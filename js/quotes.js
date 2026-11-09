function getSortedQuotes() {
  return [...(dashboardData.quotes || [])].sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
}

function getQuoteStatusText(status) {
  return String(status || 'open') === 'converted' ? 'اتحول لأوردر' : 'مفتوح';
}

function renderQuotes() {
  const target = $('quotesList');
  if (!target) return;

  const quotes = getSortedQuotes();

  if (!quotes.length) {
    target.innerHTML = `<div class="empty-state">لا توجد عروض أسعار محفوظة.</div>`;
    return;
  }

  const cardsHtml = quotes.map((quote) => {
    const code = escapeHtml(quote.code || '');
    const codeArg = jsStringArg(quote.code || '');
    const converted = String(quote.status || 'open') === 'converted';
    return `
      <article class="pipeline-card">
        <div class="pipeline-card-head">
          <div>
            <span class="pipeline-code">${code}</span>
            <strong class="pipeline-title">${escapeHtml(quote.itemName || '-')}</strong>
          </div>
          <span class="status-pill ${converted ? 'status-success' : 'status-warning'}">${getQuoteStatusText(quote.status)}</span>
        </div>

        <div class="pipeline-meta">
          <div>العميل: ${escapeHtml(quote.customerName || '-')}</div>
          <div>التاريخ: ${escapeHtml(quote.date || '-')}</div>
          <div>عدد القطع: ${formatNumber(quote.quantity || 1)}</div>
          ${converted ? `<div>الأوردر: ${escapeHtml(quote.convertedOrderCode || '-')}</div>` : ''}
        </div>

        <div class="pipeline-price">
          <strong>السعر: ${formatMoney(quote.finalPrice || 0)}</strong>
          <span>الربح: ${formatMoney(quote.profit || 0)}</span>
        </div>

        <div class="pipeline-actions">
          ${converted ? '' : `<button class="action-btn edit" type="button" onclick="convertQuoteToOrder(${codeArg})">تحويل لأوردر</button>`}
          <button class="action-btn delete" type="button" onclick="deleteQuoteAction(${codeArg})">حذف</button>
        </div>
      </article>
    `;
  }).join('');

  const moreButton = dashboardData.meta?.quotes?.hasMore
    ? `<button class="btn btn-secondary btn-small" type="button" onclick="loadMoreQuotes()">عرض المزيد (${Math.max(0, Number(dashboardData.meta?.quotes?.total || quotes.length) - quotes.length)})</button>`
    : '';

  target.innerHTML = cardsHtml + moreButton;
}

async function loadMoreQuotes() {
  await loadMoreDataPage('quotes', renderQuotes);
}

function openQuotesModal() {
  setActiveNav('quotes');
  closeMainPanels();
  renderQuotes();
  openModal('quotesModal');
}

function closeQuotesModal() {
  closeModal('quotesModal');
  returnToOrderNav();
}

async function convertQuoteToOrder(code) {
  if (convertingQuote) return;

  const confirmed = await askConfirm('تحويل عرض السعر لأوردر سيخصم الخامات من المخزون. هل تريد المتابعة؟');
  if (!confirmed) return;

  convertingQuote = true;

  try {
    const response = await window.farmAPI.convertQuoteToOrder(code);
    if (!response?.success) {
      showToast(response?.message || 'فشل في تحويل عرض السعر', 'error');
      return;
    }

    showToast(`تم تحويل عرض السعر إلى أوردر ${response.data || ''}`);
    await loadDashboardData();
    renderQuotes();
  } finally {
    convertingQuote = false;
  }
}

async function deleteQuoteAction(code) {
  if (deletingQuote) return;

  const confirmed = await askConfirm('هل تريد حذف عرض السعر؟');
  if (!confirmed) return;

  deletingQuote = true;

  try {
    const response = await window.farmAPI.deleteQuote(code);
    if (!response?.success) {
      showToast(response?.message || 'فشل في حذف عرض السعر', 'error');
      return;
    }

    showToast('تم حذف عرض السعر');
    await loadDashboardData();
    renderQuotes();
  } finally {
    deletingQuote = false;
  }
}

function exportQuotesCSV() {
  const headers = ['الكود', 'التاريخ', 'المجسم', 'العميل', 'عدد القطع', 'السعر', 'الربح', 'الحالة', 'الأوردر'];
  const rows = getSortedQuotes().map((quote) => [
    quote.code,
    quote.date,
    quote.itemName,
    quote.customerName,
    formatNumber(quote.quantity || 1),
    formatNumber(quote.finalPrice || 0),
    formatNumber(quote.profit || 0),
    getQuoteStatusText(quote.status),
    quote.convertedOrderCode || ''
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n');

  downloadTextFile(`quotes-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
}
