function safeDivide(numerator, denominator, fallback = 0) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);

  return Number.isFinite(top) &&
    Number.isFinite(bottom) &&
    bottom > 0
    ? top / bottom
    : fallback;
}

function inferPercent(part, base, fallback = 0) {
  const value = safeDivide(part, base, fallback / 100) * 100;

  return Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function recalculateEditedOrderCosts(oldOrder, printHours, manualMinutes, printerId) {
  const quantity = Math.max(1, Number(oldOrder.quantity || 1));
  const oldPrintHours = Number(oldOrder.printHours || 0);
  const oldManualMinutes = Number(oldOrder.manualMinutes || 0);

  const materialCost = Number(oldOrder.materialCost || 0);
  const wasteCost = Number(oldOrder.wasteCost || 0);
  const packagingCost = Number(oldOrder.packagingCost || 0);
  const accessoriesCost = Number(oldOrder.accessoriesCost || 0);
  const shippingCost = Number(oldOrder.shippingCost || 0);

  const oldDepreciationCost = Number(oldOrder.depreciationCost || 0);
  const oldElectricityCost = Number(oldOrder.electricityCost || 0);
  const oldLaborCost = Number(oldOrder.laborCost || 0);
  const oldRiskCost = Number(oldOrder.riskCost || 0);
  const oldTaxCost = Number(oldOrder.taxCost || 0);

  const previousMachineHourCost = safeDivide(
    oldDepreciationCost,
    oldPrintHours,
    0
  );

  const selectedPrinter = printerId
    ? getPrinterById(printerId)
    : null;

  const machineRunHourCost = selectedPrinter
    ? (
        typeof getPrinterOperatingCostPerHour === 'function'
          ? getPrinterOperatingCostPerHour(selectedPrinter)
          : toPositiveNumber(selectedPrinter.hourlyDepreciation, 0)
      )
    : previousMachineHourCost;

  const assetHourCost =
    selectedPrinter &&
    typeof getAssetsHourlyDepreciation === 'function'
      ? getAssetsHourlyDepreciation({ printer: selectedPrinter })
      : 0;

  const maintenanceHourCost =
    selectedPrinter &&
    typeof getMaintenanceCostPerHour === 'function'
      ? getMaintenanceCostPerHour()
      : 0;

  const machineHourCost = selectedPrinter
    ? machineRunHourCost + assetHourCost + maintenanceHourCost
    : previousMachineHourCost;

  const electricityCostPerHour = safeDivide(
    oldElectricityCost,
    oldPrintHours,
    getConfigNumber('electricityCostPerHour')
  );

  const laborRate = safeDivide(
    oldLaborCost,
    oldManualMinutes / 60,
    getConfigNumber('laborRate')
  );

  const oldProductionSubtotal =
    materialCost +
    wasteCost +
    oldDepreciationCost +
    oldElectricityCost +
    oldLaborCost +
    packagingCost;

  const failurePercent = inferPercent(
    oldRiskCost,
    oldProductionSubtotal,
    getConfigNumber('failurePercent')
  );

  const oldProductionCostAfterRisk =
    oldProductionSubtotal + oldRiskCost;

  const taxPercent = inferPercent(
    oldTaxCost,
    oldProductionCostAfterRisk,
    getConfigNumber('defaultTaxPercent')
  );

  const depreciationCost =
    Number(printHours || 0) * machineHourCost;

  const electricityCost =
    Number(printHours || 0) * electricityCostPerHour;

  const laborCost =
    (Number(manualMinutes || 0) / 60) * laborRate;

  const pricing = calculateMoo3dPricing({
    quantity,
    materialCost,
    wasteCost,
    depreciationCost,
    electricityCost,
    laborCost,
    packagingCost,
    accessoriesCost: accessoriesCost / quantity,
    shippingCost,
    failurePercent,
    taxPercent,
    profitMargin: 0,
    discountValue: 0,
    minimumOrderPrice: 0,
    roundingStep: 1
  });

  return {
    quantity,
    materialCost: roundMoney(materialCost),
    wasteWeight: roundMoney(Number(oldOrder.wasteWeight || 0)),
    wasteCost: roundMoney(wasteCost),
    depreciationCost: roundMoney(pricing.depreciationCost),
    electricityCost: roundMoney(pricing.electricityCost),
    laborCost: roundMoney(pricing.laborCost),
    packagingCost: roundMoney(packagingCost),
    accessoriesCost: roundMoney(pricing.accessoriesCost),
    shippingCost: roundMoney(pricing.shippingCost),
    riskCost: roundMoney(pricing.riskCost),
    taxCost: roundMoney(pricing.taxCost),
    totalCost: roundMoney(pricing.totalCost),
    directAddOnsCost: roundMoney(pricing.directAddOnsCost)
  };
}
async function openEditSale(code) {
  if (savingEdit) return;
  const order = getOrderByCode(code);

  if (!order) {
    showToast('الأوردر غير موجود', 'error');
    return;
  }

  const request = ++editMaterialRequest;
  const response = await window.farmAPI.getOrderMaterials(code);
  if (request !== editMaterialRequest) return;
  if (!response?.success || !Array.isArray(response.data)) {
    showToast(response?.message || 'تعذر تحميل خامات الأوردر', 'error');
    return;
  }
  editingOrderCode = code;
  originalEditMaterials = response.data;
  editMaterials = originalEditMaterials.map((item) => ({ ...item }));

  setValue('editCode', order.code || '');
  setValue('editDate', order.date || '');
  setValue('editItemName', order.itemName || '');
  setValue('editCustomerName', order.customerName || '');
  const printerSelect = $('editPrinter');
  if (printerSelect && order.printerId && !Array.from(printerSelect.options).some((option) => Number(option.value) === Number(order.printerId))) {
    const option = document.createElement('option');
    option.value = String(order.printerId);
    option.textContent = `${order.printerName || 'الطابعة السابقة'} (مؤرشفة — مرتبطة بهذا الأوردر)`;
    printerSelect.appendChild(option);
  }
  setValue('editPrinter', order.printerId || '');

  const printParts = splitHoursToParts(order.printHours || 0);

  setValue('editPrintHours', printParts.hours);
  setValue('editPrintMinutes', printParts.minutes);
  setValue('editManualMinutes', order.manualMinutes || 0);
  setValue('editFinalPrice', order.finalPrice || 0);
  editPrice = { weightsKey: null, suggestion: null, basePrice: getValue('editFinalPrice') };
  setValue('editWasteWeight', order.wasteWeight || 0);
  $('editLegacyWasteHint').hidden = !(Number(order.wasteWeight) > 0 &&
    originalEditMaterials.every((row) => row.wasteGrams == null));
  setValue('editNotes', order.notes || '');
  renderEditMaterials();
  updateEditCostPreview();

  openModal('editModal');
}

let editMaterialRequest = 0;
let originalEditMaterials = [];
let editMaterials = [];
let editPrice;

function renderEditMaterials() {
  const picker = $('editMaterialPicker');
  const available = (dashboardData.materials || []).filter((material) => !editMaterials.some((row) => row.materialId === material.id));
  picker.innerHTML = '<option value="">اختار خامة من المخزن...</option>' + available.map((material) => (
    `<option value="${Number(material.id)}">${escapeHtml(material.name)} — ${escapeHtml(material.color || '')} — ${stockWeightText(material.remaining)} جم</option>`
  )).join('');
  picker.disabled = available.length === 0;
  $('editAddMaterial').disabled = available.length === 0;
  $('editMaterialRows').innerHTML = editMaterials.map((row, index) => {
    const material = getMaterialById(row.materialId);
    const detail = material?.color || (row.materialId ? 'خامة مسجّلة في الأوردر' : 'خامة قديمة غير مرتبطة بالمخزون');
    return `
      <div class="material-row order-material-row">
        <div class="material-row-name">
          <span class="material-row-title">${escapeHtml(row.materialName)}</span>
          <span class="material-row-meta">${escapeHtml(detail)}</span>
        </div>
        <input type="text" inputmode="decimal" value="${escapeHtml(row.grams)}" ${row.materialId ? '' : 'readonly'}
          aria-label="جرامات ${escapeHtml(row.materialName)}" data-action-input="setEditMaterialGrams" data-arg-input="${index}" />
        <span class="material-used-chip">جرام</span>
        <button class="material-remove-btn" type="button" aria-label="حذف ${escapeHtml(row.materialName)}"
          data-action-click="removeEditMaterial" data-arg-click="${index}">×</button>
      </div>`;
  }).join('') || '<div class="empty-state">أضف خامة واحدة على الأقل.</div>';
}

function addEditMaterial() {
  const material = getMaterialById(getValue('editMaterialPicker'));
  if (!material || editMaterials.some((row) => row.materialId === material.id)) return;
  const previous = originalEditMaterials.find((row) => row.materialId === material.id);
  editMaterials.push(previous ? { ...previous } : {
    materialId: material.id,
    materialName: material.name,
    grams: '',
    pricePerGram: Number(material.weight) > 0 ? Number(material.price || 0) / Number(material.weight) : 0
  });
  renderEditMaterials();
  updateEditCostPreview();
  $('editMaterialRows').querySelector('.material-row:last-child input')?.focus();
}

function removeEditMaterial(index) {
  editMaterials.splice(index, 1);
  renderEditMaterials();
  updateEditCostPreview();
}

function getEditedMaterialUsage() {
  const usage = [];
  for (const row of editMaterials) {
    const rawGrams = toPositiveNumber(row.grams, 0);
    const grams = roundMoney(rawGrams);
    if (grams <= 0) return null;
    const previous = originalEditMaterials.find((item) => item.rowId === row.rowId);
    usage.push({
      ...row,
      grams,
      preserveRowId: row.materialId ? null : row.rowId,
      pricePerGram: Number(Number(row.pricePerGram || 0).toFixed(6)),
      totalCost: previous && rawGrams === previous.grams
        ? previous.totalCost
        : roundMoney(rawGrams * Number(row.pricePerGram || 0))
    });
  }
  return usage.length ? usage : null;
}

function getEditCostState(oldOrder, printHours, manualMinutes, printerId) {
  const usage = getEditedMaterialUsage();
  const sameMaterials = usage?.length === originalEditMaterials.length
    && usage.every((row) => originalEditMaterials.some((old) => (
      old.rowId === row.rowId && old.grams === row.grams && old.totalCost === row.totalCost
    )));
  const wasteInput = getTrimmedValue('editWasteWeight');
  const enteredWaste = wasteInput === '' ? 0 : toNumber(wasteInput, NaN);
  const validWaste = Number.isFinite(enteredWaste) && enteredWaste >= 0;
  const oldWasteWeight = Number(oldOrder.wasteWeight || 0);
  const sameWaste = validWaste && roundMoney(enteredWaste) === roundMoney(oldWasteWeight);
  const wasteWeight = sameWaste ? oldWasteWeight : roundMoney(enteredWaste);
  const sameTime = Number(printerId) === Number(oldOrder.printerId)
    && Math.abs(printHours - Number(oldOrder.printHours || 0)) < 0.0001
    && manualMinutes === Number(oldOrder.manualMinutes || 0);
  const baseline = sameTime ? {
    ...oldOrder,
    quantity: Math.max(1, Number(oldOrder.quantity || 1)),
    directAddOnsCost: Number(oldOrder.accessoriesCost || 0) + Number(oldOrder.shippingCost || 0)
  } : recalculateEditedOrderCosts(oldOrder, printHours, manualMinutes, printerId);

  const state = { usage, sameMaterials, sameWaste, sameTime, validWaste };
  if (!usage || !validWaste || (sameMaterials && sameWaste)) return { ...state, costs: baseline };
  const materialCost = sameMaterials ? Number(oldOrder.materialCost || 0) : usage.reduce((sum, row) => sum + row.totalCost, 0);
  const grams = usage.reduce((sum, row) => sum + row.grams, 0);
  const wasteCost = wasteWeight * materialCost / grams;
  const oldSubtotal = ['materialCost', 'wasteCost', 'depreciationCost', 'electricityCost', 'laborCost', 'packagingCost']
    .reduce((sum, field) => sum + Number(oldOrder[field] || 0), 0);
  const oldRiskCost = Number(oldOrder.riskCost || 0);
  const pricing = calculateMoo3dPricing({
    ...baseline,
    materialCost,
    wasteCost,
    accessoriesCost: Number(oldOrder.accessoriesCost || 0) / baseline.quantity,
    failurePercent: inferPercent(oldRiskCost, oldSubtotal, getConfigNumber('failurePercent')),
    taxPercent: inferPercent(oldOrder.taxCost, oldSubtotal + oldRiskCost, getConfigNumber('defaultTaxPercent'))
  });
  return {
    ...state,
    costs: {
      ...baseline,
      materialCost: roundMoney(pricing.materialCost),
      wasteWeight,
      wasteCost: roundMoney(pricing.wasteCost),
      riskCost: roundMoney(pricing.riskCost),
      taxCost: roundMoney(pricing.taxCost),
      totalCost: roundMoney(pricing.totalCost)
    }
  };
}

function suggestEditPrice(order, edit) {
  const savedPrice = Number(order.finalPrice || 0);
  const { costs } = edit;
  const oldTotalCost = Number(order.totalCost || 0);
  const oldAddOns = Number(order.accessoriesCost || 0) + Number(order.shippingCost || 0);
  const oldBeforeDiscount = Number(order.priceBeforeDiscount || savedPrice);
  const profitMargin = inferPercent(
    Math.max(0, oldBeforeDiscount - oldAddOns - oldTotalCost),
    oldTotalCost,
    getConfigNumber('defaultProfitMargin')
  );
  const pricing = calculateMoo3dPricing({
    quantity: costs.quantity,
    materialCost: costs.totalCost,
    accessoriesCost: costs.accessoriesCost / costs.quantity,
    shippingCost: costs.shippingCost,
    profitMargin,
    discountValue: order.discountValue,
    minimumOrderPrice: order.minimumOrderPrice,
    roundingStep: getConfigNumber('roundingStep')
  });
  const calculatedPrice = roundMoney(pricing.finalPrice);
  const reducedStockCost = edit.sameTime && costs.totalCost < oldTotalCost;
  const finalPrice = reducedStockCost ? Math.min(calculatedPrice, savedPrice) : calculatedPrice;
  return {
    finalPrice,
    automatic: {
      priceBeforeDiscount: roundMoney(pricing.priceBeforeDiscount),
      discountValue: roundMoney(pricing.safeDiscountValue),
      priceAfterDiscount: roundMoney(pricing.priceAfterDiscount),
      roundedAdjustment: roundMoney(Math.max(0, finalPrice - pricing.priceAfterDiscount))
    }
  };
}

function getEditPriceState(order, edit) {
  const field = $('editFinalPrice');
  if (edit.usage && edit.validWaste) {
    const weightsKey = JSON.stringify([edit.costs.wasteWeight, ...edit.usage.map((row) =>
      [row.materialId, row.preserveRowId, row.grams])]);
    const weightsChanged = editPrice.weightsKey !== weightsKey;
    const previousSuggestion = editPrice.suggestion;
    editPrice.weightsKey = weightsKey;

    if (edit.sameMaterials && edit.sameWaste) {
      if (weightsChanged && previousSuggestion) field.value = editPrice.basePrice;
      editPrice.suggestion = null;
      editPrice.basePrice = field.value;
    } else {
      const suggestion = suggestEditPrice(order, edit);
      const followingSuggestion = previousSuggestion && toNumber(field.value, NaN) === previousSuggestion.finalPrice;
      if (weightsChanged || (followingSuggestion && suggestion.finalPrice !== previousSuggestion.finalPrice)) {
        field.value = suggestion.finalPrice;
      }
      editPrice.suggestion = suggestion;
    }
  }

  const entered = toNumber(field.value, NaN);
  const finalPrice = Number.isFinite(entered) && entered >= 0 ? roundMoney(entered) : null;
  const suggestion = editPrice.suggestion;
  const manualFinalPrice = finalPrice !== (suggestion?.finalPrice ?? Number(order.finalPrice || 0));
  return { finalPrice, suggestion, manualFinalPrice };
}

function updateEditCostPreview() {
  const order = getOrderByCode(editingOrderCode);
  if (!order) return;
  const edit = getEditCostState(
    order,
    getPrintHoursFromInputs('edit'),
    toPositiveNumber(getValue('editManualMinutes'), Number(order.manualMinutes || 0)),
    Number(getValue('editPrinter'))
  );
  const { usage, validWaste, costs } = edit;
  const { finalPrice, suggestion } = getEditPriceState(order, edit);
  if (!validWaste) {
    setText('editCostPreview', 'أدخل وزن هالك صالحًا بالجرام.');
    return;
  }
  if (!usage) {
    setText('editCostPreview', 'أدخل وزنًا أكبر من صفر لكل خامة.');
    return;
  }
  if (finalPrice === null) {
    setText('editCostPreview', 'أدخل سعر بيع صالحًا.');
    return;
  }
  const paid = Number(order.paidAmount ?? order.finalPrice);
  const cashChange = order.paymentStatus === 'collected' && !isCancelled(order) && finalPrice !== Number(order.finalPrice)
    ? roundMoney(finalPrice - paid)
    : 0;
  const details = [
    `تكلفة الهالك: ${formatMoney(costs.wasteCost)}`,
    `إجمالي التكلفة: ${formatMoney(costs.totalCost)}`,
    `صافي الربح: ${formatMoney(finalPrice - costs.totalCost - costs.directAddOnsCost)}`
  ];
  if (suggestion) details.push(`سعر البيع المقترح: ${formatMoney(suggestion.finalPrice)}`);
  if (cashChange < 0) details.push(`هيتخصم من الدرج ${formatMoney(-cashChange)} عند الحفظ.`);
  if (cashChange > 0) details.push(`هيتضاف للدرج ${formatMoney(cashChange)} عند الحفظ.`);
  setText('editCostPreview', details.join(' · '));
}

async function saveEditSale() {
  if (savingEdit || !editingOrderCode) return;

  savingEdit = true;

  try {
    const oldOrder = getOrderByCode(editingOrderCode);

    if (!oldOrder) {
      showToast('الأوردر غير موجود', 'error');
      closeModal('editModal');
      return;
    }

    const itemName = getTrimmedValue('editItemName');
    const date = getValue('editDate');

    if (!itemName) {
      showToast('اسم المجسم مطلوب', 'error');
      $('editItemName')?.focus();
      return;
    }

    if (!date) {
      showToast('تاريخ الأوردر مطلوب', 'error');
      $('editDate')?.focus();
      return;
    }

    const printerValue = getValue('editPrinter');
    const printerId = printerValue ? Number(printerValue) : null;

    const printHours = getPrintHoursFromInputs('edit');

    const manualMinutes = toPositiveNumber(
      getValue('editManualMinutes'),
      Number(oldOrder.manualMinutes || 0)
    );

    if (!printerId) {
      showToast('اختار الطابعة المستخدمة', 'error');
      $('editPrinter')?.focus();
      return;
    }

    if (printHours <= 0) {
      showToast('وقت الطباعة لازم يكون أكبر من صفر', 'error');
      $('editPrintHours')?.focus();
      return;
    }

    const edit = getEditCostState(oldOrder, printHours, manualMinutes, printerId);
    const { usage, sameMaterials, sameWaste, sameTime, validWaste, costs: recalculated } = edit;
    if (!validWaste) {
      showToast('أدخل وزن هالك صالحًا بالجرام', 'error');
      $('editWasteWeight')?.focus();
      return;
    }
    if (!usage) {
      showToast('أدخل وزنًا أكبر من صفر لكل خامة في الأوردر', 'error');
      return;
    }
    const { finalPrice, suggestion, manualFinalPrice } = getEditPriceState(oldOrder, edit);
    if (finalPrice === null) {
      showToast('أدخل سعر بيع صالحًا', 'error');
      $('editFinalPrice')?.focus();
      return;
    }
    const stockEdited = !sameMaterials || !sameWaste;
    const unchangedCostInputs = !stockEdited && sameTime;

    const minimumNoLossPrice =
      recalculated.totalCost +
      recalculated.directAddOnsCost;

    if (!manualFinalPrice && finalPrice < minimumNoLossPrice &&
      (finalPrice !== Number(oldOrder.finalPrice || 0) || (!stockEdited && !sameTime))) {
      showToast(
        `سعر البيع أقل من التكلفة الجديدة: الحد الأدنى ${formatMoney(minimumNoLossPrice)}`,
        'error'
      );
      return;
    }

    const profit = roundMoney(
      finalPrice -
      recalculated.totalCost -
      recalculated.directAddOnsCost
    );

    const quantity = Math.max(1, recalculated.quantity);

    const payload = {
  code: editingOrderCode,
  date,
  itemName,
  customerName: getTrimmedValue('editCustomerName'),
  printerId,
  status: oldOrder.status || 'delivered',
  quantity,
  printHours,
  manualMinutes,
  notes: getTrimmedValue('editNotes'),

  materialCost: recalculated.materialCost,
  wasteWeight: recalculated.wasteWeight,
  wasteCost: recalculated.wasteCost,
  depreciationCost: recalculated.depreciationCost,
  electricityCost: recalculated.electricityCost,
  laborCost: recalculated.laborCost,
  packagingCost: recalculated.packagingCost,
  accessoriesCost: recalculated.accessoriesCost,
  shippingCost: recalculated.shippingCost,
  riskCost: recalculated.riskCost,
  taxCost: recalculated.taxCost,
  totalCost: recalculated.totalCost,

  priceBeforeDiscount: finalPrice,
  discountValue: 0,
  priceAfterDiscount: finalPrice,

  minimumOrderPrice: Number(oldOrder.minimumOrderPrice || 0),
  roundedAdjustment: 0,

  finalPrice,
  manualFinalPrice,
  profit,

  unitFinalPrice: roundMoney(finalPrice / quantity),
  unitTotalCost: roundMoney(recalculated.totalCost / quantity),
  unitProfit: roundMoney(profit / quantity),

  replaceMaterialUsage: stockEdited,
  expectedMaterialRowIds: originalEditMaterials.map((item) => item.rowId),
  materialUsage: usage
};

    if (suggestion && !manualFinalPrice) {
      Object.assign(payload, suggestion.automatic);
    } else if (sameTime && finalPrice === Number(oldOrder.finalPrice || 0)) {
      payload.priceBeforeDiscount = oldOrder.priceBeforeDiscount;
      payload.discountValue = oldOrder.discountValue;
      payload.priceAfterDiscount = oldOrder.priceAfterDiscount;
      payload.roundedAdjustment = oldOrder.roundedAdjustment;
    }

    if (unchangedCostInputs && finalPrice === Number(oldOrder.finalPrice || 0)) {
      // Preserve historical discounts, rounding, rates and financial breakdown.
      Object.assign(payload, oldOrder, {
        code: editingOrderCode,
        date,
        itemName,
        customerName: getTrimmedValue('editCustomerName'),
        printerId,
        notes: getTrimmedValue('editNotes'),
        replaceMaterialUsage: false
      });
    }

const response = await window.farmAPI.updateOrder(payload);



    if (!response?.success) {
      showToast(
        response?.message || 'فشل في تعديل الأوردر',
        'error'
      );
      return;
    }

    showToast('تم تعديل الأوردر بنجاح');

    closeModal('editModal');

    editingOrderCode = null;

    await loadDashboardData();

    if (isModalOpen('reportsModal')) {
      await renderReportsTable();
    }

    if (isModalOpen('pipelineModal')) {
      await renderPipeline();
    }

  } catch (error) {
    showToast(error?.message || 'تعذر إتمام التعديل. راجع السجل قبل إعادة المحاولة.', 'error');
  } finally {
    savingEdit = false;
  }
}
let deletingSale = false;

async function deleteSale(code) {
  const cleanCode = String(code || '').trim();
  const order = getOrderByCode(cleanCode);
  if (!order) {
    showToast('الأوردر غير موجود', 'error');
    return;
  }
  if (deletingSale) return;
  deletingSale = true;
  let committed = false;
  try {
    const materials = await window.farmAPI.getOrderMaterials(cleanCode);
    if (!materials?.success || !Array.isArray(materials.data)) {
      showToast(materials?.message || 'تعذر تحميل خامات الأوردر', 'error');
      return;
    }
    const paid = isCancelled(order) ? 0 : Number(order.paidAmount ?? getOrderPaidAmount(order));
    const restored = materials.data.filter((item) => item.materialId && Number(item.grams) > 0)
      .map((item) => `${item.materialName} (${formatNumber(item.grams)} جم)`);
    const confirmed = await askConfirm([
      paid > 0 ? `هيتخصم ${formatMoney(paid)} من كاش الصندوق.` : 'المبلغ المحصّل للأوردر صفر.',
      restored.length ? `هيرجع للمخزون ${restored.join('، ')}.` : 'مفيش خامات مرتبطة بالمخزون في الأوردر ده.',
      'استخدم الحذف لتصحيح تسجيل غلط. لو الخامة اتستهلكت فعلاً، راجع رصيدها بعد الحذف.'
    ], { title: `حذف الأوردر ${cleanCode}؟`, action: 'حذف الأوردر', danger: true });
    if (!confirmed) return;
    const response = await window.farmAPI.deleteOrder(cleanCode);
    if (!response?.success) {
      showToast(response?.message || 'فشل في حذف الأوردر', 'error');
      return;
    }
    committed = true;
    await loadDashboardData();
    if (isModalOpen('reportsModal')) await renderReportsTable();
    if (isModalOpen('pipelineModal')) await renderPipeline();
    showToast('تم حذف الأوردر وتحديث الصندوق والمخزون');
  } catch (error) {
    showToast(committed
      ? 'تم الحذف. لو العرض لسه قديم، اقفل الشاشة وافتحها من جديد.'
      : (error?.message || 'تعذر إتمام الحذف.'), 'error');
  } finally {
    deletingSale = false;
  }
}
window.saveEditSale = saveEditSale;
window.deleteSale = deleteSale;
window.openEditSale = openEditSale;
