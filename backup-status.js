'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createBackupStatusStore(directory) {
  const filename = path.join(directory, 'backup-status.json');
  const empty = { state: 'pending', lastSuccessAt: null, lastSuccessPath: null, lastFailureAt: null, lastError: null };
  let status = { ...empty };
  try {
    const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!['pending', 'running', 'success', 'error'].includes(saved.state)) throw new Error('Invalid backup status');
    for (const key of ['lastSuccessAt', 'lastFailureAt']) {
      if (saved[key] != null && (typeof saved[key] !== 'string' || !Number.isFinite(Date.parse(saved[key])))) {
        throw new Error('Invalid backup date');
      }
    }
    if (saved.lastSuccessPath != null && typeof saved.lastSuccessPath !== 'string') throw new Error('Invalid backup path');
    if (saved.state === 'success' && (!saved.lastSuccessAt || !saved.lastSuccessPath)) throw new Error('Incomplete backup status');
    if (saved.lastError != null && typeof saved.lastError !== 'string') throw new Error('Invalid backup error');
    status = { ...empty, ...saved };
    if (status.state === 'running') {
      status.state = 'error';
      status.lastError = 'محاولة النسخ السابقة لم تكتمل. احفظ نسخة جديدة.';
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      status.state = 'error';
      status.lastError = 'تعذر قراءة حالة النسخ السابقة. احفظ نسخة جديدة للتحقق.';
    }
  }

  function persist() {
    const temporary = filename + '.tmp';
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(status), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, filename);
    } catch (error) {
      console.warn('[BACKUP STATUS SAVE FAILED]', error.message);
      try { fs.unlinkSync(temporary); } catch (_) {}
    }
  }

  return {
    get() {
      const current = { ...status };
      if (current.state !== 'running' && current.lastSuccessPath && !fs.existsSync(current.lastSuccessPath)) {
        current.state = 'error';
        current.lastError = 'ملف آخر نسخة ناجحة غير موجود في مكانه. احفظ نسخة جديدة.';
      }
      return current;
    },
    start() {
      status.state = 'running';
      persist();
    },
    success(filePath) {
      status = { ...empty, state: 'success', lastSuccessAt: new Date().toISOString(), lastSuccessPath: filePath };
      persist();
    },
    failure(message) {
      status.state = 'error';
      status.lastFailureAt = new Date().toISOString();
      status.lastError = String(message || 'تعذر حفظ النسخة الاحتياطية.');
      persist();
    }
  };
}

module.exports = { createBackupStatusStore };
