const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const FILE_NAME = 'متابعة_MOO3D_Farm_بداية_جديدة.xlsx';
const LIMIT = 5000;
const TEMPLATE = path.join(__dirname, 'assets', 'tracking-template.xlsx');
const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

async function readIfPresent(file) {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readXml(zip, entry) {
  const part = zip.file(entry);
  if (!part) throw new Error('ملف المتابعة غير صالح أو ناقص.');
  const text = (await part.async('string')).replace(/^\uFEFF/, '').replace(/^<\?xml\s+[^?]*\?>\s*/, '');
  if (/<!DOCTYPE\b/i.test(text)) throw new Error('ملف المتابعة يحتوي على تعريف XML غير مدعوم.');
  return new DOMParser({ onError(level, message) { throw new Error(message); } }).parseFromString(text, 'application/xml');
}

function setCell(row, address, value) {
  let cell = Array.from(row.getElementsByTagNameNS(SHEET_NS, 'c'))
    .find((candidate) => candidate.getAttribute('r') === address);
  if (!cell && value == null) return;
  const doc = row.ownerDocument;
  if (!cell) {
    cell = doc.createElementNS(SHEET_NS, 'c');
    cell.setAttribute('r', address);
    const next = Array.from(row.getElementsByTagNameNS(SHEET_NS, 'c')).find((candidate) => {
      const column = candidate.getAttribute('r').replace(/\d+$/, '');
      return column.length > 1 || column > address[0];
    });
    row.insertBefore(cell, next || null);
  }
  cell.removeAttribute('t');
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  if (value == null || value === '') return;
  if (typeof value === 'number') {
    const node = doc.createElementNS(SHEET_NS, 'v');
    node.textContent = String(value);
    cell.appendChild(node);
  } else {
    cell.setAttribute('t', 'inlineStr');
    const inline = doc.createElementNS(SHEET_NS, 'is');
    const text = doc.createElementNS(SHEET_NS, 't');
    text.textContent = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    inline.appendChild(text);
    cell.appendChild(inline);
  }
}

function toExcelDate(value, offset) {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) return text;
  return date.getTime() / 86400000 + offset;
}

function resolveSheetPath(workbook, relationships, name) {
  const sheets = Array.from(workbook.getElementsByTagNameNS(SHEET_NS, 'sheet'));
  const sheet = sheets.find((item) => item.getAttribute('name') === name);
  if (!sheet) throw new Error('ملف المتابعة الحالي مختلف عن قالب البداية الجديدة.');
  const relId = sheet.getAttributeNS(OFFICE_REL_NS, 'id');
  const relation = Array.from(relationships.getElementsByTagNameNS('*', 'Relationship'))
    .find((item) => item.getAttribute('Id') === relId);
  const target = relation?.getAttribute('Target');
  if (!target || relation.getAttribute('TargetMode') === 'External') throw new Error('تبويب المتابعة غير صالح.');
  const entry = target.startsWith('/') ? target.slice(1) : path.posix.join('xl', target);
  if (!/^xl\/worksheets\/[\w.-]+\.xml$/.test(entry)) throw new Error('مسار تبويب المتابعة غير صالح.');
  return entry;
}

function getRows(sheetXml) {
  const sheetData = sheetXml.getElementsByTagNameNS(SHEET_NS, 'sheetData')[0];
  const rows = new Map(Array.from(sheetData.getElementsByTagNameNS(SHEET_NS, 'row'))
    .map((element) => [Number(element.getAttribute('r')), element]));
  return { sheetData, rows };
}

function updateRows(sheetXml, records, columns) {
  const { rows, sheetData } = getRows(sheetXml);
  if (!rows.has(4)) throw new Error('جدول المتابعة ناقص.');

  for (const [number, row] of rows) {
    if (number < records.length + 5 || number > LIMIT + 4) continue;
    // Empty styled cells are retained for later exports.
    for (const col of columns) setCell(row, col + number, null);
  }

  for (const [index, values] of records.entries()) {
    const number = index + 5;
    let row = rows.get(number);
    if (!row) {
      row = sheetXml.createElementNS(SHEET_NS, 'row');
      row.setAttribute('r', String(number));
      const next = Array.from(sheetData.getElementsByTagNameNS(SHEET_NS, 'row'))
        .find((element) => Number(element.getAttribute('r')) > number);
      sheetData.insertBefore(row, next || null);
    }
    values.forEach((value, col) => setCell(row, columns[col] + number, value));
  }
}

