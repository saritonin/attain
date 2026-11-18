// ==UserScript==
// @name         GMetrix - Open IC3 GS5 Spark Details
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Adds a button next to the student name; opens IC3 GS5 Spark Details and shows Post Assessment completion status
// @match        https://manage.gmetrix.net/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gmetrix.net
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const REPORT_NAME = 'Student Course Activity';
  const COURSE_NAME = 'IC3 GS5 Spark';
  const PASS_AT_OR_ABOVE = 80;
  const INDICATOR_ID = 'tm-complete-indicator';
  const BUTTON_ID = 'tm-open-ic3-details';
  const URL_CHECK_MS = 500;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const isVisible = (el) => !!(el && el.offsetParent !== null);
  const onStudentsPage = () => location.pathname.startsWith('/students/');

  async function waitFor(fn, timeout = 15000, interval = 200) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const result = fn();
        if (result) return result;
      } catch (e) { /* keep polling */ }
      await sleep(interval);
    }
    return null;
  }

  // Step 1: click "Reports and Activity" tab, return its tab pane
  async function openActivityTab() {
    const label = await waitFor(() =>
      [...document.querySelectorAll('.joyride-activity-tab')]
        .find((el) => norm(el.textContent) === 'Reports and Activity')
    );
    if (!label) throw new Error('Reports and Activity tab not found');
    const tab = label.closest('a[role="tab"]') || label;
    if (tab.getAttribute('aria-selected') !== 'true') tab.click();

    const paneId = tab.getAttribute('aria-controls');
    const pane = await waitFor(() => {
      const p = paneId && document.getElementById(paneId);
      return p && isVisible(p) ? p : null;
    });
    if (!pane) throw new Error('Reports and Activity pane not found');
    return pane;
  }

  // Step 2: set the report dropdown to "Student Course Activity"
  async function selectReport(pane) {
    const getToggles = () =>
      [...pane.querySelectorAll('button.dropdown-toggle[aria-haspopup="listbox"]')].filter(isVisible);
    const reportIsSet = () => getToggles().some((b) => norm(b.textContent) === REPORT_NAME);

    await waitFor(() => getToggles().length);
    if (reportIsSet()) return;

    for (const toggle of getToggles()) {
      toggle.click();
      const option = await waitFor(() =>
        [...document.querySelectorAll('[role="option"], .dropdown-item')]
          .find((el) => isVisible(el) && norm(el.textContent) === REPORT_NAME),
        2500
      );
      if (option) {
        option.click();
        const ok = await waitFor(reportIsSet, 5000);
        if (!ok) throw new Error('Report selection did not stick');
        return;
      }
      toggle.click(); // wrong dropdown, close it
      await sleep(200);
    }
    throw new Error('Could not find the report dropdown option');
  }

  // Step 3: find the td with aria-label="IC3 GS5 Spark" and click Details in its row
  async function openDetails(pane) {
    const row = await waitFor(() => {
      const td = [...pane.querySelectorAll('td[aria-label]')].find(
        (el) => norm(el.getAttribute('aria-label')) === COURSE_NAME && isVisible(el)
      );
      return td ? td.closest('tr') : null;
    }, 20000);

    if (!row) throw new Error(COURSE_NAME + ' row not found');
    const btn = row.querySelector('button[title="Details"]');
    if (!btn) throw new Error('Details button not found in row');
    btn.click();
  }

  // Step 4: in the Details modal, show COMPLETE or INCOMPLETE based on "Post Assessment" scores
  async function showCompletionIndicator() {
    const table = await waitFor(() => {
      const scope = document.querySelector('.modal') || document;
      return [...scope.querySelectorAll('table')].find((t) => {
        const headers = [...t.querySelectorAll('thead th')].map((th) => norm(th.textContent));
        return headers.includes('Resource') && headers.includes('Score') &&
               t.querySelectorAll('tbody tr').length > 0;
      });
    }, 20000);
    if (!table) throw new Error('Resource table not found in the Details modal');

    const headers = [...table.querySelectorAll('thead th')].map((th) => norm(th.textContent));
    const resCol = headers.indexOf('Resource');
    const scoreCol = headers.indexOf('Score');

    const postRows = [...table.querySelectorAll('tbody tr')].filter((tr) => {
      const cell = tr.children[resCol];
      return cell && norm(cell.textContent).endsWith('Post Assessment');
    });

    const total = postRows.length;
    const done = postRows.filter((tr) => {
      const score = parseFloat(norm(tr.children[scoreCol].textContent)); // "94 %" -> 94, "No Score" -> NaN
      return !isNaN(score) && score >= PASS_AT_OR_ABOVE;
    }).length;
    const allPass = total > 0 && done === total;

    const old = document.getElementById(INDICATOR_ID);
    if (old) old.remove();

    const card = table.closest('.card') || table.closest('.modal') || document;
    const dropdownGroup = card.querySelector('.dropdown.btn-group[role="group"]');
    if (!dropdownGroup) throw new Error('Dropdown not found for indicator');
    const dropdownCol = dropdownGroup.parentElement.parentElement || dropdownGroup.parentElement;

    const badge = document.createElement('span');
    badge.id = INDICATOR_ID;
    badge.textContent = allPass ? 'COMPLETE' : 'INCOMPLETE - ' + done + ' of ' + total + ' DONE';
    badge.style.cssText = [
      'align-self:flex-end', 'margin-left:12px', 'margin-bottom:5px',
      'padding:6px 14px', 'border-radius:6px', 'font-weight:700',
      'font-size:0.9rem', 'letter-spacing:0.5px', 'white-space:nowrap',
      'color:#fff', 'background-color:' + (allPass ? '#198754' : '#dc3545')
    ].join(';');
    dropdownCol.insertAdjacentElement('afterend', badge);
  }

  async function run(button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Working...';
    try {
      const pane = await openActivityTab();
      await selectReport(pane);
      await sleep(1500); // let the report table finish loading
      await openDetails(pane);
      await showCompletionIndicator();
    } catch (err) {
      console.error('[GMetrix script]', err);
      alert('GMetrix script: ' + err.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  // ---- SPA navigation handling ----

  let lastUrl = location.href;

  function removeButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (existing) existing.remove();
  }

  function removeIndicator() {
    const existing = document.getElementById(INDICATOR_ID);
    if (existing) existing.remove();
  }

  // Add the trigger button next to the h1 if we're on a students page and it's missing
  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const h1 = document.querySelector('h1');
    if (!h1) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = 'Open IC3 GS5 Spark Details';
    btn.style.marginLeft = '12px';
    btn.style.verticalAlign = 'middle';
    btn.addEventListener('click', () => run(btn));

    h1.style.display = 'inline-block';
    h1.insertAdjacentElement('afterend', btn);
  }

  function onChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      removeIndicator(); // stale badge from a previous page
    }

    if (onStudentsPage()) {
      ensureButton();
    } else {
      removeButton(); // take no action off /students/*
    }
  }

  onChange();
  new MutationObserver(onChange).observe(document.body, { childList: true, subtree: true });
})();
