'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { _electron: electron } = require(process.env.MOO3D_PLAYWRIGHT || 'playwright-core');
const { orderControls, settingsControls, editControls, unreachableControls } = require('./release-scroll.cjs');

async function run() {
  assert.ok(process.argv[2], 'Pass the installed MOO3D Farm executable');
  const executablePath = path.resolve(process.argv[2]);
  const expectedVersion = require('../package.json').version;
  const app = await electron.launch({ executablePath, timeout: 30_000 });
  try {
    const identity = await app.evaluate(({ app }) => ({
      executable: process.execPath, packaged: app.isPackaged, version: app.getVersion()
    }));
    assert.deepEqual(identity, { executable: executablePath, packaged: true, version: expectedVersion });
    const page = await app.firstWindow({ timeout: 15_000 });
    page.setDefaultTimeout(8000);
    const window = await app.browserWindow(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const initial = await page.evaluate(async () => window.farmAPI.getDashboardData());
    assert.equal(initial.success, true, initial.message);
    for (const key of ['orders', 'materials', 'printers', 'purchases']) assert.deepEqual(initial.data[key], [], key);
    await page.locator('#firstRunGuide[open]')
      .getByRole('button', { name: 'ابدأ لاحقًا', exact: true }).click();
    console.log('PASS installed executable started in a clean profile');

    const security = await window.evaluate(async (win) => {
      const contents = win.webContents;
      const { sandbox, contextIsolation, nodeIntegration } = contents.getLastWebPreferences();
      const initiallyOpen = contents.isDevToolsOpened();
      contents.openDevTools({ mode: 'detach', activate: false });
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { sandbox, contextIsolation, nodeIntegration, initiallyOpen,
        opened: contents.isDevToolsOpened(), devToolsWindow: Boolean(contents.devToolsWebContents) };
    });
    assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false,
      initiallyOpen: false, opened: false, devToolsWindow: false });
    console.log('PASS installed app keeps DevTools disabled and renderer sandbox enabled');

    const setup = await page.evaluate(async () => {
      const printer = await window.farmAPI.savePrinter({ name: 'Release test printer', hourlyDepreciation: 10 });
      if (!printer.success) return printer;
      const material = await window.farmAPI.saveMaterial({ name: 'Release test PLA', weight: 1000, remaining: 1000, price: 1000 });
      if (!material.success) return material;
      await loadDashboardData();
      return { success: true, printerId: String(dashboardData.printers[0].id), materialId: String(dashboardData.materials[0].id) };
    });
    assert.equal(setup.success, true, setup.message);
    assert.ok(await page.locator('#materialUsagePicker').isEnabled(), 'The test material enables the order picker');

    const viewport = await window.evaluate(async (win) => {
      if (win.isMaximized()) {
        await new Promise((resolve) => { win.once('unmaximize', resolve); win.unmaximize(); });
      }
      win.setSize(850, 540);
      return { windowSize: win.getSize(), contentSize: win.getContentSize() };
    });
    assert.deepEqual(viewport.windowSize, [850, 540]);
    await page.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height, viewport.contentSize);
    assert.deepEqual(await page.evaluate(unreachableControls, orderControls), [], 'Order screen controls');
    await page.locator('[data-view="settings"]').click();
    assert.deepEqual(await page.evaluate(unreachableControls, settingsControls), [], 'Settings controls');
    await page.locator('#settingsModal [data-action-click="closeSettingsModal"]').click();

    const itemName = 'Release installer smoke';
    await page.locator('#itemName').fill(itemName);
    await page.locator('#selectedPrinter').selectOption(setup.printerId);
    await page.locator('#printHours').fill('1');
    await page.locator('#materialUsagePicker').selectOption(setup.materialId);
    await page.locator('.ams-weight').fill('20');
    await page.locator('#wasteWeight').fill('5');
    await page.locator('[data-action-click="saveSale"]').click();
    await page.locator('#saleConfirmDialog[open] button[value="confirm"]').click();
    await page.waitForFunction((name) => dashboardData.orders.some((order) => order.itemName === name), itemName);

    const database = await app.evaluate(({ app }, { itemName, materialId }) => {
      const path = process.getBuiltinModule('node:path');
      const fs = process.getBuiltinModule('node:fs');
      const appPath = app.getAppPath();
      const load = process.getBuiltinModule('node:module').createRequire(path.join(appPath, 'package.json'));
      const db = load('./database.js').getDb();
      const binding = Object.keys(load.cache).find((file) => file.startsWith(appPath + path.sep)
        && file.includes(`${path.sep}better-sqlite3${path.sep}`) && file.endsWith('.node'));
      const installedBinding = binding && binding.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
      return {
        driver: db instanceof load('better-sqlite3'),
        binding: installedBinding && path.relative(process.resourcesPath, installedBinding),
        bindingExists: Boolean(installedBinding && fs.existsSync(installedBinding)),
        order: db.prepare('SELECT order_status AS status, paid_amount AS paid, final_price AS price, waste_weight AS waste FROM orders WHERE item_name = ?').get(itemName),
        stock: db.prepare('SELECT remaining FROM materials WHERE id = ?').get(Number(materialId)).remaining
      };
    }, { itemName, materialId: setup.materialId });
    assert.equal(database.driver, true);
    assert.equal(database.bindingExists, true);
    assert.match(database.binding, /^app\.asar\.unpacked[\\/].*better-sqlite3[\\/].*\.node$/i);
    assert.equal(database.order.status, 'delivered');
    assert.ok(database.order.price > 0);
    assert.equal(database.order.paid, database.order.price);
    assert.equal(database.order.waste, 5);
    assert.equal(database.stock, 975);
    console.log(`PASS installed better-sqlite3 (${database.binding}) saved a paid order and deducted 25g`);

    await page.locator('[data-view="sales"]').click();
    const row = page.locator('#salesTableBody tr').filter({ hasText: itemName });
    const edit = row.locator('[data-action-click="openEditSale"]');
    await edit.waitFor();
    const tableControls = ['#salesTableBody tr td:first-child', '#salesTableBody tr td:nth-child(9)',
      '#salesTableBody [data-action-click="openEditSale"]', '#salesTableBody [data-action-click="deleteSale"]'];
    assert.deepEqual(await page.evaluate(unreachableControls, tableControls), [], 'Sales table columns and actions');
    await edit.click();
    await page.locator('#editWasteWeight').waitFor();
    assert.deepEqual(await page.evaluate(unreachableControls, editControls), [], 'Order edit controls');
    assert.equal(Number(await page.locator('#editWasteWeight').inputValue()), 5);
    assert.deepEqual(errors, []);
    console.log(`PASS scroll at 850x540 window (${viewport.contentSize.join('x')} viewport) on order, settings, sales, and edit`);
  } finally {
    await app.close();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
