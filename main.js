const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const {
  getDb,
  getDashboardData,
  getDataPage,
  getDatabasePath,
  getNextOrderCode,
  getNextQuoteCode,
  setConfig,
  createPrinter,
  updatePrinter,
  deletePrinter,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  createOrder,
  updateOrder,
  deleteOrder,
  savePurchase,
  deletePurchase,
  saveAsset,
  deleteAsset,
  createQuote,
  deleteQuote,
  convertQuoteToOrder,
  replaceAllData,
  resetBusinessData,
  exportBackupData
} = require('./database');
const { normalizeResetOptions } = require('./reset-options');
const { writeVerifiedBackup } = require('./backup-safety');

let mainWindow = null;
let ipcHandlersRegistered = false;
let autoBackupTimer = null;
let autoBackupRunning = false;
let shutdownBackupDone = false;
let maintenanceBusy = false;

function writeStartupError(error) {
  try {
    const dir = path.join(app.getPath('documents'), 'MOO3D', 'Logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'startup-error.log');
    const text = `[${new Date().toISOString()}] ${error?.stack || error?.message || String(error)}\n`;
    fs.appendFileSync(file, text, 'utf8');
    return file;
  } catch (_) {
    return null;
  }
}

process.on('uncaughtException', (error) => {
  const logFile = writeStartupError(error);
  try {
    dialog.showErrorBox('MOO3D Startup Error', `${error?.message || error}\n${logFile ? `\nLog: ${logFile}` : ''}`);
  } catch (_) {}
});

process.on('unhandledRejection', (error) => {
  writeStartupError(error);
});

const CHANNELS = {
  getDashboardData: 'db:getDashboardData',
  getDataPage: 'db:getDataPage',
  getNextOrderCode: 'db:getNextOrderCode',
  getNextQuoteCode: 'db:getNextQuoteCode',
  saveConfig: 'db:saveConfig',
  savePrinter: 'db:savePrinter',
  deletePrinter: 'db:deletePrinter',
  saveMaterial: 'db:saveMaterial',
  deleteMaterial: 'db:deleteMaterial',
  createOrder: 'db:createOrder',
  updateOrder: 'db:updateOrder',
  deleteOrder: 'db:deleteOrder',
  savePurchase: 'db:savePurchase',
  deletePurchase: 'db:deletePurchase',
  saveAsset: 'db:saveAsset',
  deleteAsset: 'db:deleteAsset',
  createQuote: 'db:createQuote',
  deleteQuote: 'db:deleteQuote',
  convertQuoteToOrder: 'db:convertQuoteToOrder',
  exportBackup: 'db:exportBackup',
  importBackup: 'db:importBackup',
  resetBusinessData: 'db:resetBusinessData',
  openSafetyBackups: 'backup:openSafetyBackups',
  confirmDialog: 'dialog:confirm'
};

function ok(data = null) {
  return { success: true, data };
}

function fail(message) {
  return { success: false, message };
}

function ensureDbReady() {
  getDb();
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asTrimmedString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asPositiveNumber(value, fallback = 0) {
  const num = asNumber(value, fallback);
  return num >= 0 ? num : fallback;
}

function asNullableId(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function asInteger(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.floor(num);
}

function asPositiveInteger(value, fallback = 1) {
  const integer = asInteger(value, fallback);
  return integer > 0 ? integer : fallback;
}

function normalizeStatus(value, fallback = 'new') {
  const status = asTrimmedString(value, fallback);

  if (['new', 'printing', 'finished', 'delivered', 'cancelled'].includes(status)) {
    return status;
  }

  return fallback;
}

function normalizePrinterStatus(value, fallback = 'idle') {
  const status = asTrimmedString(value, fallback);

  if (['idle', 'printing', 'maintenance', 'offline'].includes(status)) {
    return status;
  }

  return fallback;
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1200,
    minHeight: 720,
    show: false,
    center: true,
    autoHideMenuBar: true,
    backgroundColor: '#050807',
    title: '3D Print Farm App',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const currentUrl = mainWindow.webContents.getURL();

    if (url !== currentUrl) {
      event.preventDefault();

      if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url);
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function handleIpc(channel, handler, fallbackMessage) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      if (maintenanceBusy) throw new Error('جاري تأمين البيانات. أعد المحاولة بعد انتهاء الاستيراد أو البداية الجديدة.');
      ensureDbReady();
      return await handler(payload);
    } catch (error) {
      console.error(`[IPC ERROR] ${channel}`, error);
      return fail(error?.message || fallbackMessage || 'حدث خطأ غير متوقع');
    }
  });
}

