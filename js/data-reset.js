let freshStartRunning = false;

function openFreshStartModal() {
  if (freshStartRunning) return;
  for (const id of ['resetClearPrinters', 'resetClearAssets', 'resetMachineHours', 'resetRestartCodes']) {
    if ($(id)) $(id).checked = false;
  }
  setValue('resetConfirmation', '');
  setText('resetResult', '');
  const summary = dashboardData.meta?.summary || {};
  setText('resetPreview', `سيتم مسح كل السجلات، وليس نتائج البحث فقط: ${Number(summary.ordersCount || 0)} أوردر، و${dashboardData.materials.length} خامة، وكل المشتريات وعروض الأسعار وحركات المخزون. أسماء العملاء مشتقة من الأوردرات وستُزال معها.`);
  if ($('executeFreshStart')) $('executeFreshStart').disabled = false;
  openModal('freshStartModal');
  $('resetConfirmation')?.focus();
}

function closeFreshStartModal() {
  if (freshStartRunning) return;
  closeModal('freshStartModal');
}

async function executeFreshStart() {
  if (freshStartRunning) return;
  if (getTrimmedValue('resetConfirmation') !== 'بداية جديدة') {
    showToast('اكتب «بداية جديدة» كما هي لتأكيد المسح.', 'error');
    $('resetConfirmation')?.focus();
    return;
  }
  freshStartRunning = true;
  const controls = Array.from($('freshStartModal')?.querySelectorAll('input, button') || []);
  controls.forEach((control) => { control.disabled = true; });
  setText('resetResult', 'جاري التأكيد وتأمين نسخة من بياناتك قبل أي مسح...');
  let completed = false;
  try {
    const response = await window.farmAPI.resetBusinessData({
      confirmation: getTrimmedValue('resetConfirmation'),
      clearPrinters: !!$('resetClearPrinters')?.checked,
      clearAssets: !!$('resetClearAssets')?.checked,
      resetMachineHours: !!$('resetMachineHours')?.checked,
      restartCodes: !!$('resetRestartCodes')?.checked
    });
    if (!response?.success) {
      setText('resetResult', response?.message || 'لم تتم البداية الجديدة. راجع الرسالة ولا تعِد المحاولة دون التحقق.');
      showToast(response?.message || 'تعذر تنفيذ البداية الجديدة', 'error');
      return;
    }
    if (response.data?.cancelled) { setText('resetResult', 'تم الإلغاء. بياناتك لم تتغير.'); return; }
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
    setValue('resetConfirmation', '');
    const resultText = `تمت البداية الجديدة. نسخة الأمان محفوظة في:\n${response.data.backupPath}\n\nيمكن استرجاعها من الإعدادات ← استيراد Backup. انسخها أيضًا على وسيط خارجي.`;
    setText('resetResult', resultText + (loaded ? '' : '\nتم المسح، لكن عرض البيانات لم يتحدث. اقفل البرنامج وافتحه قبل إدخال أي بيانات.'));
    showToast('تمت البداية الجديدة وحفظ نسخة الأمان');
  } catch (error) {
    // A network/renderer error may happen AFTER a commit; do not claim a rollback.
    setText('resetResult', `تعذر تأكيد النتيجة: ${error?.message || 'خطأ غير متوقع'}. راجع البيانات ومجلد نسخ الأمان قبل إعادة المحاولة.`);
    showToast('راجع نتيجة العملية قبل إعادة المحاولة.', 'error');
  } finally {
    freshStartRunning = false;
    controls.forEach((control) => { control.disabled = false; });
    if (completed && $('executeFreshStart')) $('executeFreshStart').disabled = true;
  }
}

async function openSafetyBackupsFolder() {
  const response = await window.farmAPI.openSafetyBackups();
  if (!response?.success) showToast(response?.message || 'تعذر فتح مجلد نسخ الأمان', 'error');
}
