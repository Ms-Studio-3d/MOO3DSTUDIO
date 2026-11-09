let dashboardData = {
  config: {},
  printers: [],
  materials: [],
  orders: [],
  stockMovements: [],
  quotes: [],
  purchases: [],
  assets: [],
  customers: [],
  meta: {}
};

let currentCalc = createEmptyCalc();
let editingOrderCode = null;
let currentInvoiceOrderCode = null;
let selectedOrderMaterialIds = [];
let reportsVisibleCount = 100;
let pipelineVisibleCount = 100;
let customersVisibleCount = 100;
let savingOrder = false;
let savingQuote = false;
let savingEdit = false;
let convertingQuote = false;
let deletingQuote = false;
let loadingDataPage = false;
let reportsLoading = false;
let pipelineLoading = false;
let customersLoading = false;
let orderQueryViews = {
  reports: { filtersKey: '', items: [], meta: {}, summary: null, loading: false, requestId: 0 },
  pipeline: { filtersKey: '', items: [], meta: {}, summary: null, loading: false, requestId: 0 }
};
let customersQueryView = { filtersKey: '', items: [], meta: {}, summary: null, loading: false, requestId: 0 };
let panelReturnTargets = { reports: '', purchases: '', assets: '' };
let savingPurchase = false;
let savingAsset = false;
let editingPurchaseId = null;
let editingAssetId = null;
const LIST_PAGE_SIZE = 100;

const DEFAULT_CONFIG = {
  farmName: '3D Print Farm App',
  currencyName: 'جنيه',
  defaultProfitMargin: 100,
  defaultManualMinutes: 15,
  laborRate: 50,
  // سعر الكيلو وات في الساعة، ويتم ضربه في printerPowerKw لحساب كهرباء الساعة.
  electricityCostPerHour: 3,
  printerPowerKw: 0.25,
  packagingCost: 10,
  failurePercent: 10,
  defaultWasteWeight: 0,
  minimumOrderPrice: 0,
  accessoriesCost: 0,
  shippingCost: 0,
  defaultTaxPercent: 0,
  defaultDiscountValue: 0,
  roundingStep: 5,
  openingCash: 5200,
  baseMachineHours: 150,
  maintenanceEveryHours: 1000,
  lastMaintenanceAtHours: 0,
  maintenanceCost: 1500
};


const MAIN_PANEL_IDS = [
  'businessDashboardModal',
  'reportsModal',
  'materialsManagerModal',
  'printersManagerModal',
  'customersModal',
  'pipelineModal',
  'settingsModal',
  'quotesModal',
  'purchasesModal',
  'assetsModal'
];

const MODAL_IDS = [
  'freshStartModal',
  'businessDashboardModal',
  'reportsModal',
  'editModal',
  'invoiceModal',
  'materialsManagerModal',
  'printersManagerModal',
  'printerModal',
  'materialModal',
  'stockMovementsModal',
  'customersModal',
  'pipelineModal',
  'settingsModal',
  'quotesModal',
  'purchasesModal',
  'purchaseModal',
  'assetsModal',
  'assetModal'
];

function createEmptyCalc() {
  return {
    quantity: 1,
    unitFinalPrice: 0,
    unitTotalCost: 0,
    unitProfit: 0,
    materialCost: 0,
    wasteWeight: 0,
    wasteCost: 0,
    depreciationCost: 0,
    machineRunCost: 0,
    assetDepreciationCost: 0,
    maintenanceShareCost: 0,
    electricityCost: 0,
    laborCost: 0,
    packagingCost: 0,
    accessoriesCost: 0,
    shippingCost: 0,
    riskCost: 0,
    taxCost: 0,
    totalCost: 0,
    priceBeforeDiscount: 0,
    discountValue: 0,
    priceAfterDiscount: 0,
    minimumOrderPrice: 0,
    roundedAdjustment: 0,
    finalPrice: 0,
    profit: 0,
    materialUsage: []
  };
}
