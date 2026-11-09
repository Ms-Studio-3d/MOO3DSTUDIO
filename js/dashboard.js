function getSortedOrders() {
  return [...dashboardData.orders].sort((a, b) => {
    return String(b.date || '').localeCompare(String(a.date || '')) || Number(b.id || 0) - Number(a.id || 0);
  });
}

function getCustomersSummary() {
  if (Array.isArray(dashboardData.customers) && dashboardData.customers.length) {
    return [...dashboardData.customers].sort((a, b) => b.revenue - a.revenue || b.count - a.count);
  }

  const map = new Map();

  dashboardData.orders.forEach((order) => {
    const name = String(order.customerName || '').trim();
    if (!name) return;

    if (!map.has(name)) {
      map.set(name, {
        name,
        count: 0,
        revenue: 0,
        profit: 0,
        lastOrderCode: '',
        lastOrderDate: '',
        lastOrderItem: ''
      });
    }

    const entry = map.get(name);
    entry.count += 1;

    if (!isCancelled(order)) {
      entry.revenue += Number(order.finalPrice || 0);
      entry.profit += Number(order.profit || 0);
    }

    const orderDate = String(order.date || '');
    if (!entry.lastOrderDate || orderDate >= entry.lastOrderDate) {
      entry.lastOrderDate = orderDate;
      entry.lastOrderCode = order.code || '';
      entry.lastOrderItem = order.itemName || '';
    }
  });

  return [...map.values()].sort((a, b) => b.revenue - a.revenue || b.count - a.count);
}

function updateCustomersDatalist() {
  const datalist = $('customersDatalist');
  if (!datalist) return;

  datalist.innerHTML = getCustomersSummary()
    .map((customer) => `<option value="${escapeHtml(customer.name)}"></option>`)
    .join('');
}

function makeStableFiltersKey(filters = {}) {
  const normalized = Object.keys(filters || {})
    .sort()
    .reduce((acc, key) => {
      const value = filters[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        acc[key] = String(value).trim();
      }
      return acc;
    }, {});

  return JSON.stringify(normalized);
}

function mergeOrdersIntoCache(items = []) {
  if (!Array.isArray(items) || !items.length) return;

  const map = new Map((dashboardData.orders || []).map((order) => [String(order.code || ''), order]));
  items.forEach((order) => {
    const code = String(order.code || '');
    if (code) map.set(code, order);
  });
  dashboardData.orders = [...map.values()].sort((a, b) => {
    return String(b.date || '').localeCompare(String(a.date || '')) || Number(b.id || 0) - Number(a.id || 0);
  });
}

function getViewOrderState(viewName) {
  if (!orderQueryViews[viewName]) {
    orderQueryViews[viewName] = { filtersKey: '', items: [], meta: {}, summary: null, loading: false, requestId: 0 };
  }

  return orderQueryViews[viewName];
}

async function loadOrdersForView(viewName, filters = {}, visibleCount = LIST_PAGE_SIZE) {
  const state = getViewOrderState(viewName);
  const filtersKey = makeStableFiltersKey(filters);
  const requestId = ++state.requestId;

  if (state.filtersKey !== filtersKey) {
    state.filtersKey = filtersKey;
    state.items = [];
    state.meta = {};
    state.summary = null;
  }

  state.loading = true;

  let localItems = Array.isArray(state.items) ? [...state.items] : [];
  let localMeta = { ...(state.meta || {}) };
  let localSummary = state.summary || null;

  try {
    while (localItems.length < visibleCount && (localItems.length === 0 || localMeta.hasMore)) {
      const response = await window.farmAPI.getDataPage('orders', {
        limit: LIST_PAGE_SIZE,
        offset: localItems.length,
        filters
      });

      if (requestId !== state.requestId) return state;

      if (!response?.success) {
        showToast(response?.message || 'فشل في تحميل الأوردرات من قاعدة البيانات', 'error');
        return state;
      }

      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      localItems = localItems.length === 0 ? items : [...localItems, ...items];
      localMeta = {
        total: Number(response.data?.total || localItems.length),
        limit: Number(response.data?.limit || LIST_PAGE_SIZE),
        offset: Number(response.data?.offset || 0),
        hasMore: Boolean(response.data?.hasMore)
      };
      localSummary = response.data?.summary || localSummary || null;

      state.items = localItems;
      state.meta = localMeta;
      state.summary = localSummary;
      mergeOrdersIntoCache(items);

      if (!items.length) break;
    }

    return state;
  } catch (error) {
    if (requestId === state.requestId) {
      showToast(error?.message || 'فشل في تحميل الأوردرات من قاعدة البيانات', 'error');
    }
    return state;
  } finally {
    if (requestId === state.requestId) state.loading = false;
  }
}

