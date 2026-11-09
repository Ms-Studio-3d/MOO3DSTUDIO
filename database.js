let DatabaseDriver = null;
const path = require('path');
let electronApp = null;
try {
  ({ app: electronApp } = require('electron'));
} catch (_) {
  electronApp = null;
}

let db = null;

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
  if (!DatabaseDriver) {
    try {
      DatabaseDriver = require('better-sqlite3');
    } catch (_) {
      DatabaseDriver = createNodeSqliteCompatDriver();
    }
  }
  return DatabaseDriver;
}

function getDatabasePath() {
  if (process.env.MOO3D_DB_PATH) {
    return process.env.MOO3D_DB_PATH;
  }

  if (electronApp && typeof electronApp.getPath === 'function') {
    const userDataPath = electronApp.getPath('userData');
    return path.join(userDataPath, '3d-printing-business-manager.db');
  }

  return path.join(process.cwd(), '3d-printing-business-manager.db');
}

function setDatabasePathForTests(dbPath) {
  if (db) {
    db.close();
    db = null;
  }

  process.env.MOO3D_DB_PATH = String(dbPath || '').trim();
}

function getDb(options = {}) {
  if (db) return db;

  let Database = getDatabaseDriver();
  try {
    db = new Database(getDatabasePath(), options.readonly ? { readonly: true, fileMustExist: true } : {});
  } catch (_) {
    DatabaseDriver = createNodeSqliteCompatDriver();
    Database = DatabaseDriver;
    db = new Database(getDatabasePath(), options.readonly ? { readonly: true, fileMustExist: true } : {});
  }
  if (options.readonly) return db;
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  createTables();
  runMigrations();
  createIndexes();
  seedDefaults();

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
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
  ensureColumnExists('orders', 'price_before_discount', `ALTER TABLE orders ADD COLUMN price_before_discount REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'discount_value', `ALTER TABLE orders ADD COLUMN discount_value REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'price_after_discount', `ALTER TABLE orders ADD COLUMN price_after_discount REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'minimum_order_price', `ALTER TABLE orders ADD COLUMN minimum_order_price REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'rounded_adjustment', `ALTER TABLE orders ADD COLUMN rounded_adjustment REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'unit_final_price', `ALTER TABLE orders ADD COLUMN unit_final_price REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'unit_total_cost', `ALTER TABLE orders ADD COLUMN unit_total_cost REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'unit_profit', `ALTER TABLE orders ADD COLUMN unit_profit REAL NOT NULL DEFAULT 0`);
  ensureColumnExists('orders', 'payment_status', `ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'collected'`);
  ensureColumnExists('orders', 'payment_method', `ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT 'cash'`);
  ensureColumnExists('orders', 'paid_amount', `ALTER TABLE orders ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0`);

  backfillPricingBreakdown();
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
    CREATE INDEX IF NOT EXISTS idx_quotes_date_id ON quotes(quote_date DESC, id DESC);
  `);
}

function ensureColumnExists(tableName, columnName, alterSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((col) => col.name === columnName);

  if (!exists) {
    db.exec(alterSql);
  }
}

function backfillPricingBreakdown() {
  db.prepare(`
    UPDATE orders
    SET
      price_before_discount = CASE
        WHEN price_before_discount IS NULL OR price_before_discount = 0 THEN final_price
        ELSE price_before_discount
      END,
      price_after_discount = CASE
        WHEN price_after_discount IS NULL OR price_after_discount = 0 THEN final_price
        ELSE price_after_discount
      END,
      payment_status = 'collected',
      payment_method = 'cash',
      paid_amount = CASE
        WHEN final_price > 0 THEN final_price
        ELSE 0
      END
  `).run();
}