function normalizePrinterPayload(payload) {
  const data = asObject(payload);

  return {
    id: asNullableId(data.id),
    name: asTrimmedString(data.name),
    model: asTrimmedString(data.model),
    status: normalizePrinterStatus(data.status, 'idle'),
    hourlyDepreciation: asPositiveNumber(data.hourlyDepreciation, 0),
    notes: asTrimmedString(data.notes)
  };
}

function normalizeMaterialPayload(payload) {
  const data = asObject(payload);

  return {
    id: asNullableId(data.id),
    name: asTrimmedString(data.name),
    type: asTrimmedString(data.type),
    color: asTrimmedString(data.color),
    weight: asPositiveNumber(data.weight, 0),
    remaining: asPositiveNumber(data.remaining, 0),
    price: asPositiveNumber(data.price, 0),
    lowStockThreshold: asPositiveNumber(data.lowStockThreshold, 0),
    supplier: asTrimmedString(data.supplier)
  };
}

function normalizeMaterialUsageItem(item) {
  const data = asObject(item);

  return {
    materialId: asNullableId(data.materialId),
    materialName: asTrimmedString(data.materialName),
    grams: asPositiveNumber(data.grams, 0),
    pricePerGram: asPositiveNumber(data.pricePerGram, 0),
    totalCost: asPositiveNumber(data.totalCost, 0),
    remaining: asPositiveNumber(data.remaining, 0)
  };
}

function normalizeOrderPayload(payload) {
  const data = asObject(payload);
  const finalPrice = asPositiveNumber(data.finalPrice, 0);
  return {
    code: asTrimmedString(data.code),
    itemName: asTrimmedString(data.itemName),
    customerName: asTrimmedString(data.customerName),
    printerId: asNullableId(data.printerId),
    status: normalizeStatus(data.status, 'new'),
    quantity: asInteger(data.quantity, 0),
    printHours: asPositiveNumber(data.printHours, 0),
    manualMinutes: asPositiveNumber(data.manualMinutes, 0),
    notes: asTrimmedString(data.notes),
    date: asTrimmedString(data.date),

    materialCost: asPositiveNumber(data.materialCost, 0),
    wasteWeight: asPositiveNumber(data.wasteWeight, 0),
    wasteCost: asPositiveNumber(data.wasteCost, 0),
    depreciationCost: asPositiveNumber(data.depreciationCost, 0),
    electricityCost: asPositiveNumber(data.electricityCost, 0),
    laborCost: asPositiveNumber(data.laborCost, 0),
    packagingCost: asPositiveNumber(data.packagingCost, 0),
    accessoriesCost: asPositiveNumber(data.accessoriesCost, 0),
    shippingCost: asPositiveNumber(data.shippingCost, 0),
    riskCost: asPositiveNumber(data.riskCost, 0),
    taxCost: asPositiveNumber(data.taxCost, 0),
    totalCost: asPositiveNumber(data.totalCost, 0),

    priceBeforeDiscount: asPositiveNumber(data.priceBeforeDiscount, finalPrice),
    discountValue: asPositiveNumber(data.discountValue, 0),
    priceAfterDiscount: asPositiveNumber(data.priceAfterDiscount, finalPrice),
    minimumOrderPrice: asPositiveNumber(data.minimumOrderPrice, 0),
    roundedAdjustment: asPositiveNumber(data.roundedAdjustment, 0),

    finalPrice,
    profit: asNumber(data.profit, 0),
    unitFinalPrice: asPositiveNumber(data.unitFinalPrice, finalPrice / Math.max(1, asPositiveNumber(data.quantity, 1))),
    unitTotalCost: asPositiveNumber(data.unitTotalCost, asPositiveNumber(data.totalCost, 0) / Math.max(1, asPositiveNumber(data.quantity, 1))),
    unitProfit: asNumber(data.unitProfit, asNumber(data.profit, 0) / Math.max(1, asPositiveNumber(data.quantity, 1))),
    replaceMaterialUsage: data.replaceMaterialUsage === undefined
      ? Array.isArray(data.materialUsage)
      : data.replaceMaterialUsage === true,
    materialUsage: Array.isArray(data.materialUsage)
      ? data.materialUsage.map(normalizeMaterialUsageItem)
      : []
  };
}


function normalizePurchasePayload(payload) {
  const data = asObject(payload);
  return {
    id: asNullableId(data.id),
    date: asTrimmedString(data.date),
    category: asTrimmedString(data.category, 'أخرى'),
    item: asTrimmedString(data.item),
    quantity: asPositiveNumber(data.quantity, 1),
    gramsPerUnit: asPositiveNumber(data.gramsPerUnit, 0),
    amount: asPositiveNumber(data.amount, 0),
    supplier: asTrimmedString(data.supplier),
    notes: asTrimmedString(data.notes),
    materialId: asNullableId(data.materialId),
    createMaterial: data.createMaterial === true
  };
}

