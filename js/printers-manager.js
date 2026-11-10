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

function openPrinterModal() {
  setValue('printerId', '');
  setValue('printerName', '');
  setValue('printerModel', '');
  setValue('printerStatus', 'idle');
  setValue('printerHourlyDepreciation', '0');
  setValue('printerPurchasePrice', '');
  setValue('printerPurchaseHours', '5000');
  $('printerPurchaseFields').hidden = false;
  setValue('printerNotes', '');
  openModal('printerModal');
}

function closePrinterModal() {
  closeModal('printerModal');
}

function editPrinter(id) {
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
  $('printerPurchaseFields').hidden = true;
  setValue('printerNotes', printer.notes || '');

  openModal('printerModal');
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

  const priceInput = getTrimmedValue('printerPurchasePrice');
  if (!payload.id && priceInput) {
    const normalizedPrice = /^[0-9٠-٩]{1,3}(?:,[0-9٠-٩]{3})+(?:[.٫][0-9٠-٩]+)?$/.test(priceInput)
      ? priceInput.replace(/,/g, '')
      : priceInput;
    const cost = toPositiveNumber(normalizedPrice, 0);
    const depreciationHours = toPositiveNumber(getValue('printerPurchaseHours'), 0);
    if (cost <= 0) {
      showToast('اكتب سعر شراء أكبر من صفر.', 'error');
      $('printerPurchasePrice').focus();
      return;
    }
    if (depreciationHours <= 0) {
      showToast('اكتب عدد ساعات إهلاك أكبر من صفر.', 'error');
      $('printerPurchaseHours').focus();
      return;
    }
    payload.purchase = { cost, depreciationHours };
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
