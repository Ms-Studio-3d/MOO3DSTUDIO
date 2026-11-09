function getPurchaseTotalGrams(purchase) {
  if (String(purchase?.category || '') !== 'خامات') return 0;
  if (!purchase?.materialId) return 0;
  return Math.max(0, Number(purchase.quantity || 0) * Number(purchase.gramsPerUnit || 0));
}

function fillPurchaseMaterialSelect(selectedId = '') {
  const select = $('purchaseMaterialId');
  if (!select) return;

  select.innerHTML = [
    '<option value="">لا يزود مخزون</option>',
    '<option value="__new__">إضافة خامة جديدة باسم البند</option>',
    ...(dashboardData.materials || []).map((material) => (
      `<option value="${material.id}">${escapeHtml(material.name)} — متبقي ${formatNumber(material.remaining || 0)} جم</option>`
    ))
  ].join('');

  select.value = selectedId ? String(selectedId) : '';
}

function renderPurchasesTable() {
  const rows = Array.isArray(dashboardData.purchases) ? dashboardData.purchases : [];
  const target = $('purchasesTableBody');
  if (!target) return;

  const total = rows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const grams = rows.reduce((sum, item) => sum + getPurchaseTotalGrams(item), 0);

  setText('purchasesTotalAmount', formatMoney(total));
  setText('purchasesTotalGrams', `${formatNumber(grams)} جم`);
  setText('purchasesCount', String(dashboardData.meta?.purchases?.total || rows.length));

  const rowsHtml = rows.map((purchase) => {
    const safeId = Number(purchase.id || 0);
    return `
      <tr>
        <td>${escapeHtml(purchase.date || '-')}</td>
        <td>${escapeHtml(purchase.category || '-')}</td>
        <td>${escapeHtml(purchase.item || '-')}</td>
        <td>${formatNumber(purchase.quantity || 0)}</td>
        <td>${getPurchaseTotalGrams(purchase) ? `${formatNumber(getPurchaseTotalGrams(purchase))} جم` : '-'}</td>
        <td>${formatMoney(purchase.amount || 0)}</td>
        <td>${escapeHtml(purchase.supplier || '-')}</td>
        <td>${escapeHtml(purchase.materialName || '-')}</td>
        <td>${escapeHtml(purchase.notes || '-')}</td>
        <td>
          <button class="action-btn edit" type="button" onclick="openPurchaseModal(${safeId})">تعديل</button>
          <button class="action-btn delete" type="button" onclick="deletePurchaseAction(${safeId})">حذف</button>
        </td>
      </tr>
    `;
  }).join('');

  const moreRow = dashboardData.meta?.purchases?.hasMore
    ? `<tr><td colspan="10"><button class="btn btn-secondary btn-small" type="button" onclick="loadMorePurchases()">عرض المزيد (${Math.max(0, Number(dashboardData.meta?.purchases?.total || rows.length) - rows.length)})</button></td></tr>`
    : '';

  target.innerHTML = rows.length
    ? rowsHtml + moreRow
    : '<tr><td colspan="10"><div class="empty-state">لسه مفيش مشتريات مسجلة</div></td></tr>';
}

async function loadMorePurchases() {
  await loadMoreDataPage('purchases', renderPurchasesTable);
}

function renderPurchasesTableSafe() {
  if (isModalOpen('purchasesModal')) renderPurchasesTable();
}

function getPanelReturnTarget(options = {}) {
  if (typeof options === 'string') return options;
  if (options && typeof options === 'object' && options.returnTo) return String(options.returnTo);
  return isModalOpen('businessDashboardModal') ? 'dashboard' : '';
}

function openPurchasesModal(options = {}) {
  panelReturnTargets.purchases = getPanelReturnTarget(options);
  setActiveNav('purchases');
  closeMainPanels();
  renderPurchasesTable();
  openModal('purchasesModal');
}

function closePurchasesModal() {
  const returnTarget = panelReturnTargets.purchases;
  panelReturnTargets.purchases = '';
  closeModal('purchasesModal');

  if (returnTarget === 'dashboard') {
    openBusinessDashboard();
    return;
  }

  returnToOrderNav();
}

