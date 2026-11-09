function $(id) {
  return document.getElementById(id);
}

function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[٫]/g, '.')
    .replace(/[٬]/g, '')
    .replace(/,/g, '.')
    .trim();
}

function toNumber(value, fallback = 0) {
  const normalized = normalizeDigits(value);
  if (normalized === '') return fallback;

  const num = Number(normalized);
  return Number.isFinite(num) ? num : fallback;
}

function toPositiveNumber(value, fallback = 0) {
  const num = toNumber(value, fallback);
  return num >= 0 ? num : fallback;
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function roundUpToNearest5(value) {
  const safeValue = Math.max(0, Number(value || 0));
  const step = Math.max(1, toPositiveNumber(dashboardData.config.roundingStep, DEFAULT_CONFIG.roundingStep));
  return Math.ceil(safeValue / step) * step;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function jsStringArg(value) {
  // نحمي النص داخل JavaScript، ثم علامات التنصيص داخل HTML.
  return escapeHtml(JSON.stringify(String(value ?? '')))
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCurrency() {
  const rawCurrency = String(dashboardData.config.currencyName || DEFAULT_CONFIG.currencyName || 'جنيه').trim();

  if (!rawCurrency || rawCurrency === 'ج') {
    return 'جنيه';
  }

  return rawCurrency;
}

function formatMoney(value) {
  return `${Number(value || 0).toFixed(2)} ${getCurrency()}`;
}

function formatNumber(value) {
  return Number(value || 0).toFixed(2);
}

function formatDateTime(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ').slice(0, 19);
}


function formatHoursMinutes(value) {
  const totalMinutes = Math.max(0, Math.round(Number(value || 0) * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours && minutes) return `${hours} ساعة ${minutes} دقيقة`;
  if (hours) return `${hours} ساعة`;
  return `${minutes} دقيقة`;
}

function splitHoursToParts(value) {
  const totalMinutes = Math.max(0, Math.round(Number(value || 0) * 60));
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60
  };
}

function combineHoursMinutes(hoursValue, minutesValue) {
  const hours = toPositiveNumber(hoursValue, 0);
  const minutes = toPositiveNumber(minutesValue, 0);
  // نحفظ وقت الطباعة بدقة 4 أرقام عشرية حتى لا تضيع الدقائق القصيرة.
  // مثال: 1 دقيقة = 0.0167 ساعة تقريبًا، بدل تقريبها لـ 0.02 ساعة.
  return Number((hours + (minutes / 60)).toFixed(4));
}

function getPrintHoursFromInputs(prefix = '') {
  const hoursId = prefix ? `${prefix}PrintHours` : 'printHours';
  const minutesId = prefix ? `${prefix}PrintMinutes` : 'printMinutes';
  return combineHoursMinutes(getValue(hoursId), getValue(minutesId));
}

function setText(id, value) {
  const el = $(id);
  if (el) el.innerText = value;
}

function setValue(id, value) {
  const el = $(id);
  if (el) el.value = value;
}

function getValue(id, fallback = '') {
  return String($(id)?.value ?? fallback);
}

function getTrimmedValue(id, fallback = '') {
  return getValue(id, fallback).trim();
}

function getConfigNumber(key) {
  return toPositiveNumber(dashboardData.config[key], toPositiveNumber(DEFAULT_CONFIG[key], 0));
}

function getPrinterById(id) {
  return dashboardData.printers.find((printer) => String(printer.id) === String(id));
}

function getDefaultPrinterId() {
  const printers = Array.isArray(dashboardData.printers) ? dashboardData.printers : [];
  const availablePrinter = printers.find((printer) => String(printer.status || 'idle') !== 'offline');
  const printer = availablePrinter || printers[0];
  return printer ? String(printer.id) : '';
}

function getMaterialById(id) {
  return dashboardData.materials.find((material) => String(material.id) === String(id));
}

function getOrderByCode(code) {
  const cleanCode = String(code || '');
  const sources = [dashboardData.orders || []];

  if (typeof orderQueryViews === 'object' && orderQueryViews) {
    Object.values(orderQueryViews).forEach((view) => {
      if (Array.isArray(view?.items)) sources.push(view.items);
    });
  }

  for (const source of sources) {
    const match = source.find((item) => String(item.code) === cleanCode);
    if (match) return match;
  }

  return null;
}

function isCancelled(order) {
  return String(order?.status || '') === 'cancelled';
}

function getPrinterStatusText(status) {
  switch (status) {
    case 'idle':
      return 'متاحة';
    case 'printing':
      return 'تطبع الآن';
    case 'maintenance':
      return 'صيانة';
    case 'offline':
      return 'متوقفة';
    default:
      return 'غير محدد';
  }
}

function getPrinterStatusClass(status) {
  switch (status) {
    case 'idle':
      return 'status-success';
    case 'printing':
      return 'status-warning';
    case 'maintenance':
    case 'offline':
      return 'status-danger';
    default:
      return '';
  }
}

function getOrderStatusText(status) {
  switch (status) {
    case 'new':
      return 'جديد';
    case 'printing':
      return 'قيد الطباعة';
    case 'finished':
      return 'جاهز';
    case 'delivered':
      return 'تم التسليم';
    case 'cancelled':
      return 'ملغي';
    default:
      return 'غير محدد';
  }
}

function getOrderStatusClass(status) {
  switch (status) {
    case 'delivered':
    case 'finished':
      return 'status-success';
    case 'new':
    case 'printing':
      return 'status-warning';
    case 'cancelled':
      return 'status-danger';
    default:
      return '';
  }
}

function getPaymentStatusText() {
  return 'مدفوع بالكامل';
}

function getPaymentStatusClass() {
  return 'status-success';
}

function getPaymentMethodText() {
  return 'كاش';
}


function getPaidAmountFromStatus(status, finalPrice, paidAmount) {
  if (String(status || '') === 'cancelled') return 0;
  const final = Math.max(0, Number(finalPrice || 0));
  const paid = paidAmount === undefined || paidAmount === null || paidAmount === ''
    ? final
    : Math.max(0, Number(paidAmount || 0));
  return Math.min(final, paid);
}

function getOrderPaidAmount(order) {
  if (isCancelled(order)) return 0;
  return getPaidAmountFromStatus(order?.status, order?.finalPrice, order?.paidAmount);
}

function getOrderDueAmount(order) {
  if (isCancelled(order)) return 0;
  return Math.max(0, Number(order?.finalPrice || 0) - getOrderPaidAmount(order));
}

function getMovementTypeText(type) {
  switch (type) {
    case 'in':
      return 'إضافة';
    case 'out':
      return 'خصم';
    case 'return':
      return 'استرجاع';
    case 'adjust_in':
      return 'زيادة يدوية';
    case 'adjust_out':
      return 'نقص يدوي';
    default:
      return type || '-';
  }
}

function setActiveNav(view) {
  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.classList.toggle('nav-btn-active', button.dataset.view === view);
  });
}

function getOpenModalsCount() {
  return MODAL_IDS.filter((modalId) => isModalOpen(modalId)).length;
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;

  modal.style.display = 'flex';
  modal.style.zIndex = String(10000 + getOpenModalsCount());
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;

  modal.style.display = 'none';
  modal.style.zIndex = '';
  modal.setAttribute('aria-hidden', 'true');
}

function isModalOpen(id) {
  const modal = $(id);
  return !!modal && modal.style.display === 'flex';
}

function closeMainPanels() {
  MAIN_PANEL_IDS.forEach((id) => closeModal(id));
}

function closeAllModals() {
  MODAL_IDS.forEach((id) => closeModal(id));
}

function closeAllPanels() {
  closeAllModals();
  setActiveNav('order');
}

function returnToOrderNav() {
  const anyOpen = MODAL_IDS.some((id) => isModalOpen(id));
  if (!anyOpen) setActiveNav('order');
}

function showToast(message, type = 'success') {
  const oldToast = $('toastMsg');
  if (oldToast) oldToast.remove();

  const toast = document.createElement('div');
  toast.id = 'toastMsg';
  toast.className = `toast ${type}`;
  toast.innerText = message;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const visibleMs = type === 'error' ? 7000 : 3500;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
  }, visibleMs);

  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, visibleMs + 400);
}

