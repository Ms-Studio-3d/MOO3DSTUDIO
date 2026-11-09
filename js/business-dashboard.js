function getStockValueSummary() {
  const materials = Array.isArray(dashboardData.materials) ? dashboardData.materials : [];

  return materials.reduce((acc, material) => {
    const weight = Math.max(0, Number(material.weight || 0));
    const remaining = Math.max(0, Number(material.remaining || 0));
    const price = Math.max(0, Number(material.price || 0));
    const gramPrice = weight > 0 ? price / weight : 0;

    acc.value += remaining * gramPrice;
    acc.grams += remaining;
    if (remaining > 0 && remaining <= Number(material.lowStockThreshold || 150)) acc.lowCount += 1;
    return acc;
  }, { value: 0, grams: 0, lowCount: 0 });
}

function getMaintenanceInfo(totalSalesHours) {
  const baseHours = getConfigNumber('baseMachineHours');
  const interval = Math.max(1, getConfigNumber('maintenanceEveryHours'));
  const lastMaintenanceAt = getConfigNumber('lastMaintenanceAtHours');
  const totalHours = baseHours + Number(totalSalesHours || 0);
  const nextMaintenanceAt = lastMaintenanceAt + interval;
  const remaining = nextMaintenanceAt - totalHours;
  const warnLimit = Math.max(25, interval * 0.1);

  if (remaining <= 0) {
    return { baseHours, totalHours, nextMaintenanceAt, remaining, level: 'danger', label: 'مطلوبة الآن' };
  }

  if (remaining <= warnLimit) {
    return { baseHours, totalHours, nextMaintenanceAt, remaining, level: 'warn', label: 'قربت' };
  }

  return { baseHours, totalHours, nextMaintenanceAt, remaining, level: 'ok', label: 'سليم' };
}

function getBusinessMetrics() {
  const orders = (dashboardData.orders || []).filter((order) => !isCancelled(order));
  const purchases = Array.isArray(dashboardData.purchases) ? dashboardData.purchases : [];
  const assets = Array.isArray(dashboardData.assets) ? dashboardData.assets : [];
  const summary = dashboardData.meta?.summary || null;
  const stock = summary?.stock || getStockValueSummary();

  const totalSales = summary ? Number(summary.totalSales || 0) : orders.reduce((sum, order) => sum + Number(order.finalPrice || 0), 0);
  const collected = summary ? Number(summary.collected || 0) : orders.reduce((sum, order) => sum + getOrderPaidAmount(order), 0);
  const totalProfit = summary ? Number(summary.totalProfit || 0) : orders.reduce((sum, order) => sum + Number(order.profit || 0), 0);
  const totalPurchases = summary ? Number(summary.totalPurchases || 0) : purchases.reduce((sum, purchase) => sum + Number(purchase.amount || 0), 0);
  const totalAssets = summary ? Number(summary.totalAssets || 0) : assets.reduce((sum, asset) => sum + Number(asset.cost || 0), 0);
  const salesMachineHours = summary ? Number(summary.salesMachineHours || 0) : orders.reduce((sum, order) => sum + Number(order.printHours || 0), 0);
  const openingCash = getConfigNumber('openingCash');
  const currentCash = openingCash + collected - totalPurchases;
  const maintenance = getMaintenanceInfo(salesMachineHours);

  return {
    orders,
    purchases,
    assets,
    stock,
    totalSales,
    collected,
    totalProfit,
    totalPurchases,
    totalAssets,
    salesMachineHours,
    openingCash,
    currentCash,
    cashPlusStock: currentCash + stock.value,
    recovery: Math.max(0, totalAssets - totalProfit),
    maintenance
  };
}

function renderBusinessDashboard() {
  const metrics = getBusinessMetrics();

  setText('dashOpeningCash', formatMoney(metrics.openingCash));
  setText('dashCurrentCash', formatMoney(metrics.currentCash));
  setText('dashStockValue', formatMoney(metrics.stock.value));
  setText('dashTotalSales', formatMoney(metrics.totalSales));
  setText('dashCollected', formatMoney(metrics.collected));
  setText('dashPurchasesTotal', formatMoney(metrics.totalPurchases));
  setText('dashOrdersCount', String(dashboardData.meta?.summary?.ordersCount || (dashboardData.orders || []).length));
  setText('dashMachineHours', formatHoursMinutes(metrics.maintenance.totalHours));
  setText('dashMachineHoursNote', `${formatHoursMinutes(metrics.maintenance.baseHours)} بداية + ${formatHoursMinutes(metrics.salesMachineHours)} من المبيعات`);
  setText('dashRecovery', formatMoney(metrics.recovery));

  const card = $('dashMaintenanceCard');
  if (card) {
    card.classList.remove('highlight', 'warn', 'danger');
    card.classList.add(metrics.maintenance.level === 'ok' ? 'highlight' : metrics.maintenance.level);
  }

  const lampClass = metrics.maintenance.level === 'ok' ? '' : metrics.maintenance.level;
  const lamp = $('dashMaintenanceLamp');
  if (lamp) {
    lamp.innerHTML = `<span class="maintenance-lamp"><span class="lamp-dot ${lampClass}"></span> ${metrics.maintenance.label}</span>`;
  }

  setText(
    'dashMaintenanceNote',
    metrics.maintenance.remaining <= 0
      ? `الصيانة متأخرة بـ ${formatHoursMinutes(Math.abs(metrics.maintenance.remaining))}`
      : `متبقي ${formatHoursMinutes(metrics.maintenance.remaining)} — القادمة عند ${formatNumber(metrics.maintenance.nextMaintenanceAt)} ساعة`
  );

  setText('quickProfit', formatMoney(metrics.totalProfit));
  setText('quickStockGrams', `${formatNumber(metrics.stock.grams)} جم`);
  setText('quickCashPlusStock', formatMoney(metrics.cashPlusStock));
  setText('quickAssets', formatMoney(metrics.totalAssets));
  setText('quickNextMaintenance', `${formatNumber(metrics.maintenance.nextMaintenanceAt)} ساعة`);
  setText('quickLowStock', String(metrics.stock.lowCount));

  const recent = [
    ...metrics.orders.slice(0, 5).map((order) => ({
      date: order.date,
      title: `بيع: ${order.code || ''} — ${order.itemName || '-'}`,
      value: formatMoney(order.finalPrice || 0)
    })),
    ...metrics.purchases.slice(0, 5).map((purchase) => ({
      date: purchase.date,
      title: `شراء: ${purchase.item || '-'}`,
      value: formatMoney(purchase.amount || 0)
    }))
  ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 8);

  const target = $('dashboardRecentActivity');
  if (target) {
    target.innerHTML = recent.length
      ? recent.map((item) => `
        <div class="quick-row">
          <span>${escapeHtml(item.date || '-')} — ${escapeHtml(item.title)}</span>
          <strong>${escapeHtml(item.value)}</strong>
        </div>
      `).join('')
      : '<div class="empty-state">لسه مفيش حركة مسجلة</div>';
  }
}

function renderBusinessDashboardSafe() {
  if (isModalOpen('businessDashboardModal')) renderBusinessDashboard();
}

function openBusinessDashboard() {
  setActiveNav('dashboard');
  closeMainPanels();
  renderBusinessDashboard();
  openModal('businessDashboardModal');
}

function closeBusinessDashboard() {
  closeModal('businessDashboardModal');
  returnToOrderNav();
}
