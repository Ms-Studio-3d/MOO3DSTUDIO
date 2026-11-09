'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
      dbPath: h.dbPath, backupsDir: path.join(h.documents, 'MOO3D/Backups'), reason
    } });
    worker.once('message', (msg) => msg.success ? resolve(msg.filePath) : reject(new Error(msg.message)));
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`Worker exit ${code}`)); });
  });
}

(async () => {
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
  await test('native reset cancellation leaves every record untouched', async () => {
    const before = full(); h.dialogBehavior = () => ({ response: 0 });
    const result = await h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة' });
    assert.equal(result.data.cancelled, true);
    assert.deepEqual(full().config, before.config);
    assert.deepEqual(full().materials, before.materials);
    h.dialogBehavior = null;
  });
  await test('other IPC writes are gated while reset confirmation is open', async () => {
    let release;
    h.dialogBehavior = () => new Promise((resolve) => { release = resolve; });
    const reset = h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة' });
    assert.equal((await h.farmAPI.saveConfig({ openingCash: '999' })).success, false);
    release({ response: 0 }); await reset;
    h.dialogBehavior = null;
  });
  await test('failed safety backup blocks reset before any DELETE', async () => {
    fresh('backup-failure');
    const before = full();
    fs.mkdirSync(path.join(h.documents, 'MOO3D/Backups'), { recursive: true });
    fs.writeFileSync(path.join(h.documents, 'MOO3D/Backups/Protected'), 'not a directory');
    assert.equal((await h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة' })).success, false);
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
    const result = await h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة' });
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
    resetResult = await h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة' });
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
    const result = await h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة', clearPrinters: true, clearAssets: true, resetMachineHours: true, restartCodes: true });
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
    const backupsDir = path.join(h.documents, 'MOO3D/Backups');
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
  console.log(`\n${passed} stability scenarios passed through actual preload/main/SQLite, with native OS dialogs mocked.`);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  try { h?.database.setDatabasePathForTests(''); } catch (_) {}
  try { fs.rmSync(temporary, { recursive: true, force: true }); } catch (_) {}
});
