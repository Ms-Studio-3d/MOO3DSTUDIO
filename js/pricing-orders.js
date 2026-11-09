
function getAssetsHourlyDepreciation(options = {}) {
  const assets = Array.isArray(dashboardData.assets) ? dashboardData.assets : [];
  const printer = options.printer || null;

  let totalHourlyDepreciation = 0;
  let printerAssetHourlyDepreciation = 0;

  assets.forEach((asset) => {
    const cost = toPositiveNumber(asset.cost, 0);
    const hours = toPositiveNumber(asset.depreciationHours, 0);
    if (hours <= 0) return;

    const hourly = cost / hours;
    totalHourlyDepreciation += hourly;

    const text = `${asset.item || ''} ${asset.type || ''} ${asset.assetType || ''}`.toLowerCase();
    const looksLikePrinterAsset = cost >= 10000 && (
      text.includes('bambu') ||
      text.includes('طابعة') ||
      text.includes('printer') ||
      text.includes('ماكينة')
    );

    if (looksLikePrinterAsset) printerAssetHourlyDepreciation += hourly;
  });

  // حماية لقاعدة بيانات قديمة أو ناقصة: لو الطابعة الافتراضية موجودة لكن أصل الطابعة غير متسجل،
  // نضيف إهلاكها الافتراضي مرة واحدة فقط: 60000 ÷ 5000 = 12 جنيه/ساعة.
  // لا يتم استخدام هذا fallback إذا كان أصل طابعة حقيقي موجود بالفعل.
  if (isDefaultBambuPrinter(printer) && printerAssetHourlyDepreciation <= 0) {
    totalHourlyDepreciation += 12;
  }

  return totalHourlyDepreciation;
}

function getMaintenanceCostPerHour() {
  const everyHours = getConfigNumber('maintenanceEveryHours') || 1000;
  const maintenanceCost = getConfigNumber('maintenanceCost') || 1500;
  if (everyHours <= 0) return 0;
  return maintenanceCost / everyHours;
}


function isDefaultBambuPrinter(printer) {
  const name = String(printer?.name || '').toLowerCase();
  return name.includes('bambu lab a1') || name.includes('bambu a1');
}

function getPrinterOperatingCostPerHour(printer) {
  const raw = toPositiveNumber(printer?.hourlyDepreciation, 0);

  // قواعد حماية للبيانات القديمة: بعض النسخ خزنت في حقل الطابعة رقمًا شاملًا أو رقم إهلاك أصل.
  // في المنطق النهائي هذا الحقل = تشغيل الطابعة فقط، أما الإهلاك والصيانة فيتحسبوا من الأصول والإعدادات.
  if (isDefaultBambuPrinter(printer)) {
    const legacyOrMissing = [0, 12, 20, 33.5].some((value) => Math.abs(raw - value) < 0.0001);
    if (legacyOrMissing) return 6.5;
  }

  return raw;
}

