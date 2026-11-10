'use strict';

const STOCK_EPSILON = 1e-9;

function stockCovers(available, required) {
  return available >= required - STOCK_EPSILON;
}

function stockWeightText(grams) {
  return (Math.floor((Number(grams) + STOCK_EPSILON) * 100) / 100).toFixed(2);
}

function allocateWaste(rows, wasteWeight) {
  const units = Math.round(Number(wasteWeight || 0) * 100);
  const total = rows.reduce((sum, row) => sum + Number(row.grams), 0);
  let allocated = 0;
  let cumulativeWeight = 0;
  return rows.map((row, index) => {
    cumulativeWeight += Number(row.grams);
    const target = index === rows.length - 1 ? units : Math.round(units * cumulativeWeight / total);
    const wasteGrams = (target - allocated) / 100;
    allocated = target;
    return { ...row, wasteGrams };
  });
}

if (typeof module === 'object' && module.exports) module.exports = { STOCK_EPSILON, stockCovers, allocateWaste };
