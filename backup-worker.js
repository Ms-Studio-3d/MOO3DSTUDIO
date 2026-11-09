'use strict';
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

async function pruneOldBackups(dir, keep = 10) {
  const backups = [];
  for (const name of await fs.readdir(dir)) {
    if (!/^moo3d-backup-.*\.json$/i.test(name)) continue;
    const fullPath = path.join(dir, name);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) backups.push({ fullPath, time: stat.mtimeMs });
    } catch (_) {}
  }
  await Promise.all(backups.sort((a, b) => b.time - a.time).slice(keep)
    .map((file) => fs.unlink(file.fullPath).catch(() => {})));
}

async function main() {
  const dbPath = String(workerData?.dbPath || '').trim();
  const backupsDir = String(workerData?.backupsDir || '').trim();
  const reason = String(workerData?.reason || 'auto').replace(/[^a-z0-9_-]/gi, '').slice(0, 20) || 'auto';
  if (!dbPath || !backupsDir) throw new Error('Database path and backup directory are required');
  process.env.MOO3D_DB_PATH = dbPath;
  const { getDb, exportBackupData } = require('./database');
  const db = getDb({ readonly: true });
  let snapshot;
  try {
    // All tables are read from one consistent SQLite snapshot. No seeds or migrations.
    db.exec('BEGIN');
    snapshot = exportBackupData();
    db.exec('COMMIT');
  } finally { db.close(); }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(backupsDir, `moo3d-backup-${reason}-${stamp}-${crypto.randomUUID()}.json`);
  const temporary = `${filePath}.tmp`;
  await fs.mkdir(backupsDir, { recursive: true });
  let handle;
  try {
    const text = JSON.stringify(snapshot, null, 2);
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    if (await fs.readFile(temporary, 'utf8') !== text) throw new Error('Backup verification failed');
    await fs.rename(temporary, filePath);
    // A cleanup error must never discard an otherwise valid backup.
    await pruneOldBackups(backupsDir, 10).catch(() => {});
    parentPort.postMessage({ success: true, filePath });
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}
main().catch((error) => parentPort.postMessage({ success: false, message: error?.message || String(error) }));