function calc() {
  const materialUsage = getMaterialUsageFromInputs();
  const quantity = MOO3DPricing.toPositiveInteger(getValue('pieceQuantity'), 1);
  const printHours = getPrintHoursFromInputs();
  const manualMinutes = toPositiveNumber(getValue('manualMins'), 0);

  const profitMargin = toPositiveNumber(getValue('profitMargin'), getConfigNumber('defaultProfitMargin'));
  const discountValue = toPositiveNumber(getValue('discountValue'), getConfigNumber('defaultDiscountValue'));
  const packagingCost = toPositiveNumber(getValue('packagingCost'), getConfigNumber('packagingCost'));

  // الإكسسوارات تكلفة للقطعة الواحدة وتُضرب في عدد القطع. الشحن مرة واحدة للأوردر كله.
  const accessoriesCost = toPositiveNumber(getValue('accessoriesCost'), getConfigNumber('accessoriesCost'));
  const shippingCost = toPositiveNumber(getValue('shippingCost'), getConfigNumber('shippingCost'));
  const laborRate = toPositiveNumber(getValue('laborRate'), getConfigNumber('laborRate'));
  const electricityPricePerKwh = toPositiveNumber(getValue('electricityCostPerHour'), getConfigNumber('electricityCostPerHour'));
  const printerPowerKw = toPositiveNumber(getValue('printerPowerKw'), getConfigNumber('printerPowerKw'));
  const failurePercent = toPositiveNumber(getValue('failurePercent'), getConfigNumber('failurePercent'));
  const wasteWeight = toPositiveNumber(getValue('wasteWeight'), getConfigNumber('defaultWasteWeight'));
  const minimumOrderPrice = toPositiveNumber(getValue('minimumOrderPrice'), getConfigNumber('minimumOrderPrice'));
  const defaultTaxPercent = toPositiveNumber(getValue('defaultTaxPercent'), getConfigNumber('defaultTaxPercent'));
  const roundingStep = toPositiveNumber(getConfigNumber('roundingStep'), 5);

  const materialCost = materialUsage.reduce((sum, entry) => sum + Number(entry.totalCost || 0), 0);
  const totalMaterialGrams = materialUsage.reduce((sum, entry) => sum + Number(entry.grams || 0), 0);
  const weightedGramPrice = totalMaterialGrams > 0 ? materialCost / totalMaterialGrams : 0;
  const wasteCost = wasteWeight * weightedGramPrice;

  const selectedPrinterId = getValue('selectedPrinter') || getDefaultPrinterId();
  let printer = selectedPrinterId ? getPrinterById(selectedPrinterId) : null;

  // حماية إضافية من أي بيانات قديمة أو select متخزن بطريقة مختلفة:
  // لو لم نستطع إيجاد الطابعة بالـ id، نستخدم اسم الاختيار الظاهر بدل ما تكلفة الماكينة تطلع صفر.
  if (!printer) {
    const selectedOptionText = $('selectedPrinter')?.selectedOptions?.[0]?.textContent || '';
    if (selectedOptionText) {
      printer = { id: selectedPrinterId || '', name: selectedOptionText, hourlyDepreciation: 0 };
    }
  }

  if (!printer && Array.isArray(dashboardData.printers) && dashboardData.printers.length === 1) {
    printer = dashboardData.printers[0];
  }

  // منطق التسعير النهائي:
  // تكلفة ساعة الطابعة هنا = تشغيل فقط.
  // إهلاك الأصول ونصيب الصيانة يتحسبوا كبنود منفصلة مرة واحدة فقط.
  // كده لا نظلم العميل بتضخيم السعر، ولا نظلم الشغل بإهمال هلاك الأصل والصيانة.
  const machineOperatingHourCost = getPrinterOperatingCostPerHour(printer);
  const machineRunCost = printHours * machineOperatingHourCost;
  const assetsHourlyDepreciation = getAssetsHourlyDepreciation({ printer });
  const assetDepreciationCost = printHours * assetsHourlyDepreciation;
  const maintenanceCostPerHour = getMaintenanceCostPerHour();
  const maintenanceShareCost = printHours * maintenanceCostPerHour;
  const depreciationCost = machineRunCost + assetDepreciationCost + maintenanceShareCost;
  const electricityCost = printHours * electricityPricePerKwh * printerPowerKw;
  const laborCost = (manualMinutes / 60) * laborRate;

  const pricing = calculateMoo3dPricing({
    quantity,
    materialCost,
    wasteCost,
    depreciationCost,
    electricityCost,
    laborCost,
    packagingCost,
    accessoriesCost,
    shippingCost,
    failurePercent,
    taxPercent: defaultTaxPercent,
    profitMargin,
    discountValue,
    minimumOrderPrice,
    roundingStep,
  });

  const riskCost = pricing.riskCost;
  const taxCost = pricing.taxCost;
  const totalCost = pricing.totalCost;
  const totalMaterialCost = pricing.materialCost;
  const totalWasteCost = pricing.wasteCost;
  const totalDepreciationCost = pricing.depreciationCost;
  const totalElectricityCost = pricing.electricityCost;
  const totalLaborCost = pricing.laborCost;
  const totalPackagingCost = pricing.packagingCost;
  const totalAccessoriesCost = pricing.accessoriesCost;
  const totalShippingCost = pricing.shippingCost;
  const priceBeforeDiscount = pricing.priceBeforeDiscount;
  const safeDiscountValue = pricing.safeDiscountValue;
  const priceAfterDiscount = pricing.priceAfterDiscount;
  const finalPrice = pricing.finalPrice;
  const roundedAdjustment = pricing.roundedAdjustment;
  const profit = pricing.profit;

  setText('resPieces', `${quantity} قطعة`);
  setText('resUnitFinal', formatMoney(pricing.unitFinalPrice));
  setText('resMat', formatMoney(totalMaterialCost));
  setText('resWaste', formatMoney(totalWasteCost));
  setText('resMachineRun', formatMoney(machineRunCost));
  setText('resAssetDep', formatMoney(assetDepreciationCost));
  setText('resMaintenance', formatMoney(maintenanceShareCost));
  setText('resDep', formatMoney(totalDepreciationCost));
  setText('resElectricity', formatMoney(totalElectricityCost));
  setText('resLabor', formatMoney(totalLaborCost));
  setText('resPackaging', formatMoney(totalPackagingCost));
  setText('resShipping', formatMoney(totalAccessoriesCost + totalShippingCost));
  setText('resRisk', formatMoney(riskCost));
  setText('resTax', formatMoney(taxCost));
  setText('resTotal', formatMoney(totalCost));
  setText('resBeforeDiscount', formatMoney(priceBeforeDiscount));
  setText('resDiscount', formatMoney(safeDiscountValue));
  setText('resMinimum', formatMoney(minimumOrderPrice));
  setText('resRoundedAdjustment', formatMoney(roundedAdjustment));
  setText('resFinal', formatMoney(finalPrice));
  setText('resProfit', formatMoney(profit));

  currentCalc = {
    quantity,
    unitFinalPrice: roundMoney(pricing.unitFinalPrice),
    unitTotalCost: roundMoney(pricing.unitTotalCost),
    unitProfit: roundMoney(pricing.unitProfit),
    materialCost: roundMoney(totalMaterialCost),
    wasteWeight: roundMoney(wasteWeight),
    wasteCost: roundMoney(totalWasteCost),
    depreciationCost: roundMoney(totalDepreciationCost),
    machineRunCost: roundMoney(machineRunCost),
    assetDepreciationCost: roundMoney(assetDepreciationCost),
    maintenanceShareCost: roundMoney(maintenanceShareCost),
    machineOperatingHourCost: roundMoney(machineOperatingHourCost),
    electricityPricePerKwh: roundMoney(electricityPricePerKwh),
    printerPowerKw: roundMoney(printerPowerKw),
    electricityCost: roundMoney(totalElectricityCost),
    laborCost: roundMoney(totalLaborCost),
    packagingCost: roundMoney(totalPackagingCost),
    accessoriesCost: roundMoney(totalAccessoriesCost),
    shippingCost: roundMoney(totalShippingCost),
    riskCost: roundMoney(riskCost),
    taxCost: roundMoney(taxCost),
    totalCost: roundMoney(totalCost),
    priceBeforeDiscount: roundMoney(priceBeforeDiscount),
    discountValue: roundMoney(safeDiscountValue),
    priceAfterDiscount: roundMoney(priceAfterDiscount),
    minimumOrderPrice: roundMoney(minimumOrderPrice),
    roundedAdjustment: roundMoney(roundedAdjustment),
    finalPrice: roundMoney(finalPrice),
    profit: roundMoney(profit),
    // الجرامات المدخلة هي إجمالي استهلاك الأوردر كله لكل لون، لذلك لا نضربها في عدد القطع.
    materialUsage: materialUsage.map((item) => ({
      ...item,
      grams: roundMoney(Number(item.grams || 0)),
      totalCost: roundMoney(Number(item.totalCost || 0)),
      quantity
    }))
  };
}

