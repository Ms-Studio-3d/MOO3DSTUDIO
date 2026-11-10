'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createAppHarness, sampleOrder } = require('./helpers/app-harness');
const { roundUpByStep, calculateMoo3dPricing } = require('../js/pricing-core');
const { localDateString } = require('../js/local-date');

async function run() {
  process.env.TZ = 'Africa/Cairo';
  assert.equal(localDateString(new Date('2026-11-09T22:30:00Z')), '2026-11-10');
  assert.equal(roundUpByStep(95.00000000000001, 5), 95);
  assert.equal(roundUpByStep(95.01, 5), 100);
  assert.equal(roundUpByStep(0.30000000000000004, 0.1), 0.3);
  assert.equal(roundUpByStep(30.000000000000004, 10), 30);
  assert.equal(calculateMoo3dPricing({ materialCost: 100, profitMargin: 10, roundingStep: 5 }).finalPrice, 110);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moo3d-review-'));
  const h = createAppHarness(root, { withSampleMaterials: false });
  const db = h.database;
  const createMaterial = (name, remaining) => db.createMaterial({ name, weight: 1000, remaining, price: 500 });
  const balance = (id) => db.getDb().prepare('SELECT remaining FROM materials WHERE id = ?').get(id).remaining;
  const usage = (id, grams) => ({ materialId: id, materialName: 'PLA', grams, pricePerGram: 0.5, totalCost: grams * 0.5 });
  const sale = (rows, wasteWeight = 0) => sampleOrder(db, { materialUsage: rows, wasteWeight, wasteCost: wasteWeight * 0.5 });
  const save = async (payload) => {
    const result = await h.farmAPI.createOrder(payload);
    assert.ok(result.success, result.message);
  };
  try {
    assert.equal((await h.invoke('db:getDashboardData', undefined, {})).success, false);
    assert.equal((await h.farmAPI.saveConfig({ maintenanceCost: '0', orderCodeFloor: '999' })).success, false);
    assert.equal(db.getDashboardData().config.maintenanceCost, '1500');
    assert.equal((await h.farmAPI.saveConfig({ maintenanceCost: '0' })).success, true);
    const printer = db.createPrinter({ name: 'Bambu Lab A1', status: 'idle', hourlyDepreciation: 12 });
    const black = createMaterial('Black', 1000.30);
    const white = createMaterial('White', 1000);
    assert.equal((await h.farmAPI.createOrder({ ...sale([usage(black, 500.10)]), quantity: 1.5 })).success, false);
    assert.equal((await h.farmAPI.createOrder({ ...sale([usage(black, 500.10)]), profit: 0 })).success, false);
    await save(sale([usage(black, 500.10)]));
    const over = await h.farmAPI.createOrder(sale([usage(black, 500.21)]));
    assert.equal(over.success, false);
    const exact = sale([usage(black, 500.19)], 0.01);
    await save(exact);
    assert.equal(balance(black), 0);
    assert.equal(db.getDashboardData().meta.summary.stock.lowCount, 1);
    await h.farmAPI.deleteOrder(exact.code);
    assert.equal(balance(black).toFixed(2), '500.20');

    const multi = sale([usage(black, 15), usage(white, 5)], 4);
    await save(multi);
    assert.deepEqual(db.getOrderMaterials(multi.code).map((row) => row.wasteGrams), [3, 1]);
    assert.equal(balance(white), 994);
    const edited = await h.farmAPI.updateOrder({ ...multi, materialUsage: [usage(black, 15), usage(white, 15)] });
    assert.equal(edited.success, true, edited.message);
    assert.equal(balance(white), 983);
    assert.equal(balance(black).toFixed(2), '483.20');
    const rejected = await h.farmAPI.updateOrder({ ...multi, materialUsage: [usage(black, 9999), usage(white, 20)] });
    assert.equal(rejected.success, false);
    assert.equal(balance(white), 983);
    const beforeDelete = balance(white);
    await h.farmAPI.deleteOrder(multi.code);
    await h.farmAPI.deleteOrder(multi.code);
    assert.equal(balance(white) - beforeDelete, 17);

    const legacy = sale([usage(white, 5)], 4);
    await save(legacy);
    db.getDb().prepare('UPDATE materials SET remaining = remaining + 4 WHERE id = ?').run(white);
    db.getDb().exec('UPDATE order_materials SET waste_grams = NULL WHERE material_id = ' + white);
    await h.farmAPI.deleteOrder(legacy.code);
    assert.equal(balance(white), 1000);

    const purchased = createMaterial('Purchased', 0);
    const input = { date: '2026-11-10', item: 'Purchased', category: 'خامات', materialId: purchased, quantity: 1, gramsPerUnit: 1000, amount: 500 };
    const id = db.savePurchase(input);
    await save(sale([usage(purchased, 900)]));
    const movements = () => db.getDataPage('stockMovements', { includeAll: true }).total;
    const count = movements();
    db.savePurchase({ ...input, id, supplier: 'Updated' });
    assert.equal(movements(), count);
    db.savePurchase({ ...input, id, gramsPerUnit: 1200 });
    assert.equal(balance(purchased), 300);
    assert.throws(() => db.savePurchase({ ...input, id, gramsPerUnit: 800 }), /أقل من الكمية/);
    assert.throws(() => db.savePurchase({ ...input, id, materialId: white }), /أقل من الكمية/);
    assert.equal(balance(purchased), 300);
    assert.equal(balance(white), 1000);

    const quote = sale([usage(white, 10)], 2);
    db.createQuote({ ...quote, quoteCode: db.getNextQuoteCode() });
    const quoteCode = db.getDashboardData().quotes[0].code;
    const convertedCode = db.convertQuoteToOrder(quoteCode, db.getNextOrderCode());
    assert.equal(balance(white), 988);
    assert.throws(() => db.convertQuoteToOrder(quoteCode, db.getNextOrderCode()), /اتحول قبل/);
    db.saveAsset({ item: 'Asset', cost: 100, type: 'أخرى', depreciationHours: 200 });
    const fields = { printers: 'printers', materials: 'materials', orders: 'orders', orderMaterials: 'order_materials',
      stockMovements: 'stock_movements', purchases: 'purchases', quotes: 'quotes', assets: 'assets' };
    for (const table of Object.values(fields)) db.getDb().exec('UPDATE ' + table + " SET created_at = '2026-01-05 13:14:15'");
    db.getDb().prepare("UPDATE orders SET paid_amount = 17, payment_status = 'partial', payment_method = 'card' WHERE code = ?").run(convertedCode);
    const backup = JSON.parse(JSON.stringify(db.exportBackupData()));
    for (const key of Object.keys(fields)) {
      assert.ok(backup[key].length > 0, key);
      assert.ok(backup[key].every((row) => row.createdAt === '2026-01-05 13:14:15'), key);
    }
    const restored = await h.farmAPI.importBackup(backup);
    assert.equal(restored.success, true, restored.message);
    db.setDatabasePathForTests(h.dbPath);
    db.getDb();
    for (const table of Object.values(fields)) {
      assert.ok(db.getDb().prepare('SELECT created_at FROM ' + table).all().every((row) => row.created_at === '2026-01-05 13:14:15'), table);
    }
    const restoredOrder = db.getDashboardData().orders.find((order) => order.code === convertedCode);
    assert.deepEqual([restoredOrder.paymentStatus, restoredOrder.paymentMethod, restoredOrder.paidAmount], ['partial', 'card', 17]);
    const remainingWhite = db.getDashboardData().materials.find((m) => m.name === 'White');
    assert.equal(remainingWhite.remaining, 988);
    assert.equal(db.getOrderMaterials(convertedCode)[0].wasteGrams, 2);
    await h.farmAPI.deleteOrder(convertedCode);
    assert.equal(balance(remainingWhite.id), 1000);
    assert.equal(db.getDashboardData().printers.find((row) => row.name === 'Bambu Lab A1').hourlyDepreciation, 12);
    assert.ok(printer > 0);
    assert.equal(backup.schemaVersion, 10);
    const previous = JSON.parse(JSON.stringify(db.exportBackupData()));
    previous.schemaVersion = 9;
    for (const rows of Object.keys(fields).map((key) => previous[key])) {
      for (const row of rows) { delete row.createdAt; delete row.wasteGrams; }
    }
    assert.equal((await h.farmAPI.importBackup(previous)).success, true);
    assert.ok(db.exportBackupData().orders.every((row) => row.createdAt));

    const wasteMaterial = db.createMaterial({ name: 'Waste test PLA', weight: 1000, remaining: 1000, price: 1000 });
    const originalPricing = calculateMoo3dPricing({
      materialCost: 40, wasteCost: 5, depreciationCost: 10, profitMargin: 100, roundingStep: 5
    });
    const wasteSale = sampleOrder(db, {
      ...originalPricing, wasteWeight: 5, printHours: 1, manualMinutes: 0,
      materialUsage: [{ materialId: wasteMaterial, materialName: 'Waste test PLA', grams: 40, pricePerGram: 1, totalCost: 40 }]
    });
    await save(wasteSale);
    const collectedBefore = db.getDashboardData().meta.summary.collected;
    assert.equal(balance(wasteMaterial), 955);

    const editFields = new Map();
    const field = (key) => {
      if (!editFields.has(key)) editFields.set(key, { value: '', options: [], focus() {}, querySelector: () => null });
      return editFields.get(key);
    };
    field('editPrinter').options = [{ value: wasteSale.printerId }];
    const editor = vm.createContext({
      document: { getElementById: field },
      window: { farmAPI: h.farmAPI },
      readDashboard: async () => (await h.farmAPI.getDashboardData()).data
    });
    for (const file of ['state', 'utils', 'stock-weights', 'pricing-core', 'edit-orders']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), editor);
    }
    const evaluate = (source) => vm.runInContext(source, editor);
    await evaluate(`
      openModal = () => {};
      closeModal = () => {};
      isModalOpen = () => false;
      showToast = () => {};
      loadDashboardData = async () => { dashboardData = await readDashboard(); };
      loadDashboardData();
    `);
    editor.orderCode = wasteSale.code;
    await evaluate('openEditSale(orderCode)');
    assert.equal(Number(field('editWasteWeight').value), 5);
    assert.equal(Number(field('editFinalPrice').value), 110);
    assert.match(field('editCostPreview').innerText, /تكلفة الهالك.*5\.00/);
    const initialMaterialRows = db.getOrderMaterials(wasteSale.code).map((row) => row.rowId);

    field('editWasteWeight').value = 'x';
    await evaluate('saveEditSale()');
    assert.equal(balance(wasteMaterial), 955);
    assert.equal(db.getDashboardData().meta.summary.collected, collectedBefore);

    field('editWasteWeight').value = '5';
    evaluate("editMaterials[0].grams = '35'; updateEditCostPreview()");
    assert.equal(Number(field('editFinalPrice').value), 100);
    evaluate("editMaterials[0].grams = '40'; updateEditCostPreview()");
    assert.equal(Number(field('editFinalPrice').value), 110);

    field('editFinalPrice').value = '115';
    evaluate('updateEditCostPreview()');
    field('editWasteWeight').value = '0';
    evaluate('updateEditCostPreview()');
    assert.equal(Number(field('editFinalPrice').value), 100);
    assert.ok(!field('editFinalPrice').readOnly);
    assert.match(field('editCostPreview').innerText, /هيتخصم من الدرج 10\.00/);

    evaluate("dashboardData.config.roundingStep = '75'; updateEditCostPreview()");
    assert.equal(Number(field('editFinalPrice').value), 110);
    evaluate("dashboardData.config.roundingStep = '5'");

    field('editWasteWeight').value = '5';
    evaluate('updateEditCostPreview()');
    assert.equal(field('editFinalPrice').value, '115');

    field('editWasteWeight').value = '0';
    evaluate('updateEditCostPreview()');
    field('editFinalPrice').value = '80';
    evaluate('updateEditCostPreview()');
    assert.equal(field('editFinalPrice').value, '80');
    assert.match(field('editCostPreview').innerText, /هيتخصم من الدرج 30\.00/);
    evaluate("editMaterials[0].grams = '35'; updateEditCostPreview()");
    assert.equal(Number(field('editFinalPrice').value), 90);
    field('editFinalPrice').value = '45';
    field('editNotes').value = 'السعر المتفق عليه';
    evaluate('updateEditCostPreview()');
    assert.equal(field('editFinalPrice').value, '45');
    await evaluate('saveEditSale()');
    const editedSale = db.getDashboardData().orders.find((row) => row.code === wasteSale.code);
    assert.deepEqual([editedSale.wasteWeight, editedSale.wasteCost, editedSale.finalPrice, editedSale.paidAmount], [0, 0, 45, 45]);
    assert.equal(balance(wasteMaterial), 965);
    assert.equal(db.getDashboardData().meta.summary.collected, collectedBefore - 65);
    const staleEdit = await h.farmAPI.updateOrder({
      ...wasteSale, replaceMaterialUsage: false, expectedMaterialRowIds: initialMaterialRows
    });
    assert.equal(staleEdit.success, false);
    await evaluate('openEditSale(orderCode)');
    field('editCustomerName').value = 'تعديل اسم العميل بعد الحفظ';
    await evaluate('saveEditSale()');
    assert.equal(db.getDashboardData().orders.find((row) => row.code === wasteSale.code).customerName,
      'تعديل اسم العميل بعد الحفظ');
    assert.equal(balance(wasteMaterial), 965);
    assert.equal(db.getDashboardData().meta.summary.collected, collectedBefore - 65);

    const legacyWaste = { ...wasteSale, code: db.getNextOrderCode() };
    await save(legacyWaste);
    const sql = db.getDb();
    sql.prepare('UPDATE materials SET remaining = remaining + 5 WHERE id = ?').run(wasteMaterial);
    sql.prepare('UPDATE order_materials SET waste_grams = NULL WHERE order_id = (SELECT id FROM orders WHERE code = ?)')
      .run(legacyWaste.code);
    const legacyBalance = balance(wasteMaterial);
    await evaluate('loadDashboardData()');
    editor.orderCode = legacyWaste.code;
    await evaluate('openEditSale(orderCode)');
    assert.equal(field('editLegacyWasteHint').hidden, false);
    field('editWasteWeight').value = '0';
    await evaluate('saveEditSale()');
    assert.equal(balance(wasteMaterial), legacyBalance);
    assert.equal(db.getOrderMaterials(legacyWaste.code)[0].wasteGrams, 0);
  } finally {
    db.setDatabasePathForTests('');
    fs.rmSync(root, { recursive: true, force: true });
  }

  const context = vm.createContext({ window: {}, document: { getElementById: () => null } });
  for (const file of ['state', 'utils', 'local-date', 'pricing-orders', 'settings-export', 'quotes']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), context);
  }
  const evaluate = (code) => vm.runInContext(code, context);
  assert.equal(evaluate("toNumber('1,200.50')"), 1200.5);
  assert.equal(evaluate("toNumber('١٬٢٠٠٫٥٠')"), 1200.5);
  assert.equal(evaluate("toNumber('1,20')"), 1.2);
  assert.equal(evaluate("getPrinterOperatingCostPerHour({ name: 'Bambu Lab A1', hourlyDepreciation: 20 })"), 20);
  assert.equal(evaluate("dashboardData.config.maintenanceCost = '0'; getMaintenanceCostPerHour()"), 0);
  assert.equal(evaluate("csvEscape('=1+2')"), "'=1+2");
  assert.equal(evaluate('csvEscape(-5.25)'), '-5.25');
  assert.equal(evaluate("escapeHtml('<x title=\"y\">')"), '&lt;x title=&quot;y&quot;&gt;');
  const exports = [];
  context.captureDownload = (name, data) => exports.push([name, data]);
  context.filters = { from: '2099-01-01' };
  context.window.farmAPI = { getDataPage: async (kind, opts) => {
    assert.equal(opts.includeAll, true);
    const count = kind === 'orders' ? (opts.filters.from === '2099-01-01' ? 0 : 103) : 101;
    return { success: true, data: { items: Array.from({ length: count }, (_, index) => ({ code: String(index), itemName: '=1+2' })) } };
  } };
  evaluate('downloadTextFile = captureDownload; getReportsFilters = () => filters;');
  await evaluate('exportSalesCSV()');
  context.filters = { from: '' };
  await evaluate('exportSalesCSV()');
  await evaluate('exportQuotesCSV()');
  assert.deepEqual(exports.map((row) => row[1].split("\n").length), [1, 104, 102]);
  assert.match(exports[1][1], /'=1\+2/);
  console.log('Review regressions passed for dates, pricing, permissions, stock, purchases, restore, and exports.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