function normalizeAssetPayload(payload) {
  const data = asObject(payload);
  return {
    id: asNullableId(data.id),
    date: asTrimmedString(data.date),
    item: asTrimmedString(data.item),
    cost: asPositiveNumber(data.cost, 0),
    type: asTrimmedString(data.type),
    depreciationHours: asPositiveNumber(data.depreciationHours, 0),
    notes: asTrimmedString(data.notes)
  };
}

function validatePurchasePayload(data) {
  if (!data.date) throw new Error('تاريخ المشتريات مطلوب');
  if (!data.item) throw new Error('اسم بند المشتريات مطلوب');
  if (data.quantity <= 0) throw new Error('كمية المشتريات لازم تكون أكبر من صفر');
  if (data.category === 'خامات' && (data.materialId || data.createMaterial) && data.gramsPerUnit <= 0) {
    throw new Error('اكتب جرام للواحدة/البكرة عشان المخزون يزيد صح');
  }
}

function validateAssetPayload(data) {
  if (!data.date) throw new Error('تاريخ الأصل مطلوب');
  if (!data.item) throw new Error('اسم الأصل مطلوب');
  if (data.cost <= 0) throw new Error('تكلفة الأصل لازم تكون أكبر من صفر');
}

function validatePrinterPayload(data) {
  if (!data.name) throw new Error('اسم الطابعة مطلوب');
}

function validateMaterialPayload(data) {
  if (!data.name) throw new Error('اسم الخامة مطلوب');
  if (data.weight <= 0) throw new Error('وزن الخامة لازم يكون أكبر من صفر');
  // Remaining is total stock; weight is the reference pack size used in gram pricing.
}

function validateCreateOrderPayload(data) {
  if (!data.code) throw new Error('كود الأوردر غير صالح');
  if (!data.itemName) throw new Error('اسم المجسم مطلوب');
  if (!data.printerId) throw new Error('اختار الطابعة المستخدمة');
  if (!data.date) throw new Error('تاريخ الأوردر مطلوب');
  if (!Number.isInteger(Number(data.quantity)) || Number(data.quantity) <= 0) throw new Error('عدد القطع لازم يكون رقم صحيح موجب');
  if (data.printHours <= 0) throw new Error('وقت الطباعة لازم يكون أكبر من صفر');

  if (!Array.isArray(data.materialUsage) || data.materialUsage.length === 0) {
    throw new Error('أدخل استهلاك خامة واحدة على الأقل');
  }

  for (const item of data.materialUsage) {
    if (!item || !item.materialId) throw new Error('بيانات الخامة غير صالحة');
    if (asPositiveNumber(item.grams, 0) <= 0) throw new Error('كمية الخامة لازم تكون أكبر من صفر');
  }

  if (data.finalPrice < data.totalCost + data.accessoriesCost + data.shippingCost) throw new Error('سعر البيع أقل من التكلفة والمصاريف المباشرة');
}

function validateUpdateOrderPayload(data) {
  if (!data.code) throw new Error('كود الأوردر غير صالح');
  if (!data.itemName) throw new Error('اسم المجسم مطلوب');
  if (!data.printerId) throw new Error('اختار الطابعة المستخدمة');
  if (!data.date) throw new Error('تاريخ الأوردر مطلوب');
  if (!Number.isInteger(Number(data.quantity)) || Number(data.quantity) <= 0) throw new Error('عدد القطع لازم يكون رقم صحيح موجب');
  if (data.printHours <= 0) throw new Error('وقت الطباعة لازم يكون أكبر من صفر');

  if (data.replaceMaterialUsage) {
    if (!Array.isArray(data.materialUsage) || data.materialUsage.length === 0) {
      throw new Error('أدخل استهلاك خامة واحدة على الأقل');
    }

    for (const item of data.materialUsage) {
      if (!item || !item.materialId) throw new Error('بيانات الخامة غير صالحة');
      if (asPositiveNumber(item.grams, 0) <= 0) throw new Error('كمية الخامة لازم تكون أكبر من صفر');
    }
  }

  if (data.finalPrice < data.totalCost + data.accessoriesCost + data.shippingCost) throw new Error('سعر البيع أقل من التكلفة والمصاريف المباشرة');
}