function resetResultsPanel() {
  setText('resPieces', '1 قطعة');
  setText('resUnitFinal', formatMoney(0));
  setText('resMat', formatMoney(0));
  setText('resWaste', formatMoney(0));
  setText('resMachineRun', formatMoney(0));
  setText('resAssetDep', formatMoney(0));
  setText('resMaintenance', formatMoney(0));
  setText('resDep', formatMoney(0));
  setText('resElectricity', formatMoney(0));
  setText('resLabor', formatMoney(0));
  setText('resPackaging', formatMoney(0));
  setText('resShipping', formatMoney(0));
  setText('resRisk', formatMoney(0));
  setText('resTax', formatMoney(0));
  setText('resTotal', formatMoney(0));
  setText('resBeforeDiscount', formatMoney(0));
  setText('resDiscount', formatMoney(0));
  setText('resMinimum', formatMoney(0));
  setText('resRoundedAdjustment', formatMoney(0));
  setText('resFinal', formatMoney(0));
  setText('resProfit', formatMoney(0));
}

function resetOrderForm() {
  setValue('itemName', '');
  setValue('customerName', '');
  setValue('selectedPrinter', getDefaultPrinterId());
  setValue('pieceQuantity', '1');
  setValue('printHours', '0');
  setValue('printMinutes', '0');
  setValue('opDate', new Date().toISOString().slice(0, 10));
  setValue('orderNotes', '');
  selectedOrderMaterialIds = [];
  document.querySelectorAll('.ams-weight').forEach((input) => {
    input.value = '';
  });
  applyConfigToInputs();
  renderMaterialUsageInputs();
  currentCalc = createEmptyCalc();
  resetResultsPanel();
  setNextOrderCode();
  calc();
}

