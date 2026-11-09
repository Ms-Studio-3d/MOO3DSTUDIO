function renderPrinterSelects() {
  ['selectedPrinter', 'editPrinter', 'filterPrinter', 'pipelinePrinterFilter'].forEach((id) => {
    const select = $(id);
    if (!select) return;

    const oldValue = select.value;
    const isFilter = id === 'filterPrinter' || id === 'pipelinePrinterFilter';
    const printers = Array.isArray(dashboardData.printers) ? dashboardData.printers : [];
    const printerOptions = printers.map((printer) => {
      return `<option value="${Number(printer.id)}">${escapeHtml(printer.name)}</option>`;
    });

    let firstOption = '';
    if (isFilter) {
      firstOption = `<option value="">كل الطابعات</option>`;
    } else if (id === 'editPrinter') {
      firstOption = `<option value="">اختر طابعة</option>`;
    } else if (!printers.length) {
      firstOption = `<option value="">لا توجد طابعات مضافة</option>`;
    }

    select.innerHTML = [firstOption, ...printerOptions].filter(Boolean).join('');

    const hasOldValue = oldValue && [...select.options].some((opt) => opt.value === oldValue);

    if (isFilter) {
      select.value = hasOldValue ? oldValue : '';
      return;
    }

    if (id === 'selectedPrinter') {
      select.value = hasOldValue ? oldValue : getDefaultPrinterId();
      if (!select.value && select.options.length) select.selectedIndex = 0;
      return;
    }

    select.value = hasOldValue ? oldValue : '';
  });
}

function getPrinterUsageStats(printerId) {
  const orders = dashboardData.orders.filter((order) => {
    return String(order.printerId || '') === String(printerId) && !isCancelled(order);
  });

  const totalHours = orders.reduce((sum, order) => {
    return sum + Number(order.printHours || 0);
  }, 0);

  const deliveredOrders = orders.filter((order) => String(order.status || '') === 'delivered').length;
  const activeOrders = orders.filter((order) => {
    return ['new', 'printing', 'finished'].includes(String(order.status || ''));
  }).length;

  const lastOrder = [...orders].sort((a, b) => {
    return String(b.date || '').localeCompare(String(a.date || '')) || Number(b.id || 0) - Number(a.id || 0);
  })[0];

  return {
    totalHours,
    ordersCount: orders.length,
    deliveredOrders,
    activeOrders,
    lastUsedDate: lastOrder?.date || '-',
    lastOrderCode: lastOrder?.code || '-',
    lastOrderItem: lastOrder?.itemName || '-'
  };
}

function renderPrinters() {
  const printersList = $('printersList');
  if (!printersList) return;

  setText('printersCount', String(dashboardData.printers.length));
  setText('activePrintersCount', String(dashboardData.printers.filter((printer) => printer.status === 'printing').length));

  if (!dashboardData.printers.length) {
    printersList.innerHTML = `<div class="empty-state">لا توجد طابعات مضافة.</div>`;
    return;
  }

  printersList.innerHTML = dashboardData.printers.map((printer) => {
    const printerId = Number(printer.id);
    const statusText = getPrinterStatusText(printer.status);
    const statusClass = getPrinterStatusClass(printer.status);
    const usage = getPrinterUsageStats(printerId);

    return `
      <div class="list-card">
        <div class="list-card-head">
          <strong>${escapeHtml(printer.name)}</strong>
          <span class="section-badge ${statusClass}">${escapeHtml(statusText)}</span>
        </div>

        <div class="list-card-body">
          <div>الموديل: ${escapeHtml(printer.model || '-')}</div>
          <div>تشغيل الطابعة فقط / ساعة: ${formatMoney(printer.hourlyDepreciation || 0)}</div>
          <div>إجمالي ساعات التشغيل: ${formatNumber(usage.totalHours)} ساعة</div>
          <div>عدد الأوردرات على الطابعة: ${usage.ordersCount}</div>
          <div>أوردرات تم تسليمها: ${usage.deliveredOrders}</div>
          <div>أوردرات مفتوحة: ${usage.activeOrders}</div>
          <div>آخر استخدام: ${escapeHtml(usage.lastUsedDate)} - ${escapeHtml(usage.lastOrderCode)} - ${escapeHtml(usage.lastOrderItem)}</div>
          <div>ملاحظات: ${escapeHtml(printer.notes || '-')}</div>
        </div>

        <div class="inline-actions card-actions">
          <button class="btn btn-secondary" type="button" onclick="editPrinter(${printerId})">تعديل</button>
          <button class="btn btn-danger" type="button" onclick="deletePrinterAction(${printerId})">حذف</button>
        </div>
      </div>
    `;
  }).join('');
}
