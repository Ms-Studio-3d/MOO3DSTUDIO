'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

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
  contents.on('console-message', (_event, details) => { if (details.level === 'error') messages.push(details.message); });
  contents.once('did-fail-load', (_event, _code, description) => { console.error(description); app.exit(1); });
  contents.once('did-finish-load', async () => {
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
      assert.equal(typeof await execute('window.require'), 'undefined');
      const preferences = contents.getLastWebPreferences();
      assert.equal(preferences.sandbox, true);
      assert.equal(preferences.contextIsolation, true);
      assert.equal(preferences.devTools, !packagedApp);
      await execute([
        'window.inlineBlocked = false;',
        'document.addEventListener("securitypolicyviolation", () => { window.inlineBlocked = true; }, { once: true });',
        'const probe = document.createElement("script");',
        'probe.textContent = "window.inlineExecuted = true";',
        'document.body.appendChild(probe);'
      ].join('\n'));
      await waitFor('window.inlineBlocked');
      assert.equal(await execute('Boolean(window.inlineExecuted)'), false);
      await execute("document.querySelector('[data-action-click=dismissFirstRunGuide]').click()");
      await waitFor("!document.querySelector('#firstRunGuide')?.open");
      await execute("setValue('profitMargin', '77'); calc(); document.querySelector('[data-view=settings]').click()");
      await waitFor("isModalOpen('settingsModal')");
      await execute("document.querySelector('#settingsModal [data-action-click=closeSettingsModal]').click()");
      assert.equal(await execute("getValue('profitMargin')"), '77');
      await execute("document.querySelector('[data-view=dashboard]').click()");
      await execute("document.querySelector('#businessDashboardModal [data-action-click=openReports]').click()");
      await waitFor("isModalOpen('reportsModal')");
      await execute("document.querySelector('#reportsModal [data-action-click=closeReports]').click()");
      await waitFor("isModalOpen('businessDashboardModal')");
      await execute("document.querySelector('#businessDashboardModal [data-action-click=closeBusinessDashboard]').click()");

      contents.debugger.attach('1.3');
      for (const [width, height] of [[1024, 600], [1200, 720], [1366, 768], [1920, 1080]]) {
        await contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await waitFor('innerWidth === ' + width + ' && innerHeight === ' + height);
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
      console.error(error);
      app.exit(1);
    }
  });
});

require(path.join(packagedApp || path.join(__dirname, '..'), 'main.js'));