async function loadCustomersForView(filters = {}, visibleCount = LIST_PAGE_SIZE) {
  const state = customersQueryView;
  const filtersKey = makeStableFiltersKey(filters);
  const requestId = ++state.requestId;

  if (state.filtersKey !== filtersKey) {
    state.filtersKey = filtersKey;
    state.items = [];
    state.meta = {};
    state.summary = null;
  }

  state.loading = true;

  let localItems = Array.isArray(state.items) ? [...state.items] : [];
  let localMeta = { ...(state.meta || {}) };
  let localSummary = state.summary || null;

  try {
    while (localItems.length < visibleCount && (localItems.length === 0 || localMeta.hasMore)) {
      const response = await window.farmAPI.getDataPage('customers', {
        limit: LIST_PAGE_SIZE,
        offset: localItems.length,
        filters
      });

      if (requestId !== state.requestId) return state;

      if (!response?.success) {
        showToast(response?.message || 'فشل في تحميل العملاء من قاعدة البيانات', 'error');
        return state;
      }

      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      localItems = localItems.length === 0 ? items : [...localItems, ...items];
      localMeta = {
        total: Number(response.data?.total || localItems.length),
        limit: Number(response.data?.limit || LIST_PAGE_SIZE),
        offset: Number(response.data?.offset || 0),
        hasMore: Boolean(response.data?.hasMore)
      };
      localSummary = response.data?.summary || localSummary || null;

      state.items = localItems;
      state.meta = localMeta;
      state.summary = localSummary;

      if (!items.length) break;
    }

    return state;
  } catch (error) {
    if (requestId === state.requestId) {
      showToast(error?.message || 'فشل في تحميل العملاء من قاعدة البيانات', 'error');
    }
    return state;
  } finally {
    if (requestId === state.requestId) state.loading = false;
  }
}

function debounceRender(fn, key, delay = 220) {
  clearTimeout(window[`__moo3d_${key}_timer`]);
  window[`__moo3d_${key}_timer`] = setTimeout(fn, delay);
}

function renderReportsTableDebounced() {
  reportsVisibleCount = LIST_PAGE_SIZE;
  const state = getViewOrderState('reports');
  state.filtersKey = '';
  debounceRender(() => renderReportsTable(), 'reports_filters');
}

function renderPipelineDebounced() {
  pipelineVisibleCount = LIST_PAGE_SIZE;
  const state = getViewOrderState('pipeline');
  state.filtersKey = '';
  debounceRender(() => renderPipeline(), 'pipeline_filters');
}

function updateTopTitle() {
  const appTitle = document.querySelector('.app-title');
  const farmName = dashboardData.config.farmName || DEFAULT_CONFIG.farmName;

  if (appTitle) appTitle.innerText = farmName;
  document.title = farmName;
}

