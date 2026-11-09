const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const editOrders = fs.readFileSync(path.join(root, 'js/edit-orders.js'), 'utf8');
const reports = fs.readFileSync(path.join(root, 'js/reports.js'), 'utf8');
const purchasesAssets = fs.readFileSync(path.join(root, 'js/purchases-assets.js'), 'utf8');
const materialsManager = fs.readFileSync(path.join(root, 'js/materials-manager.js'), 'utf8');

function mustInclude(source, needle, label = needle) {
  assert.ok(source.includes(needle), `${label} was not found`);
}

['editPrinter', 'editPrintHours', 'editPrintMinutes', 'salesTableBody', 'quotesList', 'purchasesTableBody', 'assetsTableBody', 'stockMovementsTableBody'].forEach((id) => {
  mustInclude(html, `id="${id}"`, `${id} markup`);
});

mustInclude(editOrders, "showToast('اختار الطابعة المستخدمة'", 'edit screen printer validation toast');
mustInclude(editOrders, "showToast('وقت الطباعة لازم يكون أكبر من صفر'", 'edit screen print-time validation toast');
mustInclude(reports, 'showMoreReports()', 'reports load-more control');
mustInclude(purchasesAssets, 'loadMorePurchases()', 'purchases load-more control');
mustInclude(purchasesAssets, 'loadMoreAssets()', 'assets load-more control');
mustInclude(materialsManager, 'loadMoreStockMovements()', 'stock movements load-more control');


mustInclude(html, 'إضافة خامة جديدة باسم البند', 'purchase new material option');
mustInclude(html, "openPurchasesModal({ returnTo: 'dashboard' })", 'dashboard purchases return target');
mustInclude(html, "openAssetsModal({ returnTo: 'dashboard' })", 'dashboard assets return target');
mustInclude(purchasesAssets, 'createMaterial:', 'purchase payload can request material creation');
mustInclude(purchasesAssets, "panelReturnTargets.purchases", 'purchases panel return state');
mustInclude(purchasesAssets, "panelReturnTargets.assets", 'assets panel return state');

['overflow-wrap: anywhere', 'min-width: 0', 'text-overflow: ellipsis', 'overscroll-behavior: contain', 'white-space: normal'].forEach((rule) => {
  mustInclude(css, rule, `CSS readability rule ${rule}`);
});


['getDefaultPrinterId()', "select.value = hasOldValue ? oldValue : getDefaultPrinterId()", "else if (!printers.length)"].forEach((needle) => {
  mustInclude(fs.readFileSync(path.join(root, 'js/printers-view.js'), 'utf8') + fs.readFileSync(path.join(root, 'js/pricing-orders.js'), 'utf8'), needle, `default printer behavior ${needle}`);
});

['#94a3b8', '--text-soft: #b7c0cc', 'select option[value="__new__"]'].forEach((rule) => {
  mustInclude(css, rule, `readability polish ${rule}`);
});



['compact-order-grid', 'compact-pricing-grid', 'compact-material-list'].forEach((needle) => {
  mustInclude(html, needle, `compact quote layout markup ${needle}`);
});

[
  '--side-nav-width',
  '.quote-workspace',
  'overflow: hidden;',
  'grid-template-columns: minmax(0, 1fr) 300px',
  '.bottom-nav {',
  'position: fixed;',
  '.nav-btn[data-view="order"]::before',
  '.app-topbar .topbar-actions .btn',
  '.modal.app-panel .modal-content.modal-xl'
].forEach((rule) => {
  mustInclude(css, rule, `compact navigation/layout rule ${rule}`);
});

assert.ok((css.match(/@media \(max-width:/g) || []).length >= 5, 'responsive media queries should be present');


[
  '.business-summary-grid',
  '.business-card',
  '.dashboard-grid',
  '.quick-row',
  '.maintenance-lamp',
  '.lamp-dot'
].forEach((rule) => {
  mustInclude(css, rule, `business dashboard layout rule ${rule}`);
});

// Simulate the generated material rows across renders, including the previous
// rows still being visible to the renderer when the user clicks remove.
let materialRows = [];
let pickerOptions = [];
const summary = new Map();
const materialList = {
  set innerHTML(markup) {
    pickerOptions = [...markup.matchAll(/<option value="(\d+)"/g)].map((match) => match[1]);
    materialRows = [...markup.matchAll(/class="ams-weight"\s+data-id="(\d+)"\s+value="([^"]*)"/g)]
      .map(([, id, value]) => {
        const input = { dataset: { id }, value, addEventListener() {}, focus() {} };
        return { dataset: { id }, input, querySelector: () => input };
      });
  }
};
const context = vm.createContext({
  document: {
    createElement() {
      return { get innerHTML() { return this.textContent; } };
    },
    getElementById(id) {
      if (id === 'amsInputs') return materialList;
      if (id.startsWith('res')) {
        if (!summary.has(id)) summary.set(id, {});
        return summary.get(id);
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.order-material-row') return materialRows;
      if (selector === '.ams-weight') return materialRows.map((row) => row.input);
      return [];
    },
    querySelector() { return null; }
  }
});
context.window = context;
for (const file of ['state', 'utils', 'inventory-view', 'pricing-core', 'pricing-orders']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), context, { filename: file });
}
const run = (code) => vm.runInContext(code, context);
run(`
  dashboardData.config = { ...DEFAULT_CONFIG };
  dashboardData.materials = [
    { id: 1, name: 'Black', remaining: 1000, weight: 1000, price: 800 },
    { id: 2, name: 'White', remaining: 1000, weight: 1000, price: 1000 }
  ];
  renderMaterialUsageInputs();
  addMaterialUsageRow('1');
`);
materialRows[0].input.value = '100';
run("addMaterialUsageRow('2')");
assert.deepEqual(materialRows.map((row) => row.input.value), ['100', '']);
materialRows[1].input.value = '50';
run('calc()');
assert.equal(run('currentCalc.materialCost'), 130);
const priceWithBoth = run('currentCalc.finalPrice');

run("removeMaterialUsageRow('2')");
assert.deepEqual(materialRows.map((row) => row.input.value), ['100']);
assert.deepEqual(pickerOptions, ['2']);
assert.equal(run('currentCalc.materialCost'), 80);
assert.ok(run('currentCalc.finalPrice') < priceWithBoth);
assert.equal(run('currentCalc.materialUsage.length'), 1);
assert.equal(run('dashboardData.materials.every((material) => material.remaining === 1000)'), true);

run("addMaterialUsageRow('2')");
assert.deepEqual(materialRows.map((row) => row.input.value), ['100', '']);
materialRows[1].input.value = '50';
run("removeMaterialUsageRow('1')");
assert.deepEqual(materialRows.map((row) => row.input.value), ['50']);
assert.equal(run('currentCalc.materialCost'), 50);
run("removeMaterialUsageRow('2')");
assert.equal(materialRows.length, 0);
assert.equal(run('currentCalc.materialCost'), 0);

console.log('UI tests passed, including material removal and repricing');
