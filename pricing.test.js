const assert = require('node:assert/strict');
const { calculateMoo3dPricing, toPositiveInteger, toNonNegativeNumber, roundUpByStep } = require('../js/pricing-core');

const sample = calculateMoo3dPricing({
  quantity: 1,
  materialCost: 8,
  wasteCost: 0,
  depreciationCost: 20,
  electricityCost: 0,
  laborCost: 0,
  packagingCost: 10,
  accessoriesCost: 20,
  shippingCost: 0,
  failurePercent: 10,
  taxPercent: 0,
  profitMargin: 100,
  discountValue: 0,
  minimumOrderPrice: 0,
  roundingStep: 5,
});

assert.equal(sample.productionSubtotal, 38);
assert.equal(Number(sample.riskCost.toFixed(2)), 3.8);
assert.equal(Number(sample.totalCost.toFixed(2)), 41.8);
assert.equal(Number(sample.priceBeforeDiscount.toFixed(2)), 103.6);
assert.equal(sample.finalPrice, 105);
assert.equal(Number(sample.profit.toFixed(2)), 43.2);
assert.equal(Number(sample.minimumNoLossPrice.toFixed(2)), 61.8);
assert.ok(sample.finalPrice >= sample.minimumNoLossPrice);

// 3 قطع في طبعة واحدة: الوقت والتغليف والخامات إجمالي للأوردر كله، وليس للقطعة.
// الإكسسوارات فقط لكل قطعة، والشحن مرة واحدة للأوردر.
const threePiecesSamePrint = calculateMoo3dPricing({
  quantity: 3,
  materialCost: 24,
  depreciationCost: 20,
  packagingCost: 10,
  accessoriesCost: 20,
  shippingCost: 15,
  failurePercent: 10,
  profitMargin: 100,
  roundingStep: 5,
});

assert.equal(threePiecesSamePrint.quantity, 3);
assert.equal(threePiecesSamePrint.materialCost, 24);
assert.equal(threePiecesSamePrint.depreciationCost, 20);
assert.equal(threePiecesSamePrint.packagingCost, 10);
assert.equal(threePiecesSamePrint.accessoriesCost, 60);
assert.equal(threePiecesSamePrint.shippingCost, 15);
assert.equal(Number(threePiecesSamePrint.productionSubtotal.toFixed(2)), 54);
assert.equal(Number(threePiecesSamePrint.riskCost.toFixed(2)), 5.4);
assert.equal(Number(threePiecesSamePrint.totalCost.toFixed(2)), 59.4);
assert.equal(threePiecesSamePrint.directAddOnsCost, 75);
assert.equal(Number(threePiecesSamePrint.priceBeforeDiscount.toFixed(2)), 193.8);
assert.equal(threePiecesSamePrint.finalPrice, 195);
assert.equal(Number(threePiecesSamePrint.profit.toFixed(2)), 60.6);
assert.equal(Number(threePiecesSamePrint.unitFinalPrice.toFixed(2)), 65);

const withShippingAndAccessories = calculateMoo3dPricing({
  quantity: 1,
  materialCost: 8,
  depreciationCost: 20,
  packagingCost: 10,
  accessoriesCost: 20,
  shippingCost: 15,
  failurePercent: 10,
  profitMargin: 100,
  roundingStep: 5,
});

assert.equal(Number(withShippingAndAccessories.totalCost.toFixed(2)), 41.8);
assert.equal(withShippingAndAccessories.directAddOnsCost, 35);
assert.equal(Number(withShippingAndAccessories.priceBeforeDiscount.toFixed(2)), 118.6);
assert.equal(withShippingAndAccessories.finalPrice, 120);
assert.equal(Number(withShippingAndAccessories.profit.toFixed(2)), 43.2);
assert.equal(Number(withShippingAndAccessories.minimumNoLossPrice.toFixed(2)), 76.8);

// تغيير وقت الطباعة لازم يغير تكلفة الماكينة والكهرباء والإجمالي.
const oneHour = calculateMoo3dPricing({
  materialCost: 10,
  depreciationCost: 15,
  electricityCost: 3,
  laborCost: 10,
  packagingCost: 5,
  failurePercent: 10,
  profitMargin: 100,
  roundingStep: 1,
});

