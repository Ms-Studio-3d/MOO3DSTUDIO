const { STOCK_EPSILON, stockCovers, allocateWaste } = require('./js/stock-weights');
const { localDateString } = require('./js/local-date');
let DatabaseDriver = null;
const path = require('path');
let electronApp = null;
try {
  ({ app: electronApp } = require('electron'));
} catch (_) {
  electronApp = null;
}

let db = null;
const BACKUP_SCHEMA_VERSION = 10;

function createNodeSqliteCompatDriver() {
  const { DatabaseSync } = require('node:sqlite');

  return class NodeSqliteCompatDatabase {
    constructor(filename, options = {}) {
      this.database = new DatabaseSync(filename, { readOnly: options.readonly === true });
    }

    prepare(sql) {
      return this.database.prepare(sql);
    }

    exec(sql) {
      return this.database.exec(sql);
    }

    pragma(statement) {
      return this.database.exec(`PRAGMA ${statement}`);
    }

    transaction(callback) {
      return (...args) => {
        this.database.exec('BEGIN IMMEDIATE');
        try {
          const result = callback(...args);
          this.database.exec('COMMIT');
          return result;
        } catch (error) {
          try { this.database.exec('ROLLBACK'); } catch (_) {}
          throw error;
        }
      };
    }

    close() {
      return this.database.close();
    }
  };
}

function getDatabaseDriver() {
  if (DatabaseDriver) return DatabaseDriver;
  try {
    const Driver = require('better-sqlite3');
    new Driver(':memory:').close();
    DatabaseDriver = Driver;
  } catch (error) {
    const bindingError = ['MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED'].includes(error.code)
      || /Could not locate the bindings file|NODE_MODULE_VERSION|No native build was found/i.test(error.message);
    if (!bindingError || process.versions.electron) throw error;
    console.warn('[SQLITE NATIVE MODULE UNAVAILABLE]', error.message);
    DatabaseDriver = createNodeSqliteCompatDriver();
  }
  return DatabaseDriver;
}

function getDatabasePath() {
  if (process.env.MOO3DSTUDIO_DB_PATH) {
    return process.env.MOO3DSTUDIO_DB_PATH;
  }

  if (electronApp && typeof electronApp.getPath === 'function') {
    const userDataPath = electronApp.getPath('userData');
    return path.join(userDataPath, 'moo3dstudio.db');
  }

  return path.join(process.cwd(), 'moo3dstudio.db');
}

function setDatabasePathForTests(dbPath) {
  if (db) {
    db.close();
    db = null;
  }

  process.env.MOO3DSTUDIO_DB_PATH = String(dbPath || '').trim();
}

function getDb(options = {}) {
  if (db) return db;

  const Database = getDatabaseDriver();
  db = new Database(getDatabasePath(), options.readonly ? { readonly: true, fileMustExist: true } : {});
  if (options.readonly) return db;
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    createTables();
    runMigrations();
    createIndexes();
    seedDefaults();
  } catch (error) {
    try { db.close(); } catch (_) {}
    db = null;
    throw error;
  }

  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS printers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      model TEXT DEFAULT '',
      status TEXT DEFAULT 'idle',
      hourly_depreciation REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT DEFAULT '',
      color TEXT DEFAULT '',
      weight REAL NOT NULL DEFAULT 1000,
      remaining REAL NOT NULL DEFAULT 1000,
      price REAL NOT NULL DEFAULT 0,
      low_stock_threshold REAL NOT NULL DEFAULT 150,
      supplier TEXT DEFAULT '',
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      item_name TEXT NOT NULL,
      customer_name TEXT DEFAULT '',
      printer_id INTEGER,
      order_status TEXT DEFAULT 'new',
      quantity REAL NOT NULL DEFAULT 1,
      print_hours REAL NOT NULL DEFAULT 0,
      manual_minutes REAL NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      order_date TEXT NOT NULL,
      material_cost REAL NOT NULL DEFAULT 0,
      waste_weight REAL NOT NULL DEFAULT 0,
      waste_cost REAL NOT NULL DEFAULT 0,
      depreciation_cost REAL NOT NULL DEFAULT 0,
      electricity_cost REAL NOT NULL DEFAULT 0,
      labor_cost REAL NOT NULL DEFAULT 0,
      packaging_cost REAL NOT NULL DEFAULT 0,
      accessories_cost REAL NOT NULL DEFAULT 0,
      shipping_cost REAL NOT NULL DEFAULT 0,
      risk_cost REAL NOT NULL DEFAULT 0,
      tax_cost REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      price_before_discount REAL NOT NULL DEFAULT 0,
      discount_value REAL NOT NULL DEFAULT 0,
      price_after_discount REAL NOT NULL DEFAULT 0,
      minimum_order_price REAL NOT NULL DEFAULT 0,
      rounded_adjustment REAL NOT NULL DEFAULT 0,
      final_price REAL NOT NULL DEFAULT 0,
      profit REAL NOT NULL DEFAULT 0,
      unit_final_price REAL NOT NULL DEFAULT 0,
      unit_total_cost REAL NOT NULL DEFAULT 0,
      unit_profit REAL NOT NULL DEFAULT 0,
      payment_status TEXT DEFAULT 'collected',
      payment_method TEXT DEFAULT 'cash',
      paid_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS order_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      material_id INTEGER,
      material_name TEXT NOT NULL,
      grams REAL NOT NULL DEFAULT 0,
      waste_grams REAL CHECK (waste_grams >= 0),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      price_per_gram REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER,
      material_name TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      reason TEXT DEFAULT '',
      reference_code TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      item_name TEXT NOT NULL,
      customer_name TEXT DEFAULT '',
      quote_date TEXT NOT NULL,
      final_price REAL NOT NULL DEFAULT 0,
      profit REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open',
      payload_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      converted_order_code TEXT DEFAULT ''
    );


    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_date TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'أخرى',
      item TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 1,
      grams_per_unit REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      supplier TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      material_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_date TEXT NOT NULL,
      item TEXT NOT NULL DEFAULT '',
      cost REAL NOT NULL DEFAULT 0,
      asset_type TEXT DEFAULT '',
      depreciation_hours REAL NOT NULL DEFAULT 0,
      hourly_depreciation_override REAL CHECK (hourly_depreciation_override >= 0),
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      printer_id INTEGER REFERENCES printers(id) ON DELETE SET NULL
    );
  `);
}

function runMigrations() {
  ensureColumnExists('materials', 'supplier', `ALTER TABLE materials ADD COLUMN supplier TEXT DEFAULT ''`);
  ensureColumnExists('materials', 'low_stock_threshold', `ALTER TABLE materials ADD COLUMN low_stock_threshold REAL NOT NULL DEFAULT 150`);
  ensureColumnExists('materials', 'is_archived', `ALTER TABLE materials ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0`);

  ensureColumnExists('printers', 'model', `ALTER TABLE printers ADD COLUMN model TEXT DEFAULT ''`);
  ensureColumnExists('printers', 'status', `ALTER TABLE printers ADD COLUMN status TEXT DEFAULT 'idle'`);
  ensureColumnExists('printers', 'hourly_depreciation', `ALTER TABLE printers ADD COLUMN hourly_depreciation REAL DEFAULT 0`);
  ensureColumnExists('printers', 'notes', `ALTER TABLE printers ADD COLUMN notes TEXT DEFAULT ''`);
  ensureColumnExists('printers', 'is_archived', `ALTER TABLE printers ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0`);
  db.transaction(() => {
    const addedPrinterLink = ensureColumnExists('assets', 'printer_id',
      'ALTER TABLE assets ADD COLUMN printer_id INTEGER REFERENCES printers(id) ON DELETE SET NULL');
    if (!addedPrinterLink) return;
    // Previous versions created the asset with the printer's exact name.
    db.exec(`
      WITH matches AS (
        SELECT a.id AS asset_id, p.id AS printer_id,
          COUNT(*) OVER (PARTITION BY a.id) AS printers_found,
          COUNT(*) OVER (PARTITION BY p.id) AS assets_found
        FROM assets a JOIN printers p ON TRIM(a.item) = TRIM(p.name)
        WHERE TRIM(a.asset_type) = 'طابعة'
      )
      UPDATE assets
      SET printer_id = (
        SELECT printer_id FROM matches
        WHERE asset_id = assets.id AND printers_found = 1 AND assets_found = 1
      )
    `);
  })();
  ensureColumnExists('assets', 'hourly_depreciation_override',
    'ALTER TABLE assets ADD COLUMN hourly_depreciation_override REAL CHECK (hourly_depreciation_override >= 0)');

  ensureColumnExists('orders', 'order_status', `ALTER TABLE orders ADD COLUMN order_status TEXT DEFAULT 'new'`);
  ensureColumnExists('orders', 'quantity', `ALTER TABLE orders ADD COLUMN quantity REAL NOT NULL DEFAULT 1`);
  ensureColumnExists('orders', 'print_hours', `ALTER TABLE orders ADD COLUMN print_hours REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'manual_minutes', `ALTER TABLE orders ADD COLUMN manual_minutes REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'material_cost', `ALTER TABLE orders ADD COLUMN material_cost REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'waste_weight', `ALTER TABLE orders ADD COLUMN waste_weight REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'waste_cost', `ALTER TABLE orders ADD COLUMN waste_cost REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'depreciation_cost', `ALTER TABLE orders ADD COLUMN depreciation_cost REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'electricity_cost', `ALTER TABLE orders ADD COLUMN electricity_cost REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'labor_cost', `ALTER TABLE orders ADD COLUMN labor_cost REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'packaging_cost', `ALTER TABLE orders ADD COLUMN packaging_cost REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'accessories_cost', `ALTER TABLE orders ADD COLUMN accessories_cost REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'shipping_cost', `ALTER TABLE orders ADD COLUMN shipping_cost REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'risk_cost', `ALTER TABLE orders ADD COLUMN risk_cost REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'tax_cost', `ALTER TABLE orders ADD COLUMN tax_cost REAL NOT NULL DEFAULT 0`);
  db.transaction(() => {
    const addedBefore = ensureColumnExists('orders', 'price_before_discount', `ALTER TABLE orders ADD COLUMN price_before_discount REAL NOT NULL DEFAULT 0`);
    ensureColumnExists('orders', 'discount_value', `ALTER TABLE orders ADD COLUMN discount_value REAL NOT NULL DEFAULT 0`);
    const addedAfter = ensureColumnExists('orders', 'price_after_discount', `ALTER TABLE orders ADD COLUMN price_after_discount REAL NOT NULL DEFAULT 0`);
    ensureColumnExists('orders', 'minimum_order_price', `ALTER TABLE orders ADD COLUMN minimum_order_price REAL NOT NULL DEFAULT 0`);
    ensureColumnExists('orders', 'rounded_adjustment', `ALTER TABLE orders ADD COLUMN rounded_adjustment REAL NOT NULL DEFAULT 0`);
    ensureColumnExists('orders', 'unit_final_price', `ALTER TABLE orders ADD COLUMN unit_final_price REAL NOT NULL DEFAULT 0`);
    ensureColumnExists('orders', 'unit_total_cost', `ALTER TABLE orders ADD COLUMN unit_total_cost REAL NOT NULL DEFAULT 0`);
    ensureColumnExists('orders', 'unit_profit', `ALTER TABLE orders ADD COLUMN unit_profit REAL NOT NULL DEFAULT 0`);
    ensureColumnExists('orders', 'payment_status', `ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'collected'`);
    ensureColumnExists('orders', 'payment_method', `ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT 'cash'`);
    const addedPaid = ensureColumnExists('orders', 'paid_amount', `ALTER TABLE orders ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0`);

    ensureColumnExists('order_materials', 'waste_grams', 'ALTER TABLE order_materials ADD COLUMN waste_grams REAL CHECK (waste_grams >= 0)');
    backfillPricingBreakdown({ addedBefore, addedAfter, addedPaid });
    const addedUsageDate = ensureColumnExists('order_materials', 'created_at', 'ALTER TABLE order_materials ADD COLUMN created_at TEXT');
    if (addedUsageDate) db.exec('UPDATE order_materials SET created_at = (SELECT created_at FROM orders WHERE id = order_id)');
  })();
}

function createIndexes() {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_code ON orders(code);
    CREATE INDEX IF NOT EXISTS idx_orders_date_id ON orders(order_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_name);
    CREATE INDEX IF NOT EXISTS idx_orders_printer ON orders(printer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
    CREATE INDEX IF NOT EXISTS idx_order_materials_order ON order_materials(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_materials_material ON order_materials(material_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_ref ON stock_movements(reference_code);
    CREATE INDEX IF NOT EXISTS idx_purchases_date_id ON purchases(purchase_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_date_id ON assets(asset_date DESC, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_printer ON assets(printer_id);
    CREATE INDEX IF NOT EXISTS idx_quotes_date_id ON quotes(quote_date DESC, id DESC);
  `);
}

