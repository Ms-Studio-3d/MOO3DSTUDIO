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

function bindSettingsLiveInputs() {
  [
    'farmName',
    'currencyName',
    'settingsDefaultProfitMargin',
    'settingsDefaultManualMinutes',
    'settingsLaborRate',
    'settingsElectricityCostPerHour',
    'settingsPrinterPowerKw',
    'settingsPackagingCost',
    'settingsFailurePercent',
    'settingsDefaultWasteWeight',
    'settingsMinimumOrderPrice',
    'settingsAccessoriesCost',
    'settingsShippingCost',
    'settingsDefaultTaxPercent',
    'settingsDefaultDiscountValue',
    'settingsRoundingStep',
    'settingsOpeningCash',
    'settingsBaseMachineHours',
    'settingsMaintenanceEveryHours',
    'settingsLastMaintenanceAtHours',
    'settingsMaintenanceCost'
  ].forEach((id) => {
    const el = $(id);
    if (!el) return;

    el.addEventListener('input', () => {
      if (id === 'farmName') {
        const appTitle = document.querySelector('.app-title');

        if (appTitle) {
          appTitle.innerText = getTrimmedValue(
            'farmName',
            DEFAULT_CONFIG.farmName
          );
        }
      }
    });
  });
}

function bindGlobalKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
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
  const today = new Date().toISOString().slice(0, 10);

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


/* ربط الدوال المستخدمة من HTML قبل أي تشغيل */
window.openEditSale = openEditSale;
window.saveEditSale = saveEditSale;
window.deleteSale = deleteSale;


document.addEventListener('DOMContentLoaded', async () => {
  initializeDates();

  bindLiveCalculationInputs();
  bindSettingsLiveInputs();
  bindPaymentInputs();
  bindGlobalKeyboardShortcuts();
  bindImportInput();

  await loadDashboardData();
});
