function openPrintersManagerModal() {
  setActiveNav('printers');
  closeMainPanels();
  renderPrinters();
  openModal('printersManagerModal');
}

function closePrintersManagerModal() {
  closeModal('printersManagerModal');
  returnToOrderNav();
}

function getPrinterPurchasePrice() {
  const input = getTrimmedValue('printerPurchasePrice');
  const grouped = /^[0-9٠-٩]{1,3}(?:,[0-9٠-٩]{3})+(?:[.٫][0-9٠-٩]+)?$/.test(input);
  return toPositiveNumber(grouped ? input.replace(/,/g, '') : input, 0);
}

function updatePrinterDepreciationPreview() {
  const price = getPrinterPurchasePrice();
  const hours = toPositiveNumber(getValue('printerPurchaseHours'), 0);
  const overrideInput = getTrimmedValue('printerDepreciationOverride');
  if (overrideInput) {
    const override = toNumber(overrideInput, NaN);
    setText('printerDepreciationPreview', Number.isFinite(override) && override >= 0
      ? `إهلاك الطابعة لكل ساعة طباعة ${formatMoney(override)} (يدوي)`
      : 'إهلاك الساعة لازم يكون رقم صفر أو أكبر.');
    return;
  }
  setText('printerDepreciationPreview', price > 0 && hours > 0
    ? `إهلاك الطابعة لكل ساعة طباعة ${formatMoney(price / hours)}`
    : 'إهلاك الساعة بيتحسب بقسمة سعر الشراء على ساعات الإهلاك.');
}

function setPrinterPurchaseFields(printer) {
  $('printerExistingAssetField').hidden = true;
  $('printerExistingAsset').replaceChildren();
  setValue('printerPurchasePrice', printer?.purchasePrice ?? '');
  setValue('printerPurchaseHours', printer?.purchaseHours ?? 5000);
  setValue('printerDepreciationOverride', printer?.purchaseHourlyDepreciationOverride ?? '');
  updatePrinterDepreciationPreview();
}

function selectPrinterPurchaseAsset() {
  const option = $('printerExistingAsset').selectedOptions[0];
  setValue('printerPurchasePrice', option?.dataset.cost ?? '');
  setValue('printerPurchaseHours', option?.dataset.hours ?? 5000);
  setValue('printerDepreciationOverride', option?.dataset.override ?? '');
  updatePrinterDepreciationPreview();
}

function openPrinterModal() {
  setValue('printerId', '');
  setValue('printerName', '');
  setValue('printerModel', '');
  setValue('printerStatus', 'idle');
  setValue('printerHourlyDepreciation', '0');
  setPrinterPurchaseFields();
  setValue('printerNotes', '');
  openModal('printerModal');
}

function closePrinterModal() {
  closeModal('printerModal');
}

async function editPrinter(id) {
  const printer = getPrinterById(id);

  if (!printer) {
    showToast('الطابعة غير موجودة', 'error');
    return;
  }

  setValue('printerId', printer.id || '');
  setValue('printerName', printer.name || '');
  setValue('printerModel', printer.model || '');
  setValue('printerStatus', printer.status || 'idle');
  setValue('printerHourlyDepreciation', printer.hourlyDepreciation || 0);
  setPrinterPurchaseFields(printer);
  setValue('printerNotes', printer.notes || '');

  openModal('printerModal');
  if (printer.purchaseAssetId) return;

  const result = await window.farmAPI.getDataPage('assets', { includeAll: true });
  if (!result?.success || !isModalOpen('printerModal') || Number(getValue('printerId')) !== Number(id)) return;
  const available = result.data.items.filter((asset) => asset.printerId == null);
  if (!available.length) return;

  const select = $('printerExistingAsset');
  const newAsset = document.createElement('option');
  newAsset.value = '';
  newAsset.textContent = 'تسجيل سعر الشراء كأصل جديد';
  select.appendChild(newAsset);
  for (const asset of available) {
    const option = document.createElement('option');
    option.value = String(asset.id);
    option.textContent = `${asset.item} (${formatMoney(asset.cost)})`;
    option.dataset.cost = String(asset.cost);
    option.dataset.hours = String(asset.depreciationHours || 5000);
    option.dataset.override = String(asset.hourlyDepreciationOverride ?? '');
    select.appendChild(option);
  }
  $('printerExistingAssetField').hidden = false;
}

