'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Worker } = require('node:worker_threads');
const { createAppHarness, sampleOrder } = require('./helpers/app-harness');
const { createBackupStatusStore } = require('../backup-status');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moo3d-shutdown-backup-'));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// The first real worker finishes its file before the parent receives the result.
// This controls the race without changing the worker's SQLite snapshot or JSON.
function heldWorker({ failFirst = false } = {}) {
  const firstResult = deferred();
  const instances = [];
  class HeldWorker extends EventEmitter {
    constructor(filename, options) {
      super();
      this.first = instances.length === 0;
      this.held = this.first;
      this.events = [];
      this.reason = options.workerData.reason;
      instances.push(this);
      if (this.first && failFirst) {
        const blocked = path.join(root, `blocked-${instances.length}-${Date.now()}`);
        fs.writeFileSync(blocked, 'not a directory');
        options = { ...options, workerData: { ...options.workerData, backupsDir: blocked } };
      }
      this.worker = new Worker(filename, options);
      for (const event of ['message', 'error', 'exit']) {
        this.worker.on(event, (value) => {
          if (this.held) this.events.push([event, value]);
          else this.emit(event, value);
          if (this.first && event === 'message') firstResult.resolve(value);
          if (this.first && event === 'error') firstResult.reject(value);
        });
      }
    }
    release() {
      this.held = false;
      for (const [event, value] of this.events.splice(0)) this.emit(event, value);
    }
    terminate() { return this.worker.terminate(); }
    unref() {} // Keep the test alive until the real worker completes.
  }
  return { Worker: HeldWorker, firstResult: firstResult.promise, instances };
}

function snapshot(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function status(h) { return createBackupStatusStore(h.appPaths.userData).get(); }

async function testStaleInFlightBackup() {
  const held = heldWorker();
  const h = createAppHarness(path.join(root, 'in-flight'), { workerClass: held.Worker, timeout: setTimeout });
  const initial = h.farmAPI.retryBackup();
  const first = await held.firstResult;
  assert.equal(first.success, true, first.message);
  assert.equal(snapshot(first.filePath).orders.length, 0);
  const order = sampleOrder(h.database);
  assert.equal((await h.farmAPI.createOrder(order)).success, true);
  assert.equal(h.database.getDashboardData().orders.length, 1);
  const closed = h.closeApp();
  assert.equal(h.requestQuit(), true, 'A second quit request must wait for the final snapshot too');
  assert.equal(h.quitCalls, 0);
  const rejected = await h.farmAPI.createOrder(sampleOrder(h.database));
  assert.equal(rejected.success, false, 'New writes must be rejected once shutdown begins');
  assert.equal(h.database.getDashboardData().orders.length, 1);
  assert.equal((await h.farmAPI.getBackupStatus()).success, true);
  held.instances[0].release();
  await Promise.all([initial, closed]);
  const saved = status(h);
  const final = snapshot(saved.lastSuccessPath);
  assert.equal(final.orders.length, 1, 'Shutdown must save the order committed after the earlier snapshot');
  assert.equal(final.orders[0].code, order.code);
  assert.equal(final.materials[0].remaining, 900);
  assert.notEqual(saved.lastSuccessPath, first.filePath);
  assert.equal(held.instances.length, 2);
  assert.equal(held.instances[1].reason, 'shutdown');
  assert.equal(saved.state, 'success');
  assert.equal(h.quitCalls, 1);
  h.validateBackupPayload(final);
}

async function testWithoutActiveBackup() {
  const h = createAppHarness(path.join(root, 'no-active'), { timeout: setTimeout });
  assert.equal((await h.farmAPI.createOrder(sampleOrder(h.database))).success, true);
  await h.closeApp();
  const saved = status(h);
  assert.equal(saved.state, 'success');
  assert.match(path.basename(saved.lastSuccessPath), /^moo3d-backup-shutdown-/);
  assert.equal(snapshot(saved.lastSuccessPath).orders.length, 1);
  assert.equal(h.quitCalls, 1);
}

async function testEarlierFailure() {
  const held = heldWorker({ failFirst: true });
  const h = createAppHarness(path.join(root, 'earlier-failure'), { workerClass: held.Worker, timeout: setTimeout });
  const initial = h.farmAPI.retryBackup();
  assert.equal((await held.firstResult).success, false);
  assert.equal((await h.farmAPI.createOrder(sampleOrder(h.database))).success, true);
  const closed = h.closeApp();
  held.instances[0].release();
  assert.equal((await initial).success, false);
  await closed;
  assert.equal(status(h).state, 'success', 'Failure of an older attempt must not prevent a fresh shutdown backup');
  assert.equal(snapshot(status(h).lastSuccessPath).orders.length, 1);
  assert.equal(held.instances.length, 2);
}

async function testShutdownDeadline() {
  const held = heldWorker();
  const timers = [];
  const h = createAppHarness(path.join(root, 'deadline'), {
    workerClass: held.Worker,
    timeout: (callback, delay) => {
      const timer = setTimeout(callback, 60_000);
      timers.push({ callback, delay, timer });
      return timer;
    }
  });
  const initial = h.farmAPI.retryBackup();
  assert.equal((await held.firstResult).success, true);
  assert.equal((await h.farmAPI.createOrder(sampleOrder(h.database))).success, true);
  const closed = h.closeApp();
  const deadline = timers.find((entry) => entry.delay === 35_000);
  assert.ok(deadline, 'Shutdown must have a bounded overall deadline');
  deadline.callback();
  await closed;
  const failed = status(h);
  assert.equal(failed.state, 'error');
  held.instances[0].release();
  await initial;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status(h).state, 'error', 'A late older success must not erase an incomplete-shutdown warning');
  assert.equal(status(h).lastError, failed.lastError);
  assert.equal(status(h).lastSuccessPath, null);
  assert.equal(held.instances.length, 1, 'Do not start another worker after the app has quit');
  assert.equal(h.quitCalls, 1);
  for (const entry of timers) clearTimeout(entry.timer);
}

