const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const FILE_NAME = 'متابعة_MOO3D_Farm.xlsx';
const IMPORT_SHEET = 'استيراد البرنامج';
const LIMIT = 500;
const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const columns = 'ABCDEFG';

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
  const text = (await part.async('string')).replace(/^\uFEFF/, '');
  return new DOMParser().parseFromString(text, 'application/xml');
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

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length > LIMIT) {
    throw new Error('ملف المتابعة يدعم حتى 500 أوردر.');
  }
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 7 || !row[0]
      || !row.slice(0, 4).every((value) => typeof value === 'string' && value.length <= 32767)
      || !row.slice(4).every((value) => Number.isFinite(value) && value >= 0)) {
      throw new Error('فيه بيانات أوردر غير صالحة للتصدير.');
    }
  }
}

async function updateWorkbook(buffer, rows) {
  const zip = await JSZip.loadAsync(buffer);
  const workbookPath = 'xl/workbook.xml';
  const workbook = await readXml(zip, workbookPath);
  const sheets = Array.from(workbook.getElementsByTagNameNS(SHEET_NS, 'sheet'));
  const sheet = sheets.find((item) => item.getAttribute('name') === IMPORT_SHEET);
  if (!sheet) throw new Error('الملف الموجود لازم يحتوي على تبويب «استيراد البرنامج».');
  const relId = sheet.getAttributeNS(OFFICE_REL_NS, 'id');
  const relationships = await readXml(zip, 'xl/_rels/workbook.xml.rels');
  const relation = Array.from(relationships.getElementsByTagName('Relationship'))
    .find((item) => item.getAttribute('Id') === relId);
  const target = relation?.getAttribute('Target');
  if (!target || relation.getAttribute('TargetMode') === 'External') throw new Error('تبويب الاستيراد غير صالح.');
  const sheetPath = target.startsWith('/') ? target.slice(1) : path.posix.join('xl', target);
  const sheetXml = await readXml(zip, sheetPath);
  const sheetData = sheetXml.getElementsByTagNameNS(SHEET_NS, 'sheetData')[0];
  const rowElements = new Map(Array.from(sheetData.getElementsByTagNameNS(SHEET_NS, 'row'))
    .map((element) => [Number(element.getAttribute('r')), element]));
  if (!rowElements.has(4)) throw new Error('جدول استيراد البرنامج ناقص.');
  const date1904 = workbook.getElementsByTagNameNS(SHEET_NS, 'workbookPr')[0]?.getAttribute('date1904');
  const dateOffset = date1904 === '1' || date1904 === 'true' ? 24107 : 25569;

  for (let i = 0; i < LIMIT; i++) {
    const number = i + 5;
    const values = rows[i];
    let row = rowElements.get(number);
    if (!row && !values) continue;
    if (!row) {
      row = sheetXml.createElementNS(SHEET_NS, 'row');
      row.setAttribute('r', String(number));
      const next = Array.from(sheetData.getElementsByTagNameNS(SHEET_NS, 'row'))
        .find((element) => Number(element.getAttribute('r')) > number);
      sheetData.insertBefore(row, next || null);
    }
    for (let col = 0; col < columns.length; col++) {
      let value = values?.[col];
      if (col === 1 && value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const date = new Date(value + 'T00:00:00Z');
        if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) {
          value = date.getTime() / 86400000 + dateOffset;
        }
      }
      setCell(row, columns[col] + number, value);
    }
  }

  const view = sheetXml.getElementsByTagNameNS(SHEET_NS, 'sheetView')[0];
  if (view) view.setAttribute('rightToLeft', '1');
  let calc = workbook.getElementsByTagNameNS(SHEET_NS, 'calcPr')[0];
  if (!calc) {
    calc = workbook.createElementNS(SHEET_NS, 'calcPr');
    const extList = workbook.getElementsByTagNameNS(SHEET_NS, 'extLst')[0];
    workbook.documentElement.insertBefore(calc, extList?.parentNode === workbook.documentElement ? extList : null);
  }
  calc.setAttribute('fullCalcOnLoad', '1');
  const serializer = new XMLSerializer();
  zip.file(sheetPath, serializer.serializeToString(sheetXml));
  zip.file(workbookPath, serializer.serializeToString(workbook));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function saveTrackingWorkbook(directory, rows) {
  validateRows(rows);
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, FILE_NAME);
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  const template = path.join(__dirname, 'assets', 'tracking-template.xlsx');
  for (const name of ['~$' + FILE_NAME, '~$' + FILE_NAME.slice(2)]) {
    if (await fs.stat(path.join(directory, name)).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    })) {
      throw new Error('اقفل شيت المتابعة في Excel قبل ما تعيد التصدير.');
    }
  }
  const existing = await readIfPresent(target);
  const updated = await updateWorkbook(existing ?? await fs.readFile(template), rows);

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

module.exports = { saveTrackingWorkbook };