async function savePrinterAction() {
  const saveButton = $('savePrinterButton');
  if (saveButton.disabled) return;

  const name = getTrimmedValue('printerName');

  if (!name) {
    showToast('اسم الطابعة مطلوب', 'error');
    $('printerName')?.focus();
    return;
  }

  const payload = {
    id: getValue('printerId') ? Number(getValue('printerId')) : null,
    name,
    model: getTrimmedValue('printerModel'),
    status: getValue('printerStatus') || 'idle',
    hourlyDepreciation: toPositiveNumber(getValue('printerHourlyDepreciation'), 0),
    notes: getTrimmedValue('printerNotes')
  };

  const printer = payload.id ? getPrinterById(payload.id) : null;
  const assetId = Number(getValue('printerExistingAsset')) || printer?.purchaseAssetId || null;
  const cost = getPrinterPurchasePrice();
  const depreciationHours = toPositiveNumber(getValue('printerPurchaseHours'), 0);
  const overrideInput = getTrimmedValue('printerDepreciationOverride');
  const hourlyDepreciationOverride = overrideInput ? toNumber(overrideInput, NaN) : null;
  const purchaseUnchanged = printer?.purchaseAssetId && cost === printer.purchasePrice
    && depreciationHours === printer.purchaseHours && hourlyDepreciationOverride === printer.purchaseHourlyDepreciationOverride;
  if (!purchaseUnchanged && (getTrimmedValue('printerPurchasePrice') || assetId || overrideInput)) {
    if (cost <= 0) {
      showToast('اكتب سعر شراء أكبر من صفر.', 'error');
      $('printerPurchasePrice').focus();
      return;
    }
    if (hourlyDepreciationOverride != null && (!Number.isFinite(hourlyDepreciationOverride) || hourlyDepreciationOverride < 0)) {
      showToast('إهلاك الساعة لازم يكون رقم صفر أو أكبر.', 'error');
      $('printerDepreciationOverride').focus();
      return;
    }
    if (depreciationHours <= 0 && hourlyDepreciationOverride == null) {
      showToast('اكتب عدد ساعات إهلاك أكبر من صفر أو حدد إهلاك الساعة يدويًا.', 'error');
      $('printerPurchaseHours').focus();
      return;
    }
    payload.purchase = { assetId, cost, depreciationHours, hourlyDepreciationOverride };
  }

  saveButton.disabled = true;
  try {
    const response = await window.farmAPI.savePrinter(payload);

    if (!response?.success) {
      showToast(response?.message || 'فشل في حفظ الطابعة', 'error');
      return;
    }

    showToast(response.data?.assetSaved ? 'تم حفظ الطابعة وسعر شرائها في الأصول' : 'تم حفظ الطابعة بنجاح');
    closePrinterModal();
    await loadDashboardData();
  } finally {
    saveButton.disabled = false;
  }
}

async function deletePrinterAction(id) {
  const confirmed = await askConfirm('لو الطابعة مستخدمة في أوردرات، هتتأرشف وتفضل بياناتها موجودة في الأوردرات القديمة.',
    { title: 'حذف الطابعة؟', action: 'حذف الطابعة', danger: true });

  if (!confirmed) return;

  const response = await window.farmAPI.deletePrinter(id);

  if (!response?.success) {
    showToast(response?.message || 'فشل في حذف الطابعة', 'error');
    return;
  }

  if (response.data?.archived) {
    showToast('تم أرشفة الطابعة لأنها مستخدمة في أوردرات قديمة');
  } else {
    showToast('تم حذف الطابعة');
  }

  await loadDashboardData();
}