function ensureColumnExists(tableName, columnName, alterSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((col) => col.name === columnName);

  if (!exists) {
    db.exec(alterSql);
  }
  return !exists;
}

function backfillPricingBreakdown({ addedBefore, addedAfter, addedPaid }) {
  if (addedBefore) db.exec('UPDATE orders SET price_before_discount = final_price');
  if (addedAfter) db.exec('UPDATE orders SET price_after_discount = final_price');
  if (addedPaid) db.exec("UPDATE orders SET paid_amount = MAX(0, final_price) WHERE payment_status = 'collected'");
}

function seedDefaults() {
  const defaults = {
    farmName: 'MOO3DSTUDIO',
    currencyName: 'جنيه',
    laborRate: '50',
    electricityCostPerHour: '3',
    printerPowerKw: '0.25',
    packagingCost: '10',
    failurePercent: '10',
    defaultWasteWeight: '0',
    minimumOrderPrice: '0',
    accessoriesCost: '0',
    shippingCost: '0',
    defaultTaxPercent: '0',
    defaultPaymentMethod: 'cash',
    defaultPaymentStatus: 'collected',
    roundingStep: '5',
    defaultProfitMargin: '100',
    defaultManualMinutes: '15',
    defaultDiscountValue: '0',
    openingCash: '0',
    baseMachineHours: '0',
    maintenanceEveryHours: '1000',
    lastMaintenanceAtHours: '0',
    maintenanceCost: '1500'
  };

  const insertConfig = db.prepare(`
    INSERT OR IGNORE INTO app_config (key, value)
    VALUES (?, ?)
  `);

  Object.entries(defaults).forEach(([key, value]) => {
    insertConfig.run(key, String(value));
  });

  // Empty tables can be intentional. Never resurrect deleted demonstration data.
  if (db.prepare("SELECT value FROM app_config WHERE key = 'initialDataSeeded'").get()?.value === '1') return;

  const currentFarmName = db.prepare(`SELECT value FROM app_config WHERE key = 'farmName'`).get();

  if (!currentFarmName || !String(currentFarmName.value || '').trim()) {
    db.prepare(`
      INSERT INTO app_config (key, value)
      VALUES ('farmName', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(defaults.farmName);
  }

  const currentCurrencyName = db.prepare(`SELECT value FROM app_config WHERE key = 'currencyName'`).get();

  if (
    !currentCurrencyName ||
    !String(currentCurrencyName.value || '').trim() ||
    String(currentCurrencyName.value || '').trim() === 'ج'
  ) {
    db.prepare(`
      INSERT INTO app_config (key, value)
      VALUES ('currencyName', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(defaults.currencyName);
  }

  // رفع متوسط استهلاك الطابعة الافتراضي إلى 0.25kW لمطابقة نتيجة التسعير السريع في الموبايل.
  // لو المستخدم كان معدلها لقيمة مختلفة لن يتم لمسها.
  db.prepare(`
    UPDATE app_config
    SET value = '0.25'
    WHERE key = 'printerPowerKw'
      AND ABS(CAST(COALESCE(value, '0') AS REAL) - 0.15) < 0.0001
  `).run();

  // من v1.8.6 تكلفة ساعة الطابعة تعني تشغيل فقط.
  // إهلاك الأصول ونصيب الصيانة يتحسبوا كبنود مستقلة مرة واحدة داخل التسعير.
  // لو قاعدة البيانات جاية من v1.8.5 وفيها الرقم الافتراضي 20 كرقم شامل،
  // نحوله إلى 6.5 تشغيل فقط بحيث يظل إجمالي العبء بالساعة الافتراضي 20:
  // تشغيل 6.5 + إهلاك أصل 12 + صيانة 1.5 = 20.
  db.prepare(`
    UPDATE printers
    SET hourly_depreciation = 6.5,
        notes = 'الطابعة الأساسية - Bambu Lab A1 — تكلفة تشغيل الطابعة فقط. التسعير يضيف إهلاك الأصول ونصيب الصيانة مرة واحدة تلقائيًا.'
    WHERE name = 'Bambu Lab A1'
      AND ABS(COALESCE(hourly_depreciation, 0) - 20) < 0.0001
      AND notes LIKE '%تكلفة تشغيل/إهلاك الساعة الشاملة%'
  `).run();

  // لو قاعدة أقدم كانت مخزنة 33.5 = تشغيل 20 + إهلاك 12 + صيانة 1.5،
  // نحافظ على تشغيل 20 فقط ونترك الإهلاك والصيانة يتحسبوا من الأصول والإعدادات.
  db.prepare(`
    UPDATE printers
    SET hourly_depreciation = 20,
        notes = 'الطابعة الأساسية - Bambu Lab A1 — تكلفة تشغيل الطابعة فقط. التسعير يضيف إهلاك الأصول ونصيب الصيانة مرة واحدة تلقائيًا.'
    WHERE name = 'Bambu Lab A1'
      AND ABS(COALESCE(hourly_depreciation, 0) - 33.5) < 0.0001
      AND notes LIKE '%تشمل تشغيل 20 + إهلاك 12 + صيانة 1.5%'
  `).run();

  setConfig('initialDataSeeded', '1');
}

function getAllConfig() {
  return Object.fromEntries(db.prepare('SELECT key, value FROM app_config').all().map(({ key, value }) => [key, value]));
}

function setConfig(key, value) {
  db.prepare(`
    INSERT INTO app_config (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(key), String(value));
}

const USER_CONFIG_KEYS = new Set([
  'farmName', 'currencyName', 'defaultProfitMargin', 'defaultManualMinutes', 'laborRate',
  'electricityCostPerHour', 'printerPowerKw', 'packagingCost', 'failurePercent', 'defaultWasteWeight',
  'minimumOrderPrice', 'accessoriesCost', 'shippingCost', 'defaultTaxPercent', 'defaultDiscountValue',
  'roundingStep', 'openingCash', 'baseMachineHours', 'maintenanceEveryHours', 'lastMaintenanceAtHours', 'maintenanceCost'
]);

function saveUserConfig(config) {
  const entries = Object.entries(config);
  const guideOnly = entries.length === 1 && entries[0][0] === 'firstRunGuideSeen' && entries[0][1] === '1';
  for (const [key, value] of entries) {
    if (!guideOnly && !USER_CONFIG_KEYS.has(key)) throw new Error('إعداد غير مسموح: ' + key);
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('قيمة إعداد غير صالحة: ' + key);
    if (!['farmName', 'currencyName'].includes(key) && (String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0)) {
      throw new Error('قيمة إعداد غير صالحة: ' + key);
    }
  }
  db.transaction(() => {
    for (const [key, value] of entries) setConfig(key, value);
  })();
}

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

function normalizePageOptions(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const includeAll = Boolean(opts.includeAll);
  const requestedLimit = Number(opts.limit || DEFAULT_LIST_LIMIT);
  const requestedOffset = Number(opts.offset || 0);
  const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : DEFAULT_LIST_LIMIT));
  const offset = Math.max(0, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0);
  const filters = opts.filters && typeof opts.filters === 'object' ? opts.filters : {};

  return { includeAll, limit, offset, filters };
}

function escapeLike(value) {
  return String(value ?? '').replace(/[\%_]/g, (char) => `\\${char}`);
}

function addLikeFilter(parts, params, columns, rawValue) {
  const value = String(rawValue ?? '').trim().toLowerCase();
  if (!value) return;

  const like = `%${escapeLike(value)}%`;
  parts.push(`(${columns.map((column) => `LOWER(COALESCE(${column}, '')) LIKE ? ESCAPE '\\'`).join(' OR ')})`);
  columns.forEach(() => params.push(like));
}

function buildOrdersWhereClause(filters = {}) {
  const parts = ['1 = 1'];
  const params = [];
  const cleanFilters = filters && typeof filters === 'object' ? filters : {};

  addLikeFilter(parts, params, [
    'o.code',
    'o.item_name',
    'o.customer_name',
    'o.notes',
    'p.name'
  ], cleanFilters.search);

  addLikeFilter(parts, params, ['o.customer_name'], cleanFilters.customer);

  const printerId = Number(cleanFilters.printerId || 0);
  if (Number.isFinite(printerId) && printerId > 0) {
    parts.push('o.printer_id = ?');
    params.push(Math.floor(printerId));
  }

  const from = String(cleanFilters.from || '').trim();
  if (from) {
    parts.push('o.order_date >= ?');
    params.push(from);
  }

  const to = String(cleanFilters.to || '').trim();
  if (to) {
    parts.push('o.order_date <= ?');
    params.push(to);
  }

  const status = String(cleanFilters.status || '').trim();
  if (status) {
    parts.push('o.order_status = ?');
    params.push(status);
  }

  return { whereSql: parts.join(' AND '), params };
}

function getOrdersSummary(whereSql, params) {
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN o.order_status != 'cancelled' THEN o.final_price ELSE 0 END), 0) AS totalRevenue,
      COALESCE(SUM(CASE WHEN o.order_status != 'cancelled' THEN o.paid_amount ELSE 0 END), 0) AS collected,
      COALESCE(SUM(CASE WHEN o.order_status != 'cancelled' THEN o.profit ELSE 0 END), 0) AS totalProfit,
      COALESCE(MAX(CASE WHEN o.order_status != 'cancelled' THEN o.final_price ELSE NULL END), 0) AS topSale,
      COALESCE(AVG(CASE WHEN o.order_status != 'cancelled' THEN o.profit ELSE NULL END), 0) AS avgProfit,
      COALESCE(SUM(CASE WHEN o.order_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelledCount,
      COALESCE(SUM(CASE WHEN o.order_status != 'cancelled' THEN o.print_hours ELSE 0 END), 0) AS salesMachineHours
    FROM orders o
    LEFT JOIN printers p ON p.id = o.printer_id
    WHERE ${whereSql}
  `).get(...params);

  const topCustomer = db.prepare(`
    SELECT
      o.customer_name AS name,
      COUNT(*) AS count,
      COALESCE(SUM(o.final_price), 0) AS revenue,
      COALESCE(SUM(o.profit), 0) AS profit
    FROM orders o
    LEFT JOIN printers p ON p.id = o.printer_id
    WHERE ${whereSql}
      AND o.order_status != 'cancelled'
      AND TRIM(COALESCE(o.customer_name, '')) != ''
    GROUP BY o.customer_name
    ORDER BY revenue DESC, count DESC, name ASC
    LIMIT 1
  `).get(...params);

  return {
    count: Number(summary.count || 0),
    totalRevenue: Number(summary.totalRevenue || 0),
    collected: Number(summary.collected || 0),
    totalProfit: Number(summary.totalProfit || 0),
    topSale: Number(summary.topSale || 0),
    avgProfit: Number(summary.avgProfit || 0),
    cancelledCount: Number(summary.cancelledCount || 0),
    salesMachineHours: Number(summary.salesMachineHours || 0),
    topCustomer: topCustomer ? {
      name: String(topCustomer.name || ''),
      count: Number(topCustomer.count || 0),
      revenue: Number(topCustomer.revenue || 0),
      profit: Number(topCustomer.profit || 0)
    } : null
  };
}

function buildPageMeta(total, limit, offset, includeAll) {
  return {
    total: Number(total || 0),
    limit: includeAll ? Number(total || 0) : limit,
    offset: includeAll ? 0 : offset,
    hasMore: includeAll ? false : offset + limit < Number(total || 0)
  };
}

function getOrdersPage(options = {}) {
  const { includeAll, limit, offset, filters } = normalizePageOptions(options);
  const { whereSql, params } = buildOrdersWhereClause(filters);
  const total = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM orders o
    LEFT JOIN printers p ON p.id = o.printer_id
    WHERE ${whereSql}
  `).get(...params).count || 0);
  const sql = `
    SELECT
      o.id,
      o.code,
      o.item_name AS itemName,
      o.customer_name AS customerName,
      o.printer_id AS printerId,
      COALESCE(p.name, '') AS printerName,
      o.order_status AS status,
      o.quantity AS quantity,
      o.print_hours AS printHours,
      o.manual_minutes AS manualMinutes,
      o.notes,
      o.order_date AS date,
      o.material_cost AS materialCost,
      o.waste_weight AS wasteWeight,
      o.waste_cost AS wasteCost,
      o.depreciation_cost AS depreciationCost,
      o.electricity_cost AS electricityCost,
      o.labor_cost AS laborCost,
      o.packaging_cost AS packagingCost,
      o.accessories_cost AS accessoriesCost,
      o.shipping_cost AS shippingCost,
      o.risk_cost AS riskCost,
      o.tax_cost AS taxCost,
      o.total_cost AS totalCost,
      o.price_before_discount AS priceBeforeDiscount,
      o.discount_value AS discountValue,
      o.price_after_discount AS priceAfterDiscount,
      o.minimum_order_price AS minimumOrderPrice,
      o.rounded_adjustment AS roundedAdjustment,
      o.final_price AS finalPrice,
      o.profit,
      o.unit_final_price AS unitFinalPrice,
      o.unit_total_cost AS unitTotalCost,
      o.unit_profit AS unitProfit,
      o.created_at AS createdAt,
      o.payment_status AS paymentStatus,
      o.payment_method AS paymentMethod,
      o.paid_amount AS paidAmount
    FROM orders o
    LEFT JOIN printers p ON p.id = o.printer_id
    WHERE ${whereSql}
    ORDER BY o.order_date DESC, o.id DESC
    ${includeAll ? '' : 'LIMIT ? OFFSET ?'}
  `;
  const items = includeAll ? db.prepare(sql).all(...params) : db.prepare(sql).all(...params, limit, offset);

  return { items, summary: getOrdersSummary(whereSql, params), ...buildPageMeta(total, limit, offset, includeAll) };
}

function getOrderMaterials(code) {
  return db.prepare(`
    SELECT om.id AS rowId, om.material_id AS materialId, om.material_name AS materialName,
      om.grams, om.waste_grams AS wasteGrams, om.created_at AS createdAt, om.price_per_gram AS pricePerGram, om.total_cost AS totalCost
    FROM order_materials om
    JOIN orders o ON o.id = om.order_id
    WHERE o.code = ?
    ORDER BY om.id
  `).all(code);
}

function getStockMovementsPage(options = {}) {
  const { includeAll, limit, offset } = normalizePageOptions(options);
  const total = Number(db.prepare('SELECT COUNT(*) AS count FROM stock_movements').get().count || 0);
  const sql = `
    SELECT
      id,
      material_id AS materialId,
      material_name AS materialName,
      movement_type AS movementType,
      quantity,
      reason,
      reference_code AS referenceCode,
      created_at AS createdAt
    FROM stock_movements
    ORDER BY id DESC
    ${includeAll ? '' : 'LIMIT ? OFFSET ?'}
  `;
  const items = includeAll ? db.prepare(sql).all() : db.prepare(sql).all(limit, offset);

  return { items, ...buildPageMeta(total, limit, offset, includeAll) };
}

function getQuotesPage(options = {}) {
  const { includeAll, limit, offset } = normalizePageOptions(options);
  const total = Number(db.prepare('SELECT COUNT(*) AS count FROM quotes').get().count || 0);
  const sql = `
    SELECT
      id,
      code,
      item_name AS itemName,
      customer_name AS customerName,
      quote_date AS date,
      final_price AS finalPrice,
      profit,
      quantity,
      status,
      payload_json AS payloadJson,
      converted_order_code AS convertedOrderCode,
      created_at AS createdAt
    FROM quotes
    ORDER BY id DESC
    ${includeAll ? '' : 'LIMIT ? OFFSET ?'}
  `;
  const rows = includeAll ? db.prepare(sql).all() : db.prepare(sql).all(limit, offset);
  const items = rows.map((quote) => {
    let payload = null;
    try { payload = JSON.parse(quote.payloadJson || '{}'); } catch (_) { payload = null; }
    return { ...quote, payload };
  });

  return { items, ...buildPageMeta(total, limit, offset, includeAll) };
}

function getPurchasesPage(options = {}) {
  const { includeAll, limit, offset } = normalizePageOptions(options);
  const total = Number(db.prepare('SELECT COUNT(*) AS count FROM purchases').get().count || 0);
  const sql = `
    SELECT
      p.id,
      p.purchase_date AS date,
      p.category,
      p.item,
      p.quantity,
      p.grams_per_unit AS gramsPerUnit,
      p.amount,
      p.supplier,
      p.notes,
      p.material_id AS materialId,
      COALESCE(m.name, '') AS materialName,
      p.created_at AS createdAt
    FROM purchases p
    LEFT JOIN materials m ON m.id = p.material_id
    ORDER BY p.purchase_date DESC, p.id DESC
    ${includeAll ? '' : 'LIMIT ? OFFSET ?'}
  `;
  const items = includeAll ? db.prepare(sql).all() : db.prepare(sql).all(limit, offset);

  return { items, ...buildPageMeta(total, limit, offset, includeAll) };
}

function getAssetsPage(options = {}) {
  const { includeAll, limit, offset } = normalizePageOptions(options);
  const total = Number(db.prepare('SELECT COUNT(*) AS count FROM assets').get().count || 0);
  const sql = `
    SELECT
      id,
      asset_date AS date,
      item,
      cost,
      asset_type AS type,
      depreciation_hours AS depreciationHours,
      hourly_depreciation_override AS hourlyDepreciationOverride,
      notes,
      printer_id AS printerId,
      created_at AS createdAt
    FROM assets
    ORDER BY asset_date DESC, id DESC
    ${includeAll ? '' : 'LIMIT ? OFFSET ?'}
  `;
  const items = includeAll ? db.prepare(sql).all() : db.prepare(sql).all(limit, offset);

  return { items, ...buildPageMeta(total, limit, offset, includeAll) };
}

function getCustomersPage(options = {}) {
  const { includeAll, limit, offset, filters } = normalizePageOptions(options);
  const { whereSql, params } = buildOrdersWhereClause(filters);
  const total = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM (
      SELECT o.customer_name
      FROM orders o
      LEFT JOIN printers p ON p.id = o.printer_id
      WHERE ${whereSql}
        AND TRIM(COALESCE(o.customer_name, '')) != ''
      GROUP BY o.customer_name
    ) customers
  `).get(...params).count || 0);

  const sql = `
    SELECT
      o.customer_name AS name,
      COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN o.order_status != 'cancelled' THEN o.final_price ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN o.order_status != 'cancelled' THEN o.profit ELSE 0 END), 0) AS profit,
      (
        SELECT oo.code
        FROM orders oo
        WHERE oo.customer_name = o.customer_name
        ORDER BY oo.order_date DESC, oo.id DESC
        LIMIT 1
      ) AS lastOrderCode,
      (
        SELECT oo.item_name
        FROM orders oo
        WHERE oo.customer_name = o.customer_name
        ORDER BY oo.order_date DESC, oo.id DESC
        LIMIT 1
      ) AS lastOrderItem,
      MAX(o.order_date) AS lastOrderDate
    FROM orders o
    LEFT JOIN printers p ON p.id = o.printer_id
    WHERE ${whereSql}
      AND TRIM(COALESCE(o.customer_name, '')) != ''
    GROUP BY o.customer_name
    ORDER BY revenue DESC, count DESC, name ASC
    ${includeAll ? '' : 'LIMIT ? OFFSET ?'}
  `;

  const rows = includeAll ? db.prepare(sql).all(...params) : db.prepare(sql).all(...params, limit, offset);
  const items = rows.map((row) => ({
    name: String(row.name || '').trim(),
    count: Number(row.count || 0),
    revenue: Number(row.revenue || 0),
    profit: Number(row.profit || 0),
    lastOrderCode: String(row.lastOrderCode || ''),
    lastOrderItem: String(row.lastOrderItem || ''),
    lastOrderDate: String(row.lastOrderDate || '')
  }));

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS orderCount,
      COALESCE(SUM(CASE WHEN o.order_status != 'cancelled' THEN o.final_price ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN o.order_status != 'cancelled' THEN o.profit ELSE 0 END), 0) AS profit
    FROM orders o
    LEFT JOIN printers p ON p.id = o.printer_id
    WHERE ${whereSql}
      AND TRIM(COALESCE(o.customer_name, '')) != ''
  `).get(...params);

  return {
    items,
    summary: {
      customersCount: total,
      orderCount: Number(summary.orderCount || 0),
      revenue: Number(summary.revenue || 0),
      profit: Number(summary.profit || 0)
    },
    ...buildPageMeta(total, limit, offset, includeAll)
  };
}

function getDashboardSummary() {
  const orders = db.prepare(`
    SELECT
      COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN final_price ELSE 0 END), 0) AS totalSales,
      COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN paid_amount ELSE 0 END), 0) AS collected,
      COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN profit ELSE 0 END), 0) AS totalProfit,
      COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN print_hours ELSE 0 END), 0) AS salesMachineHours
    FROM orders
  `).get();

  const purchases = db.prepare(`
    SELECT
      COUNT(*) AS count,
      COALESCE(SUM(amount), 0) AS totalPurchases
    FROM purchases
  `).get();

  const assets = db.prepare(`
    SELECT
      COUNT(*) AS count,
      COALESCE(SUM(cost), 0) AS totalAssets
    FROM assets
  `).get();

  const stock = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN weight > 0 THEN remaining * (price / weight) ELSE 0 END), 0) AS value,
      COALESCE(SUM(remaining), 0) AS grams,
      COALESCE(SUM(CASE WHEN remaining <= low_stock_threshold THEN 1 ELSE 0 END), 0) AS lowCount
    FROM materials
    WHERE is_archived = 0
  `).get();

  return {
    ordersCount: Number(orders.count || 0),
    purchasesCount: Number(purchases.count || 0),
    assetsCount: Number(assets.count || 0),
    totalSales: Number(orders.totalSales || 0),
    collected: Number(orders.collected || 0),
    totalProfit: Number(orders.totalProfit || 0),
    totalPurchases: Number(purchases.totalPurchases || 0),
    totalAssets: Number(assets.totalAssets || 0),
    salesMachineHours: Number(orders.salesMachineHours || 0),
    stock: {
      value: Number(stock.value || 0),
      grams: Number(stock.grams || 0),
      lowCount: Number(stock.lowCount || 0)
    }
  };
}