function applyConfigToInputs() {
  const defaultProfitMargin = String(toPositiveNumber(dashboardData.config.defaultProfitMargin, DEFAULT_CONFIG.defaultProfitMargin));
  const defaultManualMinutes = String(toPositiveNumber(dashboardData.config.defaultManualMinutes, DEFAULT_CONFIG.defaultManualMinutes));
  const laborRate = String(toPositiveNumber(dashboardData.config.laborRate, DEFAULT_CONFIG.laborRate));
  const electricityCostPerHour = String(toPositiveNumber(dashboardData.config.electricityCostPerHour, DEFAULT_CONFIG.electricityCostPerHour));
  const printerPowerKw = String(toPositiveNumber(dashboardData.config.printerPowerKw, DEFAULT_CONFIG.printerPowerKw));
  const packagingCost = String(toPositiveNumber(dashboardData.config.packagingCost, DEFAULT_CONFIG.packagingCost));
  const failurePercent = String(toPositiveNumber(dashboardData.config.failurePercent, DEFAULT_CONFIG.failurePercent));
  const defaultWasteWeight = String(toPositiveNumber(dashboardData.config.defaultWasteWeight, DEFAULT_CONFIG.defaultWasteWeight));
  const minimumOrderPrice = String(toPositiveNumber(dashboardData.config.minimumOrderPrice, DEFAULT_CONFIG.minimumOrderPrice));
  const accessoriesCost = String(toPositiveNumber(dashboardData.config.accessoriesCost, DEFAULT_CONFIG.accessoriesCost));
  const shippingCost = String(toPositiveNumber(dashboardData.config.shippingCost, DEFAULT_CONFIG.shippingCost));
  const defaultTax = String(toPositiveNumber(dashboardData.config.defaultTaxPercent, DEFAULT_CONFIG.defaultTaxPercent));
  const defaultDiscount = String(toPositiveNumber(dashboardData.config.defaultDiscountValue, DEFAULT_CONFIG.defaultDiscountValue));
  const roundingStep = String(toPositiveNumber(dashboardData.config.roundingStep, DEFAULT_CONFIG.roundingStep));
  const openingCash = String(toPositiveNumber(dashboardData.config.openingCash, DEFAULT_CONFIG.openingCash));
  const baseMachineHours = String(toPositiveNumber(dashboardData.config.baseMachineHours, DEFAULT_CONFIG.baseMachineHours));
  const maintenanceEveryHours = String(toPositiveNumber(dashboardData.config.maintenanceEveryHours, DEFAULT_CONFIG.maintenanceEveryHours));
  const lastMaintenanceAtHours = String(toPositiveNumber(dashboardData.config.lastMaintenanceAtHours, DEFAULT_CONFIG.lastMaintenanceAtHours));
  const maintenanceCost = String(toPositiveNumber(dashboardData.config.maintenanceCost, DEFAULT_CONFIG.maintenanceCost));
  const currencyName = getCurrency();

  setValue('farmName', dashboardData.config.farmName || DEFAULT_CONFIG.farmName);
  setValue('currencyName', currencyName);

  setValue('pieceQuantity', getValue('pieceQuantity', '1') || '1');
  setValue('profitMargin', defaultProfitMargin);
  setValue('manualMins', defaultManualMinutes);
  setValue('discountValue', defaultDiscount);
  setValue('laborRate', laborRate);
  setValue('electricityCostPerHour', electricityCostPerHour);
  setValue('printerPowerKw', printerPowerKw);
  setValue('packagingCost', packagingCost);
  setValue('failurePercent', failurePercent);
  setValue('wasteWeight', defaultWasteWeight);
  setValue('minimumOrderPrice', minimumOrderPrice);
  setValue('accessoriesCost', accessoriesCost);
  setValue('shippingCost', shippingCost);
  setValue('defaultTaxPercent', defaultTax);

  setValue('settingsDefaultProfitMargin', defaultProfitMargin);
  setValue('settingsDefaultManualMinutes', defaultManualMinutes);
  setValue('settingsLaborRate', laborRate);
  setValue('settingsElectricityCostPerHour', electricityCostPerHour);
  setValue('settingsPrinterPowerKw', printerPowerKw);
  setValue('settingsPackagingCost', packagingCost);
  setValue('settingsFailurePercent', failurePercent);
  setValue('settingsDefaultWasteWeight', defaultWasteWeight);
  setValue('settingsMinimumOrderPrice', minimumOrderPrice);
  setValue('settingsAccessoriesCost', accessoriesCost);
  setValue('settingsShippingCost', shippingCost);
  setValue('settingsDefaultTaxPercent', defaultTax);
  setValue('settingsDefaultDiscountValue', defaultDiscount);
  setValue('settingsRoundingStep', roundingStep);
  setValue('settingsOpeningCash', openingCash);
  setValue('settingsBaseMachineHours', baseMachineHours);
  setValue('settingsMaintenanceEveryHours', maintenanceEveryHours);
  setValue('settingsLastMaintenanceAtHours', lastMaintenanceAtHours);
  setValue('settingsMaintenanceCost', maintenanceCost);
}

