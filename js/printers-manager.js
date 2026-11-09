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
  setValue('printerNotes', printer.notes || '');

  openModal('printerModal');
}

async function savePrinterAction() {
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

  const response = await window.farmAPI.savePrinter(payload);

  if (!response?.success) {
    showToast(response?.message || 'فشل في حفظ الطابعة', 'error');
    return;
  }

  showToast('تم حفظ الطابعة بنجاح');
  closePrinterModal();
  await loadDashboardData();

  if (isModalOpen('printersManagerModal')) renderPrinters();
}

async function deletePrinterAction(id) {
  const confirmed = await askConfirm('هل تريد حذف هذه الطابعة؟ لو مستخدمة في أوردرات سيتم أرشفتها فقط.');

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
