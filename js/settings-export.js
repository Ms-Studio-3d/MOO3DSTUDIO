async function saveSettings() {
  const config = {
    farmName: getTrimmedValue('farmName', DEFAULT_CONFIG.farmName),
    currencyName: getTrimmedValue('currencyName', DEFAULT_CONFIG.currencyName),
    defaultProfitMargin: String(toPositiveNumber(getValue('settingsDefaultProfitMargin'), DEFAULT_CONFIG.defaultProfitMargin)),
    defaultManualMinutes: String(toPositiveNumber(getValue('settingsDefaultManualMinutes'), DEFAULT_CONFIG.defaultManualMinutes)),
    laborRate: String(toPositiveNumber(getValue('settingsLaborRate'), DEFAULT_CONFIG.laborRate)),
    electricityCostPerHour: String(toPositiveNumber(getValue('settingsElectricityCostPerHour'), DEFAULT_CONFIG.electricityCostPerHour)),
    printerPowerKw: String(toPositiveNumber(getValue('settingsPrinterPowerKw'), DEFAULT_CONFIG.printerPowerKw)),
    packagingCost: String(toPositiveNumber(getValue('settingsPackagingCost'), DEFAULT_CONFIG.packagingCost)),
    failurePercent: String(toPositiveNumber(getValue('settingsFailurePercent'), DEFAULT_CONFIG.failurePercent)),
    defaultWasteWeight: String(toPositiveNumber(getValue('settingsDefaultWasteWeight'), DEFAULT_CONFIG.defaultWasteWeight)),
    minimumOrderPrice: String(toPositiveNumber(getValue('settingsMinimumOrderPrice'), DEFAULT_CONFIG.minimumOrderPrice)),
    accessoriesCost: String(toPositiveNumber(getValue('settingsAccessoriesCost'), DEFAULT_CONFIG.accessoriesCost)),
    shippingCost: String(toPositiveNumber(getValue('settingsShippingCost'), DEFAULT_CONFIG.shippingCost)),
    defaultTaxPercent: String(toPositiveNumber(getValue('settingsDefaultTaxPercent'), DEFAULT_CONFIG.defaultTaxPercent)),
    defaultDiscountValue: String(toPositiveNumber(getValue('settingsDefaultDiscountValue'), DEFAULT_CONFIG.defaultDiscountValue)),
    roundingStep: String(toPositiveNumber(getValue('settingsRoundingStep'), DEFAULT_CONFIG.roundingStep)),
    openingCash: String(toPositiveNumber(getValue('settingsOpeningCash'), DEFAULT_CONFIG.openingCash)),
    baseMachineHours: String(toPositiveNumber(getValue('settingsBaseMachineHours'), DEFAULT_CONFIG.baseMachineHours)),
    maintenanceEveryHours: String(toPositiveNumber(getValue('settingsMaintenanceEveryHours'), DEFAULT_CONFIG.maintenanceEveryHours)),
    lastMaintenanceAtHours: String(toPositiveNumber(getValue('settingsLastMaintenanceAtHours'), DEFAULT_CONFIG.lastMaintenanceAtHours)),
    maintenanceCost: String(toPositiveNumber(getValue('settingsMaintenanceCost'), DEFAULT_CONFIG.maintenanceCost))
  };

  const response = await window.farmAPI.saveConfig(config);

  if (!response?.success) {
    showToast(response?.message || 'فشل في حفظ الإعدادات', 'error');
    return;
  }

  closeSettingsModal();
  showToast('تم حفظ الإعدادات بنجاح');
  await loadDashboardData();
}

function openSettingsModal() {
  setActiveNav('settings');
  closeMainPanels();
  applyConfigToInputs();
  openModal('settingsModal');
}

function closeSettingsModal() {
  closeModal('settingsModal');
  returnToOrderNav();
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
}

