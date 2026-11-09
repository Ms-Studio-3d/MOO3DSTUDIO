'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/** Atomic, verified JSON snapshot. Protected backups are NEVER included in auto-pruning. */
function writeVerifiedBackup(data, directory, reason, validate) {
  if (typeof validate !== 'function') throw new Error('Backup validation is required');
  validate(data);
  const text = JSON.stringify(data, null, 2);
  const safeReason = String(reason || 'safety').replace(/[^a-z0-9_-]/gi, '').slice(0, 30);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `moo3d-protected-${safeReason}-${stamp}-${crypto.randomUUID()}.json`);
  const temporary = `${target}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    const saved = fs.readFileSync(temporary, 'utf8');
    if (saved !== text) throw new Error('النسخة الاحتياطية المكتوبة لا تطابق البيانات الحالية');
    validate(JSON.parse(saved));
    fs.renameSync(temporary, target);
    return target;
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw new Error(`لم تُحفظ نسخة الأمان؛ العملية أُوقفت وبياناتك لم تُمسح. ${error.message}`);
  }
}
module.exports = { writeVerifiedBackup };