async function updateWorkbook(buffer, snapshot) {
  const zip = await JSZip.loadAsync(buffer);
  const workbookPath = 'xl/workbook.xml';
  const workbook = await readXml(zip, workbookPath);
  const relationships = await readXml(zip, 'xl/_rels/workbook.xml.rels');
  const date1904 = workbook.getElementsByTagNameNS(SHEET_NS, 'workbookPr')[0]?.getAttribute('date1904');
  const dateOffset = date1904 === '1' || date1904 === 'true' ? 24107 : 25569;
  const date = (value) => toExcelDate(value, dateOffset);
  const text = (value) => String(value ?? '').slice(0, 32767);
  const orderRows = snapshot.orders.map((order) => [
    text(order.code), date(order.date), text(order.itemName), text(order.customerName),
    order.finalPrice, order.totalCost + order.accessoriesCost + order.shippingCost,
    order.paidAmount, order.profit, Math.max(0, order.finalPrice - order.paidAmount),
    order.finalPrice ? order.profit / order.finalPrice : null
  ]);
  const purchaseRows = snapshot.purchases.map((purchase) => [
    `PUR-${purchase.id}`, date(purchase.date), text(purchase.item), text(purchase.category),
    purchase.quantity, purchase.gramsPerUnit, purchase.amount, text(purchase.supplier), text(purchase.notes)
  ]);
  if (![...orderRows, ...purchaseRows].every((row) => row.every((value) => typeof value !== 'number' || Number.isFinite(value)))) {
    throw new Error('فيه أرقام غير صالحة في بيانات التصدير.');
  }

  const hasClassicLayout = Array.from(workbook.getElementsByTagNameNS(SHEET_NS, 'sheet'))
    .some((sheet) => sheet.getAttribute('name') === 'استيراد البرنامج');
  const tables = [['المشتريات', 'ABCDEFGHI', purchaseRows]];
  if (hasClassicLayout) {
    const purchaseMonth = (value) => {
      const result = date(String(value || '').slice(0, 7) + '-01');
      return typeof result === 'number' ? result : null;
    };
    const materialRows = snapshot.purchases.filter((purchase) => purchase.category === 'خامات').map((purchase) => [
      date(purchase.date), text(purchase.item), purchase.amount, text(purchase.notes), 'جديد', purchaseMonth(purchase.date)
    ]);
    const expenseCategories = new Set(['صيانة', 'دعاية', 'أدوات', 'أخرى']);
    const expenseRows = snapshot.purchases.filter((purchase) => expenseCategories.has(purchase.category)).map((purchase) => [
      date(purchase.date), text(purchase.item), text(purchase.category), purchase.amount, purchaseMonth(purchase.date)
    ]);
    tables.push(
      ['استيراد البرنامج', 'ABCDEFG', orderRows.map((row) => row.slice(0, 7))],
      ['الخامات', 'ABCDEF', materialRows],
      ['المصروفات', 'ABCDE', expenseRows]
    );
  } else {
    tables.push(['الطلبات', 'ABCDEFGHIJ', orderRows]);
  }

  const serializer = new XMLSerializer();
  for (const [name, columns, rows] of tables) {
    const sheetPath = resolveSheetPath(workbook, relationships, name);
    const sheet = await readXml(zip, sheetPath);
    if (!sheet.getElementsByTagNameNS(SHEET_NS, 'sheetProtection').length) {
      throw new Error('ملف المتابعة الحالي مختلف عن قالب البداية الجديدة.');
    }
    updateRows(sheet, rows, columns);
    zip.file(sheetPath, serializer.serializeToString(sheet, { requireWellFormed: true }));
  }
  const metricsPath = resolveSheetPath(workbook, relationships, hasClassicLayout ? 'الإعدادات' : 'لوحة المتابعة');
  const metrics = await readXml(zip, metricsPath);
  const metricsRows = getRows(metrics).rows;
  const updates = hasClassicLayout
    ? [[6, snapshot.totalAssets], [21, snapshot.openingCash], [22, snapshot.stockValue], [23, snapshot.materialUsed]]
    : [[11, snapshot.openingCash]];
  for (const [number, value] of updates) {
    const row = metricsRows.get(number);
    if (!row || !Number.isFinite(value)) throw new Error('تعذر تحديث أرقام لوحة المتابعة.');
    setCell(row, 'B' + number, value);
  }
  zip.file(metricsPath, serializer.serializeToString(metrics, { requireWellFormed: true }));

  let calc = workbook.getElementsByTagNameNS(SHEET_NS, 'calcPr')[0];
  if (!calc) {
    calc = workbook.createElementNS(SHEET_NS, 'calcPr');
    const extList = workbook.getElementsByTagNameNS(SHEET_NS, 'extLst')[0];
    workbook.documentElement.insertBefore(calc, extList?.parentNode === workbook.documentElement ? extList : null);
  }
  calc.setAttribute('fullCalcOnLoad', '1');
  zip.file(workbookPath, serializer.serializeToString(workbook, { requireWellFormed: true }));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function checkWorkbookClosed(directory) {
  for (const name of ['~$' + FILE_NAME, '~$' + FILE_NAME.slice(2)]) {
    if (await fs.stat(path.join(directory, name)).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    })) {
      throw new Error('اقفل شيت المتابعة في Excel قبل ما تعيد التصدير.');
    }
  }
}