function getDataPage(kind, options = {}) {
  const pageOptions = normalizePageOptions(options);

  switch (String(kind || '').trim()) {
    case 'orders':
      return getOrdersPage(pageOptions);
    case 'stockMovements':
      return getStockMovementsPage(pageOptions);
    case 'quotes':
      return getQuotesPage(pageOptions);
    case 'purchases':
      return getPurchasesPage(pageOptions);
    case 'assets':
      return getAssetsPage(pageOptions);
    case 'customers':
      return getCustomersPage(pageOptions);
    default:
      throw new Error('نوع البيانات غير مدعوم');
  }
}

function getTrackingData() {
  const database = getDb();
  return database.transaction(() => {
    const orders = getDataPage('orders', { includeAll: true }).items.filter((order) => order.status !== 'cancelled');
    const { totalAssets, stock } = getDashboardSummary();
    return {
      orders,
      purchases: getDataPage('purchases', { includeAll: true }).items,
      openingCash: Math.max(0, Number(getAllConfig().openingCash) || 0),
      totalAssets,
      stockValue: stock.value,
      materialUsed: orders.reduce((sum, order) => sum + order.materialCost + order.wasteCost, 0)
    };
  })();
}

function getDashboardData(options = {}) {
  const pageOptions = normalizePageOptions(options);
  const printers = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.model,
      p.status,
      p.hourly_depreciation AS hourlyDepreciation,
      p.notes,
      p.is_archived AS isArchived,
      p.created_at AS createdAt,
      a.id AS purchaseAssetId,
      a.cost AS purchasePrice,
      a.depreciation_hours AS purchaseHours,
      a.hourly_depreciation_override AS purchaseHourlyDepreciationOverride
    FROM printers p
    LEFT JOIN assets a ON a.printer_id = p.id
    WHERE p.is_archived = 0
    ORDER BY p.id DESC
  `).all();

  const materials = db.prepare(`
    SELECT
      id,
      name,
      type,
      color,
      weight,
      remaining,
      price,
      low_stock_threshold AS lowStockThreshold,
      supplier,
      is_archived AS isArchived,
      created_at AS createdAt
    FROM materials
    WHERE is_archived = 0
    ORDER BY id DESC
  `).all();

  const ordersPage = getOrdersPage(pageOptions);
  const stockMovementsPage = getStockMovementsPage(pageOptions);
  const quotesPage = getQuotesPage(pageOptions);
  const purchasesPage = getPurchasesPage(pageOptions);
  const assetsPage = getAssetsPage(pageOptions);
  const customersPage = getCustomersPage(pageOptions);

  return {
    config: getAllConfig(),
    printers,
    materials,
    orders: ordersPage.items,
    stockMovements: stockMovementsPage.items,
    quotes: quotesPage.items,
    purchases: purchasesPage.items,
    assets: assetsPage.items,
    customers: customersPage.items,
    meta: {
      orders: buildPageMeta(ordersPage.total, ordersPage.limit, ordersPage.offset, pageOptions.includeAll),
      stockMovements: buildPageMeta(stockMovementsPage.total, stockMovementsPage.limit, stockMovementsPage.offset, pageOptions.includeAll),
      quotes: buildPageMeta(quotesPage.total, quotesPage.limit, quotesPage.offset, pageOptions.includeAll),
      purchases: buildPageMeta(purchasesPage.total, purchasesPage.limit, purchasesPage.offset, pageOptions.includeAll),
      assets: buildPageMeta(assetsPage.total, assetsPage.limit, assetsPage.offset, pageOptions.includeAll),
      customers: buildPageMeta(customersPage.total, customersPage.limit, customersPage.offset, pageOptions.includeAll),
      summary: getDashboardSummary()
    }
  };
}

function createPrinter(data) {
  const stmt = db.prepare(`
    INSERT INTO printers (name, model, status, hourly_depreciation, notes, is_archived)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    String(data.name || '').trim(),
    String(data.model || '').trim(),
    String(data.status || 'idle').trim(),
    Number(data.hourlyDepreciation || 0),
    String(data.notes || '').trim(),
    0
  );

  return Number(result.lastInsertRowid);
}

