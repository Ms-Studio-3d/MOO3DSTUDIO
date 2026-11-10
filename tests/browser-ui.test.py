from pathlib import Path
from playwright.sync_api import sync_playwright
import subprocess, tempfile, json, time, shutil, os
import sys
root=Path(__file__).resolve().parent.parent
tmp=tempfile.mkdtemp(prefix='moo3d-browser-')
out=Path(tmp)/'screenshots';out.mkdir()
log=open(Path(tmp)/'browser-server.log','w', encoding='utf-8')
server=subprocess.Popen(['node',str(root/'tests/browser-bridge.cjs'),tmp],stdout=subprocess.PIPE,stderr=log,text=True)
info=json.loads(server.stdout.readline())
print('Browser test: actual UI + preload/main + temporary SQLite; OS dialogs mocked.',flush=True)
checks=[]
def passed(s): checks.append(s);print('PASS:',s,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.getenv('MOO3D_CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1366,'height':768})
  page.set_default_timeout(5000)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  base=f'http://127.0.0.1:{info["port"]}/'
  page.goto(base)
  page.wait_for_function("typeof dashboardData !== 'undefined' && dashboardData.materials.length === 4 && !!getValue('selectedPrinter')")
  page.locator('#itemName').fill('مجسم اختبار الواجهة')
  page.locator('#customerName').fill('عميل تجريبي')
  page.locator('#printHours').fill('2')
  mid=page.evaluate('String(dashboardData.materials[0].id)')
  page.locator('#materialUsagePicker').select_option(mid)
  page.locator('.ams-weight').fill('100')
  second_mid=page.evaluate('String(dashboardData.materials[1].id)')
  page.locator('#materialUsagePicker').select_option(second_mid)
  second_row=page.locator(f'.order-material-row[data-id="{second_mid}"]')
  second_row.locator('.ams-weight').fill('50')
  assert page.evaluate('currentCalc.materialCost')==120
  second_row.get_by_role('button', name='حذف الخامة').click()
  second_row.wait_for(state='detached')
  assert page.locator('.ams-weight').input_value()=='100'
  assert page.evaluate('currentCalc.materialCost')==80
  assert page.evaluate('dashboardData.materials.every(m => m.remaining === 1000)')
  passed('Removing the second material preserves the first weight and updates the order price without changing stock')
  page.locator('#printHours').blur()
  page.wait_for_timeout(300)
  saved_price=page.evaluate('currentCalc.finalPrice')
  save_button=page.locator('button[data-action-click="saveSale"]')
  sale_confirm=page.locator('#saleConfirmDialog')
  for dismissal in ('click', 'Escape', 'Enter'):
   save_button.click()
   sale_confirm.wait_for(state='visible')
   cancel=sale_confirm.get_by_role('button', name='إلغاء')
   assert cancel.evaluate('(button) => button === document.activeElement')
   if dismissal=='click':
    cancel.click()
   else:
    page.keyboard.press(dismissal)
   sale_confirm.wait_for(state='hidden')
   page.wait_for_function('savingOrder === false')
   assert page.evaluate('dashboardData.orders.length')==0
   assert page.evaluate('dashboardData.materials.every(m => m.remaining === 1000)')
   assert page.locator('#itemName').input_value()=='مجسم اختبار الواجهة'
  passed('Cancel, Escape and Enter on the default button preserve the order draft and stock')
  save_button.click()
  sale_confirm.get_by_role('button', name='تسجيل الأوردر', exact=True).click()
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
  page.locator('#editModal button[data-action-click="saveEditSale"]').click()
  page.wait_for_function("!isModalOpen('editModal') && dashboardData.orders[0].customerName === 'تم تعديل العميل بنجاح'")
  after=page.evaluate('JSON.parse(JSON.stringify(dashboardData.orders[0]))')
  for key in ['finalPrice','totalCost','profit','depreciationCost','discountValue','roundedAdjustment','printHours']:
   assert after[key]==original[key],(key,after[key],original[key])
  assert page.evaluate('(dashboardData.materials.find(m => String(m.id) === '+json.dumps(mid)+')).remaining')==900
  passed('Report edit button and save button work without changing historical prices or consuming stock')
  page.locator('#salesTableBody .action-btn.edit').first.click()
  page.locator('#editItemName').fill('')
  page.locator('#editModal button[data-action-click="saveEditSale"]').click()
  page.locator('#toastMsg.error').wait_for(state='visible')
  assert page.evaluate("Number(getComputedStyle(document.getElementById('toastMsg')).zIndex) > Number(getComputedStyle(document.getElementById('editModal')).zIndex)")
  passed('Validation errors remain visible over sales/edit panels')
  page.locator('#editModal button[data-action-click="closeModal"[data-arg-click='"editModal"']]').click()
  page.locator('#salesTableBody button',has_text='فاتورة').first.click()
  text=page.locator('#invoiceContent').inner_text()
  assert 'صافي الربح الداخلي' not in text and 'تفاصيل التكلفة' not in text
  page.screenshot(path=str(out/'customer-invoice.png'),full_page=True)
  passed('Customer invoice excludes internal costs and profits')
  page.locator('#invoiceModal button[data-action-click="closeInvoice"]').click()
  page.locator('#salesTableBody .action-btn.delete').first.click()
  confirmation=page.locator('#actionConfirmDialog')
  confirmation.get_by_role('button', name='حذف الأوردر', exact=True).click()
  page.wait_for_function('dashboardData.orders.length === 0')
  assert page.evaluate('(dashboardData.materials.find(m => String(m.id) === '+json.dumps(mid)+')).remaining')==1000
  passed('Report delete button returns stock once and removes the displayed sale')
  # Restore test sale to exercise actual import UI and fresh-start on nonempty data.
  tmpbackup=Path(tmp)/'test-backup.json';tmpbackup.write_text(json.dumps(backup,ensure_ascii=False))
  page.evaluate('closeAllModals(); openSettingsModal();')
  page.locator('#importBackupInput').set_input_files(str(tmpbackup))
  confirmation.get_by_role('button', name='استيراد', exact=True).click()
  page.wait_for_function('dashboardData.orders.length === 1')
  passed('Actual backup file input restores data through preload/main validation')
  page.locator('button[data-action-click="openFreshStartModal"]').click()
  assert page.locator('#executeFreshStart').is_disabled()
  assert page.evaluate('dashboardData.orders.length')==1
  page.locator('#resetConfirmation').fill('بداية جديده')
  assert page.locator('#executeFreshStart').is_enabled()
  page.screenshot(path=str(out/'fresh-start.png'),full_page=True)
  page.locator('#executeFreshStart').click()
  assert page.evaluate('dashboardData.orders.length')==1
  confirmation.get_by_role('button', name='تأكيد التصفير', exact=True).click()
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
  page.goto(base)
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
 print(json.dumps({'passed':len(checks),'checks':checks,'nativeElectronDialogs':'mocked','browser':'Chromium','platform':sys.platform},ensure_ascii=False,indent=2),flush=True)
finally:
 server.terminate()
 try:server.wait(timeout=3)
 except subprocess.TimeoutExpired:server.kill()
 log.close()
 shutil.rmtree(tmp,ignore_errors=True)
