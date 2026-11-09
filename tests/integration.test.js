const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const root = path.join(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moo3d-integration-'));
const dbPath = path.join(tempDir, 'integration.db');
const backupsDir = path.join(tempDir, 'backups');

const database = require('../database');

database.setDatabasePathForTests(dbPath);
const db = database.getDb();

function money(value) {
  return Number(Number(value).toFixed(2));
}

function createSampleOrder(index, overrides = {}) {
  const code = overrides.code || `ORD-${3000 + index}`;
  const finalPrice = money(overrides.finalPrice ?? (120 + index));
  const totalCost = money(overrides.totalCost ?? (40 + (index % 9)));
  const quantity = overrides.quantity ?? ((index % 4) + 1);
  const profit = money(finalPrice - totalCost);
  const materialGrams = overrides.materialGrams ?? 1;

  database.createOrder({
    code,
    itemName: overrides.itemName || (index === 135 ? 'needle-135 custom dragon' : `مجسم اختبار ${index}`),
    customerName: overrides.customerName || (index % 10 === 0 ? 'عميل مميز' : `عميل ${index % 17}`),
    printerId: overrides.printerId,
    status: overrides.status || 'delivered',
    quantity,
    printHours: overrides.printHours ?? (1 + (index % 5) / 10),
    manualMinutes: overrides.manualMinutes ?? 10,
    notes: overrides.notes || (index === 135 ? 'search-token-after-first-page' : ''),
    date: overrides.date || `2026-05-${String((index % 28) + 1).padStart(2, '0')}`,
    materialCost: money(materialGrams * 0.8),
    wasteWeight: 0,
    wasteCost: 0,
    depreciationCost: 12,
    electricityCost: 3,
    laborCost: 5,
    packagingCost: 4,
    accessoriesCost: 0,
    shippingCost: 0,
    riskCost: 2,
    taxCost: 0,
    totalCost,
    priceBeforeDiscount: finalPrice,
    discountValue: 0,
    priceAfterDiscount: finalPrice,
    minimumOrderPrice: 0,
    roundedAdjustment: 0,
    finalPrice,
    profit,
    unitFinalPrice: money(finalPrice / quantity),
    unitTotalCost: money(totalCost / quantity),
    unitProfit: money(profit / quantity),
    materialUsage: [{
      materialId: overrides.materialId,
      materialName: overrides.materialName,
      grams: materialGrams,
      pricePerGram: 0.8,
      totalCost: money(materialGrams * 0.8)
    }]
  });

  return { code, finalPrice, totalCost, profit, quantity, materialGrams };
}

async function runBackupWorker(reason = 'integration') {
  return await new Promise((resolve, reject) => {
    const worker = new Worker(path.join(root, 'backup-worker.js'), {
      workerData: { dbPath, backupsDir, reason }
    });

    let settled = false;
    worker.on('message', (message) => {
      if (settled) return;
      settled = true;
      if (message?.success) resolve(message.filePath);
      else reject(new Error(message?.message || 'backup worker failed'));
    });
    worker.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    worker.on('exit', (code) => {
      if (!settled && code !== 0) reject(new Error(`backup worker exited with code ${code}`));
    });
  });
}

(async () => {
  const printerId = database.createPrinter({
    name: 'Integration Printer',
    model: 'T-100',
    status: 'idle',
    hourlyDepreciation: 10,
    notes: ''
  });

  const materialId = database.createMaterial({
    name: 'Integration PLA',
    type: 'PLA',
    color: 'Black',
    weight: 20000,
    remaining: 20000,
    price: 16000,
    lowStockThreshold: 500,
    supplier: 'test'
  });

  const created = [];
  for (let i = 1; i <= 150; i += 1) {
    created.push(createSampleOrder(i, {
      printerId,
      materialId,
      materialName: 'Integration PLA'
    }));
  }

  const firstPage = database.getDataPage('orders', { limit: 100, offset: 0 });
  assert.equal(firstPage.items.length, 100, 'first page should only load 100 records');
  assert.ok(firstPage.total >= 150, 'orders total should count the whole temporary database');
  assert.equal(firstPage.hasMore, true, 'more than 100 orders should be paginated');

  const searchPage = database.getDataPage('orders', {
    limit: 100,
    offset: 0,
    filters: { search: 'needle-135' }
  });
  assert.equal(searchPage.total, 1, 'search should match records beyond the first 100');
  assert.equal(searchPage.items[0].code, 'ORD-3135');
  assert.equal(searchPage.hasMore, false, 'load-more should depend on matched search results, not global order count');
  assert.equal(searchPage.summary.count, 1);
  assert.equal(searchPage.summary.totalRevenue, created[134].finalPrice);

  const customerPage = database.getDataPage('orders', {
    limit: 25,
    offset: 0,
    filters: { customer: 'عميل مميز' }
  });
  const expectedCustomerOrders = created.filter((_, index) => (index + 1) % 10 === 0);
  const expectedCustomerRevenue = money(expectedCustomerOrders.reduce((sum, item) => sum + item.finalPrice, 0));
  assert.equal(customerPage.total, expectedCustomerOrders.length, 'customer filter should use the full database');
  assert.equal(money(customerPage.summary.totalRevenue), expectedCustomerRevenue, 'report total must use all matching customer rows');
  assert.equal(customerPage.summary.topCustomer.name, 'عميل مميز');

  const customersSummary = database.getDataPage('customers', {
    limit: 100,
    offset: 0,
    filters: { customer: 'عميل مميز' }
  });
  assert.equal(customersSummary.total, 1, 'customers summary should aggregate from the database, not loaded rows');
  assert.equal(customersSummary.items[0].count, expectedCustomerOrders.length);
  assert.equal(money(customersSummary.items[0].revenue), expectedCustomerRevenue);

  const materialBeforeEdit = db.prepare('SELECT remaining FROM materials WHERE id = ?').get(materialId).remaining;
  database.updateOrder({
    code: 'ORD-3135',
    itemName: 'needle-135 custom dragon edited',
    customerName: 'عميل مميز',
    printerId,
    status: 'delivered',
    quantity: 2,
    printHours: 2,
    manualMinutes: 15,
    notes: 'edited integration order',
    date: '2026-05-15',
    materialCost: 1.6,
    wasteWeight: 0,
    wasteCost: 0,
    depreciationCost: 20,
    electricityCost: 6,
    laborCost: 10,
    packagingCost: 4,
    accessoriesCost: 0,
    shippingCost: 0,
    riskCost: 3,
    taxCost: 0,
    totalCost: 45,
    priceBeforeDiscount: 180,
    discountValue: 0,
    priceAfterDiscount: 180,
    minimumOrderPrice: 0,
    roundedAdjustment: 0,
    finalPrice: 180,
    profit: 135,
    unitFinalPrice: 90,
    unitTotalCost: 22.5,
    unitProfit: 67.5,
    materialUsage: [{
      materialId,
      materialName: 'Integration PLA',
      grams: 2,
      pricePerGram: 0.8,
      totalCost: 1.6
    }]
  });

  const editedOrder = db.prepare('SELECT payment_status, payment_method, paid_amount, final_price FROM orders WHERE code = ?').get('ORD-3135');
  assert.equal(editedOrder.payment_status, 'collected');
  assert.equal(editedOrder.payment_method, 'cash');
  assert.equal(editedOrder.paid_amount, editedOrder.final_price, 'edited order must remain fully paid in cash');

  const materialAfterEdit = db.prepare('SELECT remaining FROM materials WHERE id = ?').get(materialId).remaining;
  assert.equal(materialAfterEdit, materialBeforeEdit - 1, 'editing material usage should return old grams then deduct new grams');

  database.deleteOrder('ORD-3135');
  const deletedOrder = db.prepare('SELECT id FROM orders WHERE code = ?').get('ORD-3135');
  assert.equal(deletedOrder, undefined, 'deleteOrder should remove the order');
  const materialAfterDelete = db.prepare('SELECT remaining FROM materials WHERE id = ?').get(materialId).remaining;
  assert.equal(materialAfterDelete, materialBeforeEdit + 1, 'deleteOrder should return the edited material usage to stock');

  const purchaseId = database.savePurchase({
    date: '2026-06-01',
    category: 'خامات',
    item: 'Integration PLA refill',
    quantity: 1,
    gramsPerUnit: 500,
    amount: 400,
    supplier: 'test supplier',
    notes: 'integration purchase',
    materialId
  });
  assert.ok(purchaseId > 0);
  assert.equal(db.prepare('SELECT remaining FROM materials WHERE id = ?').get(materialId).remaining, materialAfterDelete + 500);
  database.deletePurchase(purchaseId);
  assert.equal(db.prepare('SELECT remaining FROM materials WHERE id = ?').get(materialId).remaining, materialAfterDelete);

  const newMaterialPurchaseId = database.savePurchase({
    date: '2026-06-02',
    category: 'خامات',
    item: 'Integration PETG New Color',
    quantity: 2,
    gramsPerUnit: 1000,
    amount: 900,
    supplier: 'new supplier',
    notes: 'create material from purchase',
    createMaterial: true
  });
  assert.ok(newMaterialPurchaseId > 0);
  const newMaterial = db.prepare('SELECT id, name, weight, remaining, price, supplier FROM materials WHERE name = ?').get('Integration PETG New Color');
  assert.ok(newMaterial?.id > 0, 'purchase should create a new material when requested');
  assert.equal(newMaterial.weight, 2000);
  assert.equal(newMaterial.remaining, 2000);
  assert.equal(newMaterial.price, 900);
  assert.equal(newMaterial.supplier, 'new supplier');
  const linkedPurchase = db.prepare('SELECT material_id AS materialId FROM purchases WHERE id = ?').get(newMaterialPurchaseId);
  assert.equal(linkedPurchase.materialId, newMaterial.id, 'created material should be linked to the purchase');
  database.deletePurchase(newMaterialPurchaseId);
  assert.equal(db.prepare('SELECT remaining FROM materials WHERE id = ?').get(newMaterial.id).remaining, 0, 'deleting the purchase should reverse stock for newly created material');

  const beforeBackupCount = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;
  const backupPromise = runBackupWorker('background');
  await new Promise((resolve) => setImmediate(resolve));
  createSampleOrder(999, {
    code: 'ORD-9999',
    itemName: 'backup concurrency order',
    customerName: 'Backup Test',
    printerId,
    materialId,
    materialName: 'Integration PLA',
    finalPrice: 250,
    totalCost: 80,
    materialGrams: 3
  });
  const backupPath = await backupPromise;
  assert.ok(fs.existsSync(backupPath), 'backup worker should write a backup file');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, beforeBackupCount + 1, 'backup must not lose concurrent order data');

  const backupPayload = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert.ok(Array.isArray(backupPayload.orders), 'backup payload should contain orders array');
  assert.ok(backupPayload.orders.length >= beforeBackupCount, 'backup should export database rows without blocking the main test flow');

  const finalPaymentRows = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE payment_status != 'collected' OR payment_method != 'cash' OR paid_amount != final_price").get().count;
  assert.equal(finalPaymentRows, 0, 'all stored orders must remain fully collected in cash');

  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('Integration tests passed with temporary database, pagination, filters, totals, inventory, edits, deletes, and background backup');
})().catch((error) => {
  try { db.close(); } catch (_) {}
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  console.error(error);
  process.exit(1);
});