function validateOrderBeforeSave(options = {}) {
  const checkStock = options.checkStock !== false;
  const itemName = getTrimmedValue('itemName');
  const rawQuantity = Number(getValue('pieceQuantity'));
  const quantity = MOO3DPricing.toPositiveInteger(rawQuantity, 1);
  const printHours = getPrintHoursFromInputs();
  const printerId = getValue('selectedPrinter');
  const materialUsage = getMaterialUsageFromInputs();

  if (!itemName) {
    showToast('اسم المجسم مطلوب', 'error');
    $('itemName')?.focus();
    return { valid: false };
  }

  if (!printerId) {
    showToast('اختار الطابعة المستخدمة', 'error');
    $('selectedPrinter')?.focus();
    return { valid: false };
  }

  if (!Number.isInteger(rawQuantity) || rawQuantity <= 0) {
    showToast('عدد القطع لازم يكون رقم صحيح موجب', 'error');
    $('pieceQuantity')?.focus();
    return { valid: false };
  }

  if (printHours <= 0) {
    showToast('وقت الطباعة لازم يكون أكبر من صفر', 'error');
    $('printHours')?.focus();
    return { valid: false };
  }

  if (!materialUsage.length) {
    showToast('أدخل استهلاك خامة واحدة على الأقل', 'error');
    return { valid: false };
  }

  if (checkStock) {
    const requiredByMaterial = new Map();
    (currentCalc.materialUsage || []).forEach((item) => {
      const key = Number(item.materialId || 0);
      if (!key) return;
      const current = requiredByMaterial.get(key) || { grams: 0, remaining: Number(item.remaining || 0), name: item.materialName };
      current.grams += Number(item.grams || 0);
      current.remaining = Number(item.remaining || current.remaining || 0);
      current.name = item.materialName || current.name;
      requiredByMaterial.set(key, current);
    });

    for (const item of requiredByMaterial.values()) {
      if (Number(item.grams || 0) > Number(item.remaining || 0)) {
        showToast(`المخزون غير كافٍ في ${item.name}: المطلوب ${formatNumber(item.grams)} جم والمتاح ${formatNumber(item.remaining)} جم`, 'error');
        return { valid: false };
      }
    }
  }

  if (Number(currentCalc.totalCost || 0) <= 0 || Number(currentCalc.finalPrice || 0) <= 0) {
    showToast('راجع بيانات التسعير أولًا', 'error');
    return { valid: false };
  }

  const minimumNoLossPrice = Number(currentCalc.totalCost || 0) + Number(currentCalc.accessoriesCost || 0) + Number(currentCalc.shippingCost || 0);
  if (Number(currentCalc.finalPrice || 0) < minimumNoLossPrice) {
    showToast('سعر البيع أقل من التكلفة والمصاريف المباشرة', 'error');
    return { valid: false };
  }

  return { valid: true, itemName, printerId, materialUsage };
}

async function saveSale() {
  if (savingOrder) return;
  savingOrder = true;
  let committed = false;

  try {
    calc();
    const validation = validateOrderBeforeSave();
    if (!validation.valid) return;

    if (!await askConfirm('هل تم استلام المبلغ كاملًا؟ سيتم تسجيل الأوردر وخصم المخزون')) return;

    const responseCode = await window.farmAPI.getNextOrderCode();
    if (!responseCode?.success) {
      showToast(responseCode?.message || 'فشل في إنشاء كود الأوردر', 'error');
      return;
    }

    const responseOrderCode = String(responseCode.data || 'ORD-1001');
    const payload = buildCurrentOrderPayload(responseOrderCode);
    payload.itemName = validation.itemName;
    payload.printerId = Number(validation.printerId);

    const response = await window.farmAPI.createOrder(payload);
    if (!response?.success) {
      showToast(response?.message || 'فشل في حفظ الأوردر', 'error');
      return;
    }

    committed = true;
    resetOrderForm();
    showToast('تم تسجيل الأوردر المدفوع وخصم المخزون بنجاح');
    await loadDashboardData();
    setActiveNav('order');
  } catch (error) {
    showToast(committed
      ? 'تم حفظ البيعة، لكن تعذر تحديث العرض. لا تسجلها مرة أخرى؛ اقفل البرنامج وافتحه وراجع المبيعات.'
      : (error?.message || 'تعذر تأكيد الحفظ. راجع المبيعات قبل إعادة المحاولة.'), 'error');
  } finally {
    savingOrder = false;
  }
}

