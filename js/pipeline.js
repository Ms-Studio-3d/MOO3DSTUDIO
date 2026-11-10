function getPipelineFilters() {
  return {
    search: getTrimmedValue('pipelineSearch'),
    printerId: getValue('pipelinePrinterFilter'),
    from: getValue('pipelineFrom'),
    to: getValue('pipelineTo')
  };
}

async function renderPipeline() {
  const target = $('pipelineAll');
  const count = $('pipelineCountAll');
  if (!target) return;

  const state = await loadOrdersForView('pipeline', getPipelineFilters(), pipelineVisibleCount);
  const allOrders = Array.isArray(state.items) ? state.items : [];
  const visibleOrders = allOrders.slice(0, pipelineVisibleCount);
  const matchedTotal = Number(state.meta?.total || state.summary?.count || allOrders.length);
  if (count) count.innerText = String(matchedTotal);

  if (state.loading && !visibleOrders.length) {
    target.innerHTML = `<div class="empty-state">جاري تحميل النتائج من قاعدة البيانات...</div>`;
    return;
  }

  const hasMoreLoaded = allOrders.length > visibleOrders.length;
  const hasMoreRemote = Boolean(state.meta?.hasMore);
  const remainingOrders = Math.max(0, matchedTotal - visibleOrders.length);
  const moreButton = (hasMoreLoaded || hasMoreRemote)
    ? `<div class="inline-actions"><button class="btn btn-secondary btn-small" type="button" data-action-click="showMorePipeline">عرض المزيد (${remainingOrders})</button></div>`
    : '';

  target.innerHTML = visibleOrders.length
    ? visibleOrders.map((order) => renderPipelineCard(order)).join('') + moreButton
    : (moreButton || `<div class="empty-state">لا يوجد أوردرات</div>`);
}

async function showMorePipeline() {
  pipelineVisibleCount += LIST_PAGE_SIZE;
  await renderPipeline();
}

function renderPipelineCard(order) {
  const code = escapeHtml(order.code || '');
  const codeArg = jsStringArg(order.code || '');

  return `
    <article class="pipeline-card">
      <div class="pipeline-card-head">
        <div>
          <span class="pipeline-code">${code}</span>
          <strong class="pipeline-title">${escapeHtml(order.itemName || '-')}</strong>
        </div>
      </div>

      <div class="pipeline-meta">
        <div>العميل: ${escapeHtml(order.customerName || '-')}</div>
        <div>الطابعة: ${escapeHtml(order.printerName || '-')}</div>
        <div>التاريخ: ${escapeHtml(order.date || '-')}</div>
        <div>عدد القطع: ${formatNumber(order.quantity || 1)}</div>
        <div>وقت الطباعة: ${formatHoursMinutes(order.printHours || 0)}</div>
      </div>

      <div class="pipeline-price">
        <span>التكلفة: ${formatMoneyHtml(order.totalCost || 0)}</span>
        <strong>البيع: ${formatMoneyHtml(order.finalPrice || 0)}</strong>
        <span>الربح: ${formatMoneyHtml(order.profit || 0)}</span>
      </div>

      <div class="pipeline-actions">
        <button class="action-btn edit" type="button" data-action-click="openEditSale" data-arg-click="${codeArg}">تعديل</button>
        <button class="action-btn" type="button" data-action-click="openInvoice" data-arg-click="${codeArg}">فاتورة</button>
        <button class="action-btn delete" type="button" data-action-click="deleteSale" data-arg-click="${codeArg}">حذف</button>
      </div>
    </article>
  `;
}

function openPipelineModal() {
  pipelineVisibleCount = LIST_PAGE_SIZE;
  const state = getViewOrderState('pipeline');
  state.filtersKey = '';
  setActiveNav('pipeline');
  closeMainPanels();
  renderPrinterSelects();
  renderPipeline();
  openModal('pipelineModal');
}

function closePipelineModal() {
  closeModal('pipelineModal');
  returnToOrderNav();
}
