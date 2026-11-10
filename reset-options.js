'use strict';

const RESET_CONFIRMATION = 'بداية جديدة';

/** Strict, opt-in destructive options shared by IPC and database tests. */
function normalizeResetOptions(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      String(payload.confirmation || '').trim() !== RESET_CONFIRMATION) {
    throw new Error(`اكتب «${RESET_CONFIRMATION}» لتأكيد مسح البيانات التجريبية.`);
  }
  for (const key of ['clearPrinters', 'clearAssets', 'resetMachineHours', 'restartCodes', 'factoryReset']) {
    if (payload[key] !== undefined && typeof payload[key] !== 'boolean') {
      throw new Error('اختيارات البداية الجديدة غير صالحة. لم يتم مسح أي بيانات.');
    }
  }
  const factoryReset = payload.factoryReset === true;
  return {
    confirmation: RESET_CONFIRMATION,
    factoryReset,
    clearPrinters: factoryReset || payload.clearPrinters === true,
    clearAssets: factoryReset || payload.clearAssets === true,
    resetMachineHours: factoryReset || payload.resetMachineHours === true,
    restartCodes: factoryReset || payload.restartCodes === true
  };
}

module.exports = { RESET_CONFIRMATION, normalizeResetOptions };
