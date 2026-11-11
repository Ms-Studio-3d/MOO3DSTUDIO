'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { orderControls, settingsControls, unreachableControls } = require('./release-scroll.cjs');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'moo3d-window-'));
for (const key of ['appData', 'documents']) {
  const folder = path.join(sandbox, key);
  fs.mkdirSync(folder);
  app.setPath(key, folder);
}
const packagedApp = process.env.MOO3D_SMOKE_APP;
if (packagedApp) Object.defineProperty(app, 'isPackaged', { value: true });
const timeout = setTimeout(() => { console.error('Electron window smoke timed out'); app.exit(1); }, 45000);
app.on('quit', () => {
  clearTimeout(timeout);
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_) {}
});

app.once('browser-window-created', (_event, window) => {
  window.maximize = () => {};
  window.show = () => {};
  const contents = window.webContents;
  const execute = (source) => contents.executeJavaScript(source);
  const messages = [];
  contents.on('console-message', (details) => { if (details.level === 'error') messages.push(details.message); });
  contents.once('did-fail-load', (_event, _code, description) => { console.error(description); app.exit(1); });
  contents.once('did-finish-load', async () => {
    let phase = 'first run and IPC';
    try {
      const waitFor = async (condition) => {
        const until = Date.now() + 8000;
        while (Date.now() < until) {
          if (await execute(condition)) return;
          await new Promise((resolve) => setTimeout(resolve, 75));
        }
        throw new Error('Renderer condition failed: ' + condition + '. ' + messages.join('\n'));
      };
      await waitFor("Boolean(window.farmAPI && document.querySelector('#firstRunGuide')?.open)");
      const data = await execute('farmAPI.getDashboardData()');
      assert.equal(data.success, true, data.message);
      assert.equal(data.data.printers.length, 0);
      assert.equal(data.data.materials.length, 0);
      assert.equal(typeof await execute('window.require'), 'undefined');
      phase = 'renderer security settings';
      const preferences = contents.getLastWebPreferences();
      assert.equal(preferences.sandbox, true, 'Renderer sandbox');
      assert.equal(preferences.contextIsolation, true, 'Renderer context isolation');
      assert.equal(preferences.nodeIntegration, false, 'Renderer Node integration');
      if (packagedApp) {
        contents.openDevTools({ mode: 'detach', activate: false });
        assert.equal(contents.devToolsWebContents, null, 'Packaged app must keep DevTools closed');
      }
      phase = 'content security policy';
      await execute([
        'window.inlineBlocked = false;',
        'document.addEventListener("securitypolicyviolation", () => { window.inlineBlocked = true; }, { once: true });',
        'const probe = document.createElement("script");',
        'probe.textContent = "window.inlineExecuted = true";',
        'void document.body.appendChild(probe);'
      ].join('\n'));
      await waitFor('window.inlineBlocked');
      assert.equal(await execute('Boolean(window.inlineExecuted)'), false);
      await execute("document.querySelector('[data-action-click=dismissFirstRunGuide]').click()");
      await waitFor("!document.querySelector('#firstRunGuide')?.open");
      phase = 'backup status and retry';
      await execute("document.querySelector('[data-view=settings]').click()");
      await execute("document.querySelector('[data-action-click=retryAutomaticBackup]').click()");
      await waitFor("document.querySelector('#backupStatusBadge').dataset.state === 'success'");
      assert.ok((await execute('farmAPI.getBackupStatus()')).data.lastSuccessAt);
      await execute("document.querySelector('#settingsModal [data-action-click=closeSettingsModal]').click()");
      phase = 'settings and dashboard navigation';
      await execute("setValue('profitMargin', '77'); calc(); document.querySelector('[data-view=settings]').click()");
      await waitFor("isModalOpen('settingsModal')");
      await execute("document.querySelector('#settingsModal [data-action-click=closeSettingsModal]').click()");
      assert.equal(await execute("getValue('profitMargin')"), '77');
      await execute("document.querySelector('[data-view=dashboard]').click()");
      await execute("document.querySelector('#businessDashboardModal [data-action-click=openReports]').click()");
      await waitFor("isModalOpen('reportsModal')");
      await execute("document.querySelector('#reportsModal [data-action-click=closeReports]').click()");
      await waitFor("isModalOpen('businessDashboardModal')");
      for (const [openAction, modal, closeAction] of [
        ['openDashboardPurchases', 'purchasesModal', 'closePurchasesModal'],
        ['openDashboardAssets', 'assetsModal', 'closeAssetsModal']
      ]) {
        await execute(`document.querySelector('#businessDashboardModal [data-action-click=${openAction}]').click()`);
        await waitFor(`isModalOpen('${modal}')`);
        await execute(`document.querySelector('#${modal} [data-action-click=${closeAction}]').click()`);
        await waitFor("isModalOpen('businessDashboardModal')");
      }
      await execute("document.querySelector('#businessDashboardModal [data-action-click=closeBusinessDashboard]').click()");

      phase = 'enable the order material picker';
      const material = await execute("farmAPI.saveMaterial({ name: 'Window smoke PLA', weight: 1000, remaining: 1000, price: 1000 })");
      assert.equal(material.success, true, material.message);
      await execute('loadDashboardData()');
      await waitFor("Boolean(document.querySelector('#materialUsagePicker:enabled option:not([value=\"\"])'))");

      phase = 'viewport setup';
      contents.debugger.attach('1.3');
      for (const [width, height] of [[850, 540], [1024, 600], [1200, 720], [1366, 768], [1920, 1080]]) {
        phase = width + 'x' + height + ' viewport';
        await contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await waitFor('innerWidth === ' + width + ' && innerHeight === ' + height);
        if (width === 850) {
          assert.deepEqual(await execute(`(${unreachableControls})(${JSON.stringify(orderControls)})`), [], 'Order inputs, totals and navigation reachable at minimum viewport');
        }
        const result = await execute([
          '(() => {',
          '  const action = document.querySelector("[data-action-click=saveSale]");',
          '  action.scrollIntoView({ block: "nearest", inline: "nearest" });',
          '  const r = action.getBoundingClientRect();',
          '  return r.width > 0 && r.height > 0 && r.top >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1;',
          '})()'
        ].join('\n'));
        assert.ok(result, 'Sale action reachable at ' + width + 'x' + height);
        await execute("document.querySelector('[data-view=settings]').click()");
        if (width === 850) {
          assert.deepEqual(await execute(`(${unreachableControls})(${JSON.stringify(settingsControls)})`), [], 'Settings reachable at minimum viewport');
        }
        const settings = await execute([
          '(() => {',
          '  const button = document.querySelector("[data-action-click=saveSettings]");',
          '  button.scrollIntoView({ block: "nearest", inline: "nearest" });',
          '  const r = button.getBoundingClientRect();',
          '  return r.width > 0 && r.height > 0 && r.top >= -1 && r.bottom <= innerHeight + 1;',
          '})()'
        ].join('\n'));
        assert.ok(settings, 'Settings save reachable at ' + width + 'x' + height);
        await execute("document.querySelector('#settingsModal [data-action-click=closeSettingsModal]').click()");
        console.log('Window controls reachable at ' + width + 'x' + height);
      }
      contents.debugger.detach();
      const unexpected = messages.filter((message) => !/Content Security Policy/.test(message));
      assert.deepEqual(unexpected, []);
      console.log('Electron window, isolated SQLite/IPC, CSP, settings, and dashboard return verified' + (packagedApp ? ' using app.asar.' : '.'));
      app.quit();
    } catch (error) {
      console.error('Electron smoke failed during ' + phase, error);
      if (process.env.GITHUB_ACTIONS === 'true') {
        const message = (phase + ': ' + error.message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
        console.log('::error title=Electron window smoke::' + message);
      }
      app.exit(1);
    }
  });
});

require(path.join(packagedApp || path.join(__dirname, '..'), 'main.js'));
