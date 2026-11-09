async function renderCustomers() {
  const customersList = $('customersList');
  if (!customersList) return;

  const state = await loadCustomersForView({}, customersVisibleCount);
  const customers = Array.isArray(state.items) ? state.items : [];
  const total = Number(state.meta?.total || state.summary?.customersCount || customers.length);

  setText('customersCount', String(total));

  if (state.loading && !customers.length) {
    customersList.innerHTML = `<div class="empty-state">جاري تحميل العملاء من قاعدة البيانات...</div>`;
    return;
  }

  if (!customers.length) {
    customersList.innerHTML = `<div class="empty-state">لا يوجد عملاء مسجلين حتى الآن.</div>`;
    return;
  }

  const visibleCustomers = customers.slice(0, customersVisibleCount);
  const remaining = Math.max(0, total - visibleCustomers.length);
  const moreButton = (remaining > 0 || state.meta?.hasMore)
    ? `<div class="inline-actions"><button class="btn btn-secondary btn-small" type="button" onclick="showMoreCustomers()">عرض المزيد (${remaining})</button></div>`
    : '';

  customersList.innerHTML = visibleCustomers.map((customer) => {
    return `
      <div class="list-card">
        <div class="list-card-head">
          <strong>${escapeHtml(customer.name)}</strong>
          <span class="section-badge status-success">${customer.count} أوردر</span>
        </div>

        <div class="list-card-body">
          <div>إجمالي المبيعات: ${formatMoney(customer.revenue)}</div>
          <div>صافي الربح: ${formatMoney(customer.profit)}</div>
          <div>آخر أوردر: ${escapeHtml(customer.lastOrderCode || '-')} - ${escapeHtml(customer.lastOrderItem || '-')}</div>
          <div>آخر تاريخ: ${escapeHtml(customer.lastOrderDate || '-')}</div>
        </div>
      </div>
    `;
  }).join('') + moreButton;
}

async function showMoreCustomers() {
  customersVisibleCount += LIST_PAGE_SIZE;
  await renderCustomers();
}

function openCustomersModal() {
  customersVisibleCount = LIST_PAGE_SIZE;
  customersQueryView.filtersKey = '';
  setActiveNav('customers');
  closeMainPanels();
  renderCustomers();
  openModal('customersModal');
}

function closeCustomersModal() {
  closeModal('customersModal');
  returnToOrderNav();
}
