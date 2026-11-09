function renderInventory() {
  const inventoryUI = $('inventoryUI');
  if (!inventoryUI) return;

  setText('materialsCount', String(dashboardData.materials.length));

  const lowMaterials = dashboardData.materials.filter((material) => {
    return Number(material.remaining || 0) <= Number(material.lowStockThreshold || 0);
  });

  setText('lowStockCount', String(lowMaterials.length));

  if (!dashboardData.materials.length) {
    inventoryUI.innerHTML = `<div class="empty-state">لا توجد خامات مضافة.</div>`;
    return;
  }

  inventoryUI.innerHTML = [...dashboardData.materials]
    .sort((a, b) => Number(a.remaining || 0) - Number(b.remaining || 0))
    .map((material) => {
      const materialId = Number(material.id);
      const weight = Math.max(Number(material.weight || 0), 1);
      const remaining = toPositiveNumber(material.remaining, 0);
      const percentage = Math.max(0, Math.min(100, (remaining / weight) * 100));
      const isLow = remaining <= Number(material.lowStockThreshold || 0);

      return `
        <div class="stock-item ${isLow ? 'low' : ''}">
          <div class="stock-header">
            <span>${escapeHtml(material.name)}</span>
            <span>${remaining.toFixed(0)}g / ${weight.toFixed(0)}g</span>
          </div>

          <div class="stock-bar">
            <div class="stock-progress" style="width:${percentage}%"></div>
          </div>

          <div class="list-card-body stock-details">
            <div>النوع: ${escapeHtml(material.type || '-')}</div>
            <div>اللون: ${escapeHtml(material.color || '-')}</div>
            <div>السعر: ${formatMoney(material.price || 0)}</div>
            <div>حد التنبيه: ${toPositiveNumber(material.lowStockThreshold, 0).toFixed(0)}g</div>
            <div>المورد: ${escapeHtml(material.supplier || '-')}</div>
          </div>

          <div class="inline-actions card-actions">
            <button class="btn btn-secondary" type="button" onclick="editMaterial(${materialId})">تعديل</button>
            <button class="btn btn-danger" type="button" onclick="deleteMaterialAction(${materialId})">حذف</button>
          </div>
        </div>
      `;
    }).join('');
}

function getSelectedOrderMaterialRowsFromDom() {
  const rows = [];
  document.querySelectorAll('.order-material-row').forEach((row) => {
    const id = String(row.dataset.id || row.querySelector('.ams-weight')?.dataset.id || '').trim();
    if (!id) return;
    rows.push({
      id,
      value: row.querySelector('.ams-weight')?.value || ''
    });
  });
  return rows;
}

function getUnusedOrderMaterials() {
  const used = new Set((selectedOrderMaterialIds || []).map(String));
  return (dashboardData.materials || []).filter((material) => !used.has(String(material.id)));
}