function openPurchaseModal(id = null) {
  editingPurchaseId = id ? Number(id) : null;
  const purchase = editingPurchaseId
    ? (dashboardData.purchases || []).find((item) => Number(item.id) === editingPurchaseId)
    : null;

  setText('purchaseModalTitle', purchase ? 'تعديل مشتريات' : 'إضافة مشتريات');
  setValue('purchaseId', purchase?.id || '');
  setValue('purchaseDate', purchase?.date || new Date().toISOString().slice(0, 10));
  setValue('purchaseCategory', purchase?.category || 'خامات');
  setValue('purchaseItem', purchase?.item || '');
  fillPurchaseMaterialSelect(purchase?.materialId || (purchase ? '' : '__new__'));
  setValue('purchaseQty', purchase?.quantity ?? 1);
  setValue('purchaseGramsPerUnit', purchase?.gramsPerUnit ?? 1000);
  setValue('purchaseAmount', purchase?.amount ?? 0);
  setValue('purchaseSupplier', purchase?.supplier || '');
  setValue('purchaseNotes', purchase?.notes || '');

  openModal('purchaseModal');
}

function closePurchaseModal() {
  closeModal('purchaseModal');
  editingPurchaseId = null;
}

async function savePurchaseAction() {
  if (savingPurchase) return;
  savingPurchase = true;

  try {
    const payload = {
      id: getValue('purchaseId') ? Number(getValue('purchaseId')) : null,
      date: getValue('purchaseDate'),
      category: getValue('purchaseCategory') || 'أخرى',
      item: getTrimmedValue('purchaseItem'),
      materialId: getValue('purchaseMaterialId') && getValue('purchaseMaterialId') !== '__new__' ? Number(getValue('purchaseMaterialId')) : null,
      createMaterial: getValue('purchaseMaterialId') === '__new__',
      quantity: toPositiveNumber(getValue('purchaseQty'), 1),
      gramsPerUnit: toPositiveNumber(getValue('purchaseGramsPerUnit'), 0),
      amount: toPositiveNumber(getValue('purchaseAmount'), 0),
      supplier: getTrimmedValue('purchaseSupplier'),
      notes: getTrimmedValue('purchaseNotes')
    };

    if (!payload.item) {
      const material = payload.materialId ? getMaterialById(payload.materialId) : null;
      payload.item = material ? material.name : '';
    }

    if (payload.category === 'خامات' && payload.createMaterial && !payload.item) {
      showToast('اكتب اسم الخامة الجديدة في خانة البند', 'error');
      $('purchaseItem')?.focus();
      return;
    }

    const response = await window.farmAPI.savePurchase(payload);
    if (!response?.success) {
      showToast(response?.message || 'فشل في حفظ المشتريات', 'error');
      return;
    }

    showToast('تم حفظ المشتريات');
    closePurchaseModal();
    await loadDashboardData();
    renderPurchasesTableSafe();
    renderBusinessDashboardSafe();
  } finally {
    savingPurchase = false;
  }
}

async function deletePurchaseAction(id) {
  const confirmed = await askConfirm('هل تريد حذف هذه المشتريات؟ لو كانت خامة سيتم خصمها من المخزون.');
  if (!confirmed) return;

  const response = await window.farmAPI.deletePurchase(id);
  if (!response?.success) {
    showToast(response?.message || 'فشل في حذف المشتريات', 'error');
    return;
  }

  showToast('تم حذف المشتريات');
  await loadDashboardData();
  renderPurchasesTableSafe();
  renderBusinessDashboardSafe();
}

