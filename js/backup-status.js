'use strict';

let currentBackupStatus = null;
let backupStatusLoading = false;
let backupRetryPending = false;
let lastBackupFailureNotice = null;

function renderBackupStatus(status) {
  currentBackupStatus = status;
  const state = backupRetryPending ? 'running' : status.state;
  const labels = {
    pending: 'بانتظار أول نسخة تلقائية',
    running: 'جارٍ حفظ نسخة احتياطية',
    success: 'النسخ الاحتياطي ناجح',
    error: 'النسخ الاحتياطي يحتاج مراجعة'
  };
  const label = labels[state] || labels.pending;
  const date = status.lastSuccessAt
    ? new Date(status.lastSuccessAt).toLocaleString('ar-EG')
    : 'لم تُسجّل نسخة ناجحة بعد';
  for (const id of ['backupStatusChip', 'backupStatusBadge']) {
    const element = $(id);
    if (!element) continue;
    element.textContent = label;
    element.dataset.state = state;
    element.title = 'آخر نسخة تلقائية ناجحة: ' + date;
  }
  setText('backupLastSuccess', date);
  setText('backupStatusMessage', state === 'error'
    ? 'تعذر تأكيد النسخ الاحتياطي. راجع مساحة القرص ومجلد النسخ، ثم اضغط «حفظ نسخة الآن».'
    : 'تُحفظ النسخ التلقائية بعد التعديلات وعند إغلاق البرنامج.');
  setText('backupErrorDetails', status.lastError || '');
  if ($('backupErrorBox')) $('backupErrorBox').hidden = state !== 'error';
  if ($('retryBackupButton')) {
    $('retryBackupButton').disabled = state === 'running';
    $('retryBackupButton').textContent = state === 'running' ? 'جارٍ الحفظ…' : 'حفظ نسخة الآن';
  }
}

async function refreshBackupStatus() {
  if (backupStatusLoading) return;
  backupStatusLoading = true;
  try {
    const response = await window.farmAPI.getBackupStatus();
    const status = response?.success ? response.data : {
      ...currentBackupStatus,
      state: 'error',
      lastError: response?.message || 'تعذر قراءة حالة النسخ الاحتياطي.'
    };
    renderBackupStatus(status);
    if (status.state === 'error') {
      const failure = JSON.stringify([status.lastFailureAt, status.lastSuccessAt, status.lastError]);
      if (failure !== lastBackupFailureNotice) {
        lastBackupFailureNotice = failure;
        showToast('تعذر حفظ النسخة الاحتياطية. افتح الإعدادات وراجع حالة النسخ.', 'error');
      }
    } else if (status.state === 'success') {
      lastBackupFailureNotice = null;
    }
  } finally {
    backupStatusLoading = false;
  }
}

async function retryAutomaticBackup() {
  if (backupRetryPending) return;
  backupRetryPending = true;
  renderBackupStatus(currentBackupStatus || { state: 'pending' });
  try {
    const response = await window.farmAPI.retryBackup();
    if (response?.success) showToast('تم حفظ نسخة احتياطية مؤكدة بنجاح');
    else showToast(response?.message || 'تعذر حفظ النسخة الاحتياطية', 'error');
  } finally {
    backupRetryPending = false;
    await refreshBackupStatus();
  }
}

async function openAutomaticBackupsFolder() {
  const response = await window.farmAPI.openAutomaticBackups();
  if (!response?.success) showToast(response?.message || 'تعذر فتح مجلد النسخ التلقائية', 'error');
}

function initializeBackupStatus() {
  refreshBackupStatus();
  setInterval(refreshBackupStatus, 5000);
}