async function loadMoreDataPage(kind, renderCallback = null) {
  if (loadingDataPage) return false;

  const currentRows = Array.isArray(dashboardData[kind]) ? dashboardData[kind] : [];
  const pageMeta = dashboardData.meta?.[kind] || {};

  if (!pageMeta.hasMore) return false;

  loadingDataPage = true;

  try {
    const response = await window.farmAPI.getDataPage(kind, {
      limit: LIST_PAGE_SIZE,
      offset: currentRows.length
    });

    if (!response?.success) {
      showToast(response?.message || 'فشل في تحميل المزيد من البيانات', 'error');
      return false;
    }

    const items = Array.isArray(response.data?.items) ? response.data.items : [];
    dashboardData[kind] = [...currentRows, ...items];
    dashboardData.meta = {
      ...(dashboardData.meta || {}),
      [kind]: {
        total: Number(response.data?.total || currentRows.length + items.length),
        limit: Number(response.data?.limit || LIST_PAGE_SIZE),
        offset: Number(response.data?.offset || currentRows.length),
        hasMore: Boolean(response.data?.hasMore)
      }
    };

    if (typeof renderCallback === 'function') renderCallback();
    return true;
  } finally {
    loadingDataPage = false;
  }
}

async function setNextOrderCode() {
  const response = await window.farmAPI.getNextOrderCode();
  if (!response?.success) return;

  const nextCode = String(response.data || 'ORD-1001');
  setText('nextOrderCode', nextCode.replace('ORD-', ''));
}

let dashboardLoadRequest = 0;
async function loadDashboardData() {
  const requestId = ++dashboardLoadRequest;
  const response = await window.farmAPI.getDashboardData();
  if (requestId !== dashboardLoadRequest) return false;

  if (!response?.success) {
    showToast(response?.message || 'فشل في تحميل البيانات', 'error');
    return false;
  }

  dashboardData = {
    config: { ...DEFAULT_CONFIG, ...(response.data?.config || {}) },
    printers: Array.isArray(response.data?.printers) ? response.data.printers : [],
    materials: Array.isArray(response.data?.materials) ? response.data.materials : [],
    orders: Array.isArray(response.data?.orders) ? response.data.orders : [],
    stockMovements: Array.isArray(response.data?.stockMovements) ? response.data.stockMovements : [],
    quotes: Array.isArray(response.data?.quotes) ? response.data.quotes : [],
    purchases: Array.isArray(response.data?.purchases) ? response.data.purchases : [],
    assets: Array.isArray(response.data?.assets) ? response.data.assets : [],
    customers: Array.isArray(response.data?.customers) ? response.data.customers : [],
    meta: response.data?.meta || {}
  };

  Object.values(orderQueryViews).forEach((view) => { view.requestId += 1; });
  customersQueryView.requestId += 1;
  orderQueryViews = {
    reports: { filtersKey: '', items: [], meta: {}, summary: null, loading: false, requestId: 0 },
    pipeline: { filtersKey: '', items: [], meta: {}, summary: null, loading: false, requestId: 0 }
  };
  customersQueryView = { filtersKey: '', items: [], meta: {}, summary: null, loading: false, requestId: 0 };

  if (String(dashboardData.config.currencyName || '').trim() === 'ج') {
    dashboardData.config.currencyName = 'جنيه';
  }

  applyConfigToInputs();
  updateTopTitle();
  updateCustomersDatalist();
  renderPrinters();
  renderPrinterSelects();
  renderInventory();
  renderMaterialUsageInputs();
  // لا نرسم التقارير وحركات المخزون عند بداية التشغيل لأنها قد تكون كبيرة.
  // يتم رسمها فقط عند فتح الصفحة الخاصة بها.
  if (isModalOpen('reportsModal')) renderReportsTable();
  if (isModalOpen('stockMovementsModal')) renderStockMovementsTable();
  if (isModalOpen('businessDashboardModal') && typeof renderBusinessDashboard === 'function') renderBusinessDashboard();
  if (isModalOpen('purchasesModal') && typeof renderPurchasesTable === 'function') renderPurchasesTable();
  if (isModalOpen('assetsModal') && typeof renderAssetsTable === 'function') renderAssetsTable();

  if (isModalOpen('pipelineModal')) renderPipeline();
  if (isModalOpen('customersModal')) renderCustomers();
  if (isModalOpen('quotesModal') && typeof renderQuotes === 'function') renderQuotes();

  // تحديث رقم الأوردر والحساب بعد الرسم الأساسي حتى لا يتأخر فتح الشاشة.
  await setNextOrderCode();
  calc();
  return true;
}
