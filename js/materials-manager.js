function openMaterialsManagerModal() {
  setActiveNav('materials');
  closeMainPanels();
  renderInventory();
  renderStockMovementsTableSafe();
  openModal('materialsManagerModal');
}

function closeMaterialsManagerModal() {
  closeModal('materialsManagerModal');
  returnToOrderNav();
}

function openMaterialModal() {
  setValue('materialId', '');
  setValue('materialName', '');
  setValue('materialType', '');
  setValue('materialColor', '');
  setValue('materialWeight', '1000');
  setValue('materialRemaining', '1000');
  setValue('materialPrice', '0');
  setValue('materialLowStockThreshold', '150');
  setValue('materialSupplier', '');
  openModal('materialModal');
}

function closeMaterialModal() {
  closeModal('materialModal');
}

function editMaterial(id) {
  const material = getMaterialById(id);

  if (!material) {
    showToast('الخامة غير موجودة', 'error');
    return;
  }

  setValue('materialId', material.id || '');
  setValue('materialName', material.name || '');
  setValue('materialType', material.type || '');
  setValue('materialColor', material.color || '');
  setValue('materialWeight', material.weight || 0);
  setValue('materialRemaining', material.remaining || 0);
  setValue('materialPrice', material.price || 0);
  setValue('materialLowStockThreshold', material.lowStockThreshold || 0);
  setValue('materialSupplier', material.supplier || '');

  openModal('materialModal');
}

async function saveMaterialAction() {
  const name = getTrimmedValue('materialName');

  if (!name) {
    showToast('اسم الخامة مطلوب', 'error');
    $('materialName')?.focus();
    return;
  }

  const weight = toPositiveNumber(getValue('materialWeight'), 0);
  const remaining = toPositiveNumber(getValue('materialRemaining'), 0);

  if (weight <= 0) {
    showToast('وزن البكرة لازم يكون أكبر من صفر', 'error');
    $('materialWeight')?.focus();
    return;
  }

  // Total stock may contain multiple packs; pack weight still defines price per gram.


  const payload = {
    id: getValue('materialId') ? Number(getValue('materialId')) : null,
    name,
    type: getTrimmedValue('materialType'),
    color: getTrimmedValue('materialColor'),
    weight,
    remaining,
    price: toPositiveNumber(getValue('materialPrice'), 0),
    lowStockThreshold: toPositiveNumber(getValue('materialLowStockThreshold'), 0),
    supplier: getTrimmedValue('materialSupplier')
  };

  const response = await window.farmAPI.saveMaterial(payload);

  if (!response?.success) {
    showToast(response?.message || 'فشل في حفظ الخامة', 'error');
    return;
  }

  showToast('تم حفظ الخامة بنجاح');
  closeMaterialModal();
  await loadDashboardData();

  if (isModalOpen('materialsManagerModal')) renderInventory();
}

async function deleteMaterialAction(id) {
  const confirmed = await askConfirm('هل تريد حذف هذه الخامة؟ لو مستخدمة في أوردرات سيتم أرشفتها فقط.');

  if (!confirmed) return;

  const response = await window.farmAPI.deleteMaterial(id);

  if (!response?.success) {
    showToast(response?.message || 'فشل في حذف الخامة', 'error');
    return;
  }

  if (response.data?.archived) {
    showToast('تم أرشفة الخامة لأنها مستخدمة في أوردرات قديمة');
  } else {
    showToast('تم حذف الخامة');
  }

  await loadDashboardData();
}

function openStockMovementsModal() {
  renderStockMovementsTable();
  openModal('stockMovementsModal');
}

function closeStockMovementsModal() {
  closeModal('stockMovementsModal');
}

function renderStockMovementsTable() {
  const body = $('stockMovementsTableBody');
  if (!body) return;

  if (!dashboardData.stockMovements.length) {
    body.innerHTML = `<tr><td colspan="6"><div class="empty-state">لا توجد حركات مخزون.</div></td></tr>`;
    return;
  }

  const rowsHtml = dashboardData.stockMovements.map((movement) => {
    return `
      <tr>
        <td>${escapeHtml(formatDateTime(movement.createdAt))}</td>
        <td>${escapeHtml(movement.materialName || '-')}</td>
        <td>${escapeHtml(getMovementTypeText(movement.movementType))}</td>
        <td>${formatNumber(movement.quantity || 0)}g</td>
        <td>${escapeHtml(movement.reason || '-')}</td>
        <td>${escapeHtml(movement.referenceCode || '-')}</td>
      </tr>
    `;
  }).join('');

  const moreRow = dashboardData.meta?.stockMovements?.hasMore
    ? `<tr><td colspan="6"><button class="btn btn-secondary btn-small" type="button" onclick="loadMoreStockMovements()">عرض المزيد (${Math.max(0, Number(dashboardData.meta?.stockMovements?.total || dashboardData.stockMovements.length) - dashboardData.stockMovements.length)})</button></td></tr>`
    : '';

  body.innerHTML = rowsHtml + moreRow;
}

async function loadMoreStockMovements() {
  await loadMoreDataPage('stockMovements', renderStockMovementsTable);
}

function renderStockMovementsTableSafe() {
  if (isModalOpen('stockMovementsModal')) renderStockMovementsTable();
}
