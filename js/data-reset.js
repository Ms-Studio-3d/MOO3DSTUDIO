let freshStartRunning = false;
const optionalResetIds = ['resetClearPrinters', 'resetClearAssets', 'resetMachineHours', 'resetRestartCodes'];

function syncFreshStartOptions() {
  optionalResetIds.forEach((id) => { $(id).disabled = $('resetFactory').checked; });
}

function syncFreshStartConfirmation() {
  const phrase = getTrimmedValue('resetConfirmation').replace(/\s+/g, ' ').replace(/ه(?= |$)/g, 'ة');
  const ready = phrase === 'بداية جديدة';
  $('executeFreshStart').disabled = freshStartRunning || !ready;
  setText('resetConfirmationHint', ready
    ? 'العبارة صحيحة. اضغط «متابعة للتأكيد».'
    : 'زر المتابعة هيتفعّل لما تكتب «بداية جديدة».');
  return ready;
}

function openFreshStartModal() {
  if (freshStartRunning) return;
  for (const id of ['resetFactory', ...optionalResetIds]) {
    if ($(id)) $(id).checked = false;
  }
  syncFreshStartOptions();
  setValue('resetConfirmation', '');
  syncFreshStartConfirmation();
  setText('resetResult', '');
  const summary = dashboardData.meta?.summary || {};
  setText('resetPreview', `سيتم مسح كل السجلات، وليس نتائج البحث فقط: ${Number(summary.ordersCount || 0)} أوردر، و${dashboardData.materials.length} خامة، وكل المشتريات وعروض الأسعار وحركات المخزون. أسماء العملاء مشتقة من الأوردرات وستُزال معها.`);
  openModal('freshStartModal');
  $('resetConfirmation')?.focus();
}

function closeFreshStartModal() {
  if (freshStartRunning) return;
  closeModal('freshStartModal');
}

async function executeFreshStart() {
  if (freshStartRunning) return;
  if (!syncFreshStartConfirmation()) {
    showToast('اكتب «بداية جديدة» كما هي لتأكيد المسح.', 'error');
    $('resetConfirmation')?.focus();
    return;
  }
  freshStartRunning = true;
  const controls = Array.from($('freshStartModal')?.querySelectorAll('input, select, button') || []);
  controls.forEach((control) => { control.disabled = true; });
  setText('resetResult', '');
  let completed = false;
  try {
    const options = {
      confirmation: 'بداية جديدة',
      factoryReset: $('resetFactory').checked,
      clearPrinters: !!$('resetClearPrinters')?.checked,
      clearAssets: !!$('resetClearAssets')?.checked,
      resetMachineHours: !!$('resetMachineHours')?.checked,
      restartCodes: !!$('resetRestartCodes')?.checked
    };
    const confirmed = await askConfirm([
      'هيتم مسح المبيعات وعروض الأسعار والمشتريات والخامات وحركات المخزون وتصفير كاش البداية.',
      ...(options.factoryReset ? [
        'هيتم حذف الطابعات والأصول وتصفير الساعات وإرجاع الإعدادات وأرقام الأوردرات لأول تثبيت.',
        'هيتم حفظ نسخة من شيت المتابعة الجديد ثم استبداله بنسخة فاضية.'
      ] : [
      options.clearPrinters ? 'هيتم حذف الطابعات.' : 'هيتم الاحتفاظ بالطابعات.',
      options.clearAssets ? 'هيتم حذف كل الأصول.' : 'هيتم الاحتفاظ بالأصول.',
      options.resetMachineHours ? 'هيتم تصفير ساعات الماكينة وآخر صيانة.' : 'هيتم الاحتفاظ بساعات الماكينة وآخر صيانة.',
      options.restartCodes ? 'أرقام الأوردرات هتبدأ من ORD-1001.' : 'أرقام الأوردرات هتكمل من آخر رقم.',
      ]),
      'هيتم حفظ نسخة أمان قبل المسح.'
    ], { title: 'تأكيد البداية الجديدة', action: 'تأكيد التصفير', danger: true });
    if (!confirmed) {
      setText('resetResult', 'تم الإلغاء.');
      return;
    }
    setText('resetResult', 'جاري حفظ نسخة أمان وتنفيذ البداية الجديدة...');
    const response = await window.farmAPI.resetBusinessData({ ...options, confirmed: true });
    if (!response?.success) {
      setText('resetResult', response?.message || 'لم تتم البداية الجديدة. راجع الرسالة ولا تعِد المحاولة دون التحقق.');
      showToast(response?.message || 'تعذر تنفيذ البداية الجديدة', 'error');
      return;
    }
    completed = true;
    // Discard forms/cached identities that belong to the old dataset.
    editingOrderCode = null;
    currentInvoiceOrderCode = null;
    editingPurchaseId = null;
    editingAssetId = null;
    selectedOrderMaterialIds = [];
    currentCalc = createEmptyCalc();
    reportsVisibleCount = pipelineVisibleCount = customersVisibleCount = LIST_PAGE_SIZE;
    ['itemName', 'customerName', 'notes', 'filterFrom', 'filterCustomer', 'salesSearch',
      'pipelineFrom', 'pipelineSearch', 'pipelineCustomer'].forEach((id) => setValue(id, ''));
    MODAL_IDS.filter((id) => !['settingsModal', 'freshStartModal'].includes(id)).forEach(closeModal);
    resetOrderForm();
    const loaded = await loadDashboardData();
    const trackerStatus = response.data.trackingError
      ? `\nالبرنامج اتصفّر. شيت المتابعة محتاج مراجعة: ${response.data.trackingError}`
      : options.factoryReset ? '\nافتح البرنامج من جديد عشان يظهر دليل أول تشغيل.' : '';
    const resultText = `تمت البداية الجديدة. نسخة الأمان محفوظة في:\n${response.data.backupPath}${trackerStatus}\n\nيمكن استرجاع بيانات البرنامج من الإعدادات ← استيراد Backup.`;
    setText('resetResult', resultText + (loaded ? '' : '\nتم المسح، لكن عرض البيانات لم يتحدث. اقفل البرنامج وافتحه قبل إدخال أي بيانات.'));
    showToast('تمت البداية الجديدة وحفظ نسخة الأمان');
  } catch (error) {
    // A network/renderer error may happen AFTER a commit; do not claim a rollback.
    setText('resetResult', `تعذر تأكيد النتيجة: ${error?.message || 'خطأ غير متوقع'}. راجع البيانات ومجلد نسخ الأمان قبل إعادة المحاولة.`);
    showToast('راجع نتيجة العملية قبل إعادة المحاولة.', 'error');
  } finally {
    freshStartRunning = false;
    controls.forEach((control) => { control.disabled = false; });
    syncFreshStartOptions();
    if (completed) setValue('resetConfirmation', '');
    syncFreshStartConfirmation();
  }
}

async function openSafetyBackupsFolder() {
  const response = await window.farmAPI.openSafetyBackups();
  if (!response?.success) showToast(response?.message || 'تعذر فتح مجلد نسخ الأمان', 'error');
}