function renderMaterialUsageInputs() {
  const amsInputs = $('amsInputs');
  if (!amsInputs) return;

  const previousRows = getSelectedOrderMaterialRowsFromDom();
  const previousValues = {};

  previousRows.forEach((row) => {
    previousValues[String(row.id)] = row.value;
  });

  const materials = dashboardData.materials || [];

  if (!materials.length) {
    selectedOrderMaterialIds = [];
    amsInputs.innerHTML = `<div class="empty-state">أضف خامة أولًا لكي يظهر إدخال الاستهلاك.</div>`;
    return;
  }

  // مهم: لا نستبدل selectedOrderMaterialIds بالصفوف الموجودة في الـ DOM فقط.
  // عند الضغط على زر إضافة خامة، الخامة الجديدة تكون لسه مش مرسومة في الـ DOM،
  // ولو اعتمدنا على الـ DOM فقط الزر يبدو كأنه لا يعمل، خصوصًا عند إضافة خامة ثانية.
  const idsFromDom = previousRows.map((row) => String(row.id));
  const idsFromState = (selectedOrderMaterialIds || []).map(String);

  selectedOrderMaterialIds = [...idsFromDom, ...idsFromState]
    .map((id) => String(id || '').trim())
    .filter((id, index, list) => id && list.indexOf(id) === index && getMaterialById(id));

  const unusedMaterials = getUnusedOrderMaterials();
  const optionsHtml = unusedMaterials.map((material) => {
    const remaining = toPositiveNumber(material.remaining, 0);
    const color = material.color ? ` • ${material.color}` : '';
    return `<option value="${Number(material.id)}">${escapeHtml(material.name)}${escapeHtml(color)} — المتبقي ${remaining.toFixed(0)}g</option>`;
  }).join('');

  const rowsHtml = selectedOrderMaterialIds.map((id) => {
    const material = getMaterialById(id);
    if (!material) return '';

    const materialId = Number(material.id);
    const remaining = toPositiveNumber(material.remaining, 0);
    const isLow = remaining <= Number(material.lowStockThreshold || 0);
    const meta = `${material.type || '-'} • ${material.color || '-'} • المتبقي ${remaining.toFixed(0)}g`;
    const oldValue = previousValues[String(materialId)] || '';

    return `
      <div class="material-row order-material-row ${isLow ? 'low' : ''}" data-id="${materialId}">
        <div class="material-row-name">
          <span class="material-row-title">${escapeHtml(material.name)}</span>
          <span class="material-row-meta">${escapeHtml(meta)}</span>
        </div>

        <input
          type="text"
          class="ams-weight"
          data-id="${materialId}"
          value="${escapeHtml(oldValue)}"
          placeholder="جرام"
          inputmode="decimal"
        />

        <span class="material-used-chip">${escapeHtml(oldValue || '0')} مستخدم</span>

        <button class="material-remove-btn" type="button" onclick="removeMaterialUsageRow('${materialId}')" aria-label="حذف الخامة">×</button>
      </div>
    `;
  }).join('');

  amsInputs.innerHTML = `
    <div class="materials-picker-bar">
      <select id="materialUsagePicker" ${unusedMaterials.length ? '' : 'disabled'}>
        <option value="">اختار خامة من المخزن...</option>
        ${optionsHtml}
      </select>
      <button class="btn btn-primary add-material-btn" type="button" onclick="addMaterialUsageRow()" ${unusedMaterials.length ? '' : 'disabled'}>+ إضافة خامة</button>
      <span class="materials-count-pill">${materials.length} خامة متاحة</span>
    </div>

    <div id="materialUsageRows" class="material-usage-rows">
      ${rowsHtml || `<div class="empty-state material-empty-state">اختار خامة من المخزن واضغط إضافة خامة. الأوردر يعرض الألوان المستخدمة فقط.</div>`}
    </div>
  `;

  const picker = $('materialUsagePicker');
  if (picker) {
    picker.addEventListener('change', () => {
      if (!picker.value) return;
      addMaterialUsageRow(picker.value);
      picker.value = '';
    });

    picker.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addMaterialUsageRow();
        picker.value = '';
      }
    });
  }

  document.querySelectorAll('.ams-weight').forEach((input) => {
    const updateUsedChip = () => {
      const chip = input.closest('.order-material-row')?.querySelector('.material-used-chip');
      if (chip) chip.innerText = `${input.value || '0'} مستخدم`;
    };

    input.addEventListener('input', () => {
      updateUsedChip();
      calc();
    });
    input.addEventListener('change', () => {
      updateUsedChip();
      calc();
    });
  });
}

function addMaterialUsageRow(materialId = '') {
  const picker = $('materialUsagePicker');
  const selectedId = String(materialId || picker?.value || '').trim();

  if (!selectedId) {
    showToast('اختار خامة من المخزن الأول', 'error');
    return;
  }

  if (!getMaterialById(selectedId)) {
    showToast('الخامة المختارة غير موجودة', 'error');
    return;
  }

  selectedOrderMaterialIds = (selectedOrderMaterialIds || []).map(String);

  if (selectedOrderMaterialIds.includes(selectedId)) {
    const input = document.querySelector(`.ams-weight[data-id="${selectedId}"]`);
    if (input) input.focus();
    showToast('الخامة دي موجودة بالفعل في الأوردر', 'error');
    return;
  }

  selectedOrderMaterialIds.push(selectedId);
  renderMaterialUsageInputs();

  const input = document.querySelector(`.ams-weight[data-id="${selectedId}"]`);
  if (input) input.focus();
  calc();
}

function removeMaterialUsageRow(materialId) {
  const id = String(materialId || '').trim();
  selectedOrderMaterialIds = (selectedOrderMaterialIds || []).map(String).filter((item) => item !== id);
  renderMaterialUsageInputs();
  calc();
}

function getMaterialUsageFromInputs() {
  const usage = [];
  const usedIds = new Set();

  document.querySelectorAll('.ams-weight').forEach((input) => {
    const materialId = String(input.dataset.id || input.closest('.order-material-row')?.dataset.id || '').trim();
    const grams = toPositiveNumber(input.value, 0);
    const material = getMaterialById(materialId);

    if (!material || grams <= 0 || usedIds.has(String(material.id))) return;
    usedIds.add(String(material.id));

    const pricePerGram = Number(material.weight || 0) > 0
      ? Number(material.price || 0) / Number(material.weight || 0)
      : 0;

    usage.push({
      materialId: Number(material.id),
      materialName: material.name,
      grams: Number(grams.toFixed(2)),
      pricePerGram: Number(pricePerGram.toFixed(6)),
      totalCost: Number((grams * pricePerGram).toFixed(2)),
      remaining: Number(material.remaining || 0)
    });
  });

  return usage;
}