function seedDefaults() {
  const printersCount = db.prepare('SELECT COUNT(*) AS count FROM printers').get().count;
  const materialsCount = db.prepare('SELECT COUNT(*) AS count FROM materials').get().count;
  const assetsCount = db.prepare('SELECT COUNT(*) AS count FROM assets').get().count;

  const defaults = {
    farmName: 'Print Farm App',
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
    openingCash: '5200',
    baseMachineHours: '150',
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

  // v1.8.7: تصحيح بيانات الطابعة الافتراضية القديمة.
  // الحقل hourly_depreciation أصبح "تشغيل الطابعة فقط / ساعة".
  // أرقام 0 أو 12 أو 20 أو 33.5 في قواعد قديمة كانت إما ناقصة أو شاملة أو إهلاك أصل،
  // لذلك نعيد طابعة Bambu الافتراضية إلى 6.5 تشغيل فقط، والإهلاك والصيانة يتحسبان من الأصول والإعدادات.
  db.prepare(`
    UPDATE printers
    SET hourly_depreciation = 6.5,
        notes = 'الطابعة الأساسية - Bambu Lab A1 — تشغيل فقط 6.5/ساعة. البرنامج يضيف إهلاك الأصول ونصيب الصيانة مرة واحدة تلقائيًا.'
    WHERE name = 'Bambu Lab A1'
      AND (
        ABS(COALESCE(hourly_depreciation, 0) - 0) < 0.0001
        OR ABS(COALESCE(hourly_depreciation, 0) - 12) < 0.0001
        OR ABS(COALESCE(hourly_depreciation, 0) - 20) < 0.0001
        OR ABS(COALESCE(hourly_depreciation, 0) - 33.5) < 0.0001
      )
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

  if (printersCount === 0) {
    const insertPrinter = db.prepare(`
      INSERT INTO printers (name, model, status, hourly_depreciation, notes, is_archived)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertPrinter.run(
      'Bambu Lab A1',
      'A1',
      'idle',
      6.5,
      'الطابعة الأساسية - Bambu Lab A1 — تكلفة تشغيل الطابعة فقط. التسعير يضيف إهلاك الأصول ونصيب الصيانة مرة واحدة تلقائيًا.',
      0
    );
  }

  if (materialsCount === 0) {
    const insertMaterial = db.prepare(`
      INSERT INTO materials (name, type, color, weight, remaining, price, low_stock_threshold, supplier, is_archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertMaterial.run('PLA Black', 'PLA', 'Black', 1000, 1000, 800, 150, '', 0);
    insertMaterial.run('PLA White', 'PLA', 'White', 1000, 1000, 800, 150, '', 0);
    insertMaterial.run('PLA Red', 'PLA', 'Red', 1000, 1000, 800, 150, '', 0);
    insertMaterial.run('PLA Silk Gold', 'PLA Silk', 'Gold', 1000, 1000, 1200, 150, '', 0);
  }

  if (assetsCount === 0) {
    db.prepare(`
      INSERT INTO assets (asset_date, item, cost, asset_type, depreciation_hours, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      '2026-04-12',
      'Bambu Lab A1 Combo / الطابعة',
      60000,
      'طابعة',
      5000,
      'أصل افتتاحي لحساب استرداد تكلفة الطابعة'
    );
  }


  const hasLargePrinterAsset = db.prepare(`
    SELECT COUNT(*) AS count
    FROM assets
    WHERE cost >= 10000
      AND depreciation_hours > 0
      AND (item LIKE '%Bambu%' OR item LIKE '%طابعة%' OR asset_type LIKE '%طابعة%')
  `).get().count;

  if (Number(hasLargePrinterAsset || 0) === 0) {
    db.prepare(`
      INSERT INTO assets (asset_date, item, cost, asset_type, depreciation_hours, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      '2026-04-12',
      'Bambu Lab A1 Combo / الطابعة',
      60000,
      'طابعة',
      5000,
      'أصل افتراضي أضيف لضمان حساب إهلاك الطابعة مرة واحدة داخل التسعير'
    );
  }
  setConfig('initialDataSeeded', '1');
}

function getAllConfig() {
  const rows = db.prepare('SELECT key, value FROM app_config').all();
  const config = {};

  for (const row of rows) {
    config[row.key] = row.value;
  }

  return config;
}

function setConfig(key, value) {
  db.prepare(`
    INSERT INTO app_config (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(key), String(value));
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
      notes,
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
      COALESCE(SUM(CASE WHEN remaining > 0 AND remaining <= low_stock_threshold THEN 1 ELSE 0 END), 0) AS lowCount
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

function getDashboardData(options = {}) {
  const pageOptions = normalizePageOptions(options);
  const printers = db.prepare(`
    SELECT
      id,
      name,
      model,
      status,
      hourly_depreciation AS hourlyDepreciation,
      notes,
      is_archived AS isArchived
    FROM printers
    WHERE is_archived = 0
    ORDER BY id DESC
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
      is_archived AS isArchived
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
}

function updateMaterial(data) {
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
    String(data.date || new Date().toISOString().slice(0, 10)).trim(),
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
      price_per_gram,
      total_cost
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const updateMaterialStock = db.prepare(`
    UPDATE materials
    SET remaining = remaining - ?
    WHERE id = ? AND remaining >= ? AND is_archived = 0
  `);

  const insertStockMovement = db.prepare(`
    INSERT INTO stock_movements (
      material_id,
      material_name,
      movement_type,
      quantity,
      reason,
      reference_code
    )
    VALUES (?, ?, ?, ?, ?, ?)
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
    if (Number(item.grams || 0) <= 0) {
      throw new Error('كمية الخامة لازم تكون أكبر من صفر');
    }
  }

  const cleanCode = String(data.code || '').trim();
  const existingCode = db.prepare('SELECT id FROM orders WHERE code = ?').get(cleanCode);

  if (existingCode) {
    throw new Error('كود الأوردر موجود بالفعل، حاول مرة أخرى');
  }

  for (const item of data.materialUsage) {
    const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(Number(item.materialId));

    if (!material) {
      throw new Error(`الخامة غير موجودة: ${item.materialName}`);
    }

    if (Number(material.is_archived || 0) === 1) {
      throw new Error(`الخامة مؤرشفة ولا يمكن استخدامها: ${item.materialName}`);
    }

    if (Number(material.remaining || 0) < Number(item.grams || 0)) {
      throw new Error(`المخزون غير كافٍ في: ${item.materialName}`);
    }
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

  for (const item of data.materialUsage) {
    const result = updateMaterialStock.run(
      Number(item.grams || 0),
      Number(item.materialId),
      Number(item.grams || 0)
    );

    if (result.changes === 0) {
      throw new Error(`تعذر خصم المخزون من: ${item.materialName}`);
    }

    insertMaterialUsage.run(
      orderId,
      Number(item.materialId),
      String(item.materialName || '').trim(),
      Number(item.grams || 0),
      Number(item.pricePerGram || 0),
      Number(item.totalCost || 0)
    );

    insertStockMovement.run(
      Number(item.materialId),
      String(item.materialName || '').trim(),
      'out',
      Number(item.grams || 0),
      'استهلاك في أوردر',
      cleanCode
    );
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
    payload.date = new Date().toISOString().slice(0, 10);
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
    const existingOrder = db.prepare('SELECT id, code, printer_id AS printerId FROM orders WHERE code = ?').get(code);

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

      const oldMaterials = db.prepare(`
        SELECT material_id AS materialId, material_name AS materialName, grams
        FROM order_materials
        WHERE order_id = ?
      `).all(existingOrder.id);

      for (const item of oldMaterials) {
        if (item.materialId) {
          db.prepare(`
            UPDATE materials
            SET remaining = remaining + ?
            WHERE id = ?
          `).run(Number(item.grams || 0), Number(item.materialId));
        }

        db.prepare(`
          INSERT INTO stock_movements (
            material_id,
            material_name,
            movement_type,
            quantity,
            reason,
            reference_code
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          item.materialId ? Number(item.materialId) : null,
          String(item.materialName || '').trim(),
          'return',
          Number(item.grams || 0),
          'استرجاع قبل تعديل أوردر',
          String(existingOrder.code || '').trim()
        );
      }

      db.prepare('DELETE FROM order_materials WHERE order_id = ?').run(existingOrder.id);

      for (const item of data.materialUsage) {
        if (Number(item.grams || 0) <= 0) {
          throw new Error('كمية الخامة لازم تكون أكبر من صفر');
        }

        const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(Number(item.materialId));

        if (!material) {
          throw new Error(`الخامة غير موجودة: ${item.materialName}`);
        }

        if (Number(material.is_archived || 0) === 1) {
          throw new Error(`الخامة مؤرشفة ولا يمكن استخدامها: ${item.materialName}`);
        }

        if (Number(material.remaining || 0) < Number(item.grams || 0)) {
          throw new Error(`المخزون غير كافٍ في: ${item.materialName}`);
        }

        const result = db.prepare(`
          UPDATE materials
          SET remaining = remaining - ?
          WHERE id = ? AND remaining >= ? AND is_archived = 0
        `).run(
          Number(item.grams || 0),
          Number(item.materialId),
          Number(item.grams || 0)
        );

        if (result.changes === 0) {
          throw new Error(`تعذر خصم المخزون من: ${item.materialName}`);
        }

        db.prepare(`
          INSERT INTO order_materials (
            order_id,
            material_id,
            material_name,
            grams,
            price_per_gram,
            total_cost
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          existingOrder.id,
          Number(item.materialId),
          String(item.materialName || '').trim(),
          Number(item.grams || 0),
          Number(item.pricePerGram || 0),
          Number(item.totalCost || 0)
        );

        db.prepare(`
          INSERT INTO stock_movements (
            material_id,
            material_name,
            movement_type,
            quantity,
            reason,
            reference_code
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          Number(item.materialId),
          String(item.materialName || '').trim(),
          'out',
          Number(item.grams || 0),
          'استهلاك بعد تعديل أوردر',
          String(existingOrder.code || '').trim()
        );
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
      'collected',
      'cash',
      finalPrice,
      code
    );
  });

  transaction(payload);
}

function deleteOrder(code) {
  const order = db.prepare('SELECT id, code FROM orders WHERE code = ?').get(String(code || '').trim());

  if (!order) return;

  const materials = db.prepare(`
    SELECT material_id AS materialId, material_name AS materialName, grams
    FROM order_materials
    WHERE order_id = ?
  `).all(order.id);

  const transaction = db.transaction(() => {
    for (const item of materials) {
      if (item.materialId) {
        db.prepare(`
          UPDATE materials
          SET remaining = remaining + ?
          WHERE id = ?
        `).run(Number(item.grams || 0), Number(item.materialId));
      }

      db.prepare(`
        INSERT INTO stock_movements (
          material_id,
          material_name,
          movement_type,
          quantity,
          reason,
          reference_code
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        item.materialId ? Number(item.materialId) : null,
        String(item.materialName || '').trim(),
        'return',
        Number(item.grams || 0),
        'استرجاع بعد حذف أوردر',
        String(order.code || '').trim()
      );
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

function applyPurchaseStockDelta(data, direction, referenceCode, reason) {
  const grams = getPurchaseStockGrams(data);
  const materialId = getPurchaseMaterialId(data);
  if (!grams || !materialId) return;

  const material = db.prepare('SELECT id, name, remaining FROM materials WHERE id = ?').get(materialId);
  if (!material) throw new Error('الخامة المرتبطة بالمشتريات غير موجودة');

  if (direction < 0 && Number(material.remaining || 0) < grams) {
    throw new Error(`لا يمكن حذف/تعديل المشتريات لأن المتبقي في ${material.name} أقل من الكمية المطلوب خصمها`);
  }

  db.prepare('UPDATE materials SET remaining = remaining + ? WHERE id = ?').run(Number(direction) * grams, materialId);

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
    date: String(data.date || new Date().toISOString().slice(0, 10)).trim(),
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

      applyPurchaseStockDelta(old, -1, `PUR-${clean.id}`, 'استرجاع مخزون قبل تعديل مشتريات');

      if (clean.createMaterial) {
        clean.materialId = createMaterialFromPurchase(clean);
      }

      db.prepare(`
        UPDATE purchases
        SET purchase_date = ?, category = ?, item = ?, quantity = ?, grams_per_unit = ?, amount = ?, supplier = ?, notes = ?, material_id = ?
        WHERE id = ?
      `).run(clean.date, clean.category, clean.item, clean.quantity, clean.gramsPerUnit, clean.amount, clean.supplier, clean.notes, clean.materialId, clean.id);

      applyPurchaseStockDelta(clean, 1, `PUR-${clean.id}`, 'إضافة مخزون بعد تعديل مشتريات');
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
    date: String(data.date || new Date().toISOString().slice(0, 10)).trim(),
    item: String(data.item || '').trim(),
    cost: Math.max(0, Number(data.cost || 0)),
    type: String(data.type || '').trim(),
    depreciationHours: Math.max(0, Number(data.depreciationHours || 0)),
    notes: String(data.notes || '').trim()
  };

  if (!clean.date) throw new Error('تاريخ الأصل مطلوب');
  if (!clean.item) throw new Error('اسم الأصل مطلوب');
  if (clean.cost <= 0) throw new Error('تكلفة الأصل لازم تكون أكبر من صفر');

  if (clean.id) {
    db.prepare(`
      UPDATE assets
      SET asset_date = ?, item = ?, cost = ?, asset_type = ?, depreciation_hours = ?, notes = ?
      WHERE id = ?
    `).run(clean.date, clean.item, clean.cost, clean.type, clean.depreciationHours, clean.notes, clean.id);
    return clean.id;
  }

  const result = db.prepare(`
    INSERT INTO assets (asset_date, item, cost, asset_type, depreciation_hours, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(clean.date, clean.item, clean.cost, clean.type, clean.depreciationHours, clean.notes);

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
      INSERT INTO printers (name, model, status, hourly_depreciation, notes, is_archived)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMaterial = db.prepare(`
      INSERT INTO materials (name, type, color, weight, remaining, price, low_stock_threshold, supplier, is_archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        paid_amount
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (
        material_id,
        material_name,
        movement_type,
        quantity,
        reason,
        reference_code
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertOrderMaterial = db.prepare(`
      INSERT INTO order_materials (
        order_id,
        material_id,
        material_name,
        grams,
        price_per_gram,
        total_cost
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertQuote = db.prepare(`
      INSERT INTO quotes (code, item_name, customer_name, quote_date, final_price, profit, quantity, status, payload_json, converted_order_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertPurchase = db.prepare(`
      INSERT INTO purchases (purchase_date, category, item, quantity, grams_per_unit, amount, supplier, notes, material_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAsset = db.prepare(`
      INSERT INTO assets (asset_date, item, cost, asset_type, depreciation_hours, notes)
      VALUES (?, ?, ?, ?, ?, ?)
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
        Number(printer.isArchived ? 1 : 0)
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
        Number(material.isArchived ? 1 : 0)
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
        Number(order.priceBeforeDiscount || finalPrice),
        Number(order.discountValue || 0),
        Number(order.priceAfterDiscount || finalPrice),
        Number(order.minimumOrderPrice || 0),
        Number(order.roundedAdjustment || 0),
        finalPrice,
        Number(order.profit || 0),
        Number(order.unitFinalPrice || (finalPrice / Math.max(1, Number(order.quantity || 1)))),
        Number(order.unitTotalCost || (Number(order.totalCost || 0) / Math.max(1, Number(order.quantity || 1)))),
        Number(order.unitProfit || (Number(order.profit || 0) / Math.max(1, Number(order.quantity || 1)))),
        'collected',
        'cash',
        finalPrice
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
        Number(item.totalCost || 0)
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
        String(movement.referenceCode || '').trim()
      );
    });

    (payload.purchases || []).forEach((purchase) => {
      const mappedMaterialId = purchase.materialId != null
        ? (materialIdMap.get(Number(purchase.materialId)) ?? null)
        : null;

      insertPurchase.run(
        String(purchase.date || new Date().toISOString().slice(0, 10)).trim(),
        String(purchase.category || 'أخرى').trim(),
        String(purchase.item || '').trim(),
        Number(purchase.quantity || 0),
        Number(purchase.gramsPerUnit || 0),
        Number(purchase.amount || 0),
        String(purchase.supplier || '').trim(),
        String(purchase.notes || '').trim(),
        mappedMaterialId
      );
    });

    (payload.assets || []).forEach((asset) => {
      insertAsset.run(
        String(asset.date || new Date().toISOString().slice(0, 10)).trim(),
        String(asset.item || '').trim(),
        Number(asset.cost || 0),
        String(asset.type || '').trim(),
        Number(asset.depreciationHours || 0),
        String(asset.notes || '').trim()
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
        String(quote.date || new Date().toISOString().slice(0, 10)).trim(),
        Number(quote.finalPrice || 0),
        Number(quote.profit || 0),
        Number(quote.quantity || 1),
        String(quote.status || 'open').trim(),
        payloadJson,
        String(quote.convertedOrderCode || '').trim()
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
      is_archived AS isArchived
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
      is_archived AS isArchived
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
    appName: 'Print Farm App',
    schemaVersion: 9,
    ...data,
    printers: [...data.printers, ...archivedPrinters],
    materials: [...data.materials, ...archivedMaterials],
    stockMovements,
    orderMaterials
  };
}

module.exports = {
  getDb,
  getDatabasePath,
  getDashboardData,
  getDataPage,
  setDatabasePathForTests,
  getNextOrderCode,
  getNextQuoteCode,
  generateUniqueOrderCode,
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
};
