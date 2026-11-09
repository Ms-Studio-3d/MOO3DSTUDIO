const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const database = fs.readFileSync(path.join(root, 'database.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

function mustInclude(source, needle, label = needle) {
  assert.ok(source.includes(needle), `${label} was not found`);
}

const updateOrderSource = database.slice(database.indexOf('function updateOrder'), database.indexOf('function deleteOrder'));

mustInclude(updateOrderSource, "throw new Error('اختار الطابعة المستخدمة')", 'update order printer required validation');
mustInclude(updateOrderSource, "throw new Error('عدد القطع لازم يكون رقم صحيح موجب')", 'update order quantity validation');
mustInclude(updateOrderSource, "throw new Error('وقت الطباعة لازم يكون أكبر من صفر')", 'update order print time validation');
mustInclude(updateOrderSource, "throw new Error('كمية الخامة لازم تكون أكبر من صفر')", 'update order material usage validation');
mustInclude(updateOrderSource, 'const shouldReplaceMaterialUsage = Boolean(data.replaceMaterialUsage);', 'optional material replacement flag');
mustInclude(updateOrderSource, 'existingUsage', 'existing material usage validation when not replacing materials');
mustInclude(updateOrderSource, 'const quantity = requestedQuantity;', 'validated quantity is persisted');

const createOrderSource = database.slice(database.indexOf('function insertOrderWithStock'), database.indexOf('function convertQuoteToOrder'));
mustInclude(createOrderSource, "throw new Error('اختار الطابعة المستخدمة')", 'create order printer validation');
mustInclude(createOrderSource, "throw new Error('عدد القطع لازم يكون رقم صحيح موجب')", 'create order quantity validation');
mustInclude(createOrderSource, "throw new Error('وقت الطباعة لازم يكون أكبر من صفر')", 'create order print time validation');
mustInclude(createOrderSource, "throw new Error('كمية الخامة لازم تكون أكبر من صفر')", 'create order material grams validation');
mustInclude(createOrderSource, 'const quantity = requestedQuantity;', 'create order keeps validated quantity');

mustInclude(database, 'function getDatabasePath()', 'database path helper');
mustInclude(database, 'function setDatabasePathForTests(dbPath)', 'test database path injection');
mustInclude(database, 'getDatabasePath,', 'database path export');
mustInclude(database, 'setDatabasePathForTests,', 'test database path export');

mustInclude(main, 'validateUpdateOrderPayload(data)', 'update validator exists');
mustInclude(main, 'if (!data.printerId)', 'update validator requires printer');
mustInclude(main, 'if (data.printHours <= 0)', 'update validator requires positive print time');
mustInclude(main, 'if (data.replaceMaterialUsage)', 'update validator checks replacement material usage');
mustInclude(main, "getDataPage: 'db:getDataPage'", 'paginated data IPC channel');
mustInclude(preload, 'getDataPage(kind, options = {})', 'paginated preload API');

console.log('Database validation tests passed');
