// ==UserScript==
// @name         Generate RRF
// @namespace    https://learn.sunyattain.org/
// @version      1.5
// @description  Fill the ATTAIN Resource Request Form template and download it
// @match        https://learn.sunyattain.org/local/user/index.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=sunyattain.org
// @grant        GM_xmlhttpRequest
// @connect      docs.google.com
// @connect      drive.google.com
// @connect      drive.usercontent.google.com
// @connect      *.googleusercontent.com
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// ==/UserScript==

(function () {
  'use strict';

  const FILE_ID = '1MDMm3FcLkty4xBiVDq7_Fdsf-CORN2J6';
  const TEMPLATE_URLS = [
    `https://drive.google.com/uc?export=download&id=${FILE_ID}`,
    `https://docs.google.com/spreadsheets/d/${FILE_ID}/export?format=xlsx`
  ];
  const BUTTON_BOTTOM_PX = 60;

  const KEY_OPTIONS = [
    { label: 'Spark',                       F: 'Spark', I: 'Learnkey' },
    { label: 'GED Ready - Math',            H: 'Math',            I: 'GED Readiness' },
    { label: 'GED Ready - Language Arts',   H: 'Language Arts',   I: 'GED Readiness' },
    { label: 'GED Ready - Social Studies',  H: 'Social Studies',  I: 'GED Readiness' },
    { label: 'GED Ready - Science',         H: 'Science',         I: 'GED Readiness' }
  ];

  const CATEGORY_MAP = [
    ['Supplemental', 'Supplemental'],
    ['TANF/Family',  'TANF FA'],
    ['TANF 200',     'TANF 200%'],
    ['Non',          'Non-TANF']
  ];

  const DEPARTMENT_MAP = {
    BERRY:   'Berry Houses Community Center',
    BMHA:    'BMHA Martha Mitchell Center',
    BXEOC:   'Bronx EOC',
    BKEOC:   'Brooklyn EOC',
    BUL:     'Broome County',
    BFEOC:   'Buffalo EOC',
    CSCC:    'Capital District Albany EOC',
    TROY:    'Capital District Troy EOC',
    BCH:     'Carlisle Hills Community Center',
    SHABAZZ: 'Dr. Betty Shabazz',
    DREW:    'Drew Hamilton community Center',
    ELM:     'ELMCOR',
    FAR:     'Far Rockaway Community Center',
    GMHC:    'GMHC',
    HBB:     'Hector B. Basora',
    HSS:     'Henry St. Settlement',
    RCB:     'Loretta C. Scott Center',
    BWD:     'LIEOC Brentwood',
    MEOC:    'Manhattan EOC',
    MVCC:    'Mohawk Valley',
    MLK:     'MLK Center',
    NFHA:    'Niagara Falls HA',
    NBCCC:   'North Bronx CCOC',
    PG:      'Polo Grounds Community Center',
    QEOC:    'Queens EOC',
    REOC:    'Rochester EOC',
    SOC:     'Schenectady Outreach Center',
    SJP:     "St. John's Place",
    MONT:    'Sullivan County',
    SEOC:    'Syracuse EOC',
    ARM:     'The Armory Foundation',
    WEOC:    'Westchester EOC'
  };

  const log = (...a) => console.log('[RRF]', ...a);

  // ---------- UI ----------
  function addButton() {
    if (document.getElementById('rrf-generate-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'rrf-generate-btn';
    btn.type = 'button';
    btn.textContent = 'Generate RRF';
    Object.assign(btn.style, {
      position: 'fixed', right: '20px', bottom: BUTTON_BOTTOM_PX + 'px', zIndex: 99999,
      padding: '8px 12px', background: '#0f6cbf', color: '#fff', border: 'none',
      borderRadius: '4px', cursor: 'pointer'
    });
    btn.addEventListener('click', onGenerate);
    document.body.appendChild(btn);
  }

  function askKeyType() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100000,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      });
      const box = document.createElement('div');
      Object.assign(box.style, {
        background: '#fff', color: '#222', padding: '20px 24px', borderRadius: '8px',
        minWidth: '320px', font: '14px sans-serif', boxShadow: '0 4px 20px rgba(0,0,0,.4)'
      });
      const title = document.createElement('div');
      title.textContent = 'What type of key do you need?';
      Object.assign(title.style, { fontWeight: '600', fontSize: '16px', marginBottom: '12px' });
      box.appendChild(title);

      const close = val => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
      const onKey = e => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);

      KEY_OPTIONS.forEach(opt => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = opt.label;
        Object.assign(b.style, {
          display: 'block', width: '100%', margin: '6px 0', padding: '8px 12px',
          border: '1px solid #0f6cbf', background: '#fff', color: '#0f6cbf',
          borderRadius: '4px', cursor: 'pointer', font: '14px sans-serif', textAlign: 'left'
        });
        b.addEventListener('click', () => close(opt));
        box.appendChild(b);
      });

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      Object.assign(cancel.style, { marginTop: '8px', padding: '6px 12px', cursor: 'pointer' });
      cancel.addEventListener('click', () => close(null));
      box.appendChild(cancel);

      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  // ---------- Form helpers ----------
  function fieldValue(form, name) {
    const el = form.querySelector(`[name="${name}"]`);
    return el ? el.value.trim() : '';
  }

  function categoryText() {
    const sel = document.querySelector('#id_category');
    if (!sel) return '';
    if (sel.tagName === 'SELECT') {
      const o = sel.options[sel.selectedIndex];
      return o ? o.text.trim() : '';
    }
    return (sel.value || '').trim();
  }

  function mapCategory(text) {
    const t = text.toLowerCase();
    for (const [prefix, out] of CATEGORY_MAP) {
      if (t.startsWith(prefix.toLowerCase())) return out;
    }
    return '';
  }

  function mapDepartment(code) {
    return DEPARTMENT_MAP[String(code).trim().toUpperCase()] || '';
  }

  // ---------- Template download ----------
  function gmGet(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, responseType: 'arraybuffer', timeout: 30000,
        onload: r => (r.status >= 200 && r.status < 300) ? resolve(r.response)
                                                         : reject(new Error('HTTP ' + r.status)),
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Download timed out'))
      });
    });
  }

  async function loadTemplate() {
    let lastErr;
    for (const url of TEMPLATE_URLS) {
      try {
        const buf = await gmGet(url);
        const bytes = new Uint8Array(buf.byteLength);   // copy into this realm
        bytes.set(new Uint8Array(buf));
        log('downloaded', bytes.length, 'bytes from', url);
        if (bytes[0] === 0x50 && bytes[1] === 0x4B) return bytes;
        lastErr = new Error('Response was not an .xlsx file (check sharing permissions)');
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Could not load template');
  }

  // ---------- Sheet XML patching (indexOf-based) ----------
  const esc = s => String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function colNum(col) {
    let n = 0;
    for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }

  function colName(n) {
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  const attr = (tag, name) => {
    const m = tag.match(new RegExp('\\s' + name + '="([^"]*)"'));
    return m ? m[1] : null;
  };

  const splitAddr = a => { const m = a.match(/^([A-Z]+)(\d+)$/); return { col: m[1], row: parseInt(m[2], 10) }; };

  // If addr lies inside a merged range, return that range's top-left cell
  function resolveMergeMaster(xml, addr) {
    const s = xml.indexOf('<mergeCells');
    if (s === -1) return addr;
    const e = xml.indexOf('</mergeCells>', s);
    const block = xml.slice(s, e === -1 ? xml.length : e);
    const { col, row } = splitAddr(addr);
    const c = colNum(col);
    const re = /<mergeCell\b[^>]*\bref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g;
    let m;
    while ((m = re.exec(block))) {
      const c1 = colNum(m[1]), r1 = +m[2], c2 = colNum(m[3]), r2 = +m[4];
      if (c >= c1 && c <= c2 && row >= r1 && row <= r2) {
        const master = colName(c1) + r1;
        if (master !== addr) log(`${addr} is inside merge ${m[1]}${m[2]}:${m[3]}${m[4]}; writing to ${master}`);
        return master;
      }
    }
    return addr;
  }

  function parseCells(inner) {
    const cells = [];
    let i = 0;
    while (true) {
      const s = inner.indexOf('<c ', i);
      if (s === -1) break;
      const tagEnd = inner.indexOf('>', s);
      const selfClose = inner[tagEnd - 1] === '/';
      const end = selfClose ? tagEnd + 1 : inner.indexOf('</c>', tagEnd) + 4;
      if (end < 4) throw new Error('Malformed cell XML');
      const tag = inner.slice(s, tagEnd + 1);
      const ref = attr(tag, 'r') || '';
      cells.push({ col: ref.replace(/\d+/g, ''), tag, xml: inner.slice(s, end) });
      i = end;
    }
    return cells;
  }

  function patchRowInner(inner, rowNum, values) {
    const cells = parseCells(inner);
    for (const col of Object.keys(values)) {
      const existing = cells.find(c => c.col === col);
      const style = existing && attr(existing.tag, 's');
      const xml = `<c r="${col}${rowNum}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${esc(values[col])}</t></is></c>`;
      if (existing) { existing.xml = xml; existing.tag = xml; }
      else cells.push({ col, tag: xml, xml });
    }
    cells.sort((a, b) => colNum(a.col) - colNum(b.col));
    return cells.map(c => c.xml).join('');
  }

  function patchSheetRow(xml, rowNum, values) {
    const sdStart = xml.indexOf('<sheetData');
    if (sdStart === -1) throw new Error('No sheetData in worksheet');
    const sdOpenEnd = xml.indexOf('>', sdStart);
    if (xml[sdOpenEnd - 1] === '/') throw new Error('Worksheet has no rows (empty sheetData)');
    const sdEnd = xml.indexOf('</sheetData>', sdOpenEnd);

    let i = sdOpenEnd + 1;
    let insertAt = sdEnd;
    while (true) {
      const s = xml.indexOf('<row ', i);
      if (s === -1 || s >= sdEnd) break;
      const tagEnd = xml.indexOf('>', s);
      const selfClose = xml[tagEnd - 1] === '/';
      let tag = xml.slice(s, tagEnd + 1);
      const r = parseInt(attr(tag, 'r'), 10);
      const rowEnd = selfClose ? tagEnd + 1 : xml.indexOf('</row>', tagEnd) + 6;

      if (r === rowNum) {
        tag = tag.replace(/\sspans="[^"]*"/, '');
        if (selfClose) tag = tag.slice(0, -2) + '>';
        const inner = selfClose ? '' : xml.slice(tagEnd + 1, rowEnd - 6);
        const newRow = tag + patchRowInner(inner, rowNum, values) + '</row>';
        return xml.slice(0, s) + newRow + xml.slice(rowEnd);
      }
      if (r > rowNum) { insertAt = s; break; }
      i = rowEnd;
    }
    const newRow = `<row r="${rowNum}">${patchRowInner('', rowNum, values)}</row>`;
    return xml.slice(0, insertAt) + newRow + xml.slice(insertAt);
  }

  // cellValues: { "C10": "text", "F6": "text", ... }
  function patchSheet(xml, cellValues) {
    const byRow = {};
    for (const [addr, val] of Object.entries(cellValues)) {
      const master = resolveMergeMaster(xml, addr);
      const { col, row } = splitAddr(master);
      (byRow[row] = byRow[row] || {})[col] = val;
    }
    for (const row of Object.keys(byRow)) {
      xml = patchSheetRow(xml, parseInt(row, 10), byRow[row]);
    }
    return xml;
  }

  function firstSheetPath(files) {
    const wb = fflate.strFromU8(files['xl/workbook.xml']);
    const sheetTag = wb.match(/<sheet\b[^>]*>/);
    if (!sheetTag) throw new Error('No sheets found in workbook');
    const rid = sheetTag[0].match(/\b[\w]+:id="([^"]+)"/)[1];
    const rels = fflate.strFromU8(files['xl/_rels/workbook.xml.rels']);
    for (const rel of rels.match(/<Relationship\b[^>]*>/g) || []) {
      if (attr(rel, 'Id') === rid) {
        const target = attr(rel, 'Target');
        return target.startsWith('/') ? target.slice(1) : 'xl/' + target;
      }
    }
    throw new Error('Could not locate first worksheet');
  }

  function timestamp() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
  }

  // ---------- Main ----------
  async function onGenerate() {
    const form = document.querySelector('#mform1');
    if (!form) { alert('Form #mform1 not found on this page.'); return; }

    const key = await askKeyType();
    if (!key) return;

    const btn = document.getElementById('rrf-generate-btn');
    const oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Generating…';

    try {
      if (typeof fflate === 'undefined') throw new Error('fflate library did not load');

      const bytes = await loadTemplate();
      const files = fflate.unzipSync(bytes);
      log('unzipped', Object.keys(files).length, 'parts');

      const sheetPath = firstSheetPath(files);
      if (!files[sheetPath]) throw new Error('Sheet part not found: ' + sheetPath);
      log('sheet part:', sheetPath);

      const values = {};
      values.C10 = [fieldValue(form, 'firstname'), fieldValue(form, 'lastname')]
        .filter(Boolean).join(' ');

      const cat = mapCategory(categoryText());
      if (cat) values.K10 = cat;

      const deptCode = fieldValue(form, 'department');
      const deptName = mapDepartment(deptCode);
      if (deptName) values.F6 = deptName;
      else log('no department mapping for value:', JSON.stringify(deptCode), '(F6 left unchanged)');

      if (key.F) values.F10 = key.F;
      if (key.H) values.H10 = key.H;
      if (key.I) values.I10 = key.I;
      log('values:', values);

      const xml = patchSheet(fflate.strFromU8(files[sheetPath]), values);
      files[sheetPath] = fflate.strToU8(xml);

      const out = fflate.zipSync(files, { level: 6 });
      const blob = new Blob([out], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ATTAIN Resource Request Form _${timestamp()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      log('done');
    } catch (e) {
      console.error('[RRF] generation failed:', e);
      alert('Could not generate RRF: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = oldText;
    }
  }

  addButton();
})();
