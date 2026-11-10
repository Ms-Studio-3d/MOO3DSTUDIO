'use strict';

const orderControls = [
  '#itemName', '#selectedPrinter', '#materialUsagePicker', '#shippingCost',
  '#wasteWeight', '#resFinal', '#resProfit', '[data-action-click="saveSale"]',
  '[data-view="settings"]'
];
const settingsControls = ['#settingsMaintenanceCost', '#settingsModal [data-action-click="saveSettings"]'];
const editControls = ['#editWasteWeight', '#editMaterialPicker', '#editFinalPrice', '[data-action-click="saveEditSale"]'];

// Runs in the renderer. Hit-testing also catches clipping by a parent or an overlapping panel.
function unreachableControls(selectors) {
  return selectors.filter((selector) => {
    const target = document.querySelector(selector);
    if (!target) return true;
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return !rect.width || !rect.height || !target.contains(document.elementFromPoint(x, y));
  });
}

module.exports = { orderControls, settingsControls, editControls, unreachableControls };
