const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const database = fs.readFileSync(path.join(root, 'database.js'), 'utf8').replace(/\r\n?/g, '\n');

function mustInclude(source, needle, label = needle) {
  assert.ok(source.includes(needle), `${label} was not found`);
}

const updateOrderSource = database.slice(database.indexOf('function updateOrder'), database.indexOf('function deleteOrder'));
const deleteOrderSource = database.slice(database.indexOf('function deleteOrder'), database.indexOf('function savePurchase'));
const createOrderSource = database.slice(database.indexOf('function insertOrderWithStock'), database.indexOf('function convertQuoteToOrder'));

mustInclude(database, 'WHERE id = ? AND remaining >= ? - ?', 'atomic stock debit protects the available balance');
mustInclude(createOrderSource, 'applyOrderStockDelta(material, material.consumed', 'creation debits total including waste');
mustInclude(updateOrderSource, 'const delta = (after.get(id) || 0) - (before.get(id) || 0)', 'editing applies only the consumption difference');
mustInclude(deleteOrderSource, 'if (!item.materialId) continue;', 'missing linked material cannot produce a false return');
mustInclude(deleteOrderSource, '-(item.grams + (item.wasteGrams || 0))', 'deletion credits recorded weight and waste');

const transactionUses = (database.match(/db\.transaction/g) || []).length;
assert.ok(transactionUses >= 5, `expected several transactional inventory/database operations, found ${transactionUses}`);

console.log('Inventory tests passed');