function savePrinterWithAsset(printer, asset) {
  return db.transaction(() => {
    let printerId = printer.id;
    if (printerId) {
      if (!db.prepare('SELECT id FROM printers WHERE id = ? AND is_archived = 0').get(printerId)) {
        throw new Error('الطابعة غير موجودة.');
      }
      updatePrinter(printer);
    } else {
      printerId = createPrinter(printer);
    }
    const linked = db.prepare('SELECT * FROM assets WHERE printer_id = ?').get(printerId);
    const selected = asset.id ? db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.id) : linked;
    if (asset.id && (!selected || (selected.printer_id != null && selected.printer_id !== printerId)
      || (linked && linked.id !== selected.id))) {
      throw new Error('الأصل المختار اتغير أو مرتبط بطابعة تانية. افتح شاشة التعديل من جديد.');
    }
    const assetId = saveAsset({
      ...asset,
      id: selected?.id,
      date: selected?.asset_date ?? asset.date,
      item: selected?.item ?? asset.item,
      type: selected?.asset_type ?? asset.type,
      notes: selected?.notes ?? asset.notes
    });
    if (!linked) db.prepare('UPDATE assets SET printer_id = ? WHERE id = ?').run(printerId, assetId);
    return printerId;
  })();
}

function updatePrinter(data) {
  db.prepare(`
    UPDATE printers
    SET
      name = ?,
      model = ?,
      status = ?,
      hourly_depreciation = ?,
      notes = ?
    WHERE id = ?
  `).run(
    String(data.name || '').trim(),
    String(data.model || '').trim(),
    String(data.status || 'idle').trim(),
    Number(data.hourlyDepreciation || 0),
    String(data.notes || '').trim(),
    Number(data.id)
  );
}

function deletePrinter(id) {
  const printerId = Number(id);
  const printer = db.prepare('SELECT id FROM printers WHERE id = ?').get(printerId);

  if (!printer) {
    return { deleted: false, archived: false, reason: 'not_found' };
  }

  const usageCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM orders
    WHERE printer_id = ?
  `).get(printerId).count;

  if (usageCount > 0) {
    db.prepare(`
      UPDATE printers
      SET is_archived = 1
      WHERE id = ?
    `).run(printerId);

    return { deleted: false, archived: true, reason: 'used_in_orders' };
  }

  db.prepare('DELETE FROM printers WHERE id = ?').run(printerId);
  return { deleted: true, archived: false, reason: 'deleted' };
}

function createMaterial(data) {
  return db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO materials (name, type, color, weight, remaining, price, low_stock_threshold, supplier, is_archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      String(data.name || '').trim(),
      String(data.type || '').trim(),
      String(data.color || '').trim(),
      Number(data.weight || 0),
      Number(data.remaining || 0),
      Number(data.price || 0),
      Number(data.lowStockThreshold || 0),
      String(data.supplier || '').trim(),
      0
    );

    const materialId = Number(result.lastInsertRowid);
    if (Number(data.remaining || 0) <= 0) return materialId;

    db.prepare(`
      INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, reason, reference_code)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      materialId,
      String(data.name || '').trim(),
      'in',
      Number(data.remaining || 0),
      'إضافة خامة جديدة',
      ''
    );

    return materialId;
  })();
}

