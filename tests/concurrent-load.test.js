const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = [
  fs.readFileSync(path.join(root, 'js/state.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'js/dashboard.js'), 'utf8'),
  `
  const assert = globalThis.__assert;

  function createControlledFarmAPI() {
    const calls = [];
    return {
      calls,
      api: {
        getDataPage(entity, args) {
          return new Promise((resolve, reject) => {
            calls.push({ entity, args, resolve, reject });
          });
        }
      }
    };
  }

  async function settleMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
  }

  async function testOrdersConcurrentSearch() {
    const controller = createControlledFarmAPI();
    window.farmAPI = controller.api;

    const oldRequest = loadOrdersForView('reports', { search: 'old' }, 100);
    await settleMicrotasks();

    assert.equal(controller.calls.length, 1, 'first orders request should start');
    assert.equal(controller.calls[0].args.filters.search, 'old');
    assert.equal(orderQueryViews.reports.loading, true, 'orders loading should be true while first request is pending');

    const newRequest = loadOrdersForView('reports', { search: 'new' }, 100);
    await settleMicrotasks();

    assert.equal(controller.calls.length, 2, 'new orders request should start even while the old one is pending');
    assert.equal(controller.calls[1].args.filters.search, 'new');
    assert.equal(orderQueryViews.reports.loading, true, 'orders loading should remain true while latest request is pending');

    controller.calls[0].resolve({
      success: true,
      data: {
        items: [{ code: 'OLD-ORDER', date: '2026-01-01', itemName: 'Old item' }],
        total: 1,
        limit: 100,
        offset: 0,
        hasMore: false,
        summary: { count: 1 }
      }
    });
    await oldRequest;

    assert.equal(orderQueryViews.reports.loading, true, 'stale orders request must not clear loading for the latest request');
    assert.deepEqual(orderQueryViews.reports.items, [], 'stale orders response must not overwrite the current result set');
    assert.equal(dashboardData.orders.some((order) => order.code === 'OLD-ORDER'), false, 'stale orders response must not enter the cache');

    controller.calls[1].resolve({
      success: true,
      data: {
        items: [{ code: 'NEW-ORDER', date: '2026-01-02', itemName: 'New item' }],
        total: 1,
        limit: 100,
        offset: 0,
        hasMore: false,
        summary: { count: 1 }
      }
    });
    const latestState = await newRequest;

    assert.equal(latestState.loading, false, 'orders loading should be false after the latest request finishes');
    assert.deepEqual(latestState.items.map((order) => order.code), ['NEW-ORDER'], 'only the latest orders response should be rendered');
    assert.equal(latestState.filtersKey, JSON.stringify({ search: 'new' }));
    assert.equal(dashboardData.orders.some((order) => order.code === 'NEW-ORDER'), true, 'latest orders response should enter the cache');
  }

  async function testCustomersConcurrentSearch() {
    const controller = createControlledFarmAPI();
    window.farmAPI = controller.api;

    const oldRequest = loadCustomersForView({ search: 'old' }, 100);
    await settleMicrotasks();

    assert.equal(controller.calls.length, 1, 'first customers request should start');
    assert.equal(controller.calls[0].entity, 'customers');
    assert.equal(controller.calls[0].args.filters.search, 'old');
    assert.equal(customersQueryView.loading, true, 'customers loading should be true while first request is pending');

    const newRequest = loadCustomersForView({ search: 'new' }, 100);
    await settleMicrotasks();

    assert.equal(controller.calls.length, 2, 'new customers request should start even while the old one is pending');
    assert.equal(controller.calls[1].entity, 'customers');
    assert.equal(controller.calls[1].args.filters.search, 'new');

    controller.calls[0].resolve({
      success: true,
      data: {
        items: [{ name: 'Old Customer', count: 1, revenue: 10, profit: 3 }],
        total: 1,
        limit: 100,
        offset: 0,
        hasMore: false,
        summary: { customersCount: 1 }
      }
    });
    await oldRequest;

    assert.equal(customersQueryView.loading, true, 'stale customers request must not clear loading for the latest request');
    assert.deepEqual(customersQueryView.items, [], 'stale customers response must not overwrite the current result set');

    controller.calls[1].resolve({
      success: true,
      data: {
        items: [{ name: 'New Customer', count: 2, revenue: 50, profit: 20 }],
        total: 1,
        limit: 100,
        offset: 0,
        hasMore: false,
        summary: { customersCount: 1 }
      }
    });
    const latestState = await newRequest;

    assert.equal(latestState.loading, false, 'customers loading should be false after the latest request finishes');
    assert.deepEqual(latestState.items.map((customer) => customer.name), ['New Customer'], 'only the latest customers response should be rendered');
    assert.equal(latestState.filtersKey, JSON.stringify({ search: 'new' }));
  }

  async function testLatestFailureStillClearsLoading() {
    const controller = createControlledFarmAPI();
    window.farmAPI = controller.api;
    orderQueryViews.reports = { filtersKey: '', items: [], meta: {}, summary: null, loading: false, requestId: 0 };

    const request = loadOrdersForView('reports', { search: 'fail' }, 100);
    await settleMicrotasks();
    assert.equal(orderQueryViews.reports.loading, true, 'loading should be true while failing latest request is pending');

    controller.calls[0].resolve({ success: false, message: 'forced failure' });
    const state = await request;

    assert.equal(state.loading, false, 'latest failed request should also clear loading');
    assert.equal(toastMessages.some((toast) => toast[0] === 'forced failure' && toast[1] === 'error'), true, 'failure should be reported');
  }

  (async () => {
    await testOrdersConcurrentSearch();
    await testCustomersConcurrentSearch();
    await testLatestFailureStillClearsLoading();
  })();
  `
].join('\n\n');

const toastMessages = [];

const context = vm.createContext({
  console,
  window: {},
  document: { title: '' },
  setTimeout,
  clearTimeout,
  __assert: assert,
  toastMessages,
  showToast(message, type) {
    toastMessages.push([message, type]);
  }
});

const result = vm.runInContext(source, context, { filename: 'concurrent-load.vm.js' });
Promise.resolve(result)
  .then(() => {
    console.log('Concurrent load tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
