function scheduleCalc() {
  clearTimeout(window.__moo3dCalcTimer);

  window.__moo3dCalcTimer = setTimeout(() => {
    if (typeof calc === 'function') calc();
  }, 220);
}

function bindLiveCalculationInputs() {
  [
    'pieceQuantity',
    'printHours',
    'printMinutes',
    'manualMins',
    'profitMargin',
    'discountValue',
    'selectedPrinter',
    'laborRate',
    'electricityCostPerHour',
    'printerPowerKw',
    'packagingCost',
    'failurePercent',
    'wasteWeight',
    'minimumOrderPrice',
    'accessoriesCost',
    'shippingCost',
    'defaultTaxPercent'
  ].forEach((id) => {
    const el = $(id);
    if (!el) return;

    el.addEventListener('input', scheduleCalc);
    el.addEventListener('change', calc);
  });
}

function bindPaymentInputs() {}

function bindGlobalKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    if ($('saleConfirmDialog')?.open || $('firstRunGuide')?.open) return;

    if (event.key === 'Escape') {
      if (typeof freshStartRunning !== 'undefined' && freshStartRunning) return;
      closeAllModals();
      setActiveNav('order');
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 's'
    ) {
      event.preventDefault();

      if (isModalOpen('settingsModal')) {
        saveSettings();
      }
    }
  });
}

function bindImportInput() {
  const input = $('importBackupInput');

  if (input) {
    input.addEventListener('change', importBackupFromFile);
  }
}

function initializeDates() {
  const today = localDateString();

  if ($('opDate') && !getValue('opDate')) {
    setValue('opDate', today);
  }

  if ($('filterTo') && !getValue('filterTo')) {
    setValue('filterTo', today);
  }

  if ($('pipelineTo') && !getValue('pipelineTo')) {
    setValue('pipelineTo', today);
  }

  if ($('purchaseDate') && !getValue('purchaseDate')) {
    setValue('purchaseDate', today);
  }

  if ($('assetDate') && !getValue('assetDate')) {
    setValue('assetDate', today);
  }
}

function openFirstRunGuide() {
  const guide = $('firstRunGuide');
  if (!guide.open) guide.showModal();
}

async function dismissFirstRunGuide(addPrinter = false) {
  $('firstRunGuide').close();
  if (addPrinter) {
    openPrintersManagerModal();
    openPrinterModal();
  }
  if (dashboardData.config.firstRunGuideSeen !== '1') {
    const result = await window.farmAPI.saveConfig({ firstRunGuideSeen: '1' });
    if (result?.success) dashboardData.config.firstRunGuideSeen = '1';
  }
}


/* ربط الدوال المستخدمة من HTML قبل أي تشغيل */
window.openEditSale = openEditSale;
window.saveEditSale = saveEditSale;
window.deleteSale = deleteSale;


document.addEventListener('DOMContentLoaded', async () => {
  initializeDates();

  bindLiveCalculationInputs();
  bindPaymentInputs();
  bindGlobalKeyboardShortcuts();
  bindImportInput();

  $('firstRunGuide').addEventListener('cancel', (event) => {
    event.preventDefault();
    dismissFirstRunGuide();
  });
  if (await loadDashboardData() && dashboardData.config.firstRunGuideSeen !== '1'
    && !['printers', 'assets', 'materials', 'orders', 'purchases', 'quotes'].some((key) => dashboardData[key].length)) {
    openFirstRunGuide();
  }
});