async function askConfirm(message) {
  try {
    const response = await window.farmAPI.confirm(message);
    if (!response?.success) {
      showToast(response?.message || 'تعذر فتح نافذة التأكيد. العملية لم تُنفذ.', 'error');
      return false;
    }
    return !!response.confirmed;
  } catch (error) {
    showToast(error?.message || 'تعذر فتح نافذة التأكيد. العملية لم تُنفذ.', 'error');
    return false;
  }
}

// ======================================
// Expose functions globally
// ======================================

window.$ = $;

window.normalizeDigits = normalizeDigits;
window.toNumber = toNumber;
window.toPositiveNumber = toPositiveNumber;

window.formatMoney = formatMoney;
window.formatNumber = formatNumber;
window.formatDateTime = formatDateTime;
window.formatHoursMinutes = formatHoursMinutes;

window.setText = setText;
window.setValue = setValue;
window.getValue = getValue;
window.getTrimmedValue = getTrimmedValue;

window.getPrinterById = getPrinterById;
window.getDefaultPrinterId = getDefaultPrinterId;
window.getMaterialById = getMaterialById;
window.getOrderByCode = getOrderByCode;

window.openModal = openModal;
window.closeModal = closeModal;
window.isModalOpen = isModalOpen;

window.closeMainPanels = closeMainPanels;
window.closeAllModals = closeAllModals;
window.closeAllPanels = closeAllPanels;

window.returnToOrderNav = returnToOrderNav;
window.setActiveNav = setActiveNav;

window.showToast = showToast;
window.askConfirm = askConfirm;
