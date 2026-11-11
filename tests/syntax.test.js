const fs = require('node:fs');
const { wrap } = require('node:module');
const path = require('node:path');
const { Script } = require('node:vm');

const root = path.join(__dirname, '..');
const files = [
  'main.js',
  'preload.js',
  'database.js',
  'backup-worker.js',
  'backup-safety.js',
  'backup-status.js',
  'reset-options.js',
  'tracking-workbook.js',
  'js/data-reset.js',
  'js/bootstrap.js',
  'js/backup-status.js',
  'js/actions.js',
  'js/local-date.js',
  'js/stock-weights.js',
  'js/business-dashboard.js',
  'js/customers.js',
  'js/dashboard.js',
  'js/edit-orders.js',
  'js/inventory-view.js',
  'js/invoice.js',
  'js/materials-manager.js',
  'js/pipeline.js',
  'js/pricing-core.js',
  'js/pricing-orders.js',
  'js/printers-manager.js',
  'js/printers-view.js',
  'js/purchases-assets.js',
  'js/quotes.js',
  'js/reports.js',
  'js/settings-export.js',
  'js/state.js',
  'js/utils.js',
];

for (const file of files) {
  const filename = path.join(root, file);
  new Script(wrap(fs.readFileSync(filename, 'utf8')), { filename });
}

console.log(`Syntax checks passed for ${files.length} JavaScript files`);

const databaseSource = fs.readFileSync(path.join(root, 'database.js'), 'utf8');
const exportMatch = databaseSource.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);

if (!exportMatch) {
  throw new Error('database.js module.exports block was not found');
}

const exportedNames = exportMatch[1]
  .split(',')
  .map((part) => part.replace(/\/\/.*$/gm, '').trim())
  .filter(Boolean)
  .map((part) => part.split(':').pop().trim());

for (const name of exportedNames) {
  const declarationPattern = new RegExp(`(?:function|const|let|var|class)\\s+${name}\\b`);
  if (!declarationPattern.test(databaseSource)) {
    throw new Error(`database.js exports "${name}" but it is not declared`);
  }
}

console.log(`Database export checks passed for ${exportedNames.length} exports`);

