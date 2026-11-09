const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const files = [
  'main.js',
  'preload.js',
  'database.js',
  'backup-worker.js',
  'js/bootstrap.js',
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
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
}

console.log(`Syntax checks passed for ${files.length} JavaScript files`);

const fs = require('node:fs');

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

