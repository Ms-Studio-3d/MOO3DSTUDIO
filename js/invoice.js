function openInvoice(code) {
  const order = getOrderByCode(code);

  if (!order) {
    showToast('الأوردر غير موجود', 'error');
    return;
  }

  currentInvoiceOrderCode = code;
  renderInvoice(order);
  openModal('invoiceModal');
}

function closeInvoice() {
  currentInvoiceOrderCode = null;
  closeModal('invoiceModal');
}

function renderInvoice(order) {
  const invoiceContent = $('invoiceContent');
  if (!invoiceContent) return;

  const farmName = dashboardData.config.farmName || DEFAULT_CONFIG.farmName;

  invoiceContent.innerHTML = `
    <div class="invoice-sheet">
      <div class="invoice-header">
        <div class="invoice-brand">
          <h1>${escapeHtml(farmName)}</h1>
          <p>فاتورة طباعة ثلاثية الأبعاد</p>
          <span class="invoice-badge">مدفوع بالكامل</span>
        </div>

        <div class="invoice-meta">
          <p><strong>رقم الأوردر:</strong> ${escapeHtml(order.code || '-')}</p>
          <p><strong>التاريخ:</strong> ${escapeHtml(order.date || '-')}</p>
          <p><strong>العميل:</strong> ${escapeHtml(order.customerName || '-')}</p>
        </div>
      </div>

      <div class="invoice-section">
        <h3>بيانات الأوردر</h3>
        <div class="invoice-grid">
          <div class="invoice-box">
            <span>اسم المجسم</span>
            <strong>${escapeHtml(order.itemName || '-')}</strong>
          </div>

          <div class="invoice-box">
            <span>الطابعة</span>
            <strong>${escapeHtml(order.printerName || '-')}</strong>
          </div>

          <div class="invoice-box">
            <span>عدد القطع</span>
            <strong>${formatNumber(order.quantity || 1)}</strong>
          </div>

          <div class="invoice-box">
            <span>إجمالي وقت الطباعة للأوردر</span>
            <strong>${formatHoursMinutes(order.printHours || 0)}</strong>
          </div>

          <div class="invoice-box">
            <span>الشغل اليدوي</span>
            <strong>${formatNumber(order.manualMinutes || 0)} دقيقة</strong>
          </div>
        </div>
      </div>

      <div class="invoice-total">
        <div>
          <span>سعر القطعة تقريبيًا</span>
          <strong>${formatMoney(order.unitFinalPrice || ((order.finalPrice || 0) / Math.max(1, Number(order.quantity || 1))))}</strong>
        </div>
        <div>
          <span>سعر البيع النهائي</span>
          <strong>${formatMoney(order.finalPrice || 0)}</strong>
        </div>
        <div>
          <span>المبلغ المحصل</span>
          <strong>${formatMoney(getOrderPaidAmount(order))}</strong>
        </div>
      </div>

      <p class="invoice-notes">نسخة العميل — لا تتضمن تكاليف التشغيل أو الربح أو الملاحظات الداخلية.</p>
    </div>
  `;
}

function printInvoice() {
  window.print();
}
