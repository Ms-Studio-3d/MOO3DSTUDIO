'use strict';

const RESET_CONFIRMATION = 'بداية جديدة';

/** Strict, opt-in destructive options shared by IPC and database tests. */
function normalizeResetOptions(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      String(payload.confirmation || '').trim() !== RESET_CONFIRMATION) {
    throw new Error(`اكتب «${RESET_CONFIRMATION}» لتأكيد مسح البيانات التجريبية.`);
  }
  for (const key of ['clearPrinters', 'clearAssets', 'resetMachineHours', 'restartCodes']) {
    if (payload[key] !== undefined && typeof payload[key] !== 'boolean') {
      throw new Error('اختيارات البداية الجديدة غير صالحة. لم يتم مسح أي بيانات.');
    }
  }
  return {
    confirmation: RESET_CONFIRMATION,
    clearPrinters: payload.clearPrinters === true,
    clearAssets: payload.clearAssets === true,
    resetMachineHours: payload.resetMachineHours === true,
    restartCodes: payload.restartCodes === true
  };
}

module.exports = { RESET_CONFIRMATION, normalizeResetOptions };