function validateCreateQuotePayload(data) {
  if (!data.quoteCode) throw new Error('كود عرض السعر غير صالح');
  if (!data.itemName) throw new Error('اسم المجسم مطلوب');
  if (!data.printerId) throw new Error('اختار الطابعة المستخدمة');
  if (!data.date) throw new Error('تاريخ عرض السعر مطلوب');
  if (!Number.isInteger(Number(data.quantity)) || Number(data.quantity) <= 0) throw new Error('عدد القطع لازم يكون رقم صحيح موجب');
  if (data.printHours <= 0) throw new Error('وقت الطباعة لازم يكون أكبر من صفر');
  if (!Array.isArray(data.materialUsage) || data.materialUsage.length === 0) {
    throw new Error('أدخل استهلاك خامة واحدة على الأقل');
  }

  for (const item of data.materialUsage) {
    if (!item || !item.materialId) throw new Error('بيانات الخامة غير صالحة');
    if (asPositiveNumber(item.grams, 0) <= 0) throw new Error('كمية الخامة لازم تكون أكبر من صفر');
  }

  if (data.finalPrice < data.totalCost + data.accessoriesCost + data.shippingCost) throw new Error('سعر البيع أقل من التكلفة والمصاريف المباشرة');
}

function getBackupsDir() {
  return path.join(app.getPath('documents'), 'MOO3D', 'Backups');
}

