'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const { createAppHarness, sampleOrder } = require('./helpers/app-harness');
const { normalizeResetOptions } = require('../reset-options');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'moo3d-stability-'));
let h, passed = 0;
const test = async (name, action) => { await action(); passed++; console.log(`PASS ${passed}: ${name}`); };
const stock = (id) => Number(h.database.getDb().prepare('SELECT remaining FROM materials WHERE id = ?').get(id)?.remaining);
const full = () => h.database.exportBackupData();
const clone = (data) => JSON.parse(JSON.stringify(data));
const fresh = (name) => { h = createAppHarness(path.join(temporary, name)); return h; };
const getOrder = (code) => h.database.getDataPage('orders', { includeAll: true }).items.find((o) => o.code === code);
async function workerBackup(reason) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '../backup-worker.js'), { workerData: {
      dbPath: h.dbPath, backupsDir: path.join(h.documents, 'MOO3DSTUDIO/Backups'), reason
    } });
    worker.once('message', (msg) => msg.success ? resolve(msg.filePath) : reject(new Error(msg.message)));
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`Worker exit ${code}`)); });
  });
}

(async () => {
  await test('first launch has no business data and creates the blank tracker in Windows Documents', async () => {
    h = createAppHarness(path.join(temporary, 'clean'), { withSampleMaterials: false });
    assert.equal(h.appPaths.userData, path.join(h.appPaths.appData, 'MOO3DSTUDIO'));
    h.appPaths.documents = path.join(temporary, 'different Windows owner', 'redirected Documents');
    const file = path.join(h.appPaths.documents, 'MOO3DSTUDIO', 'متابعة_MOO3D_Farm_بداية_جديدة.xlsx');
    assert.equal(fs.existsSync(file), false);
    await h.startApp();
    assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(__dirname, '../assets/tracking-template.xlsx')));
    const modifiedTime = new Date('2026-01-01');
    fs.utimesSync(file, modifiedTime, modifiedTime);
    await h.startApp();
    assert.equal(fs.statSync(file).mtimeMs, modifiedTime.getTime());
    const data = full();
    for (const field of ['printers', 'assets', 'materials', 'orders', 'quotes', 'purchases', 'stockMovements']) {
      assert.equal(data[field].length, 0, field);
    }
    assert.equal(data.config.farmName, 'MOO3DSTUDIO');
    assert.equal(data.config.openingCash, '0');
    assert.equal(data.config.baseMachineHours, '0');
    assert.equal(data.config.firstRunGuideSeen, undefined);
    assert.doesNotThrow(() => h.validateBackupPayload(data));
    assert.doesNotThrow(() => h.validateBackupPayload({ ...data, appName: 'Print Farm App' }));
  });
  await test('saving the first printer with a purchase price records one asset and updates dashboard totals', async () => {
    const printer = { name: 'First printer', model: 'Test', hourlyDepreciation: 6.5 };
    const rejected = await h.farmAPI.savePrinter({ ...printer, purchase: { cost: 65000, depreciationHours: 0 } });
    assert.equal(rejected.success, false);
    assert.equal(full().printers.length, 0);

    const saved = await h.farmAPI.savePrinter({ ...printer, purchase: { cost: 65000, depreciationHours: 5000 } });
    assert.equal(saved.success, true, saved.message);
    assert.equal(saved.data.assetSaved, true);
    const dashboard = (await h.farmAPI.getDashboardData()).data;
    assert.equal(dashboard.printers.length, 1);
    assert.equal(dashboard.printers[0].hourlyDepreciation, 6.5);
    assert.equal(dashboard.assets.length, 1);
    assert.equal(dashboard.assets[0].item, printer.name);
    assert.equal(dashboard.assets[0].type, 'طابعة');
    assert.equal(dashboard.assets[0].depreciationHours, 5000);
    assert.equal(dashboard.meta.summary.totalAssets, 65000);
    const edited = await h.farmAPI.savePrinter({ ...printer, id: dashboard.printers[0].id, status: 'printing' });
    assert.equal(edited.success, true, edited.message);
    assert.equal(full().assets.length, 1);
  });
  await test('a failed purchase asset insert rolls back the new printer', async () => {
    const db = h.database.getDb();
    db.exec("CREATE TEMP TRIGGER test_block_asset BEFORE INSERT ON assets BEGIN SELECT RAISE(ABORT, 'test asset error'); END");
    try {
      const result = await h.farmAPI.savePrinter({ name: 'Uncommitted printer', purchase: { cost: 50000, depreciationHours: 5000 } });
      assert.equal(result.success, false);
      assert.equal(full().printers.length, 1);
      assert.equal(full().assets.length, 1);
    } finally {
      db.exec('DROP TRIGGER test_block_asset');
    }
  });
  fresh('sales');
  const order = sampleOrder(h.database), materialId = order.materialUsage[0].materialId;
  await test('preload → main → SQLite sale consumes 100g exactly once', async () => {
    assert.equal((await h.farmAPI.createOrder(order)).success, true);
    assert.equal(stock(materialId), 900);
  });
  await test('explicit false preserves material usage through every IPC layer', async () => {
    const before = full();
    assert.equal((await h.farmAPI.updateOrder({ ...order, customerName: 'اسم معدل', replaceMaterialUsage: false, materialUsage: [] })).success, true);
    assert.equal(stock(materialId), 900);
    assert.deepEqual(full().orderMaterials, before.orderMaterials);
    assert.deepEqual(full().stockMovements, before.stockMovements);
    assert.equal(getOrder(order.code).customerName, 'اسم معدل');
  });
  await test('sale totals are persisted and returned in fresh dashboard summary', async () => {
    const result = await h.farmAPI.getDashboardData();
    assert.equal(result.data.meta.summary.totalSales, 320);
    assert.equal(result.data.meta.summary.ordersCount, 1);
  });
  await test('delete returns 100g and removes sale', async () => {
    assert.equal((await h.farmAPI.deleteOrder(order.code)).success, true);
    assert.equal(stock(materialId), 1000);
    assert.equal(getOrder(order.code), undefined);
    assert.equal((await h.farmAPI.getDashboardData()).data.meta.summary.collected, 0);
  });
  await test('repeated delete cannot credit stock twice', async () => {
    await h.farmAPI.deleteOrder(order.code);
    assert.equal(stock(materialId), 1000);
    assert.equal(full().stockMovements.filter((m) => m.movementType === 'return').length, 1);
  });
  await test('backup validator accepts returned-stock movements', () => {
    assert.doesNotThrow(() => h.validateBackupPayload(full()));
  });
  await test('deleted sale code is not automatically reused', async () => {
    assert.equal((await h.farmAPI.getNextOrderCode()).data, 'ORD-1002');
  });
  await test('purchase createMaterial flag reaches SQLite and creates stock', async () => {
    const result = await h.farmAPI.savePurchase({ date: '2026-09-17', category: 'خامات', item: 'خامة جديدة',
      quantity: 2, gramsPerUnit: 1000, amount: 1600, createMaterial: true });
    assert.equal(result.success, true, result.message);
    const material = full().materials.find((m) => m.name === 'خامة جديدة');
    assert.ok(material);
    assert.equal(material.remaining, 2000);
  });
  await test('restock above pack size preserves price/gram and restores successfully', async () => {
    const beforeMaterial = full().materials.find((m) => m.id === materialId);
    assert.equal((await h.farmAPI.savePurchase({ date: '2026-09-17', category: 'خامات', item: beforeMaterial.name,
      quantity: 1, gramsPerUnit: 1000, amount: 800, materialId })).success, true);
    const material = full().materials.find((m) => m.id === materialId);
    assert.equal(material.remaining, 2000);
    assert.equal(material.weight, beforeMaterial.weight);
    assert.equal(material.price, beforeMaterial.price);
    const exported = full();
    const result = await h.farmAPI.importBackup(exported);
    assert.equal(result.success, true, result.message);
    assert.ok(fs.existsSync(result.data.backupPath));
    assert.equal(full().materials.find((m) => m.name === material.name).remaining, 2000);
  });
  await test('truncated backup cannot wipe valid data', async () => {
    const before = full();
    const bad = clone(before); delete bad.materials;
    assert.equal((await h.farmAPI.importBackup(bad)).success, false);
    assert.deepEqual(full().materials, before.materials);
  });
  await test('unknown future backup schema is refused', async () => {
    assert.equal((await h.farmAPI.importBackup({ ...full(), schemaVersion: 99 })).success, false);
  });
  await test('invalid numeric values and broken references are refused', async () => {
    const bad = clone(full()); bad.materials[0].remaining = 'not a number';
    assert.equal((await h.farmAPI.importBackup(bad)).success, false);
    const badReference = clone(full()); badReference.stockMovements[0].materialId = 999999;
    assert.equal((await h.farmAPI.importBackup(badReference)).success, false);
  });
  await test('typed reset phrase and strict boolean options are required', async () => {
    assert.throws(() => normalizeResetOptions({ confirmation: 'yes' }));
    assert.throws(() => normalizeResetOptions({ confirmation: 'بداية جديدة', clearAssets: 'false' }));
    const before = full();
    assert.equal((await h.farmAPI.resetBusinessData({})).success, false);
    assert.deepEqual(full().materials, before.materials);
  });
  await test('typed reset phrase alone leaves every record untouched', async () => {
    const before = full();
    const result = await h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة', confirmed: false });
    assert.equal(result.success, false);
    assert.deepEqual(full().config, before.config);
    assert.deepEqual(full().materials, before.materials);
  });
  await test('failed safety backup blocks reset before any DELETE', async () => {
    fresh('backup-failure');
    const before = full();
    fs.mkdirSync(path.join(h.documents, 'MOO3DSTUDIO/Backups'), { recursive: true });
    fs.writeFileSync(path.join(h.documents, 'MOO3DSTUDIO/Backups/Protected'), 'not a directory');
    assert.equal((await h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة', confirmed: true })).success, false);
    assert.deepEqual(full().materials, before.materials);
    assert.deepEqual(full().config, before.config);
  });
  await test('failed safety backup blocks import before replacing data', async () => {
    const before = full(), changed = clone(before); changed.config.openingCash = '1';
    assert.equal((await h.farmAPI.importBackup(changed)).success, false);
    assert.deepEqual(full().config, before.config);
  });
  await test('reset transaction rolls back on SQL error', async () => {
    fresh('rollback');
    const order = sampleOrder(h.database); await h.farmAPI.createOrder(order);
    const before = full();
    h.database.getDb().exec("CREATE TRIGGER block_reset BEFORE DELETE ON materials BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    const result = await h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة', confirmed: true });
    assert.equal(result.success, false);
    assert.deepEqual(full().orders, before.orders);
    assert.deepEqual(full().materials, before.materials);
    assert.deepEqual(full().stockMovements, before.stockMovements);
    assert.deepEqual(full().config, before.config);
    h.database.getDb().exec('DROP TRIGGER block_reset;');
  });
  let original, resetResult;
  await test('default reset clears trading data but keeps pricing, printers and assets', async () => {
    fresh('reset-defaults');
    await h.farmAPI.createOrder(sampleOrder(h.database));
    original = full();
    resetResult = await h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة', confirmed: true });
    assert.equal(resetResult.success, true, resetResult.message);
    const after = full();
    for (const field of ['orders', 'materials', 'quotes', 'purchases', 'stockMovements', 'orderMaterials']) assert.equal(after[field].length, 0, field);
    assert.deepEqual(after.printers, original.printers);
    assert.deepEqual(after.assets, original.assets);
    const allowed = new Set(['openingCash', 'baseMachineHours', 'orderCodeFloor', 'quoteCodeFloor', 'initialDataSeeded', 'lastFreshStartAt']);
    for (const [key, value] of Object.entries(original.config)) if (!allowed.has(key)) assert.equal(after.config[key], value, key);
    assert.equal(after.config.openingCash, '0');
  });
  await test('preserve total operating hours despite removing historical sales', () => {
    assert.equal(Number(full().config.baseMachineHours), Number(original.config.baseMachineHours) + 2);
    assert.equal(full().config.lastMaintenanceAtHours, original.config.lastMaintenanceAtHours);
  });
  await test('protected snapshot is complete and exactly matches pre-reset data', () => {
    const snapshot = JSON.parse(fs.readFileSync(resetResult.data.backupPath, 'utf8'));
    assert.deepEqual(snapshot.orders, clone(original.orders));
    assert.deepEqual(snapshot.materials, clone(original.materials));
    assert.deepEqual(snapshot.config, original.config);
    h.validateBackupPayload(snapshot);
  });
  await test('reopening DB does not repopulate intentionally empty materials', () => {
    h.database.setDatabasePathForTests(h.dbPath); h.database.getDb();
    assert.equal(full().materials.length, 0);
    assert.equal(full().orders.length, 0);
    assert.equal(full().config.openingCash, '0');
  });
  await test('automatic worker reads empty database without adding samples', async () => {
    const file = await workerBackup('after-reset-test');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).materials.length, 0);
    assert.equal(full().materials.length, 0);
  });
  await test('protected pre-reset backup round-trips through actual import IPC', async () => {
    const snapshot = JSON.parse(fs.readFileSync(resetResult.data.backupPath, 'utf8'));
    const result = await h.farmAPI.importBackup(snapshot);
    assert.equal(result.success, true, result.message);
    const restored = full();
    assert.deepEqual(restored.config, original.config);
    assert.equal(restored.orders[0].code, original.orders[0].code);
    assert.equal(restored.orders[0].totalCost, original.orders[0].totalCost);
    assert.equal(restored.materials.find((m) => m.name === original.materials[0].name).remaining, original.materials[0].remaining);
  });
  await test('opt-in full reset removes assets/printers, hours and restarts code numbers', async () => {
    const result = await h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة', confirmed: true, clearPrinters: true, clearAssets: true, resetMachineHours: true, restartCodes: true });
    assert.equal(result.success, true, result.message);
    assert.equal(full().printers.length, 0); assert.equal(full().assets.length, 0);
    assert.equal(full().config.baseMachineHours, '0'); assert.equal(full().config.lastMaintenanceAtHours, '0');
    assert.equal((await h.farmAPI.getNextOrderCode()).data, 'ORD-1001');
    assert.equal((await h.farmAPI.getNextQuoteCode()).data, 'Q-1001');
  });
  await test('full-reset empty tables remain empty across reopening and import', async () => {
    const empty = full();
    h.database.setDatabasePathForTests(h.dbPath); h.database.getDb();
    assert.equal(full().printers.length, 0); assert.equal(full().assets.length, 0);
    assert.equal((await h.farmAPI.importBackup(empty)).success, true);
    assert.equal(full().materials.length, 0); assert.equal(full().printers.length, 0); assert.equal(full().assets.length, 0);
  });
  await test('new real material can be entered after reset with multiple-pack stock', async () => {
    assert.equal((await h.farmAPI.saveMaterial({ name: 'رصيد حقيقي', weight: 1000, remaining: 3000, price: 800 })).success, true);
    assert.equal(full().materials.length, 1); assert.equal(full().materials[0].remaining, 3000);
    assert.equal(full().materials[0].price / full().materials[0].weight, 0.8);
  });
  await test('automatic rotation keeps protected backups', async () => {
    const backupsDir = path.join(h.documents, 'MOO3DSTUDIO/Backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(backupsDir, `moo3d-backup-old-${i}.json`), '{}');
    const protectedPath = path.join(backupsDir, 'Protected');
    const protectedNames = fs.readdirSync(protectedPath);
    await workerBackup('rotation-test');
    assert.deepEqual(fs.readdirSync(protectedPath), protectedNames);
    assert.equal(fs.readdirSync(backupsDir).filter((name) => /^moo3d-backup-.*\.json$/.test(name)).length, 10);
  });
  await test('archived original printer does not block editing historic sale metadata', async () => {
    fresh('archived-printer');
    const sale = sampleOrder(h.database); await h.farmAPI.createOrder(sale);
    h.database.deletePrinter(sale.printerId);
    const result = await h.farmAPI.updateOrder({ ...sale, customerName: 'تصحيح اسم', replaceMaterialUsage: false });
    assert.equal(result.success, true, result.message);
    assert.equal(getOrder(sale.code).customerName, 'تصحيح اسم');
  });
  await test('restored quotes point to the correct remapped material and printer IDs', async () => {
    fresh('quote-restore');
    const selected = sampleOrder(h.database);
    const originalMaterialName = selected.materialUsage[0].materialName;
    const quote = { ...selected, code: 'Q-1001' };
    assert.equal((await h.farmAPI.createQuote(quote)).success, true);
    const snapshot = full();
    // Export order is descending, so import actually changes the material identifiers.
    const result = await h.farmAPI.importBackup(snapshot);
    assert.equal(result.success, true, result.message);
    const restoredMaterial = full().materials.find((m) => m.name === originalMaterialName);
    const before = restoredMaterial.remaining;
    const converted = await h.farmAPI.convertQuoteToOrder('Q-1001');
    assert.equal(converted.success, true, converted.message);
    assert.equal(stock(restoredMaterial.id), before - 100);
    const code = full().orders[0].code;
    await h.farmAPI.deleteOrder(code);
    assert.equal(full().quotes[0].status, 'open');
  });
  await test('editing saved materials updates stock once and rejects stale or excessive changes', async () => {
    fresh('edit-materials');
    const sale = sampleOrder(h.database);
    const material = sale.materialUsage[0];
    assert.equal((await h.farmAPI.createOrder(sale)).success, true);
    const { data: before } = await h.farmAPI.getOrderMaterials(sale.code);
    assert.equal(before[0].grams, 100);
    const edited = {
      ...sale,
      replaceMaterialUsage: true,
      expectedMaterialRowIds: [before[0].rowId],
      materialUsage: [{ ...material, grams: 95, totalCost: 76 }],
      materialCost: 76,
      totalCost: 154,
      profit: 166
    };
    const result = await h.farmAPI.updateOrder(edited);
    assert.equal(result.success, true, result.message);
    assert.equal(stock(material.materialId), 905);
    assert.equal(getOrder(sale.code).finalPrice, sale.finalPrice);
    assert.equal(getOrder(sale.code).profit, 166);
    assert.equal(getOrder(sale.code).paidAmount, sale.finalPrice);
    assert.equal((await h.farmAPI.updateOrder(edited)).success, false);
    const { data: after } = await h.farmAPI.getOrderMaterials(sale.code);
    const excessive = {
      ...edited,
      expectedMaterialRowIds: [after[0].rowId],
      materialUsage: [{ ...material, grams: 1001 }]
    };
    assert.equal((await h.farmAPI.updateOrder(excessive)).success, false);
    assert.equal(stock(material.materialId), 905);
    assert.equal((await h.farmAPI.getOrderMaterials(sale.code)).data[0].grams, 95);
  });
  await test('Excel clipboard uses full cost, retains cents, and excludes cancelled orders', async () => {
    fresh('tracking-clipboard');
    const active = sampleOrder(h.database, {
      itemName: '=1+2', customerName: 'عميل\tاختبار', totalCost: 158.4, accessoriesCost: 5.25, shippingCost: 10
    });
    const cancelled = sampleOrder(h.database, { code: 'ORD-1002', status: 'cancelled' });
    assert.equal((await h.farmAPI.createOrder(active)).success, true);
    assert.equal((await h.farmAPI.createOrder(cancelled)).success, true);
    const renderer = vm.createContext({ document: {}, window: { farmAPI: h.farmAPI } });
    for (const file of ['utils.js', 'settings-export.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), renderer);
    }
    vm.runInContext('showToast = () => {};', renderer);
    await vm.runInContext('copyOrdersForTracking()', renderer);
    assert.equal(h.clipboardText, [active.code, active.date, "'=1+2", 'عميل اختبار', '320.00', '173.65', '320.00'].join('\t'));
  });
  await test('exports sales and purchases from SQLite and preserves manual sheets on refresh', async () => {
    fresh('tracking-workbook');
    const sale = sampleOrder(h.database, { itemName: '=1+2', date: '2026-11-10', totalCost: 75,
      accessoriesCost: 5.6, shippingCost: 3, finalPrice: 150, profit: 66.4 });
    assert.equal((await h.farmAPI.createOrder(sale)).success, true);
    assert.equal((await h.farmAPI.createOrder(sampleOrder(h.database, { code: 'ORD-1002', status: 'cancelled' }))).success, true);
    assert.equal((await h.farmAPI.savePurchase({ date: '2026-11-10', category: 'أخرى', item: 'مستلزمات اختبار',
      quantity: 1, amount: 40 })).success, true);
    h.database.setConfig('openingCash', '25');
    const first = await h.farmAPI.exportTrackingWorkbook();
    assert.equal(first.success, true, first.message);
    const file = path.join(h.documents, 'MOO3DSTUDIO', 'متابعة_MOO3D_Farm_بداية_جديدة.xlsx');
    assert.equal(first.data.path, file);
    assert.equal(first.data.orders, 1);
    assert.equal(first.data.purchases, 1);
    assert.equal(h.revealedFile, file);
    const JSZip = require('jszip');
    const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
    const initial = await JSZip.loadAsync(fs.readFileSync(file));
    const part = (zip, number) => zip.file(`xl/worksheets/sheet${number}.xml`).async('string');
    const cell = (xml, address) => Array.from(new DOMParser().parseFromString(xml, 'application/xml')
      .getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'c'))
      .find((node) => node.getAttribute('r') === address);
    const initialOrders = await part(initial, 8);
    assert.equal(cell(initialOrders, 'A5').textContent, sale.code);
    assert.equal(cell(initialOrders, 'C5').getAttribute('t'), 'inlineStr');
    assert.equal(cell(initialOrders, 'C5').textContent, '=1+2');
    assert.ok(Math.abs(Number(cell(initialOrders, 'F5').textContent) - 83.6) < 1e-9);
    assert.equal(cell(initialOrders, 'G5').textContent, '150');
    assert.equal(cell(await part(initial, 9), 'G5').textContent, '40');
    assert.equal(cell(await part(initial, 4), 'D5').textContent, '40');
    assert.equal(cell(await part(initial, 2), 'B21').textContent, '25');
    assert.equal(cell(await part(initial, 2), 'B6').textContent, '50000');
    assert.match(cell(await part(initial, 3), 'M5').textContent, /استيراد البرنامج.*A5/);
    assert.ok(!initialOrders.includes('ORD-1002'));

    const manualTab = 'xl/worksheets/sheet10.xml';
    const manualCell = cell(await part(initial, 10), 'C5');
    const doc = manualCell.ownerDocument;
    manualCell.setAttribute('t', 'inlineStr');
    const inlineString = manualCell.appendChild(doc.createElementNS(manualCell.namespaceURI, 'is'));
    inlineString.appendChild(doc.createElementNS(manualCell.namespaceURI, 't')).textContent = 'يدوي';
    const manual = new XMLSerializer().serializeToString(doc);
    initial.file(manualTab, manual);
    fs.writeFileSync(file, await initial.generateAsync({ type: 'nodebuffer' }));
    const locked = path.join(path.dirname(file), '~$' + path.basename(file));
    fs.writeFileSync(locked, '');
    assert.equal((await h.farmAPI.exportTrackingWorkbook()).success, false);
    assert.equal((await h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة', confirmed: true, factoryReset: true })).success, false);
    assert.ok(getOrder(sale.code));
    fs.unlinkSync(locked);

    const nextSale = sampleOrder(h.database, { date: '2026-11-11', itemName: 'طلب بعد الإدخال اليدوي' });
    assert.equal((await h.farmAPI.createOrder(nextSale)).success, true);
    const updated = await h.farmAPI.exportTrackingWorkbook();
    assert.equal(updated.success, true, updated.message);
    assert.equal(updated.data.orders, 2);
    const newer = await JSZip.loadAsync(fs.readFileSync(file));
    const newerOrders = await part(newer, 8);
    assert.equal(cell(newerOrders, 'A5').textContent, nextSale.code);
    assert.equal(cell(newerOrders, 'A6').textContent, sale.code);
    assert.equal(await part(newer, 10), manual);

    assert.equal((await h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة', confirmed: true, restartCodes: true })).success, true);
    const second = await h.farmAPI.exportTrackingWorkbook();
    assert.equal(second.success, true, second.message);
    assert.equal(second.data.orders, 0);
    assert.equal(second.data.purchases, 0);
    const refreshed = await JSZip.loadAsync(fs.readFileSync(file));
    assert.equal(cell(await part(refreshed, 8), 'A5').textContent, '');
    assert.equal(cell(await part(refreshed, 9), 'G5').textContent, '');
    assert.equal(cell(await part(refreshed, 2), 'B21').textContent, '0');
    assert.equal(await part(refreshed, 10), manual);
    assert.equal(await part(refreshed, 11), await part(initial, 11));

    const beforeFactory = fs.readFileSync(file);
    h.database.setConfig('firstRunGuideSeen', '1');
    h.database.setConfig('defaultProfitMargin', '77');
    const factory = await h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة', confirmed: true, factoryReset: true });
    assert.equal(factory.success, true, factory.message);
    assert.equal(factory.data.trackingError, null);
    assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(__dirname, '../assets/tracking-template.xlsx')));
    assert.deepEqual(fs.readFileSync(factory.data.backupPath.replace(/\.json$/, '-tracking.xlsx')), beforeFactory);
    assert.equal(full().printers.length, 0);
    assert.equal(full().assets.length, 0);
    assert.equal(full().config.firstRunGuideSeen, undefined);
    assert.equal(full().config.defaultProfitMargin, '100');
    assert.equal(factory.data.nextOrderCode, 'ORD-1001');
  });
  console.log(`\n${passed} stability scenarios passed through actual preload/main/SQLite, with native OS dialogs mocked.`);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  try { h?.database.setDatabasePathForTests(''); } catch (_) {}
  try { fs.rmSync(temporary, { recursive: true, force: true }); } catch (_) {}
});