const twoHours = calculateMoo3dPricing({
  materialCost: 10,
  depreciationCost: 30,
  electricityCost: 6,
  laborCost: 10,
  packagingCost: 5,
  failurePercent: 10,
  profitMargin: 100,
  roundingStep: 1,
});

assert.ok(twoHours.totalCost > oneHour.totalCost);
assert.ok(twoHours.profit > oneHour.profit);

// profitMargin هنا زيادة على التكلفة Markup، وليس هامش ربح محاسبي من سعر البيع.
const markup = calculateMoo3dPricing({
  materialCost: 100,
  profitMargin: 100,
  roundingStep: 1,
});
assert.equal(markup.totalCost, 100);
assert.equal(markup.priceBeforeDiscount, 200);
assert.equal(markup.finalPrice, 200);
assert.equal(markup.profit, 100);

// الخصم لا يسمح بأن يتحول السعر لقيمة سالبة.
const cappedDiscount = calculateMoo3dPricing({
  materialCost: 50,
  discountValue: 999,
  roundingStep: 1,
});
assert.equal(cappedDiscount.priceAfterDiscountBeforeMinimum, 0);
assert.equal(cappedDiscount.finalPrice, 0);

assert.equal(toPositiveInteger(3.8), 3);
assert.equal(toPositiveInteger('4'), 4);
assert.equal(toPositiveInteger(0), 1);

// حماية محرك الحساب من القيم السالبة: أي تكلفة/نسبة سالبة تتحول لصفر بدل إنتاج أسعار أو أرباح خاطئة.
const negativeValues = calculateMoo3dPricing({
  quantity: -5,
  materialCost: -100,
  wasteCost: -10,
  depreciationCost: -20,
  electricityCost: -5,
  laborCost: -15,
  packagingCost: -8,
  accessoriesCost: -3,
  shippingCost: -12,
  failurePercent: -10,
  taxPercent: -14,
  profitMargin: -50,
  discountValue: -999,
  minimumOrderPrice: -1,
  roundingStep: -5,
});
assert.equal(negativeValues.quantity, 1);
assert.equal(negativeValues.materialCost, 0);
assert.equal(negativeValues.wasteCost, 0);
assert.equal(negativeValues.depreciationCost, 0);
assert.equal(negativeValues.electricityCost, 0);
assert.equal(negativeValues.laborCost, 0);
assert.equal(negativeValues.packagingCost, 0);
assert.equal(negativeValues.unitAccessoriesCost, 0);
assert.equal(negativeValues.shippingCost, 0);
assert.equal(negativeValues.totalCost, 0);
assert.equal(negativeValues.finalPrice, 0);
assert.equal(negativeValues.profit, 0);
assert.equal(toNonNegativeNumber(-3), 0);
assert.equal(toNonNegativeNumber('7'), 7);
assert.equal(roundUpByStep(-12, 5), 0);

// مثال مرجعي متزن يحسب التشغيل والإهلاك والصيانة مرة واحدة:
// 143 جم، 5.5 ساعة، تشغيل ماكينة 6.5/ساعة + إهلاك أصل 12/ساعة + صيانة 1.5/ساعة،
// كهرباء 3 جنيه/kWh × 0.25kW، 15 دقيقة شغل يدوي، تغليف 10، فشل 10%، ربح 100%، وتقريب لأقرب 5.
const balancedMobileReference = calculateMoo3dPricing({
  quantity: 1,
  materialCost: 143 * 800 / 1000,
  wasteCost: 0,
  depreciationCost: 5.5 * (6.5 + 12 + 1.5),
  electricityCost: 5.5 * 3 * 0.25,
  laborCost: 0.25 * 50,
  packagingCost: 10,
  accessoriesCost: 0,
  shippingCost: 0,
  failurePercent: 10,
  taxPercent: 0,
  profitMargin: 100,
  discountValue: 0,
  minimumOrderPrice: 0,
  roundingStep: 5,
});

assert.equal(Number(balancedMobileReference.totalCost.toFixed(2)), 276.13);
assert.equal(balancedMobileReference.finalPrice, 555);
assert.equal(Number(balancedMobileReference.profit.toFixed(2)), 278.87);
assert.ok(balancedMobileReference.finalPrice < 715, 'balanced pricing should count assets and maintenance once, not twice');

console.log('Pricing tests passed using js/pricing-core.js');