function ensureBackupsDir() {
  const dir = getBackupsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createAutomaticBackup(reason = 'auto') {
  return new Promise((resolve) => {
    try {
      ensureDbReady();
      ensureBackupsDir();

      const worker = new Worker(path.join(__dirname, 'backup-worker.js'), {
        workerData: {
          dbPath: getDatabasePath(),
          backupsDir: getBackupsDir(),
          reason: String(reason || 'auto')
        }
      });

      let settled = false;
      const finish = (filePath = null) => {
        if (settled) return;
        settled = true;
        resolve(filePath || null);
      };

      worker.on('message', (message) => {
        if (message?.success) {
          finish(message.filePath || null);
          return;
        }

        console.warn('[AUTO BACKUP FAILED]', message?.message || 'Unknown backup worker error');
        finish(null);
      });

      worker.on('error', (error) => {
        console.warn('[AUTO BACKUP FAILED]', error?.message || error);
        finish(null);
      });

      worker.on('exit', (code) => {
        if (!settled) {
          console.warn('[AUTO BACKUP FAILED]', `worker exited with code ${code}`);
          finish(null);
        }
      });

      if (typeof worker.unref === 'function') worker.unref();
    } catch (error) {
      console.warn('[AUTO BACKUP FAILED]', error?.message || error);
      resolve(null);
    }
  });
}

function createProtectedBackup(reason) {
  const database = getDb();
  const check = database.prepare('PRAGMA quick_check').get();
  if (!check || Object.values(check)[0] !== 'ok') throw new Error('فحص قاعدة البيانات لم ينجح. تم إيقاف العملية دون مسح.');
  return writeVerifiedBackup(exportBackupData(), path.join(ensureBackupsDir(), 'Protected'), reason, validateBackupPayload);
}

function scheduleAutomaticBackup(reason = 'auto', delayMs = 2000) {
  if (autoBackupTimer) {
    clearTimeout(autoBackupTimer);
  }

  autoBackupTimer = setTimeout(() => {
    autoBackupTimer = null;

    if (autoBackupRunning) {
      scheduleAutomaticBackup(reason, delayMs);
      return;
    }

    autoBackupRunning = true;
    createAutomaticBackup(reason)
      .catch((error) => console.warn('[AUTO BACKUP FAILED]', error?.message || error))
      .finally(() => {
        autoBackupRunning = false;
      });
  }, Math.max(500, Number(delayMs || 2000)));
}

function validateBackupPayload(payload) {
  const data = asObject(payload);
  const schemaVersion = Number(data.schemaVersion || 0);

  if (!data.appName || !String(data.appName).toLowerCase().includes('print farm')) {
    throw new Error('ملف النسخة الاحتياطية لا يبدو أنه خاص بالبرنامج');
  }

  if (!Number.isInteger(schemaVersion) || schemaVersion < 7 || schemaVersion > 9) {
    throw new Error('إصدار النسخة الاحتياطية قديم أو غير صالح');
  }

  if (!data.config || typeof data.config !== 'object' || Array.isArray(data.config)) {
    throw new Error('ملف النسخة الاحتياطية لا يحتوي على إعدادات صحيحة');
  }

  ['printers', 'materials', 'orders', 'orderMaterials', 'stockMovements', 'purchases', 'assets'].forEach((key) => {
    if (schemaVersion >= 9 && !Array.isArray(data[key])) {
      throw new Error(`النسخة الاحتياطية ناقصة: ${key}. لم يتم استبدال البيانات.`);
    }
    if (data[key] !== undefined && !Array.isArray(data[key])) {
      throw new Error(`بنية النسخة الاحتياطية غير صالحة في: ${key}`);
    }
  });

  if (data.quotes !== undefined && !Array.isArray(data.quotes)) {
    throw new Error('بنية عروض الأسعار في النسخة الاحتياطية غير صالحة');
  }

  const printers = Array.isArray(data.printers) ? data.printers : [];
  const materials = Array.isArray(data.materials) ? data.materials : [];
  const orders = Array.isArray(data.orders) ? data.orders : [];
  const orderMaterials = Array.isArray(data.orderMaterials) ? data.orderMaterials : [];
  const stockMovements = Array.isArray(data.stockMovements) ? data.stockMovements : [];
  const purchases = Array.isArray(data.purchases) ? data.purchases : [];
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const quotes = Array.isArray(data.quotes) ? data.quotes : [];

  const numericFields = {
    printers: ['hourlyDepreciation'],
    materials: ['weight', 'remaining', 'price', 'lowStockThreshold'],
    orders: ['quantity', 'printHours', 'manualMinutes', 'materialCost', 'wasteWeight', 'wasteCost',
      'depreciationCost', 'electricityCost', 'laborCost', 'packagingCost', 'accessoriesCost',
      'shippingCost', 'riskCost', 'taxCost', 'totalCost', 'priceBeforeDiscount', 'discountValue',
      'priceAfterDiscount', 'minimumOrderPrice', 'roundedAdjustment', 'finalPrice', 'profit',
      'unitFinalPrice', 'unitTotalCost', 'unitProfit', 'paidAmount'],
    orderMaterials: ['grams', 'pricePerGram', 'totalCost'], stockMovements: ['quantity'],
    purchases: ['quantity', 'gramsPerUnit', 'amount'], assets: ['cost', 'depreciationHours'],
    quotes: ['quantity', 'finalPrice', 'profit']
  };
  for (const [key, fields] of Object.entries(numericFields)) {
    for (const row of (data[key] || [])) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`سجل غير صالح في: ${key}`);
      for (const field of fields) {
        if (row[field] !== undefined && (row[field] === null || row[field] === '' || !Number.isFinite(Number(row[field])))) {
          throw new Error(`رقم غير صالح في النسخة الاحتياطية: ${key}.${field}`);
        }
      }
    }
  }
  for (const key of ['printers', 'materials', 'orders']) {
    const seen = new Set();
    for (const row of data[key] || []) {
      if (!Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0 || seen.has(Number(row.id))) {
        throw new Error(`معرف مفقود أو مكرر في: ${key}`);
      }
      seen.add(Number(row.id));
    }
  }
  const ids = (rows) => new Set(rows.map((row) => Number(row.id)));
  const printerIds = ids(printers), materialIds = ids(materials), orderIds = ids(orders);
  const checkReference = (value, allowed, label, required = false) => {
    if (value == null && !required) return;
    if (!allowed.has(Number(value))) throw new Error(`مرجع مفقود في النسخة الاحتياطية: ${label}`);
  };
  orders.forEach((row) => checkReference(row.printerId, printerIds, 'طابعة الأوردر'));
  orderMaterials.forEach((row) => {
    checkReference(row.orderId, orderIds, 'استهلاك الأوردر', true);
    checkReference(row.materialId, materialIds, 'خامة الأوردر');
  });
  stockMovements.forEach((row) => checkReference(row.materialId, materialIds, 'حركة الخامة'));
  purchases.forEach((row) => checkReference(row.materialId, materialIds, 'خامة المشتريات'));

  const allowedPrinterStatuses = new Set(['idle', 'printing', 'maintenance', 'offline']);
  const allowedOrderStatuses = new Set(['new', 'printing', 'finished', 'delivered', 'cancelled']);
  const allowedQuoteStatuses = new Set(['open', 'converted']);
  const allowedStockMovements = new Set(['in', 'out', 'return', 'purchase', 'sale', 'adjust_in', 'adjust_out', 'manual', 'correction']);

  printers.forEach((printer, index) => {
    if (!asTrimmedString(printer.name)) throw new Error(`طابعة بدون اسم في النسخة الاحتياطية رقم ${index + 1}`);
    if (asPositiveNumber(printer.hourlyDepreciation, 0) !== asNumber(printer.hourlyDepreciation, 0)) throw new Error('تكلفة إهلاك طابعة غير صالحة');
    const status = asTrimmedString(printer.status, 'idle');
    if (!allowedPrinterStatuses.has(status)) throw new Error(`حالة طابعة غير صالحة: ${status}`);
  });

  materials.forEach((material, index) => {
    if (!asTrimmedString(material.name)) throw new Error(`خامة بدون اسم في النسخة الاحتياطية رقم ${index + 1}`);
    if (asPositiveNumber(material.weight, 0) !== asNumber(material.weight, 0)) throw new Error('وزن خامة غير صالح');
    if (asPositiveNumber(material.remaining, 0) !== asNumber(material.remaining, 0)) throw new Error('كمية خامة متبقية غير صالحة');
    if (asPositiveNumber(material.price, 0) !== asNumber(material.price, 0)) throw new Error('سعر خامة غير صالح');
    // Restocking can exceed the reference pack weight. Do not change weight or price: both define the existing gram price.
  });

  orders.forEach((order, index) => {
    if (!asTrimmedString(order.code)) throw new Error(`أوردر بدون كود في النسخة الاحتياطية رقم ${index + 1}`);
    if (!asTrimmedString(order.itemName)) throw new Error(`أوردر بدون اسم مجسم: ${asTrimmedString(order.code)}`);
    const status = asTrimmedString(order.status, 'new');
    if (!allowedOrderStatuses.has(status)) throw new Error(`حالة أوردر غير صالحة: ${status}`);
    if (asPositiveInteger(order.quantity, 0) <= 0) throw new Error(`عدد قطع غير صالح في الأوردر: ${asTrimmedString(order.code)}`);
    if (asPositiveNumber(order.finalPrice, 0) <= 0) throw new Error(`سعر بيع غير صالح في الأوردر: ${asTrimmedString(order.code)}`);
  });

  orderMaterials.forEach((item) => {
    if (asPositiveNumber(item.grams, 0) <= 0) throw new Error('استهلاك خامة غير صالح في النسخة الاحتياطية');
    if (asPositiveNumber(item.totalCost, 0) !== asNumber(item.totalCost, 0)) throw new Error('تكلفة خامة غير صالحة في النسخة الاحتياطية');
  });

  stockMovements.forEach((movement) => {
    const type = asTrimmedString(movement.movementType, 'manual');
    if (!allowedStockMovements.has(type)) throw new Error(`نوع حركة مخزون غير صالح: ${type}`);
    if (asNumber(movement.quantity, 0) === 0) throw new Error('حركة مخزون بكمية صفر غير صالحة');
  });

  purchases.forEach((purchase) => {
    if (!asTrimmedString(purchase.item)) throw new Error('بند مشتريات بدون اسم في النسخة الاحتياطية');
    if (asPositiveNumber(purchase.quantity, 0) <= 0) throw new Error('كمية مشتريات غير صالحة في النسخة الاحتياطية');
    if (asPositiveNumber(purchase.amount, 0) !== asNumber(purchase.amount, 0)) throw new Error('قيمة مشتريات غير صالحة في النسخة الاحتياطية');
  });

  assets.forEach((asset) => {
    if (!asTrimmedString(asset.item)) throw new Error('أصل بدون اسم في النسخة الاحتياطية');
    if (asPositiveNumber(asset.cost, 0) <= 0) throw new Error('تكلفة أصل غير صالحة في النسخة الاحتياطية');
  });

  quotes.forEach((quote) => {
    if (!asTrimmedString(quote.code)) throw new Error('عرض سعر بدون كود في النسخة الاحتياطية');
    const status = asTrimmedString(quote.status, 'open');
    if (!allowedQuoteStatuses.has(status)) throw new Error(`حالة عرض سعر غير صالحة: ${status}`);
    if (asPositiveNumber(quote.finalPrice, 0) <= 0) throw new Error(`سعر عرض غير صالح: ${asTrimmedString(quote.code)}`);
  });

  return data;
}

