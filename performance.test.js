const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readText(fileName) {
  return fs.readFileSync(path.join(root, fileName), 'utf8').replace(/\r\n/g, '\n');
}

const database = readText('database.js');
const main = readText('main.js');
const preload = readText('preload.js');
const worker = readText('backup-worker.js');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function mustInclude(source, needle, label = needle) {
  assert.ok(source.includes(needle), `${label} was not found`);
}

function mustMatch(source, pattern, label) {
  assert.ok(pattern.test(source), `${label} was not found`);
}

[
  'getOrdersPage',
  'getStockMovementsPage',
  'getQuotesPage',
  'getPurchasesPage',
  'getAssetsPage'
].forEach((name) => {
  const fnStart = database.indexOf(`function ${name}`);
  assert.notEqual(fnStart, -1, `${name} was not found`);

  const nextFn = database.indexOf('\nfunction ', fnStart + 1);
  const fnSource = database.slice(fnStart, nextFn === -1 ? database.length : nextFn);

  mustInclude(fnSource, 'LIMIT ? OFFSET ?', `${name} must use SQL pagination`);
  mustInclude(fnSource, 'COUNT(*) AS count', `${name} must expose total count`);
});

mustInclude(database, 'const DEFAULT_LIST_LIMIT = 100;', 'default page size');
mustInclude(database, 'const MAX_LIST_LIMIT = 500;', 'max page size guard');
mustInclude(database, 'function getDataPage(kind, options = {})', 'generic page loader');
mustInclude(database, 'getDashboardData({ includeAll: true })', 'backup exports intentionally request all data');

mustInclude(main, "new Worker(path.join(__dirname, 'backup-worker.js')", 'backup worker');

const scheduleStart = main.indexOf('function scheduleAutomaticBackup');
assert.notEqual(scheduleStart, -1, 'scheduleAutomaticBackup was not found');

const nextFunctionAfterSchedule = main.indexOf('\nfunction ', scheduleStart + 1);
const scheduleSource = main.slice(
  scheduleStart,
  nextFunctionAfterSchedule === -1 ? main.length : nextFunctionAfterSchedule
);

mustMatch(
  scheduleSource,
  /\.finally\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?autoBackupRunning\s*=\s*false\s*;[\s\S]*?\}\s*\)/,
  'backup state is cleared asynchronously'
);

mustInclude(preload, 'getDataPage(kind, options = {})', 'renderer can request pages');
mustInclude(worker, 'fs.writeFile(filePath', 'worker writes backup asynchronously');
mustInclude(worker, 'exportBackupData()', 'worker exports backup payload');

assert.ok(
  Array.isArray(pkg.build?.files) && pkg.build.files.includes('backup-worker.js'),
  'backup worker must be packaged with the Electron app'
);

const backupFunctionStart = main.indexOf('function createAutomaticBackup');
assert.notEqual(backupFunctionStart, -1, 'createAutomaticBackup was not found');

const backupFunctionEnd = main.indexOf('function scheduleAutomaticBackup');
assert.notEqual(backupFunctionEnd, -1, 'scheduleAutomaticBackup was not found');

const backupFunction = main.slice(backupFunctionStart, backupFunctionEnd);

assert.equal(
  backupFunction.includes('writeFileSync'),
  false,
  'automatic backup must not synchronously write files in the main process'
);

console.log('Performance tests passed');
