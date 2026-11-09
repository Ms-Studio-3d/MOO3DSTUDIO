from pathlib import Path
from playwright.sync_api import sync_playwright
import subprocess, tempfile, json, time, shutil, os
import urllib.request, re
root=Path(__file__).resolve().parent.parent
out=root/'docs/test-results/browser-screenshots';out.mkdir(parents=True,exist_ok=True)
tmp=tempfile.mkdtemp(prefix='moo3d-browser-')
log=open(root/'docs/test-results/browser-server.log','w')
server=subprocess.Popen(['node',str(root/'tests/browser-bridge.cjs'),tmp],stdout=subprocess.PIPE,stderr=log,text=True)
info=json.loads(server.stdout.readline())
print('Browser test: actual UI + preload/main + temporary SQLite; OS dialogs mocked.',flush=True)
checks=[]
def passed(s): checks.append(s);print('PASS:',s,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1366,'height':768})
  page.set_default_timeout(5000)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def rpc(source, method, args):
   request=urllib.request.Request(f'http://127.0.0.1:{info["port"]}/test-api/{method}', data=json.dumps(args).encode(), headers={'Content-Type':'application/json','X-Test-Token':info['token']},method='POST')
   with urllib.request.urlopen(request,timeout=5) as response:return json.load(response)
  page.expose_binding('__mooTestCall', rpc)
  bridge_script='window.farmAPI = Object.fromEntries('+json.dumps(info['methods'])+'.map(name => [name, (...args) => window.__mooTestCall(name, args)]));'
  page.evaluate(bridge_script)
  source=(root/'index.html').read_text()
  source=re.sub(r'<script src="([^"]+)"\s*></script>',lambda m:'<script>'+ (root/m.group(1)).read_text() +'</script>',source)
  source=re.sub(r'<link[^>]*href="style.css"[^>]*>', lambda m:'<style>'+(root/'style.css').read_text()+'</style>',source)
  page.set_content(source)
  page.wait_for_function("typeof dashboardData !== 'undefined' && dashboardData.materials.length === 4 && !!getValue('selectedPrinter')")
  page.locator('#itemName').fill('مجسم اختبار الواجهة')
  page.locator('#customerName').fill('عميل تجريبي')
  page.locator('#printHours').fill('2')
  mid=page.evaluate('String(dashboardData.materials[0].id)')
  page.locator('#materialUsagePicker').select_option(mid)
  page.locator('.ams-weight').fill('100')
  page.locator('#printHours').blur()
  page.wait_for_timeout(300)
  saved_price=page.evaluate('currentCalc.finalPrice')
  page.locator('button[onclick="saveSale()"]').click()
  page.wait_for_function('dashboardData.orders.length === 1')
  page.wait_for_function('savingOrder === false')
  assert page.evaluate('(dashboardData.materials.find(m => String(m.id) === '+json.dumps(mid)+')).remaining')==900
  assert page.evaluate('getBusinessMetrics().totalSales')==saved_price
  original=page.evaluate('JSON.parse(JSON.stringify(dashboardData.orders[0]))')
  backup=page.evaluate('async () => (await farmAPI.exportBackup()).data')
  passed('Actual sale button persists sale, consumes 100g and refreshes dashboard totals')
  page.locator('.nav-btn[data-view="sales"]').click()
  page.locator('#salesTableBody .action-btn.edit').first.click()
  page.wait_for_function("isModalOpen('editModal')")
  page.locator('#editCustomerName').fill('تم تعديل العميل بنجاح')
  page.screenshot(path=str(out/'edit-sale.png'),full_page=True)
  page.locator('#editModal button[onclick="saveEditSale()"]').click()
  page.wait_for_function("!isModalOpen('editModal') && dashboardData.orders[0].customerName === 'تم تعديل العميل بنجاح'")
  after=page.evaluate('JSON.parse(JSON.stringify(dashboardData.orders[0]))')
  for key in ['finalPrice','totalCost','profit','depreciationCost','discountValue','roundedAdjustment','printHours']:
   assert after[key]==original[key],(key,after[key],original[key])
  assert page.evaluate('(dashboardData.materials.find(m => String(m.id) === '+json.dumps(mid)+')).remaining')==900
  passed('Report edit button and save button work without changing historical prices or consuming stock')
  page.locator('#salesTableBody .action-btn.edit').first.click()
  page.locator('#editItemName').fill('')
  page.locator('#editModal button[onclick="saveEditSale()"]').click()
  page.locator('#toastMsg.error').wait_for(state='visible')
  assert page.evaluate("Number(getComputedStyle(document.getElementById('toastMsg')).zIndex) > Number(getComputedStyle(document.getElementById('editModal')).zIndex)")
  passed('Validation errors remain visible over sales/edit panels')
  page.locator('#editModal button[onclick="closeModal(\'editModal\')"]').click()
  page.locator('#salesTableBody button',has_text='فاتورة').first.click()
  text=page.locator('#invoiceContent').inner_text()
  assert 'صافي الربح الداخلي' not in text and 'تفاصيل التكلفة' not in text
  page.screenshot(path=str(out/'customer-invoice.png'),full_page=True)
  passed('Customer invoice excludes internal costs and profits')
  page.locator('#invoiceModal button[onclick="closeInvoice()"]').click()
  page.locator('#salesTableBody .action-btn.delete').first.click()
  page.wait_for_function('dashboardData.orders.length === 0')
  assert page.evaluate('(dashboardData.materials.find(m => String(m.id) === '+json.dumps(mid)+')).remaining')==1000
  passed('Report delete button returns stock once and removes the displayed sale')
  # Restore test sale to exercise actual import UI and fresh-start on nonempty data.
  tmpbackup=Path(tmp)/'test-backup.json';tmpbackup.write_text(json.dumps(backup,ensure_ascii=False))
  page.evaluate('closeAllModals(); openSettingsModal();')
  page.locator('#importBackupInput').set_input_files(str(tmpbackup))
  page.wait_for_function('dashboardData.orders.length === 1')
  passed('Actual backup file input restores data through preload/main validation')
  page.locator('button[onclick="openFreshStartModal()"]').click()
  page.locator('#executeFreshStart').click()
  assert page.evaluate('dashboardData.orders.length')==1
  page.locator('#resetConfirmation').fill('بداية جديدة')
  page.screenshot(path=str(out/'fresh-start.png'),full_page=True)
  page.locator('#executeFreshStart').click()
  page.wait_for_function("document.getElementById('resetResult').textContent.includes('تمت البداية الجديدة.') && !freshStartRunning")
  assert page.evaluate('dashboardData.materials.length')==0
  assert page.evaluate('dashboardData.orders.length')==0
  assert page.evaluate('getBusinessMetrics().currentCash')==0
  assert page.evaluate('dashboardData.printers.length')==1
  assert page.evaluate('dashboardData.assets.length')==1
  passed('Fresh-start UI requires typed confirmation and clears trading data while retaining pricing inputs')
  page.screenshot(path=str(out/'fresh-start-completed.png'),full_page=True)
  page.close()
  page=browser.new_page(viewport={'width':1366,'height':768})
  page.set_default_timeout(5000)
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.expose_binding('__mooTestCall', rpc)
  page.evaluate(bridge_script)
  page.set_content(source)
  page.wait_for_function("typeof dashboardData !== 'undefined' && dashboardData.config.openingCash === '0' && dashboardData.printers.length === 1")
  assert page.evaluate('dashboardData.materials.length')==0
  passed('UI reload keeps inventory empty, without recreating sample materials')
  page.set_viewport_size({'width':1200,'height':720})
  page.evaluate('openSettingsModal();openFreshStartModal()')
  page.locator('#resetConfirmation').fill('بداية جديدة')
  page.locator('#executeFreshStart').scroll_into_view_if_needed()
  assert page.locator('#executeFreshStart').is_visible()
  page.screenshot(path=str(out/'fresh-start-1200x720.png'),full_page=True)
  passed('Reset controls remain reachable at 1200×720 and 1366×768')
  assert not errors, errors
  passed('No uncaught browser JavaScript errors during all scenarios')
  browser.close()
 print(json.dumps({'passed':len(checks),'checks':checks,'nativeElectronDialogs':'mocked','browser':'system Chromium','platform':'Linux'},ensure_ascii=False,indent=2),flush=True)
finally:
 server.terminate()
 try:server.wait(timeout=3)
 except subprocess.TimeoutExpired:server.kill()
 log.close()
 shutil.rmtree(tmp,ignore_errors=True)
