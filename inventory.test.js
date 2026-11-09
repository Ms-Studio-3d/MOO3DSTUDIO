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

mustInclude(createOrderSource, 'WHERE id = ? AND remaining >= ? AND is_archived = 0', 'atomic stock decrement for create order');
mustInclude(updateOrderSource, "'return',\n          Number(item.grams || 0),\n          'استرجاع قبل تعديل أوردر'", 'stock return movement before order edit');
mustInclude(updateOrderSource, "'out',\n          Number(item.grams || 0),\n          'استهلاك بعد تعديل أوردر'", 'stock out movement after order edit');
mustInclude(updateOrderSource, 'WHERE id = ? AND remaining >= ? AND is_archived = 0', 'atomic stock decrement for order edit');
mustInclude(deleteOrderSource, "'return',\n        Number(item.grams || 0),\n        'استرجاع بعد حذف أوردر'", 'stock return movement after order delete');
mustInclude(updateOrderSource, 'if (Number(item.grams || 0) <= 0)', 'edit order rejects zero material grams');
mustInclude(createOrderSource, 'if (Number(item.grams || 0) <= 0)', 'create order rejects zero material grams');

const transactionUses = (database.match(/db\.transaction/g) || []).length;
assert.ok(transactionUses >= 5, `expected several transactional inventory/database operations, found ${transactionUses}`);

console.log('Inventory tests passed');
