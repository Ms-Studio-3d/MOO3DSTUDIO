const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

console.log('UI tests passed');