function updateMaterial(data) {
  return db.transaction(() => {
    const materialId = Number(data.id);
    const oldMaterial = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);

    if (!oldMaterial) return;

    const newName = String(data.name || '').trim();
    const newRemaining = Number(data.remaining || 0);

    db.prepare(`
      UPDATE materials
      SET
        name = ?,
        type = ?,
        color = ?,
        weight = ?,
        remaining = ?,
        price = ?,
        low_stock_threshold = ?,
        supplier = ?
      WHERE id = ?
    `).run(
      newName,
      String(data.type || '').trim(),
      String(data.color || '').trim(),
      Number(data.weight || 0),
      newRemaining,
      Number(data.price || 0),
      Number(data.lowStockThreshold || 0),
      String(data.supplier || '').trim(),
      materialId
    );

    if (String(oldMaterial.name || '') !== newName) {
      db.prepare(`
        UPDATE order_materials
        SET material_name = ?
        WHERE material_id = ?
      `).run(newName, materialId);

      db.prepare(`
        UPDATE stock_movements
        SET material_name = ?
        WHERE material_id = ?
      `).run(newName, materialId);
    }

    const difference = newRemaining - Number(oldMaterial.remaining || 0);

    if (difference !== 0) {
      db.prepare(`
        INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, reason, reference_code)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        materialId,
        newName,
        difference > 0 ? 'adjust_in' : 'adjust_out',
        Math.abs(difference),
        'تعديل يدوي على المخزون',
        ''
      );
    }
  })();
}

function deleteMaterial(id) {
  const materialId = Number(id);
  const material = db.prepare('SELECT id FROM materials WHERE id = ?').get(materialId);

  if (!material) {
    return { deleted: false, archived: false, reason: 'not_found' };
  }

  const usageCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM order_materials
    WHERE material_id = ?
  `).get(materialId).count;

  if (usageCount > 0) {
    db.prepare(`
      UPDATE materials
      SET is_archived = 1
      WHERE id = ?
    `).run(materialId);

    return { deleted: false, archived: true, reason: 'used_in_orders' };
  }

  db.prepare('DELETE FROM stock_movements WHERE material_id = ?').run(materialId);
  db.prepare('DELETE FROM materials WHERE id = ?').run(materialId);

  return { deleted: true, archived: false, reason: 'deleted' };
}

function getNextOrderCode() {
  const database = db || getDb();

  const row = database.prepare(`
    SELECT MAX(CAST(SUBSTR(code, 5) AS INTEGER)) AS maxNumber
    FROM orders
    WHERE code GLOB 'ORD-[0-9]*'
  `).get();

  const maxNumber = Number(row && row.maxNumber ? row.maxNumber : 0);
  const floor = Number(database.prepare("SELECT value FROM app_config WHERE key = 'orderCodeFloor'").get()?.value || 0);
  return `ORD-${Math.max(1000, maxNumber, floor) + 1}`;
}

function getNextQuoteCode() {
  const database = db || getDb();

  const row = database.prepare(`
    SELECT MAX(CAST(SUBSTR(code, 3) AS INTEGER)) AS maxNumber
    FROM quotes
    WHERE code GLOB 'Q-[0-9]*'
  `).get();

  const maxNumber = Number(row && row.maxNumber ? row.maxNumber : 0);
  const floor = Number(database.prepare("SELECT value FROM app_config WHERE key = 'quoteCodeFloor'").get()?.value || 0);
  return `Q-${Math.max(1000, maxNumber, floor) + 1}`;
}

function generateUniqueOrderCode(preferredCode) {
  const database = db || getDb();

  const exists = (code) => {
    const cleanCode = String(code || '').trim();
    if (!cleanCode) return false;

    return !!database.prepare(`
      SELECT id
      FROM orders
      WHERE code = ?
      LIMIT 1
    `).get(cleanCode);
  };

  let candidate = String(preferredCode || '').trim();

  if (!candidate) {
    candidate = getNextOrderCode();
  }

  if (!/^ORD-\d+$/.test(candidate)) {
    const numberMatch = candidate.match(/\d+/);
    candidate = numberMatch ? `ORD-${Number(numberMatch[0])}` : getNextOrderCode();
  }

  if (!exists(candidate)) {
    return candidate;
  }

  const row = database.prepare(`
    SELECT MAX(CAST(SUBSTR(code, 5) AS INTEGER)) AS maxNumber
    FROM orders
    WHERE code GLOB 'ORD-[0-9]*'
  `).get();

  let nextNumber = Math.max(
    1000,
    Number(row && row.maxNumber ? row.maxNumber : 0),
    Number(String(candidate).replace('ORD-', '')) || 0
  ) + 1;

  let nextCode = `ORD-${nextNumber}`;

  while (exists(nextCode)) {
    nextNumber += 1;
    nextCode = `ORD-${nextNumber}`;
  }

  return nextCode;
}

function createQuote(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const quoteCode = String(data.quoteCode || data.code || '').trim();
  if (!quoteCode) throw new Error('كود عرض السعر غير صالح');
  if (!String(data.itemName || '').trim()) throw new Error('اسم المجسم مطلوب');

  db.prepare(`
    INSERT INTO quotes (code, item_name, customer_name, quote_date, final_price, profit, quantity, status, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    quoteCode,
    String(data.itemName || '').trim(),
    String(data.customerName || '').trim(),
    String(data.date || localDateString()).trim(),
    Number(data.finalPrice || 0),
    Number(data.profit || 0),
    Number(data.quantity || 1),
    'open',
    JSON.stringify(data)
  );

  return quoteCode;
}

function deleteQuote(code) {
  db.prepare('DELETE FROM quotes WHERE code = ?').run(String(code || '').trim());
}

function applyOrderStockDelta(material, consumed, code, reason) {
  if (Math.abs(consumed) <= STOCK_EPSILON) return;
  const result = db.prepare(`
    UPDATE materials
    SET remaining = CASE WHEN ABS(remaining - ?) <= ? THEN 0 ELSE remaining - ? END
    WHERE id = ? AND remaining >= ? - ?
  `).run(consumed, STOCK_EPSILON, consumed, material.id, consumed, STOCK_EPSILON);
  if (result.changes !== 1) throw new Error('المخزون غير كافٍ في: ' + material.name);
  db.prepare(`
    INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, reason, reference_code)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(material.id, material.name, consumed > 0 ? 'out' : 'return', Math.abs(consumed), reason, code);
}

function insertOrderWithStock(data) {
  const insertOrder = db.prepare(`
    INSERT INTO orders (
      code,
      item_name,
      customer_name,
      printer_id,
      order_status,
      quantity,
      print_hours,
      manual_minutes,
      notes,
      order_date,
      material_cost,
      waste_weight,
      waste_cost,
      depreciation_cost,
      electricity_cost,
      labor_cost,
      packaging_cost,
      accessories_cost,
      shipping_cost,
      risk_cost,
      tax_cost,
      total_cost,
      price_before_discount,
      discount_value,
      price_after_discount,
      minimum_order_price,
      rounded_adjustment,
      final_price,
      profit,
      unit_final_price,
      unit_total_cost,
      unit_profit,
      payment_status,
      payment_method,
      paid_amount
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMaterialUsage = db.prepare(`
    INSERT INTO order_materials (
      order_id,
      material_id,
      material_name,
      grams,
      waste_grams,
      created_at,
      price_per_gram,
      total_cost
    )
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
  `);

  if (!data || !String(data.code || '').trim()) {
    throw new Error('كود الأوردر غير صالح');
  }

  if (!String(data.itemName || '').trim()) {
    throw new Error('اسم المجسم مطلوب');
  }

  if (!data.printerId) {
    throw new Error('اختار الطابعة المستخدمة');
  }

  const requestedQuantity = Number(data.quantity);
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0 || Math.floor(requestedQuantity) !== requestedQuantity) {
    throw new Error('عدد القطع لازم يكون رقم صحيح موجب');
  }

  if (Number(data.printHours || 0) <= 0) {
    throw new Error('وقت الطباعة لازم يكون أكبر من صفر');
  }

  if (!Array.isArray(data.materialUsage) || data.materialUsage.length === 0) {
    throw new Error('لا يوجد استهلاك خامات في الأوردر');
  }

  for (const item of data.materialUsage) {
    if (!Number.isFinite(Number(item.grams)) || Number(item.grams) <= 0) {
      throw new Error('كمية الخامة لازم تكون أكبر من صفر');
    }
  }

  const cleanCode = String(data.code || '').trim();
  const existingCode = db.prepare('SELECT id FROM orders WHERE code = ?').get(cleanCode);

  if (existingCode) {
    throw new Error('كود الأوردر موجود بالفعل، حاول مرة أخرى');
  }

  const usage = allocateWaste(data.materialUsage, data.wasteWeight);
  const materials = new Map();
  for (const item of usage) {
    const material = db.prepare('SELECT id, name, remaining, is_archived FROM materials WHERE id = ?').get(Number(item.materialId));
    if (!material) throw new Error('الخامة غير موجودة: ' + item.materialName);
    if (material.is_archived) throw new Error('الخامة مؤرشفة ولا يمكن استخدامها: ' + item.materialName);
    const entry = materials.get(material.id) || { ...material, consumed: 0 };
    entry.consumed += Number(item.grams) + item.wasteGrams;
    if (!stockCovers(material.remaining, entry.consumed)) throw new Error('المخزون غير كافٍ في: ' + material.name);
    materials.set(material.id, entry);
  }

  if (data.printerId) {
    const printer = db.prepare('SELECT id, is_archived FROM printers WHERE id = ?').get(Number(data.printerId));

    if (!printer) {
      throw new Error('الطابعة المحددة غير موجودة');
    }

    if (Number(printer.is_archived || 0) === 1) {
      throw new Error('الطابعة المحددة مؤرشفة ولا يمكن استخدامها');
    }
  }

  const finalPrice = Number(data.finalPrice || 0);
  const quantity = requestedQuantity;

  const orderResult = insertOrder.run(
    cleanCode,
    String(data.itemName || '').trim(),
    String(data.customerName || '').trim(),
    data.printerId ? Number(data.printerId) : null,
    String(data.status || 'delivered').trim(),
    quantity,
    Number(data.printHours || 0),
    Number(data.manualMinutes || 0),
    String(data.notes || '').trim(),
    String(data.date || '').trim(),
    Number(data.materialCost || 0),
    Number(data.wasteWeight || 0),
    Number(data.wasteCost || 0),
    Number(data.depreciationCost || 0),
    Number(data.electricityCost || 0),
    Number(data.laborCost || 0),
    Number(data.packagingCost || 0),
    Number(data.accessoriesCost || 0),
    Number(data.shippingCost || 0),
    Number(data.riskCost || 0),
    Number(data.taxCost || 0),
    Number(data.totalCost || 0),
    Number(data.priceBeforeDiscount || finalPrice),
    Number(data.discountValue || 0),
    Number(data.priceAfterDiscount || finalPrice),
    Number(data.minimumOrderPrice || 0),
    Number(data.roundedAdjustment || 0),
    finalPrice,
    Number(data.profit || 0),
    Number(data.unitFinalPrice || (finalPrice / quantity)),
    Number(data.unitTotalCost || (Number(data.totalCost || 0) / quantity)),
    Number(data.unitProfit || (Number(data.profit || 0) / quantity)),
    'collected',
    'cash',
    finalPrice
  );

  const orderId = Number(orderResult.lastInsertRowid);

  for (const material of materials.values()) {
    applyOrderStockDelta(material, material.consumed, cleanCode, 'استهلاك في أوردر');
  }
  for (const item of usage) {
    insertMaterialUsage.run(orderId, Number(item.materialId), String(item.materialName || '').trim(),
      Number(item.grams), item.wasteGrams, Number(item.pricePerGram || 0), Number(item.totalCost || 0));
  }

  const codeNumber = Number(String(cleanCode).replace(/^ORD-/, ''));
  const previousFloor = Number(db.prepare("SELECT value FROM app_config WHERE key = 'orderCodeFloor'").get()?.value || 0);
  if (Number.isSafeInteger(codeNumber)) setConfig('orderCodeFloor', String(Math.max(previousFloor, codeNumber)));
  return orderId;
}

function convertQuoteToOrder(quoteCode, orderCode) {
  const cleanQuoteCode = String(quoteCode || '').trim();
  if (!cleanQuoteCode) throw new Error('كود عرض السعر غير صالح');

  const transaction = db.transaction(() => {
    const quote = db.prepare('SELECT * FROM quotes WHERE code = ?').get(cleanQuoteCode);
    if (!quote) throw new Error('عرض السعر غير موجود');
    if (String(quote.status || '') === 'converted') {
      throw new Error(`عرض السعر اتحول قبل كده لأوردر${quote.converted_order_code ? `: ${quote.converted_order_code}` : ''}`);
    }

    let payload;
    try { payload = JSON.parse(quote.payload_json || '{}'); }
    catch (_) { throw new Error('بيانات عرض السعر غير صالحة'); }

    payload.code = generateUniqueOrderCode(orderCode);
    payload.date = localDateString();
    payload.status = 'delivered';

    insertOrderWithStock(payload);

    const updateResult = db.prepare(`
      UPDATE quotes
      SET status = 'converted', converted_order_code = ?
      WHERE code = ? AND status != 'converted'
    `).run(payload.code, cleanQuoteCode);

    if (updateResult.changes === 0) {
      throw new Error('تعذر تحديث حالة عرض السعر بعد التحويل');
    }

    return payload.code;
  });

  return transaction();
}

function createOrder(payload) {
  const transaction = db.transaction((data) => insertOrderWithStock(data));
  return transaction(payload);
}

function updateOrder(payload) {
  const code = String(payload.code || '').trim();

  if (!code) {
    throw new Error('كود الأوردر غير صالح');
  }

  const transaction = db.transaction((data) => {
    const existingOrder = db.prepare(`
      SELECT id, code, printer_id AS printerId, final_price AS finalPrice,
        payment_status AS paymentStatus, payment_method AS paymentMethod, paid_amount AS paidAmount
      FROM orders WHERE code = ?
    `).get(code);

    if (!existingOrder) {
      throw new Error('الأوردر غير موجود');
    }

    if (!String(data.itemName || '').trim()) {
      throw new Error('اسم المجسم مطلوب');
    }

    if (!data.printerId) {
      throw new Error('اختار الطابعة المستخدمة');
    }

    const requestedQuantity = Number(data.quantity);
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0 || Math.floor(requestedQuantity) !== requestedQuantity) {
      throw new Error('عدد القطع لازم يكون رقم صحيح موجب');
    }

    if (Number(data.printHours || 0) <= 0) {
      throw new Error('وقت الطباعة لازم يكون أكبر من صفر');
    }

    if (data.printerId) {
      const printer = db.prepare('SELECT id, is_archived FROM printers WHERE id = ?').get(Number(data.printerId));

      if (!printer) {
        throw new Error('الطابعة المحددة غير موجودة');
      }

      if (Number(printer.is_archived || 0) === 1 && Number(data.printerId) !== Number(existingOrder.printerId)) {
        throw new Error('الطابعة المحددة مؤرشفة ولا يمكن استخدامها');
      }
    }

    // Explicit false must leave stored consumption and stock movements untouched.
    const replaceMaterialUsage = data.replaceMaterialUsage === undefined
      ? Array.isArray(data.materialUsage)
      : data.replaceMaterialUsage === true;

    if (replaceMaterialUsage) {
      if (data.materialUsage.length === 0) {
        throw new Error('لا يوجد استهلاك خامات في الأوردر');
      }

      const oldMaterials = getOrderMaterials(code);
      if (Array.isArray(data.expectedMaterialRowIds)
        && (oldMaterials.length !== data.expectedMaterialRowIds.length
          || oldMaterials.some((item, index) => item.rowId !== data.expectedMaterialRowIds[index]))) {
        throw new Error('خامات الأوردر اتعدّلت. افتح الأوردر من جديد قبل الحفظ.');
      }

      const before = new Map();
      const after = new Map();
      const unlinkedRows = new Map();
      for (const item of oldMaterials) {
        if (item.materialId) before.set(item.materialId, (before.get(item.materialId) || 0) + item.grams + (item.wasteGrams || 0));
        else unlinkedRows.set(item.rowId, item);
      }
      const linked = data.materialUsage.filter((item) => !item.preserveRowId);
      const hasTrackedWaste = oldMaterials.some((item) => item.wasteGrams != null);
      const preservedWaste = data.materialUsage.reduce((sum, item) =>
        sum + (unlinkedRows.get(item.preserveRowId)?.wasteGrams || 0), 0);
      const waste = hasTrackedWaste ? Math.max(0, Number(data.wasteWeight || 0) - preservedWaste) : 0;
      const usage = allocateWaste(linked, waste);
      for (const item of usage) {
        if (!Number.isFinite(Number(item.grams)) || Number(item.grams) <= 0) throw new Error('كمية الخامة لازم تكون أكبر من صفر');
        const id = Number(item.materialId);
        after.set(id, (after.get(id) || 0) + Number(item.grams) + item.wasteGrams);
      }
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        const material = db.prepare('SELECT id, name, is_archived FROM materials WHERE id = ?').get(id);
        if (!material) throw new Error('الخامة غير موجودة');
        const delta = (after.get(id) || 0) - (before.get(id) || 0);
        if (material.is_archived && delta > STOCK_EPSILON) throw new Error('لا يمكن زيادة استهلاك خامة مؤرشفة: ' + material.name);
        applyOrderStockDelta(material, delta, code, delta < 0 ? 'استرجاع قبل تعديل أوردر' : 'استهلاك بعد تعديل أوردر');
      }
      db.prepare('DELETE FROM order_materials WHERE order_id = ?').run(existingOrder.id);
      const insertUsage = db.prepare(`
        INSERT INTO order_materials (order_id, material_id, material_name, grams, waste_grams, price_per_gram, total_cost, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `);
      let linkedIndex = 0;
      for (const requested of data.materialUsage) {
        const row = requested.preserveRowId ? unlinkedRows.get(requested.preserveRowId) : usage[linkedIndex++];
        if (!row) throw new Error('خامة قديمة غير موجودة في هذا الأوردر');
        if (requested.preserveRowId) unlinkedRows.delete(requested.preserveRowId);
        insertUsage.run(existingOrder.id, row.materialId ? Number(row.materialId) : null, String(row.materialName || '').trim(),
          Number(row.grams), hasTrackedWaste ? row.wasteGrams : null, Number(row.pricePerGram || 0), Number(row.totalCost || 0), row.createdAt ?? null);
      }
    }

    if (!replaceMaterialUsage) {
      const existingUsage = db.prepare(`
        SELECT
          COUNT(*) AS count,
          COALESCE(SUM(CASE WHEN grams > 0 THEN 1 ELSE 0 END), 0) AS positiveCount
        FROM order_materials
        WHERE order_id = ?
      `).get(existingOrder.id);

      if (Number(existingUsage.count || 0) === 0 || Number(existingUsage.positiveCount || 0) !== Number(existingUsage.count || 0)) {
        throw new Error('كمية الخامة لازم تكون أكبر من صفر');
      }
    }

    const finalPrice = Number(data.finalPrice || 0);
    const quantity = requestedQuantity;
    const keepRecordedPrice = finalPrice === existingOrder.finalPrice;
    if (data.replaceMaterialUsage === true && data.expectedMaterialRowIds
      && !keepRecordedPrice && finalPrice < Number(data.totalCost || 0) + Number(data.accessoriesCost || 0) + Number(data.shippingCost || 0)) {
      throw new Error('سعر البيع المعدّل أقل من التكلفة والمصاريف المباشرة');
    }

    db.prepare(`
      UPDATE orders
      SET
        item_name = ?,
        customer_name = ?,
        printer_id = ?,
        order_status = ?,
        quantity = ?,
        print_hours = ?,
        manual_minutes = ?,
        notes = ?,
        order_date = ?,
        material_cost = ?,
        waste_weight = ?,
        waste_cost = ?,
        depreciation_cost = ?,
        electricity_cost = ?,
        labor_cost = ?,
        packaging_cost = ?,
        accessories_cost = ?,
        shipping_cost = ?,
        risk_cost = ?,
        tax_cost = ?,
        total_cost = ?,
        price_before_discount = ?,
        discount_value = ?,
        price_after_discount = ?,
        minimum_order_price = ?,
        rounded_adjustment = ?,
        final_price = ?,
        profit = ?,
        unit_final_price = ?,
        unit_total_cost = ?,
        unit_profit = ?,
        payment_status = ?,
        payment_method = ?,
        paid_amount = ?
      WHERE code = ?
    `).run(
      String(data.itemName || '').trim(),
      String(data.customerName || '').trim(),
      data.printerId ? Number(data.printerId) : null,
      String(data.status || 'delivered').trim(),
      quantity,
      Number(data.printHours || 0),
      Number(data.manualMinutes || 0),
      String(data.notes || '').trim(),
      String(data.date || '').trim(),
      Number(data.materialCost || 0),
      Number(data.wasteWeight || 0),
      Number(data.wasteCost || 0),
      Number(data.depreciationCost || 0),
      Number(data.electricityCost || 0),
      Number(data.laborCost || 0),
      Number(data.packagingCost || 0),
      Number(data.accessoriesCost || 0),
      Number(data.shippingCost || 0),
      Number(data.riskCost || 0),
      Number(data.taxCost || 0),
      Number(data.totalCost || 0),
      Number(data.priceBeforeDiscount || finalPrice),
      Number(data.discountValue || 0),
      Number(data.priceAfterDiscount || finalPrice),
      Number(data.minimumOrderPrice || 0),
      Number(data.roundedAdjustment || 0),
      finalPrice,
      Number(data.profit || 0),
      Number(data.unitFinalPrice || (finalPrice / quantity)),
      Number(data.unitTotalCost || (Number(data.totalCost || 0) / quantity)),
      Number(data.unitProfit || (Number(data.profit || 0) / quantity)),
      (keepRecordedPrice || existingOrder.paymentStatus !== 'collected') ? existingOrder.paymentStatus : 'collected',
      existingOrder.paymentMethod,
      (keepRecordedPrice || existingOrder.paymentStatus !== 'collected') ? existingOrder.paidAmount : finalPrice,
      code
    );
  });

  transaction(payload);
}

function deleteOrder(code) {
  const transaction = db.transaction(() => {
    const order = db.prepare('SELECT id, code FROM orders WHERE code = ?').get(String(code || '').trim());
    if (!order) return;
    const materials = getOrderMaterials(order.code);
    for (const item of materials) {
      if (!item.materialId) continue;
      applyOrderStockDelta({ id: item.materialId, name: item.materialName },
        -(item.grams + (item.wasteGrams || 0)), order.code, 'استرجاع بعد حذف أوردر');
    }

    db.prepare('DELETE FROM order_materials WHERE order_id = ?').run(order.id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
    db.prepare("UPDATE quotes SET status = 'open', converted_order_code = '' WHERE converted_order_code = ?").run(order.code);
  });

  transaction();
}


function getPurchaseStockGrams(data) {
  if (String(data?.category || '').trim() !== 'خامات') return 0;
  if (!data?.materialId && !data?.material_id) return 0;
  return Math.max(0, Number(data?.quantity || 0) * Number(data?.gramsPerUnit ?? data?.grams_per_unit ?? 0));
}

function getPurchaseMaterialId(data) {
  const id = Number(data?.materialId ?? data?.material_id ?? 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function createMaterialFromPurchase(data) {
  const totalGrams = Math.max(0, Number(data.quantity || 0) * Number(data.gramsPerUnit || 0));
  if (String(data.category || '').trim() !== 'خامات') return null;
  if (!String(data.item || '').trim()) throw new Error('اسم الخامة الجديدة مطلوب');
  if (totalGrams <= 0) throw new Error('اكتب جرام للواحدة/البكرة عشان الخامة الجديدة تتسجل في المخزون');

  const name = String(data.item || '').trim();
  const type = name.split(/\s+/)[0] || '';
  const result = db.prepare(`
    INSERT INTO materials (name, type, color, weight, remaining, price, low_stock_threshold, supplier, is_archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    type,
    '',
    totalGrams,
    0,
    Number(data.amount || 0),
    150,
    String(data.supplier || '').trim(),
    0
  );

  return Number(result.lastInsertRowid);
}

function applyPurchaseStockDelta(data, direction, referenceCode, reason, grams = getPurchaseStockGrams(data)) {
  const materialId = getPurchaseMaterialId(data);
  if (grams <= STOCK_EPSILON || !materialId) return;

  const material = db.prepare('SELECT id, name, remaining FROM materials WHERE id = ?').get(materialId);
  if (!material) throw new Error('الخامة المرتبطة بالمشتريات غير موجودة');

  if (direction < 0 && !stockCovers(material.remaining, grams)) {
    throw new Error(`لا يمكن حذف/تعديل المشتريات لأن المتبقي في ${material.name} أقل من الكمية المطلوب خصمها`);
  }

  const remaining = material.remaining + direction * grams;
  db.prepare('UPDATE materials SET remaining = ? WHERE id = ?').run(Math.abs(remaining) <= STOCK_EPSILON ? 0 : remaining, materialId);

  db.prepare(`
    INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, reason, reference_code)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    materialId,
    String(material.name || data.item || '').trim(),
    direction > 0 ? 'in' : 'adjust_out',
    grams,
    reason || (direction > 0 ? 'إضافة مشتريات خامة' : 'تعديل/حذف مشتريات خامة'),
    String(referenceCode || '').trim()
  );
}

function savePurchase(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const id = Number(data.id || 0);
  let materialId = getPurchaseMaterialId(data);
  const category = String(data.category || 'أخرى').trim() || 'أخرى';
  const shouldCreateMaterial = category === 'خامات' && Boolean(data.createMaterial) && !materialId;
  const clean = {
    id: id > 0 ? id : null,
    date: String(data.date || localDateString()).trim(),
    category,
    item: String(data.item || '').trim(),
    quantity: Math.max(0, Number(data.quantity || 0)),
    gramsPerUnit: Math.max(0, Number(data.gramsPerUnit || 0)),
    amount: Math.max(0, Number(data.amount || 0)),
    supplier: String(data.supplier || '').trim(),
    notes: String(data.notes || '').trim(),
    materialId,
    createMaterial: shouldCreateMaterial
  };

  if (!clean.date) throw new Error('تاريخ المشتريات مطلوب');
  if (!clean.item) throw new Error('اسم بند المشتريات مطلوب');
  if (clean.quantity <= 0) throw new Error('كمية المشتريات لازم تكون أكبر من صفر');
  if (clean.category === 'خامات' && (clean.materialId || clean.createMaterial) && clean.gramsPerUnit <= 0) {
    throw new Error('اكتب جرام للواحدة/البكرة عشان المخزون يزيد صح');
  }

  const transaction = db.transaction(() => {
    if (clean.id) {
      const old = db.prepare(`
        SELECT id, purchase_date AS date, category, item, quantity, grams_per_unit AS gramsPerUnit, amount, supplier, notes, material_id AS materialId
        FROM purchases
        WHERE id = ?
      `).get(clean.id);
      if (!old) throw new Error('المشتريات غير موجودة');

      if (clean.createMaterial) {
        clean.materialId = createMaterialFromPurchase(clean);
      }

      db.prepare(`
        UPDATE purchases
        SET purchase_date = ?, category = ?, item = ?, quantity = ?, grams_per_unit = ?, amount = ?, supplier = ?, notes = ?, material_id = ?
        WHERE id = ?
      `).run(clean.date, clean.category, clean.item, clean.quantity, clean.gramsPerUnit, clean.amount, clean.supplier, clean.notes, clean.materialId, clean.id);

      const reference = 'PUR-' + clean.id;
      if (getPurchaseMaterialId(old) === getPurchaseMaterialId(clean)) {
        const delta = getPurchaseStockGrams(clean) - getPurchaseStockGrams(old);
        applyPurchaseStockDelta(clean, Math.sign(delta), reference, 'فرق مخزون بعد تعديل مشتريات', Math.abs(delta));
      } else {
        applyPurchaseStockDelta(old, -1, reference, 'استرجاع مخزون قبل تعديل مشتريات');
        applyPurchaseStockDelta(clean, 1, reference, 'إضافة مخزون بعد تعديل مشتريات');
      }
      return clean.id;
    }

    if (clean.createMaterial) {
      clean.materialId = createMaterialFromPurchase(clean);
    }

    const result = db.prepare(`
      INSERT INTO purchases (purchase_date, category, item, quantity, grams_per_unit, amount, supplier, notes, material_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clean.date, clean.category, clean.item, clean.quantity, clean.gramsPerUnit, clean.amount, clean.supplier, clean.notes, clean.materialId);

    const newId = Number(result.lastInsertRowid);
    applyPurchaseStockDelta({ ...clean, id: newId }, 1, `PUR-${newId}`, 'إضافة مشتريات خامة');
    return newId;
  });

  return transaction();
}

function deletePurchase(id) {
  const purchaseId = Number(id || 0);
  if (!purchaseId) throw new Error('رقم المشتريات غير صالح');

  const transaction = db.transaction(() => {
    const old = db.prepare(`
      SELECT id, purchase_date AS date, category, item, quantity, grams_per_unit AS gramsPerUnit, amount, supplier, notes, material_id AS materialId
      FROM purchases
      WHERE id = ?
    `).get(purchaseId);
    if (!old) return;

    applyPurchaseStockDelta(old, -1, `PUR-${purchaseId}`, 'حذف مشتريات خامة');
    db.prepare('DELETE FROM purchases WHERE id = ?').run(purchaseId);
  });

  transaction();
}

function saveAsset(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const id = Number(data.id || 0);
  const clean = {
    id: id > 0 ? id : null,
    date: String(data.date || localDateString()).trim(),
    item: String(data.item || '').trim(),
    cost: Math.max(0, Number(data.cost || 0)),
    type: String(data.type || '').trim(),
    depreciationHours: Math.max(0, Number(data.depreciationHours || 0)),
    hourlyDepreciationOverride: data.hourlyDepreciationOverride,
    notes: String(data.notes || '').trim()
  };

  if (!clean.date) throw new Error('تاريخ الأصل مطلوب');
  if (!clean.item) throw new Error('اسم الأصل مطلوب');
  if (clean.cost <= 0) throw new Error('تكلفة الأصل لازم تكون أكبر من صفر');
  const override = clean.hourlyDepreciationOverride;
  if (override != null && (!Number.isFinite(override) || override < 0)) {
    throw new Error('إهلاك الساعة لازم يكون رقم صفر أو أكبر.');
  }

  if (clean.id) {
    db.prepare(`
      UPDATE assets
      SET asset_date = ?, item = ?, cost = ?, asset_type = ?, depreciation_hours = ?, notes = ?,
        hourly_depreciation_override = CASE WHEN ? THEN ? ELSE hourly_depreciation_override END
      WHERE id = ?
    `).run(clean.date, clean.item, clean.cost, clean.type, clean.depreciationHours, clean.notes,
      Number(override !== undefined), override ?? null, clean.id);
    return clean.id;
  }

  const result = db.prepare(`
    INSERT INTO assets (asset_date, item, cost, asset_type, depreciation_hours, notes, hourly_depreciation_override)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(clean.date, clean.item, clean.cost, clean.type, clean.depreciationHours, clean.notes, override ?? null);

  return Number(result.lastInsertRowid);
}

function deleteAsset(id) {
  const assetId = Number(id || 0);
  if (!assetId) throw new Error('رقم الأصل غير صالح');
  db.prepare('DELETE FROM assets WHERE id = ?').run(assetId);
}

function replaceAllData(data) {
  const payload = data && typeof data === 'object' ? data : {};

  const transaction = db.transaction(() => {
    db.exec(`
      DELETE FROM order_materials;
      DELETE FROM stock_movements;
      DELETE FROM quotes;
      DELETE FROM purchases;
      DELETE FROM assets;
      DELETE FROM orders;
      DELETE FROM materials;
      DELETE FROM printers;
      DELETE FROM app_config;
      DELETE FROM sqlite_sequence WHERE name IN ('printers', 'materials', 'orders', 'order_materials', 'stock_movements', 'quotes', 'purchases', 'assets');
    `);

    const insertConfig = db.prepare(`
      INSERT INTO app_config (key, value)
      VALUES (?, ?)
    `);

    const insertPrinter = db.prepare(`
      INSERT INTO printers (name, model, status, hourly_depreciation, notes, is_archived, created_at)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);

    const insertMaterial = db.prepare(`
      INSERT INTO materials (name, type, color, weight, remaining, price, low_stock_threshold, supplier, is_archived, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);

    const insertOrder = db.prepare(`
      INSERT INTO orders (
        code,
        item_name,
        customer_name,
        printer_id,
        order_status,
        quantity,
        print_hours,
        manual_minutes,
        notes,
        order_date,
        material_cost,
        waste_weight,
        waste_cost,
        depreciation_cost,
        electricity_cost,
        labor_cost,
        packaging_cost,
        accessories_cost,
        shipping_cost,
        risk_cost,
        tax_cost,
        total_cost,
        price_before_discount,
        discount_value,
        price_after_discount,
        minimum_order_price,
        rounded_adjustment,
        final_price,
        profit,
        unit_final_price,
        unit_total_cost,
        unit_profit,
        payment_status,
        payment_method,
        paid_amount,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);

    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (
        material_id,
        material_name,
        movement_type,
        quantity,
        reason,
        reference_code,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);

    const insertOrderMaterial = db.prepare(`
      INSERT INTO order_materials (
        order_id,
        material_id,
        material_name,
        grams,
        price_per_gram,
        total_cost,
        waste_grams,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);

    const insertQuote = db.prepare(`
      INSERT INTO quotes (code, item_name, customer_name, quote_date, final_price, profit, quantity, status, payload_json, converted_order_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);

    const insertPurchase = db.prepare(`
      INSERT INTO purchases (purchase_date, category, item, quantity, grams_per_unit, amount, supplier, notes, material_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);

    const insertAsset = db.prepare(`
      INSERT INTO assets (asset_date, item, cost, asset_type, depreciation_hours, notes, printer_id, hourly_depreciation_override, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);

    Object.entries(payload.config || {}).forEach(([key, value]) => {
      const safeKey = String(key);
      let safeValue = String(value);

      if (safeKey === 'currencyName' && safeValue.trim() === 'ج') {
        safeValue = 'جنيه';
      }

      insertConfig.run(safeKey, safeValue);
    });

    const printerIdMap = new Map();
    const materialIdMap = new Map();
    const orderIdMap = new Map();

    (payload.printers || []).forEach((printer) => {
      const result = insertPrinter.run(
        String(printer.name || '').trim(),
        String(printer.model || '').trim(),
        String(printer.status || 'idle').trim(),
        Number(printer.hourlyDepreciation || 0),
        String(printer.notes || '').trim(),
        Number(printer.isArchived ? 1 : 0),
        printer.createdAt ?? null
      );

      if (printer.id != null) {
        printerIdMap.set(Number(printer.id), Number(result.lastInsertRowid));
      }
    });

    (payload.materials || []).forEach((material) => {
      const result = insertMaterial.run(
        String(material.name || '').trim(),
        String(material.type || '').trim(),
        String(material.color || '').trim(),
        Number(material.weight || 0),
        Number(material.remaining || 0),
        Number(material.price || 0),
        Number(material.lowStockThreshold || 0),
        String(material.supplier || '').trim(),
        Number(material.isArchived ? 1 : 0),
        material.createdAt ?? null
      );

      if (material.id != null) {
        materialIdMap.set(Number(material.id), Number(result.lastInsertRowid));
      }
    });

    (payload.orders || []).forEach((order) => {
      const mappedPrinterId = order.printerId != null
        ? (printerIdMap.get(Number(order.printerId)) ?? null)
        : null;

      const finalPrice = Number(order.finalPrice || 0);

      const result = insertOrder.run(
        String(order.code || '').trim(),
        String(order.itemName || '').trim(),
        String(order.customerName || '').trim(),
        mappedPrinterId,
        String(order.status || 'new').trim(),
        Number(order.quantity || 1),
        Number(order.printHours || 0),
        Number(order.manualMinutes || 0),
        String(order.notes || '').trim(),
        String(order.date || '').trim(),
        Number(order.materialCost || 0),
        Number(order.wasteWeight || 0),
        Number(order.wasteCost || 0),
        Number(order.depreciationCost || 0),
        Number(order.electricityCost || 0),
        Number(order.laborCost || 0),
        Number(order.packagingCost || 0),
        Number(order.accessoriesCost || 0),
        Number(order.shippingCost || 0),
        Number(order.riskCost || 0),
        Number(order.taxCost || 0),
        Number(order.totalCost || 0),
        Number(order.priceBeforeDiscount ?? finalPrice),
        Number(order.discountValue || 0),
        Number(order.priceAfterDiscount ?? finalPrice),
        Number(order.minimumOrderPrice || 0),
        Number(order.roundedAdjustment || 0),
        finalPrice,
        Number(order.profit || 0),
        Number(order.unitFinalPrice ?? (finalPrice / Math.max(1, Number(order.quantity || 1)))),
        Number(order.unitTotalCost ?? (Number(order.totalCost || 0) / Math.max(1, Number(order.quantity || 1)))),
        Number(order.unitProfit ?? (Number(order.profit || 0) / Math.max(1, Number(order.quantity || 1)))),
        String(order.paymentStatus ?? 'collected'),
        String(order.paymentMethod ?? 'cash'),
        Number(order.paidAmount ?? (order.paymentStatus == null || order.paymentStatus === 'collected' ? finalPrice : 0)),
        order.createdAt ?? null
      );

      if (order.id != null) {
        orderIdMap.set(Number(order.id), Number(result.lastInsertRowid));
      }
    });

    (payload.orderMaterials || []).forEach((item) => {
      const mappedOrderId = orderIdMap.get(Number(item.orderId));

      if (!mappedOrderId) return;

      const mappedMaterialId = item.materialId != null
        ? (materialIdMap.get(Number(item.materialId)) ?? null)
        : null;

      insertOrderMaterial.run(
        mappedOrderId,
        mappedMaterialId,
        String(item.materialName || '').trim(),
        Number(item.grams || 0),
        Number(item.pricePerGram || 0),
        Number(item.totalCost || 0),
        item.wasteGrams == null ? null : Number(item.wasteGrams),
        item.createdAt ?? null
      );
    });

    (payload.stockMovements || []).forEach((movement) => {
      const mappedMaterialId = movement.materialId != null
        ? (materialIdMap.get(Number(movement.materialId)) ?? null)
        : null;

      insertMovement.run(
        mappedMaterialId,
        String(movement.materialName || '').trim(),
        String(movement.movementType || 'adjust_in').trim(),
        Number(movement.quantity || 0),
        String(movement.reason || '').trim(),
        String(movement.referenceCode || '').trim(),
        movement.createdAt ?? null
      );
    });

    (payload.purchases || []).forEach((purchase) => {
      const mappedMaterialId = purchase.materialId != null
        ? (materialIdMap.get(Number(purchase.materialId)) ?? null)
        : null;

      insertPurchase.run(
        String(purchase.date || localDateString()).trim(),
        String(purchase.category || 'أخرى').trim(),
        String(purchase.item || '').trim(),
        Number(purchase.quantity || 0),
        Number(purchase.gramsPerUnit || 0),
        Number(purchase.amount || 0),
        String(purchase.supplier || '').trim(),
        String(purchase.notes || '').trim(),
        mappedMaterialId,
        purchase.createdAt ?? null
      );
    });

    (payload.assets || []).forEach((asset) => {
      insertAsset.run(
        String(asset.date || localDateString()).trim(),
        String(asset.item || '').trim(),
        Number(asset.cost || 0),
        String(asset.type || '').trim(),
        Number(asset.depreciationHours || 0),
        String(asset.notes || '').trim(),
        printerIdMap.get(Number(asset.printerId)) ?? null,
        asset.hourlyDepreciationOverride == null ? null : Number(asset.hourlyDepreciationOverride),
        asset.createdAt ?? null
      );
    });

    (payload.quotes || []).forEach((quote) => {
      // IDs are reassigned on import. Remap embedded quote consumption, too.
      const restoredPayload = quote.payload ? JSON.parse(JSON.stringify(quote.payload)) : JSON.parse(String(quote.payloadJson || '{}'));
      if (restoredPayload.printerId != null) restoredPayload.printerId = printerIdMap.get(Number(restoredPayload.printerId)) || null;
      if (Array.isArray(restoredPayload.materialUsage)) {
        restoredPayload.materialUsage = restoredPayload.materialUsage.map((item) => ({
          ...item, materialId: item.materialId == null ? null : (materialIdMap.get(Number(item.materialId)) || null)
        }));
      }
      const payloadJson = JSON.stringify(restoredPayload);
      if (!String(quote.code || '').trim()) return;
      insertQuote.run(
        String(quote.code || '').trim(),
        String(quote.itemName || '').trim(),
        String(quote.customerName || '').trim(),
        String(quote.date || localDateString()).trim(),
        Number(quote.finalPrice || 0),
        Number(quote.profit || 0),
        Number(quote.quantity || 1),
        String(quote.status || 'open').trim(),
        payloadJson,
        String(quote.convertedOrderCode || '').trim(),
        quote.createdAt ?? null
      );
    });

    // Imported records/configuration are authoritative, including empty inventories.
    setConfig('initialDataSeeded', '1');
    seedDefaults();
  });

  transaction();
}

/** All destructive statements and counter updates commit together, or roll back together. */
function resetBusinessData(payload) {
  const { normalizeResetOptions } = require('./reset-options');
  const options = normalizeResetOptions(payload);
  const database = db || getDb();
  return database.transaction(() => {
    const config = getAllConfig();
    const summary = getDashboardSummary();
    const orderFloor = Number(getNextOrderCode().slice(4)) - 1;
    const quoteFloor = Number(getNextQuoteCode().slice(2)) - 1;
    const counts = {};
    for (const table of ['orders', 'materials', 'purchases', 'quotes', 'stock_movements', 'printers', 'assets']) {
      counts[table] = Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    }
    database.exec(`
      DELETE FROM order_materials;
      DELETE FROM stock_movements;
      DELETE FROM quotes;
      DELETE FROM purchases;
      DELETE FROM orders;
      DELETE FROM materials;
    `);
    if (options.clearPrinters) database.exec('DELETE FROM printers;');
    if (options.clearAssets) database.exec('DELETE FROM assets;');
    if (options.factoryReset) {
      database.exec('DELETE FROM app_config;');
      seedDefaults();
    }
    // Keep primary-key high-water marks: stale UI identifiers cannot point at new items.
    setConfig('openingCash', '0');
    setConfig('baseMachineHours', options.resetMachineHours ? '0' : String(
      Number(config.baseMachineHours || 0) + Number(summary.salesMachineHours || 0)
    ));
    if (options.resetMachineHours) setConfig('lastMaintenanceAtHours', '0');
    setConfig('orderCodeFloor', options.restartCodes ? '1000' : String(orderFloor));
    setConfig('quoteCodeFloor', options.restartCodes ? '1000' : String(quoteFloor));
    setConfig('initialDataSeeded', '1');
    setConfig('lastFreshStartAt', new Date().toISOString());
    return { removed: { ...counts, printers: options.clearPrinters ? counts.printers : 0, assets: options.clearAssets ? counts.assets : 0 }, options, nextOrderCode: getNextOrderCode() };
  })();
}

function exportBackupData() {
  const data = getDashboardData({ includeAll: true });

  const orderMaterials = db.prepare(`
    SELECT
      id,
      order_id AS orderId,
      material_id AS materialId,
      material_name AS materialName,
      grams,
      waste_grams AS wasteGrams,
      created_at AS createdAt,
      price_per_gram AS pricePerGram,
      total_cost AS totalCost
    FROM order_materials
    ORDER BY id ASC
  `).all();

  const archivedPrinters = db.prepare(`
    SELECT
      id,
      name,
      model,
      status,
      hourly_depreciation AS hourlyDepreciation,
      notes,
      is_archived AS isArchived,
      created_at AS createdAt
    FROM printers
    WHERE is_archived = 1
    ORDER BY id DESC
  `).all();

  const archivedMaterials = db.prepare(`
    SELECT
      id,
      name,
      type,
      color,
      weight,
      remaining,
      price,
      low_stock_threshold AS lowStockThreshold,
      supplier,
      is_archived AS isArchived,
      created_at AS createdAt
    FROM materials
    WHERE is_archived = 1
    ORDER BY id DESC
  `).all();

  const stockMovements = db.prepare(`
    SELECT
      id,
      material_id AS materialId,
      material_name AS materialName,
      movement_type AS movementType,
      quantity,
      reason,
      reference_code AS referenceCode,
      created_at AS createdAt
    FROM stock_movements
    ORDER BY id ASC
  `).all();

  return {
    exportedAt: new Date().toISOString(),
    appName: 'MOO3DSTUDIO',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    ...data,
    printers: [...data.printers, ...archivedPrinters],
    materials: [...data.materials, ...archivedMaterials],
    stockMovements,
    orderMaterials
  };
}

module.exports = {
  BACKUP_SCHEMA_VERSION,
  getDb,
  getDatabasePath,
  getDashboardData,
  getDataPage,
  getTrackingData,
  getOrderMaterials,
  setDatabasePathForTests,
  getNextOrderCode,
  getNextQuoteCode,
  generateUniqueOrderCode,
  setConfig,
  saveUserConfig,
  createPrinter,
  savePrinterWithAsset,
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
};