function exportSalesCSV() {
  const orders = typeof getFilteredOrders === 'function' ? getFilteredOrders() : getSortedOrders();

  const headers = [
    'الكود',
    'التاريخ',
    'المجسم',
    'العميل',
    'الطابعة',
    'عدد القطع',
    'وقت الطباعة',
    'إجمالي ساعات الطباعة للأوردر',
    'إجمالي دقائق يدوي للأوردر',
    'تكلفة الخامة',
    'وزن الهالك',
    'تكلفة الهالك الوزني',
    'تكلفة الماكينة/الإهلاك/الصيانة',
    'الكهرباء',
    'الشغل اليدوي',
    'التغليف',
    'إكسسوارات',
    'الشحن',
    'نسبة الفشل / المخاطرة',
    'الضريبة',
    'إجمالي التكلفة',
    'السعر قبل الخصم',
    'الخصم',
    'السعر بعد الخصم / الحد الأدنى',
    'الحد الأدنى',
    'فرق التقريب',
    'سعر البيع',
    'المحصل',
    'الربح',
    'ملاحظات'
  ];

  const rows = orders.map((order) => [
    order.code,
    order.date,
    order.itemName,
    order.customerName,
    order.printerName,
    formatNumber(order.quantity || 1),
    formatHoursMinutes(order.printHours || 0),
    formatNumber(order.printHours),
    formatNumber(order.manualMinutes),
    formatNumber(order.materialCost),
    formatNumber(order.wasteWeight),
    formatNumber(order.wasteCost),
    formatNumber(order.depreciationCost),
    formatNumber(order.electricityCost),
    formatNumber(order.laborCost),
    formatNumber(order.packagingCost),
    formatNumber(order.accessoriesCost || 0),
    formatNumber(order.shippingCost),
    formatNumber(order.riskCost),
    formatNumber(order.taxCost),
    formatNumber(order.totalCost),
    formatNumber(order.priceBeforeDiscount),
    formatNumber(order.discountValue),
    formatNumber(order.priceAfterDiscount),
    formatNumber(order.minimumOrderPrice),
    formatNumber(order.roundedAdjustment),
    formatNumber(order.finalPrice),
    formatNumber(getOrderPaidAmount(order)),
    formatNumber(order.profit),
    order.notes || ''
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n');

  downloadTextFile(`sales-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
}

async function getTrackingRows() {
  const response = await window.farmAPI.getDataPage('orders', { includeAll: true });
  if (!response?.success) throw new Error(response?.message || 'تعذر تحميل الأوردرات');
  return response.data.items.filter((order) => !isCancelled(order)).map((order) => [
    String(order.code || ''),
    String(order.date || '').slice(0, 10),
    String(order.itemName || ''),
    String(order.customerName || ''),
    roundMoney(order.finalPrice),
    roundMoney(Number(order.totalCost || 0) + Number(order.accessoriesCost || 0) + Number(order.shippingCost || 0)),
    roundMoney(getOrderPaidAmount(order))
  ]);
}

async function copyOrdersForTracking() {
  try {
    const rows = await getTrackingRows();
    if (!rows.length || rows.length > 500) {
      throw new Error(rows.length ? 'نسخة الشيت تقبل حتى 500 أوردر' : 'لا توجد أوردرات للنسخ');
    }
    const excelText = (value) => {
      const text = value.replace(/[\t\r\n]+/g, ' ').trim();
      return /^[=+@-]/.test(text) ? "'" + text : text;
    };
    const tsv = rows.map((row) => [
      ...row.slice(0, 4).map(excelText),
      ...row.slice(4).map(formatNumber)
    ].join('\t')).join('\r\n');
    const copied = await window.farmAPI.copyTrackingRows(tsv);
    if (!copied?.success) throw new Error(copied?.message || 'تعذر نسخ الأوردرات');
    showToast(`تم نسخ ${rows.length} أوردر. الصق البيانات في A5 في تبويب استيراد البرنامج.`);
  } catch (error) {
    showToast(error.message || 'تعذر نسخ الأوردرات', 'error');
  }
}

async function exportTrackingWorkbook() {
  const button = $('exportTrackingButton');
  if (button.disabled) return;
  button.disabled = true;
  try {
    const rows = await getTrackingRows();
    const response = await window.farmAPI.exportTrackingWorkbook(rows);
    if (!response?.success) throw new Error(response?.message || 'تعذر تصدير ملف المتابعة');
    showToast(`تم تحديث ملف المتابعة في المستندات (${rows.length} أوردر)`);
  } catch (error) {
    showToast(error.message || 'تعذر تصدير ملف المتابعة', 'error');
  } finally {
    button.disabled = false;
  }
}

function exportStockCSV() {
  const headers = [
    'الخامة',
    'النوع',
    'اللون',
    'وزن البكرة',
    'المتبقي',
    'السعر',
    'حد التنبيه',
    'المورد'
  ];

  const rows = dashboardData.materials.map((material) => [
    material.name,
    material.type,
    material.color,
    formatNumber(material.weight),
    formatNumber(material.remaining),
    formatNumber(material.price),
    formatNumber(material.lowStockThreshold),
    material.supplier || ''
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n');

  downloadTextFile(`stock-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
}

async function exportBackup() {
  const response = await window.farmAPI.exportBackup();

  if (!response?.success) {
    showToast(response?.message || 'فشل في تصدير النسخة الاحتياطية', 'error');
    return;
  }

  downloadTextFile(
    `print-farm-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(response.data || {}, null, 2),
    'application/json;charset=utf-8'
  );

  showToast('تم تصدير النسخة الاحتياطية');
}

function triggerImportBackup() {
  $('importBackupInput')?.click();
}

async function importBackupFromFile(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    const confirmed = await askConfirm('بيانات النسخة الاحتياطية هتحل محل البيانات الحالية. هيتحفظ Backup أمان قبل الاستبدال.',
      { title: 'استيراد النسخة الاحتياطية؟', action: 'استيراد', danger: true });
    if (!confirmed) return;

    const response = await window.farmAPI.importBackup(data);

    if (!response?.success) {
      showToast(response?.message || 'فشل في استيراد النسخة الاحتياطية', 'error');
      return;
    }

    editingOrderCode = null;
    currentInvoiceOrderCode = null;
    editingPurchaseId = null;
    editingAssetId = null;
    selectedOrderMaterialIds = [];
    if ($('amsInputs')) $('amsInputs').innerHTML = '';
    MODAL_IDS.filter((id) => id !== 'settingsModal').forEach(closeModal);
    showToast('تم استيراد النسخة الاحتياطية بنجاح');
    await loadDashboardData();
    resetOrderForm();
  } catch (error) {
    showToast('ملف النسخة الاحتياطية غير صالح', 'error');
  } finally {
    if (event?.target) event.target.value = '';
  }
}
