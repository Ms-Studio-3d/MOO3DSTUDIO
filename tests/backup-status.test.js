'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createBackupStatusStore } = require('../backup-status');
const { createAppHarness, sampleOrder } = require('./helpers/app-harness');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moo3d-backup-status-'));

function testStore() {
  const directory = path.join(root, 'store');
  const backup = path.join(root, 'verified-backup.json');
  fs.writeFileSync(backup, '{}');
  let store = createBackupStatusStore(directory);
  assert.equal(store.get().state, 'pending');
  store.start();
  assert.equal(store.get().state, 'running');
  store = createBackupStatusStore(directory);
  assert.equal(store.get().state, 'error', 'Interrupted attempt must not appear successful on restart');
  store.success(backup);
  const savedAt = store.get().lastSuccessAt;
  assert.ok(Number.isFinite(Date.parse(savedAt)));
  store.failure('Disk is full');
  assert.equal(store.get().lastSuccessAt, savedAt);
  store = createBackupStatusStore(directory);
  assert.equal(store.get().state, 'error');
  assert.equal(store.get().lastError, 'Disk is full');
  assert.equal(store.get().lastSuccessAt, savedAt);
  store.success(backup);
  assert.equal(store.get().lastError, null);
  assert.equal(createBackupStatusStore(directory).get().state, 'success');
  fs.unlinkSync(backup);
  assert.equal(store.get().state, 'error', 'Deleted backup must not leave a green status');
  fs.writeFileSync(path.join(directory, 'backup-status.json'), '{truncated');
  assert.equal(createBackupStatusStore(directory).get().state, 'error');

  const blocked = path.join(root, 'status-parent-is-a-file');
  fs.writeFileSync(blocked, 'blocked');
  const blockedStore = createBackupStatusStore(blocked);
  assert.doesNotThrow(() => blockedStore.failure('No permission'));
  assert.equal(blockedStore.get().state, 'error');
}

async function testActualBackup() {
  const h = createAppHarness(path.join(root, 'app'));
  const sale = sampleOrder(h.database);
  assert.equal((await h.farmAPI.createOrder(sale)).success, true);
  assert.equal((await h.farmAPI.getBackupStatus()).data.state, 'pending');
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const [first, concurrent] = await Promise.all([h.farmAPI.retryBackup(), h.farmAPI.retryBackup()]);
    assert.equal(first.success, true, first.message);
    assert.equal(concurrent.success, true, concurrent.message);
    assert.equal(first.data.lastSuccessPath, concurrent.data.lastSuccessPath, 'Concurrent retry must share one verified backup');
    const status = (await h.farmAPI.getBackupStatus()).data;
    const backup = JSON.parse(fs.readFileSync(status.lastSuccessPath, 'utf8'));
    h.validateBackupPayload(backup);
    assert.equal(backup.orders[0].code, sale.code);
    assert.equal(status.state, 'success');
    assert.equal(fs.readdirSync(path.dirname(status.lastSuccessPath)).filter((name) => name.endsWith('.json')).length, 1);

    const originalDocuments = h.appPaths.documents;
    const blocked = path.join(root, 'documents-is-a-file');
    fs.writeFileSync(blocked, 'blocked');
    h.appPaths.documents = blocked;
    const failed = await h.farmAPI.retryBackup();
    assert.equal(failed.success, false);
    const failureStatus = (await h.farmAPI.getBackupStatus()).data;
    assert.equal(failureStatus.state, 'error');
    assert.equal(failureStatus.lastSuccessAt, status.lastSuccessAt);
    assert.equal(h.database.getDashboardData().orders[0].finalPrice, sale.finalPrice);
    h.appPaths.documents = originalDocuments;
    assert.equal((await h.farmAPI.retryBackup()).success, true);
    assert.equal((await h.farmAPI.getBackupStatus()).data.lastError, null);
    assert.equal((await h.farmAPI.openAutomaticBackups()).success, true);
    assert.equal((await h.invoke('backup:getStatus', undefined, {})).success, false);

    const currentStatus = (await h.farmAPI.getBackupStatus()).data;
    assert.equal((await h.farmAPI.importBackup(backup)).success, true);
    assert.equal((await h.farmAPI.getBackupStatus()).data.lastSuccessAt, currentStatus.lastSuccessAt,
      'Restoring business data must not restore stale local backup status');
  } finally {
    clearInterval(keepAlive);
  }
}

