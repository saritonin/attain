// ==UserScript==
// @name         Generate auto-filled TANF PDF
// @namespace    http://tampermonkey.net/
// @version      2026-11-05.6
// @description  uses values on participant page to generate a pre-filled TANF form
// @author       You
// @match        https://learn.sunyattain.org/local/user/index.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=sunyattain.org
// @grant        GM_xmlhttpRequest
// @connect      drive.google.com
// @connect      drive.usercontent.google.com
// @connect      googleusercontent.com
// @require      https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js
// ==/UserScript==

/* global PDFLib */

(function () {
  'use strict';

  const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } = PDFLib;
  const PDF_URL = 'https://drive.google.com/uc?export=download&id=1EM1SWZ4tJaR6a3RtsBo6XOuiv243A47U';
  const HOUSEHOLD_MEMBERS = 5; // fh fields 1-5 -> PDF fields b2-b6

  // ---- Page helpers ----
  const getForm = () => document.querySelector('#mform1');

  // Value of a form field by name (first matching element)
  function val(name) {
    const el = getForm().querySelector(`[name="${CSS.escape(name)}"]`);
    return el ? (el.value || '').trim() : '';
  }

  // True if the field "has value 1". For checkboxes/radios only checked ones count.
  function isOne(name) {
    const els = getForm().querySelectorAll(`[name="${CSS.escape(name)}"]`);
    return [...els].some((el) => {
      if (el.type === 'checkbox' || el.type === 'radio') {
        return el.checked && el.value === '1';
      }
      return String(el.value).trim() === '1';
    });
  }

  // Initial caps: "mary-jane o'BRIEN" -> "Mary-Jane O'Brien"
  const KEEP_UPPER = new Set(['PO', 'NE', 'NW', 'SE', 'SW']);

  function titleCase(str) {
    return str
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map((word) => {
        if (KEEP_UPPER.has(word.toUpperCase().replace(/\./g, ''))) return word.toUpperCase();
        if (/^\d+(st|nd|rd|th)$/.test(word)) return word; // 1st, 2nd, 3rd, 4th
        return word
          .replace(/(^|[-'’.])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase()) // after space, hyphen, apostrophe, period
          .replace(/^Mc([a-z])/, (m, ch) => 'Mc' + ch.toUpperCase()); // McDonald
      })
      .join(' ');
  }

  // First initial + first 5 letters of last name + _YYYYMMDD_TANF, e.g. JSmith_20261105_TANF.pdf
  function makeFilename() {
    const lettersOnly = (s) => s.replace(/[^A-Za-z0-9]/g, '');
    const first = lettersOnly(titleCase(val('firstname')));
    const last = lettersOnly(titleCase(val('lastname')));

    const d = new Date();
    const date = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('');

    return `${first.charAt(0)}${last.slice(0, 5)}_${date}_TANF.pdf`;
  }

  // Looks at household members (ages come from fhage1-6) and returns what the PDF and warnings need
  function checkHousehold() {
    let hasMinor = false;
    const unreadable = [];

    for (let i = 1; i <= HOUSEHOLD_MEMBERS; i++) {
      const ageText = val(`fhage${i}`);
      if (!ageText) continue;
      const age = parseInt(ageText, 10);
      if (Number.isNaN(age)) unreadable.push(i);
      else if (age < 18) hasMinor = true;
    }

    const member6Exists = ['fhname6', 'fhdob6', 'fhrel6', 'fhage6'].some((n) => val(n));
    const age6 = parseInt(val('fhage6'), 10);
    const member6Minor = !Number.isNaN(age6) && age6 < 18;

    return { hasMinor, unreadable, member6Exists, member6Minor };
  }

  // ---- PDF helper: sets a field whatever its type ----
  function setPdf(pdfForm, name, value) {
    const field = pdfForm.getFieldMaybe(name);
    if (!field) {
      console.warn(`PDF field not found: ${name}`);
      return;
    }
    if (field instanceof PDFTextField) {
      field.setText(value);
    } else if (field instanceof PDFCheckBox) {
      value ? field.check() : field.uncheck();
    } else if (field instanceof PDFDropdown || field instanceof PDFRadioGroup) {
      field.select(value);
    } else {
      console.warn(`Unsupported PDF field type for: ${name}`);
    }
  }

  // ---- Build the values to write ----
  function buildValues(household) {
    const first = titleCase(val('firstname'));
    const last = titleCase(val('lastname'));

    // "123 Main St, Troy, NY 12180" (skips any empty pieces)
    const stateZip = [val('usastate'), val('zip')].filter(Boolean).join(' ');
    const homeAddress = [titleCase(val('address')), titleCase(val('city')), stateZip]
      .filter(Boolean)
      .join(', ');

    const values = {
      applicant_name: `${first} ${last}`.trim(),
      applicant_bday: val('dobdate'),
      home_address: homeAddress,
      telephone_number: val('phone1')
    };

    // Household members: fhname1..5 -> b2_name..b6_name, etc.
    for (let i = 1; i <= HOUSEHOLD_MEMBERS; i++) {
      const b = i + 1;
      values[`b${b}_name`] = val(`fhname${i}`);
      values[`b${b}_bday`] = val(`fhdob${i}`);
      values[`b${b}_rel`] = val(`fhrel${i}`);
    }

    // Assistance programs: [page field(s), PDF field]
    const programs = [
      [['asafnet', 'atanf'], 'assistance_fa'],
      [['afs'], 'assistance_snap'],
      [['amaid'], 'assistance_medicaid'],
      [['ahp'], 'assistance_heap'],
      [['assi'], 'assistance_ssi']
    ];

    programs.forEach(([pageFields, pdfField]) => {
      if (pageFields.some(isOne)) {
        values.assistance = 'yes';
        values[pdfField] = 'yes';
      }
    });

    // Any household member 1-5 under 18
    if (household.hasMinor) {
      values.qualify_minor = 'yes';
      values.b_has_minor_child = 'yes';
    }

    return values;
  }

  // ---- Button + progress indicator ----
  const POS = { position: 'fixed', bottom: '16px', right: '16px', zIndex: 99999 };

  const btn = document.createElement('button');
  btn.textContent = 'Generate auto-filled TANF PDF';
  Object.assign(btn.style, POS, {
    padding: '8px 12px', background: '#0f6cbf', color: '#fff',
    border: 'none', borderRadius: '4px', cursor: 'pointer'
  });

  const status = document.createElement('div');
  Object.assign(status.style, POS, {
    display: 'none', alignItems: 'center', gap: '8px',
    padding: '8px 12px', background: '#fff', color: '#333',
    border: '1px solid #0f6cbf', borderRadius: '4px',
    font: '14px sans-serif', boxShadow: '0 2px 6px rgba(0,0,0,.2)'
  });

  const spinner = document.createElement('span');
  Object.assign(spinner.style, {
    width: '14px', height: '14px', boxSizing: 'border-box',
    border: '2px solid #cfe2f5', borderTopColor: '#0f6cbf',
    borderRadius: '50%', display: 'inline-block'
  });
  spinner.animate(
    [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
    { duration: 800, iterations: Infinity }
  );

  const statusText = document.createElement('span');
  statusText.textContent = 'Generating PDF...';

  status.append(spinner, statusText);

  function setBusy(busy) {
    btn.style.display = busy ? 'none' : '';
    status.style.display = busy ? 'flex' : 'none';
  }

  // ---- Main ----
  function fillPdf() {
    if (!getForm()) return alert('#mform1 not found');

    const household = checkHousehold();
    const values = buildValues(household);
    const filename = makeFilename();
    console.log('Values to write:', values);

    const warnings = [];
    if (household.member6Exists) {
      let msg = 'Household member 6 will NOT be added to the PDF automatically. You will need to add them manually.';
      if (household.member6Minor && !household.hasMinor) {
        msg += '\n\nNote: household member 6 is the only household member under 18, ' +
               'so the minor fields (qualify_minor and b_has_minor_child) were NOT set to "yes". ' +
               'You will need to mark those manually.';
      }
      warnings.push(msg);
    }
    if (household.unreadable.length) {
      warnings.push(
        `Could not read the age for household member(s) ${household.unreadable.join(', ')}, ` +
        'so they were not checked for being under 18.'
      );
    }
    if (warnings.length) {
      alert('Warning:\n\n' + warnings.join('\n\n') + '\n\nThe PDF will still be generated.');
    }

    setBusy(true);

    GM_xmlhttpRequest({
      method: 'GET',
      url: PDF_URL,
      responseType: 'arraybuffer',
      timeout: 30000,
      onload: async (res) => {
        try {
          if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
          const pdfDoc = await PDFDocument.load(res.response);
          const pdfForm = pdfDoc.getForm();

          Object.entries(values).forEach(([name, value]) => setPdf(pdfForm, name, value));

          const bytes = await pdfDoc.save();
          const blob = new Blob([bytes], { type: 'application/pdf' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } catch (err) {
          console.error('PDF fill failed:', err);
          alert('PDF fill failed: ' + err.message);
        } finally {
          setBusy(false);
        }
      },
      onerror: (err) => {
        console.error('Request failed:', err);
        alert('Could not download the PDF template.');
        setBusy(false);
      },
      ontimeout: () => {
        alert('Timed out downloading the PDF template.');
        setBusy(false);
      }
    });
  }

  btn.onclick = fillPdf;
  document.body.append(btn, status);
})();