function registerIpcHandlers() {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  handleIpc(CHANNELS.getDashboardData, async () => ok(getDashboardData()), 'فشل في تحميل البيانات');
  handleIpc(
    CHANNELS.getDataPage,
    async (payload) => {
      const data = asObject(payload);
      return ok(getDataPage(data.kind, {
        limit: data.limit,
        offset: data.offset,
        includeAll: Boolean(data.includeAll),
        filters: asObject(data.filters)
      }));
    },
    'فشل في تحميل صفحة البيانات'
  );
  handleIpc(CHANNELS.getNextOrderCode, async () => ok(getNextOrderCode()), 'فشل في إنشاء كود الأوردر');
  handleIpc(CHANNELS.getNextQuoteCode, async () => ok(getNextQuoteCode()), 'فشل في إنشاء كود عرض السعر');

  handleIpc(
    CHANNELS.saveConfig,
    async (payload) => {
      for (const [key, value] of Object.entries(asObject(payload))) {
        setConfig(key, value);
      }

      return ok();
    },
    'فشل في حفظ الإعدادات'
  );

  handleIpc(
    CHANNELS.savePrinter,
    async (payload) => {
      const data = normalizePrinterPayload(payload);
      validatePrinterPayload(data);

      if (data.id) updatePrinter(data);
      else createPrinter(data);

      return ok();
    },
    'فشل في حفظ الطابعة'
  );

  handleIpc(
    CHANNELS.deletePrinter,
    async (payload) => {
      const id = asNullableId(asObject(payload).id);
      if (!id) throw new Error('رقم الطابعة غير صالح');

      return ok(deletePrinter(id));
    },
    'فشل في حذف الطابعة'
  );

  handleIpc(
    CHANNELS.saveMaterial,
    async (payload) => {
      const data = normalizeMaterialPayload(payload);
      validateMaterialPayload(data);

      if (data.id) updateMaterial(data);
      else createMaterial(data);

      return ok();
    },
    'فشل في حفظ الخامة'
  );

  handleIpc(
    CHANNELS.deleteMaterial,
    async (payload) => {
      const id = asNullableId(asObject(payload).id);
      if (!id) throw new Error('رقم الخامة غير صالح');

      return ok(deleteMaterial(id));
    },
    'فشل في حذف الخامة'
  );

  handleIpc(
    CHANNELS.createOrder,
    async (payload) => {
      const data = normalizeOrderPayload(payload);
      validateCreateOrderPayload(data);
      createOrder(data);
      scheduleAutomaticBackup('after-order');
      return ok();
    },
    'فشل في حفظ الأوردر'
  );

  handleIpc(
    CHANNELS.updateOrder,
    async (payload) => {
      const data = normalizeOrderPayload(payload);
      validateUpdateOrderPayload(data);
      updateOrder(data);
      scheduleAutomaticBackup('after-update');
      return ok();
    },
    'فشل في تعديل الأوردر'
  );

  handleIpc(
    CHANNELS.savePurchase,
    async (payload) => {
      const data = normalizePurchasePayload(payload);
      validatePurchasePayload(data);
      const id = savePurchase(data);
      scheduleAutomaticBackup('after-purchase');
      return ok(id);
    },
    'فشل في حفظ المشتريات'
  );

  handleIpc(
    CHANNELS.deletePurchase,
    async (payload) => {
      const id = asNullableId(asObject(payload).id);
      if (!id) throw new Error('رقم المشتريات غير صالح');
      deletePurchase(id);
      scheduleAutomaticBackup('after-delete-purchase');
      return ok();
    },
    'فشل في حذف المشتريات'
  );

  handleIpc(
    CHANNELS.saveAsset,
    async (payload) => {
      const data = normalizeAssetPayload(payload);
      validateAssetPayload(data);
      const id = saveAsset(data);
      scheduleAutomaticBackup('after-asset');
      return ok(id);
    },
    'فشل في حفظ الأصل'
  );

  handleIpc(
    CHANNELS.deleteAsset,
    async (payload) => {
      const id = asNullableId(asObject(payload).id);
      if (!id) throw new Error('رقم الأصل غير صالح');
      deleteAsset(id);
      scheduleAutomaticBackup('after-delete-asset');
      return ok();
    },
    'فشل في حذف الأصل'
  );

  handleIpc(
    CHANNELS.createQuote,
    async (payload) => {
      const data = normalizeOrderPayload(payload);
      data.quoteCode = asTrimmedString(asObject(payload).quoteCode || asObject(payload).code);
      validateCreateQuotePayload(data);
      return ok(createQuote({ ...data, quoteCode: data.quoteCode }));
    },
    'فشل في حفظ عرض السعر'
  );

  handleIpc(
    CHANNELS.deleteQuote,
    async (payload) => {
      const code = asTrimmedString(asObject(payload).code);
      if (!code) throw new Error('كود عرض السعر غير صالح');
      deleteQuote(code);
      return ok();
    },
    'فشل في حذف عرض السعر'
  );

  handleIpc(
    CHANNELS.convertQuoteToOrder,
    async (payload) => {
      const quoteCode = asTrimmedString(asObject(payload).code);
      if (!quoteCode) throw new Error('كود عرض السعر غير صالح');
      const orderCode = getNextOrderCode();
      const createdOrderCode = convertQuoteToOrder(quoteCode, orderCode);
      scheduleAutomaticBackup('after-convert-quote');
      return ok(createdOrderCode);
    },
    'فشل في تحويل عرض السعر لأوردر'
  );

  handleIpc(
    CHANNELS.deleteOrder,
    async (payload) => {
      const code = asTrimmedString(asObject(payload).code);
      if (!code) throw new Error('كود الأوردر غير صالح');

      deleteOrder(code);
      scheduleAutomaticBackup('after-delete');
      return ok();
    },
    'فشل في حذف الأوردر'
  );

  handleIpc(CHANNELS.exportBackup, async () => ok(exportBackupData()), 'فشل في تصدير النسخة الاحتياطية');

  handleIpc(
    CHANNELS.importBackup,
    async (payload) => {
      const data = validateBackupPayload(payload);
      maintenanceBusy = true;
      try {
        const backupPath = createProtectedBackup('before-import');
        replaceAllData(data);
        scheduleAutomaticBackup('after-import');
        return ok({ backupPath });
      } finally { maintenanceBusy = false; }
    },
    'فشل في استيراد النسخة الاحتياطية'
  );

  handleIpc(CHANNELS.resetBusinessData, async (payload) => {
    const options = normalizeResetOptions(payload);
    maintenanceBusy = true;
    try {
      const details = [
        'سيتم مسح كل المبيعات وعروض الأسعار والمشتريات والخامات وحركات المخزون وتصفير كاش البداية.',
        options.clearPrinters ? 'سيتم حذف الطابعات أيضًا.' : 'سيتم الاحتفاظ بالطابعات.',
        options.clearAssets ? 'سيتم حذف الأصول؛ هذا يغير قيم مدخلات الإهلاك.' : 'سيتم الاحتفاظ بالأصول.',
        options.resetMachineHours ? 'سيتم تصفير ساعات الماكينة وآخر صيانة.' : 'سيتم الحفاظ على إجمالي ساعات الماكينة وآخر صيانة.',
        options.restartCodes ? 'ستبدأ أرقام الأوردرات من ORD-1001. استخدم هذا للبيانات التجريبية فقط.' : 'لن تبدأ أرقام الأوردرات من جديد.',
        'معادلة التسعير وإعدادات تكاليف التشغيل لا تتغير. ستُحفظ نسخة أمان مؤكدة قبل المسح.'
      ].join('\n\n');
      const optionsDialog = { type: 'warning', title: 'تأكيد البداية الجديدة',
        buttons: ['إلغاء', 'حفظ نسخة أمان ثم المسح'], defaultId: 0, cancelId: 0, noLink: true,
        message: 'هذه العملية تمسح البيانات الحالية. هل أنت متأكد؟', detail: details };
      const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      const confirmation = owner ? await dialog.showMessageBox(owner, optionsDialog) : await dialog.showMessageBox(optionsDialog);
      if (confirmation.response !== 1) return ok({ cancelled: true });
      const backupPath = createProtectedBackup('before-reset');
      const result = resetBusinessData(options);
      scheduleAutomaticBackup('after-reset');
      return ok({ ...result, backupPath });
    } finally { maintenanceBusy = false; }
  }, 'تعذر تنفيذ البداية الجديدة');

  handleIpc(CHANNELS.openSafetyBackups, async () => {
    const directory = path.join(ensureBackupsDir(), 'Protected');
    fs.mkdirSync(directory, { recursive: true });
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
    return ok();
  }, 'تعذر فتح مجلد نسخ الأمان');

  ipcMain.handle(CHANNELS.confirmDialog, async (_event, payload) => {
    const confirmOptions = {
      type: 'question',
      buttons: ['نعم', 'إلغاء'],
      defaultId: 0,
      cancelId: 1,
      title: 'تأكيد',
      message: asTrimmedString(asObject(payload).message, 'هل أنت متأكد؟')
    };
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const result = owner
      ? await dialog.showMessageBox(owner, confirmOptions)
      : await dialog.showMessageBox(confirmOptions);

    return {
      success: true,
      confirmed: result.response === 0
    };
  });
}

app.disableHardwareAcceleration();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  try {
    ensureDbReady();
    scheduleAutomaticBackup('startup', 8000);
    setInterval(() => scheduleAutomaticBackup('daily', 8000), 24 * 60 * 60 * 1000);
    registerIpcHandlers();
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  } catch (error) {
    const logFile = writeStartupError(error);
    dialog.showErrorBox('MOO3D لم يبدأ', `${error?.message || error}\n${logFile ? `\nتم حفظ التفاصيل في: ${logFile}` : ''}`);
    app.quit();
  }
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
});

app.on('before-quit', (event) => {
  if (!hasSingleInstanceLock) return;
  if (shutdownBackupDone) return;

  event.preventDefault();
  shutdownBackupDone = true;

  if (autoBackupTimer) {
    clearTimeout(autoBackupTimer);
    autoBackupTimer = null;
  }

  createAutomaticBackup('shutdown')
    .catch((error) => console.warn('[SHUTDOWN BACKUP FAILED]', error?.message || error))
    .finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
