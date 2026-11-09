function getReportsFilters() {
  return {
    search: getTrimmedValue('salesSearch'),
    from: getValue('filterFrom'),
    to: getValue('filterTo'),
    printerId: getValue('filterPrinter'),
    customer: getTrimmedValue('filterCustomer')
  };
}

function getFilteredOrders() {
  const state = getViewOrderState('reports');
  return Array.isArray(state.items) && state.items.length ? state.items : getSortedOrders();
}

async function renderReportsTable() {
  const salesTableBody = $('salesTableBody');
  if (!salesTableBody) return;

  const state = await loadOrdersForView('reports', getReportsFilters(), reportsVisibleCount);
  const allOrders = Array.isArray(state.items) ? state.items : [];
  const visibleOrders = allOrders.slice(0, reportsVisibleCount);
  const summary = state.summary || {};

  if (state.loading && !visibleOrders.length) {
    salesTableBody.innerHTML = `<tr><td colspan="12"><div class="empty-state">جاري تحميل النتائج من قاعدة البيانات...</div></td></tr>`;
    return;
  }

  const rowsHtml = visibleOrders.map((order) => {
    const safeCode = escapeHtml(order.code || '');
    const codeArg = jsStringArg(order.code || '');

    return `
      <tr>
        <td>${safeCode}</td>
        <td>${escapeHtml(order.date || '')}</td>
        <td>${escapeHtml(order.itemName || '')}</td>
        <td>${escapeHtml(order.customerName || '')}</td>
        <td>${escapeHtml(order.printerName || '-')}</td>
        <td>${formatNumber(order.quantity || 1)}</td>
        <td>${formatMoney(order.totalCost || 0)}</td>
        <td>${formatMoney(order.finalPrice || 0)}</td>
        <td>${formatMoney(getOrderPaidAmount(order))}</td>
        <td>${formatHoursMinutes(order.printHours || 0)}</td>
        <td>${formatMoney(order.profit || 0)}</td>
        <td>
          <button class="action-btn edit" type="button" onclick="openEditSale(${codeArg})">تعديل</button>
          <button class="action-btn" type="button" onclick="openInvoice(${codeArg})">فاتورة</button>
          <button class="action-btn delete" type="button" onclick="deleteSale(${codeArg})">حذف</button>
        </td>
      </tr>
    `;
  }).join('');

  const matchedTotal = Number(state.meta?.total || summary.count || allOrders.length);
  const hasMoreLoaded = allOrders.length > visibleOrders.length;
  const hasMoreRemote = Boolean(state.meta?.hasMore);
  const remainingOrders = Math.max(0, matchedTotal - visibleOrders.length);
  const moreRow = (hasMoreLoaded || hasMoreRemote)
    ? `<tr><td colspan="12"><button class="btn btn-secondary btn-small" type="button" onclick="showMoreReports()">عرض المزيد (${remainingOrders})</button></td></tr>`
    : '';

  salesTableBody.innerHTML = visibleOrders.length
    ? rowsHtml + moreRow
    : (moreRow || `<tr><td colspan="12"><div class="empty-state">لا توجد نتائج مطابقة.</div></td></tr>`);

  const topCustomer = summary.topCustomer;
  const lowestStockMaterial = [...dashboardData.materials]
    .sort((a, b) => Number(a.remaining || 0) - Number(b.remaining || 0))[0];

  setText('statRev', formatMoney(summary.totalRevenue || 0));
  setText('statProfit', formatMoney(summary.totalProfit || 0));
  setText('statCount', String(matchedTotal));
  setText('statTop', formatMoney(summary.topSale || 0));
  setText('statAvgProfit', formatMoney(summary.avgProfit || 0));
  setText('statTopCustomer', topCustomer ? `${topCustomer.name} (${formatMoney(topCustomer.revenue)})` : '-');
  setText(
    'statLowestStock',
    lowestStockMaterial
      ? `${lowestStockMaterial.name} (${toPositiveNumber(lowestStockMaterial.remaining, 0).toFixed(0)}g)`
      : '-'
  );
}

async function showMoreReports() {
  reportsVisibleCount += LIST_PAGE_SIZE;
  await renderReportsTable();
}

function renderReportsTableSafe() {
  if (isModalOpen('reportsModal')) renderReportsTable();
}

function openReports() {
  reportsVisibleCount = LIST_PAGE_SIZE;
  const state = getViewOrderState('reports');
  state.filtersKey = '';
  setActiveNav('sales');
  closeMainPanels();
  renderPrinterSelects();
  renderReportsTable();
  openModal('reportsModal');
}

function closeReports() {
  closeModal('reportsModal');
  returnToOrderNav();
}