async function testWorkerFailures() {
  class TimeoutWorker extends EventEmitter {
    constructor() { super(); TimeoutWorker.last = this; }
    terminate() { return Promise.resolve(); }
    unref() {}
  }
  const h = createAppHarness(path.join(root, 'timeout'), {
    workerClass: TimeoutWorker,
    timeout: (callback) => setTimeout(callback, 10)
  });
  assert.equal((await h.farmAPI.retryBackup()).success, false);
  assert.equal((await h.farmAPI.getBackupStatus()).data.state, 'error');
  TimeoutWorker.last.emit('message', { success: true, filePath: 'late-backup.json' });
  assert.equal((await h.farmAPI.getBackupStatus()).data.state, 'error', 'Late worker messages cannot overwrite timeout failure');
  assert.equal((await h.farmAPI.getBackupStatus()).data.lastSuccessAt, null);

  class ErrorWorker extends EventEmitter {
    constructor() { super(); queueMicrotask(() => this.emit('error', new Error('Worker failed'))); }
    unref() {}
  }
  const failed = createAppHarness(path.join(root, 'worker-error'), { workerClass: ErrorWorker });
  assert.equal((await failed.farmAPI.retryBackup()).success, false);
  assert.equal((await failed.farmAPI.getBackupStatus()).data.lastError, 'Worker failed');

  class ExitWorker extends EventEmitter {
    constructor() { super(); queueMicrotask(() => this.emit('exit', 0)); }
    unref() {}
  }
  const exited = createAppHarness(path.join(root, 'worker-exit'), { workerClass: ExitWorker });
  assert.equal((await exited.farmAPI.retryBackup()).success, false);
  assert.equal((await exited.farmAPI.getBackupStatus()).data.state, 'error');
}

async function testRenderer() {
  const fields = new Map();
  const element = (id) => {
    if (!fields.has(id)) fields.set(id, { textContent: '', dataset: {}, disabled: false, hidden: false });
    return fields.get(id);
  };
  const notices = [];
  let status = { state: 'pending', lastSuccessAt: null, lastError: null };
  const success = { state: 'success', lastSuccessAt: '2026-11-11T06:00:00.000Z', lastError: null };
  let retryCalls = 0;
  let finishRetry;
  const context = vm.createContext({
    $: element,
    setText: (id, value) => { element(id).textContent = value; },
    showToast: (...args) => notices.push(args),
    setInterval() {},
    window: { farmAPI: {
      getBackupStatus: async () => ({ success: true, data: status }),
      retryBackup: () => { retryCalls++; return new Promise((resolve) => { finishRetry = resolve; }); }
    } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/backup-status.js'), 'utf8'), context);
  await context.refreshBackupStatus();
  assert.equal(element('backupStatusChip').dataset.state, 'pending');
  status = { state: 'error', lastSuccessAt: null, lastFailureAt: '2026-11-11T07:00:00Z', lastError: '<b>Disk full</b>' };
  await context.refreshBackupStatus();
  await context.refreshBackupStatus();
  assert.equal(notices.length, 1, 'Polling must not repeat the same failure toast');
  assert.equal(element('backupErrorDetails').textContent, '<b>Disk full</b>', 'Errors must render as text');
  assert.equal(element('backupErrorBox').hidden, false);
  const retry = context.retryAutomaticBackup();
  await context.retryAutomaticBackup();
  assert.equal(retryCalls, 1);
  assert.equal(element('retryBackupButton').disabled, true);
  status = success;
  finishRetry({ success: true, data: success });
  await retry;
  assert.equal(element('backupStatusChip').dataset.state, 'success');
  assert.equal(element('retryBackupButton').disabled, false);
  assert.equal(element('backupErrorBox').hidden, true);
  assert.match(element('backupLastSuccess').textContent, /٢٠٢٦|2026/);
  const savedDate = element('backupLastSuccess').textContent;
  context.window.farmAPI.getBackupStatus = async () => ({ success: false, message: 'Status is unavailable' });
  await context.refreshBackupStatus();
  assert.equal(element('backupStatusChip').dataset.state, 'error');
  assert.equal(element('backupLastSuccess').textContent, savedDate);
  assert.equal(element('backupErrorDetails').textContent, 'Status is unavailable');
}

(async () => {
  testStore();
  await testActualBackup();
  await testWorkerFailures();
  await testRenderer();
  console.log('Backup status tests passed for persistence, native worker, failures, timeout, retry and renderer alerts.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