function renderAssetsTable() {
  const rows = Array.isArray(dashboardData.assets) ? dashboardData.assets : [];
  const target = $('assetsTableBody');
  if (!target) return;

  const total = rows.reduce((sum, item) => sum + Number(item.cost || 0), 0);
  const totalDepHour = rows.reduce((sum, item) => {
    const hours = Number(item.depreciationHours || 0);
    return sum + (hours > 0 ? Number(item.cost || 0) / hours : 0);
  }, 0);

  setText('assetsTotalCost', formatMoney(total));
  setText('assetsCount', String(dashboardData.meta?.assets?.total || rows.length));
  setText('assetsAvgDepHour', rows.length ? formatMoney(totalDepHour / rows.length) : formatMoney(0));

  const rowsHtml = rows.map((asset) => {
    const depHour = Number(asset.depreciationHours || 0) > 0
      ? Number(asset.cost || 0) / Number(asset.depreciationHours || 1)
      : 0;
    const safeId = Number(asset.id || 0);
    return `
      <tr>
        <td>${escapeHtml(asset.date || '-')}</td>
        <td>${escapeHtml(asset.item || '-')}</td>
        <td>${formatMoney(asset.cost || 0)}</td>
        <td>${escapeHtml(asset.type || '-')}</td>
        <td>${formatNumber(asset.depreciationHours || 0)}</td>
        <td>${formatMoney(depHour)}</td>
        <td>${escapeHtml(asset.notes || '-')}</td>
        <td>
          <button class="action-btn edit" type="button" onclick="openAssetModal(${safeId})">تعديل</button>
          <button class="action-btn delete" type="button" onclick="deleteAssetAction(${safeId})">حذف</button>
        </td>
      </tr>
    `;
  }).join('');

  const moreRow = dashboardData.meta?.assets?.hasMore
    ? `<tr><td colspan="8"><button class="btn btn-secondary btn-small" type="button" onclick="loadMoreAssets()">عرض المزيد (${Math.max(0, Number(dashboardData.meta?.assets?.total || rows.length) - rows.length)})</button></td></tr>`
    : '';

  target.innerHTML = rows.length
    ? rowsHtml + moreRow
    : '<tr><td colspan="8"><div class="empty-state">لسه مفيش أصول مسجلة</div></td></tr>';
}

async function loadMoreAssets() {
  await loadMoreDataPage('assets', renderAssetsTable);
}

function renderAssetsTableSafe() {
  if (isModalOpen('assetsModal')) renderAssetsTable();
}

function openAssetsModal(options = {}) {
  panelReturnTargets.assets = getPanelReturnTarget(options);
  setActiveNav('assets');
  closeMainPanels();
  renderAssetsTable();
  openModal('assetsModal');
}

function closeAssetsModal() {
  const returnTarget = panelReturnTargets.assets;
  panelReturnTargets.assets = '';
  closeModal('assetsModal');

  if (returnTarget === 'dashboard') {
    openBusinessDashboard();
    return;
  }

  returnToOrderNav();
}

function openAssetModal(id = null) {
  editingAssetId = id ? Number(id) : null;
  const asset = editingAssetId
    ? (dashboardData.assets || []).find((item) => Number(item.id) === editingAssetId)
    : null;

  setText('assetModalTitle', asset ? 'تعديل أصل' : 'إضافة أصل');
  setValue('assetId', asset?.id || '');
  setValue('assetDate', asset?.date || new Date().toISOString().slice(0, 10));
  setValue('assetItem', asset?.item || '');
  setValue('assetCost', asset?.cost ?? 0);
  setValue('assetType', asset?.type || '');
  setValue('assetDepreciationHours', asset?.depreciationHours ?? 5000);
  setValue('assetNotes', asset?.notes || '');

  openModal('assetModal');
}

function closeAssetModal() {
  closeModal('assetModal');
  editingAssetId = null;
}

async function saveAssetAction() {
  if (savingAsset) return;
  savingAsset = true;

  try {
    const payload = {
      id: getValue('assetId') ? Number(getValue('assetId')) : null,
      date: getValue('assetDate'),
      item: getTrimmedValue('assetItem'),
      cost: toPositiveNumber(getValue('assetCost'), 0),
      type: getTrimmedValue('assetType'),
      depreciationHours: toPositiveNumber(getValue('assetDepreciationHours'), 0),
      notes: getTrimmedValue('assetNotes')
    };

    const response = await window.farmAPI.saveAsset(payload);
    if (!response?.success) {
      showToast(response?.message || 'فشل في حفظ الأصل', 'error');
      return;
    }

    showToast('تم حفظ الأصل');
    closeAssetModal();
    await loadDashboardData();
    renderAssetsTableSafe();
    renderBusinessDashboardSafe();
  } finally {
    savingAsset = false;
  }
}

async function deleteAssetAction(id) {
  const confirmed = await askConfirm('هل تريد حذف هذا الأصل؟');
  if (!confirmed) return;

  const response = await window.farmAPI.deleteAsset(id);
  if (!response?.success) {
    showToast(response?.message || 'فشل في حذف الأصل', 'error');
    return;
  }

  showToast('تم حذف الأصل');
  await loadDashboardData();
  renderAssetsTableSafe();
  renderBusinessDashboardSafe();
}