async function testFinalWorkerFailure() {
  const h = createAppHarness(path.join(root, 'final-failure'), { timeout: setTimeout });
  assert.equal((await h.farmAPI.createOrder(sampleOrder(h.database))).success, true);
  assert.equal((await h.farmAPI.retryBackup()).success, true);
  const previous = status(h);
  const blocked = path.join(root, 'blocked-documents');
  fs.writeFileSync(blocked, 'not a directory');
  h.appPaths.documents = blocked;
  await h.closeApp();
  assert.equal(status(h).state, 'error');
  assert.equal(status(h).lastSuccessPath, previous.lastSuccessPath);
  assert.equal(h.database.getDashboardData().orders.length, 1);
  assert.equal(h.quitCalls, 1);
}

async function testAcceptedAsyncOperation() {
  const entered = deferred();
  const proceed = deferred();
  const held = heldWorker();
  const h = createAppHarness(path.join(root, 'pending-reset'), {
    workerClass: held.Worker, timeout: setTimeout,
    trackingModule: {
      prepareTrackingReset: async () => { entered.resolve(); await proceed.promise; return async () => {}; }
    }
  });
  assert.equal((await h.farmAPI.createOrder(sampleOrder(h.database))).success, true);
  const reset = h.farmAPI.resetBusinessData({ confirmation: 'بداية جديدة', confirmed: true, factoryReset: true });
  await entered.promise;
  const closed = h.closeApp();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(held.instances.length, 0, 'Final snapshot must wait for an already accepted asynchronous mutation');
  proceed.resolve();
  assert.equal((await reset).success, true);
  const result = await held.firstResult;
  assert.equal(result.success, true, result.message);
  assert.equal(snapshot(result.filePath).orders.length, 0);
  assert.equal(snapshot(result.filePath).materials.length, 0);
  held.instances[0].release();
  await closed;
  assert.equal(status(h).state, 'success');
  assert.equal(held.instances.length, 1, 'Do not schedule extra automatic backups during shutdown');
  const protectedFiles = fs.readdirSync(path.join(h.documents, 'MOO3DSTUDIO/Backups/Protected'));
  const protectedJson = protectedFiles.find((name) => name.endsWith('.json'));
  assert.equal(snapshot(path.join(h.documents, 'MOO3DSTUDIO/Backups/Protected', protectedJson)).orders.length, 1);
}

(async () => {
  for (const test of [testStaleInFlightBackup, testWithoutActiveBackup, testEarlierFailure,
    testShutdownDeadline, testFinalWorkerFailure, testAcceptedAsyncOperation]) {
    await test();
    console.log(`PASS ${test.name}`);
  }
  console.log('Six shutdown backup regressions passed with real workers and temporary databases.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