function applySavedOrderLocally(payload) {
  const printer = getPrinterById(payload.printerId);
  const savedOrder = {
    ...payload,
    id: Date.now(),
    printerName: printer ? printer.name : '',
    status: 'delivered'
  };
  dashboardData.orders = [savedOrder, ...(dashboardData.orders || [])];

  (payload.materialUsage || []).forEach((usage) => {
    const material = (dashboardData.materials || []).find((item) => Number(item.id) === Number(usage.materialId));
    if (material) material.remaining = Math.max(0, Number(material.remaining || 0) - Number(usage.grams || 0));
  });

  updateCustomersDatalist();
  renderInventory();
  renderMaterialUsageInputs();
  renderReportsTableSafe();
  renderStockMovementsTableSafe();
  if (isModalOpen('pipelineModal')) renderPipeline();
  if (typeof renderBusinessDashboardSafe === 'function') renderBusinessDashboardSafe();
  setNextOrderCode();
}


function buildCurrentOrderPayload(code) {
  calc();
  const responseOrderCode = String(code || 'ORD-1001');
  return {
    code: responseOrderCode,
    itemName: getTrimmedValue('itemName'),
    customerName: getTrimmedValue('customerName'),
    printerId: Number(getValue('selectedPrinter')),
    status: 'delivered',
    quantity: currentCalc.quantity || 1,
    printHours: getPrintHoursFromInputs(),
    manualMinutes: toPositiveNumber(getValue('manualMins'), 0),
    notes: getTrimmedValue('orderNotes'),
    date: getValue('opDate') || new Date().toISOString().slice(0, 10),
    unitFinalPrice: currentCalc.unitFinalPrice,
    unitTotalCost: currentCalc.unitTotalCost,
    unitProfit: currentCalc.unitProfit,
    materialCost: currentCalc.materialCost,
    wasteWeight: currentCalc.wasteWeight,
    wasteCost: currentCalc.wasteCost,
    depreciationCost: currentCalc.depreciationCost,
    machineRunCost: currentCalc.machineRunCost,
    assetDepreciationCost: currentCalc.assetDepreciationCost,
    maintenanceShareCost: currentCalc.maintenanceShareCost,
    electricityPricePerKwh: currentCalc.electricityPricePerKwh,
    printerPowerKw: currentCalc.printerPowerKw,
    electricityCost: currentCalc.electricityCost,
    laborCost: currentCalc.laborCost,
    packagingCost: currentCalc.packagingCost,
    accessoriesCost: currentCalc.accessoriesCost,
    shippingCost: currentCalc.shippingCost,
    riskCost: currentCalc.riskCost,
    taxCost: currentCalc.taxCost,
    totalCost: currentCalc.totalCost,
    priceBeforeDiscount: currentCalc.priceBeforeDiscount,
    discountValue: currentCalc.discountValue,
    priceAfterDiscount: currentCalc.priceAfterDiscount,
    minimumOrderPrice: currentCalc.minimumOrderPrice,
    roundedAdjustment: currentCalc.roundedAdjustment,
    finalPrice: currentCalc.finalPrice,
    profit: currentCalc.profit,
    materialUsage: currentCalc.materialUsage
  };
}

async function saveQuote() {
  if (savingQuote) return;
  savingQuote = true;

  try {
    calc();
    const validation = validateOrderBeforeSave({ checkStock: false });
    if (!validation.valid) return;

    const responseCode = await window.farmAPI.getNextQuoteCode();
    if (!responseCode?.success) {
      showToast(responseCode?.message || 'فشل في إنشاء كود عرض السعر', 'error');
      return;
    }

    const quoteCode = String(responseCode.data || 'Q-1001');
    const payload = buildCurrentOrderPayload('QUOTE-DRAFT');
    payload.quoteCode = quoteCode;

    const response = await window.farmAPI.createQuote(payload);
    if (!response?.success) {
      showToast(response?.message || 'فشل في حفظ عرض السعر', 'error');
      return;
    }

    showToast('تم حفظ عرض السعر بدون خصم المخزون');
    await loadDashboardData();
    if (typeof openQuotesModal === 'function') openQuotesModal();
  } finally {
    savingQuote = false;
  }
}
