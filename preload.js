const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
  getDashboardData: 'db:getDashboardData',
  getDataPage: 'db:getDataPage',
  getNextOrderCode: 'db:getNextOrderCode',
  getNextQuoteCode: 'db:getNextQuoteCode',
  saveConfig: 'db:saveConfig',

  savePrinter: 'db:savePrinter',
  deletePrinter: 'db:deletePrinter',

  saveMaterial: 'db:saveMaterial',
  deleteMaterial: 'db:deleteMaterial',

  createOrder: 'db:createOrder',
  updateOrder: 'db:updateOrder',
  deleteOrder: 'db:deleteOrder',
  savePurchase: 'db:savePurchase',
  deletePurchase: 'db:deletePurchase',
  saveAsset: 'db:saveAsset',
  deleteAsset: 'db:deleteAsset',
  createQuote: 'db:createQuote',
  deleteQuote: 'db:deleteQuote',
  convertQuoteToOrder: 'db:convertQuoteToOrder',

  exportBackup: 'db:exportBackup',
  importBackup: 'db:importBackup',
  resetBusinessData: 'db:resetBusinessData',
  openSafetyBackups: 'backup:openSafetyBackups',

  confirmDialog: 'dialog:confirm'
};

async function safeInvoke(channel, payload) {
  try {
    return await ipcRenderer.invoke(channel, payload);
  } catch (error) {
    console.error(`[PRELOAD ERROR] ${channel}`, error);

    return {
      success: false,
      message: error?.message || 'حدث خطأ أثناء تنفيذ العملية'
    };
  }
}

contextBridge.exposeInMainWorld('farmAPI', {
  getDashboardData() {
    return safeInvoke(CHANNELS.getDashboardData);
  },

  getDataPage(kind, options = {}) {
    return safeInvoke(CHANNELS.getDataPage, { kind, ...(options || {}) });
  },

  getNextOrderCode() {
    return safeInvoke(CHANNELS.getNextOrderCode);
  },

  getNextQuoteCode() {
    return safeInvoke(CHANNELS.getNextQuoteCode);
  },

  saveConfig(config) {
    return safeInvoke(CHANNELS.saveConfig, config);
  },

  savePrinter(printer) {
    return safeInvoke(CHANNELS.savePrinter, printer);
  },

  deletePrinter(id) {
    return safeInvoke(CHANNELS.deletePrinter, { id });
  },

  saveMaterial(material) {
    return safeInvoke(CHANNELS.saveMaterial, material);
  },

  deleteMaterial(id) {
    return safeInvoke(CHANNELS.deleteMaterial, { id });
  },

  createOrder(order) {
    return safeInvoke(CHANNELS.createOrder, order);
  },

  updateOrder(order) {
    return safeInvoke(CHANNELS.updateOrder, order);
  },

  deleteOrder(code) {
    return safeInvoke(CHANNELS.deleteOrder, { code });
  },

  savePurchase(purchase) {
    return safeInvoke(CHANNELS.savePurchase, purchase);
  },

  deletePurchase(id) {
    return safeInvoke(CHANNELS.deletePurchase, { id });
  },

  saveAsset(asset) {
    return safeInvoke(CHANNELS.saveAsset, asset);
  },

  deleteAsset(id) {
    return safeInvoke(CHANNELS.deleteAsset, { id });
  },

  createQuote(quote) {
    return safeInvoke(CHANNELS.createQuote, quote);
  },

  deleteQuote(code) {
    return safeInvoke(CHANNELS.deleteQuote, { code });
  },

  convertQuoteToOrder(code) {
    return safeInvoke(CHANNELS.convertQuoteToOrder, { code });
  },

  exportBackup() {
    return safeInvoke(CHANNELS.exportBackup);
  },

  importBackup(data) {
    return safeInvoke(CHANNELS.importBackup, data);
  },

  resetBusinessData(options) {
    return safeInvoke(CHANNELS.resetBusinessData, options);
  },

  openSafetyBackups() {
    return safeInvoke(CHANNELS.openSafetyBackups);
  },

  confirm(message) {
    return safeInvoke(CHANNELS.confirmDialog, { message });
  }
});
