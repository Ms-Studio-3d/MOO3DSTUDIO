(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.MOO3DPricing = api;
  root.roundUpByStep = api.roundUpByStep;
  root.calculateMoo3dPricing = api.calculateMoo3dPricing;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function toNonNegativeNumber(value, fallback = 0) {
    const n = toNumber(value, fallback);
    return n >= 0 ? n : Math.max(0, fallback);
  }

  function toPositiveInteger(value, fallback = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;

    const integer = Math.floor(n);
    return integer > 0 ? integer : fallback;
  }

  function roundUpByStep(value, step) {
    const safeValue = toNonNegativeNumber(value, 0);
    const safeStep = toNonNegativeNumber(step, 5);

    if (!Number.isFinite(safeStep) || safeStep <= 0) return safeValue;
    return Math.ceil(safeValue / safeStep) * safeStep;
  }

  function calculateMoo3dPricing(input = {}) {
    const quantity = toPositiveInteger(input.quantity, 1);

    // نظام MOO3D القديم/الصحيح:
    // الخامة، الهالك، تشغيل/إهلاك/صيانة الماكينة، الكهرباء، الشغل اليدوي، والتغليف
    // كلهم إجمالي للأوردر كله، ولا يتم ضربهم في عدد القطع.
    // الإكسسوارات فقط تكلفة للقطعة الواحدة وتُضرب في عدد القطع.
    // الشحن يضاف مرة واحدة للأوردر كله.
    const materialCost = toNonNegativeNumber(input.materialCost, 0);
    const wasteCost = toNonNegativeNumber(input.wasteCost, 0);
    const depreciationCost = toNonNegativeNumber(input.depreciationCost, 0);
    const electricityCost = toNonNegativeNumber(input.electricityCost, 0);
    const laborCost = toNonNegativeNumber(input.laborCost, 0);
    const packagingCost = toNonNegativeNumber(input.packagingCost, 0);
    const unitAccessoriesCost = toNonNegativeNumber(input.accessoriesCost, 0);
    const shippingCost = toNonNegativeNumber(input.shippingCost, 0);

    const accessoriesCost = unitAccessoriesCost * quantity;

    const failurePercent = toNonNegativeNumber(input.failurePercent, 0);
    const taxPercent = toNonNegativeNumber(input.taxPercent, 0);
    const profitMargin = toNonNegativeNumber(input.profitMargin, 0);
    const discountValue = toNonNegativeNumber(input.discountValue, 0);
    const minimumOrderPrice = toNonNegativeNumber(input.minimumOrderPrice, 0);
    const roundingStep = toNonNegativeNumber(input.roundingStep, 5);

    const productionSubtotal = materialCost
      + wasteCost
      + depreciationCost
      + electricityCost
      + laborCost
      + packagingCost;

    const riskCost = productionSubtotal * (failurePercent / 100);
    const productionCostAfterRisk = productionSubtotal + riskCost;
    const taxCost = productionCostAfterRisk * (taxPercent / 100);
    const totalCost = productionCostAfterRisk + taxCost;

    const directAddOnsCost = accessoriesCost + shippingCost;

    // profitMargin هنا Markup على تكلفة الإنتاج، مثل النسخة القديمة.
    // مثال: تكلفة 100 وزيادة 100% = سعر قبل الإضافات 200.
    const sellBeforeAddOns = totalCost * (1 + profitMargin / 100);
    const priceBeforeDiscount = sellBeforeAddOns + directAddOnsCost;

    const safeDiscountValue = Math.min(Math.max(discountValue, 0), priceBeforeDiscount);
    const priceAfterDiscountBeforeMinimum = Math.max(0, priceBeforeDiscount - safeDiscountValue);
    const priceAfterDiscount = Math.max(priceAfterDiscountBeforeMinimum, minimumOrderPrice);
    const finalPrice = roundUpByStep(priceAfterDiscount, roundingStep);
    const roundedAdjustment = finalPrice - priceAfterDiscount;
    const profit = finalPrice - totalCost - directAddOnsCost;
    const minimumNoLossPrice = totalCost + directAddOnsCost;

    return {
      quantity,
      materialCost,
      wasteCost,
      depreciationCost,
      electricityCost,
      laborCost,
      packagingCost,
      unitAccessoriesCost,
      shippingCost,
      accessoriesCost,
      productionSubtotal,
      riskCost,
      productionCostAfterRisk,
      taxCost,
      totalCost,
      directAddOnsCost,
      sellBeforeAddOns,
      priceBeforeDiscount,
      safeDiscountValue,
      priceAfterDiscountBeforeMinimum,
      priceAfterDiscount,
      minimumOrderPrice,
      finalPrice,
      roundedAdjustment,
      profit,
      minimumNoLossPrice,
      unitFinalPrice: finalPrice / quantity,
      unitTotalCost: totalCost / quantity,
      unitProfit: profit / quantity,
    };
  }

  return {
    roundUpByStep,
    toNumber,
    toNonNegativeNumber,
    toPositiveInteger,
    calculateMoo3dPricing,
  };
});