async function writeWorkbook(target, updated, existing) {
  const temporary = path.join(path.dirname(target), `.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, updated, { flag: 'wx' });
    if (existing) {
      const current = await readIfPresent(target);
      if (!current?.equals(existing)) throw new Error('شيت المتابعة اتغيّر أثناء التصدير. جرّب تاني.');
      await fs.rename(temporary, target);
    } else {
      await fs.link(temporary, target);
    }
    return target;
  } catch (error) {
    if (['EACCES', 'EPERM', 'EBUSY'].includes(error.code)) {
      throw new Error('تعذر حفظ شيت المتابعة في المستندات. لو مفتوح في Excel اقفله وجرّب تاني.');
    }
    throw error;
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

async function ensureTrackingWorkbook(directory) {
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, FILE_NAME);
  if (await readIfPresent(target)) return target;
  try {
    return await writeWorkbook(target, await fs.readFile(TEMPLATE), null);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return target;
  }
}

async function prepareTrackingReset(directory, backupPath) {
  await fs.mkdir(directory, { recursive: true });
  await checkWorkbookClosed(directory);
  const target = path.join(directory, FILE_NAME);
  const existing = await readIfPresent(target);
  const blank = await fs.readFile(TEMPLATE);
  if (existing?.equals(blank)) return async () => {};
  if (existing) {
    const workbookBackup = path.join(path.dirname(backupPath), path.basename(backupPath, '.json') + '-tracking.xlsx');
    await fs.writeFile(workbookBackup, existing, { flag: 'wx' });
  }
  return async () => {
    await checkWorkbookClosed(directory);
    await writeWorkbook(target, blank, existing);
  };
}

async function saveTrackingWorkbook(directory, snapshot) {
  if (snapshot.orders.length > LIMIT || snapshot.purchases.length > LIMIT) {
    throw new Error('الشيت يدعم حتى 5000 أوردر و5000 عملية شراء. لم يتغير الملف.');
  }
  await fs.mkdir(directory, { recursive: true });
  await checkWorkbookClosed(directory);
  const target = path.join(directory, FILE_NAME);
  const existing = await readIfPresent(target);
  const updated = await updateWorkbook(existing ?? await fs.readFile(TEMPLATE), snapshot);
  await checkWorkbookClosed(directory);
  return writeWorkbook(target, updated, existing);
}

module.exports = { ensureTrackingWorkbook, prepareTrackingReset, saveTrackingWorkbook };
