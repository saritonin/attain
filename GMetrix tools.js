// ==UserScript==
// @name         GMetrix tools
// @version      1.3
// @description  Autofills the GMetrix login password and adds an "Add to classroom" button next to "Redeem Code" on the dashboard
// @match        https://gmetrix.net/*
// @match        https://www.gmetrix.net/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  // ---------- locally stored secrets ----------
  // Stored in Tampermonkey's local storage, not in the script source.
  const SECRETS = {
    gmetrixPassword:     'the GMetrix password',
    classroomAccessCode: 'the classroom access code to redeem',
  };

  // Returns the stored value, prompting once if it hasn't been set yet.
  function getSecret(key) {
    let val = GM_getValue(key);
    if (!val) {
      val = prompt('Enter ' + SECRETS[key] + ':');
      if (val) GM_setValue(key, val);
    }
    return val || null;
  }
  const getPassword = () => getSecret('gmetrixPassword');
  const getClassroomAccessCode = () => getSecret('classroomAccessCode');

  // Menu commands (Tampermonkey icon) to set or change them later
  GM_registerMenuCommand('Set GMetrix password', () => {
    const v = prompt('New GMetrix password:');
    if (v) GM_setValue('gmetrixPassword', v);
  });
  GM_registerMenuCommand('Set classroom access code', () => {
    const v = prompt('New classroom access code:');
    if (v) GM_setValue('classroomAccessCode', v);
  });

  const isLogin = () => location.pathname.startsWith('/login');
  const isDashboard = () => location.pathname === '/' || location.pathname === '';

  // ---- Login page: always autofill the password, never click ----
  // Polls so it also works with client-side routing (no page reload).
  const filledLoginFields = new WeakSet();
  setInterval(() => {
    if (!isLogin()) return;
    const pw = document.querySelector('#root main form input[type="password"]');
    if (!pw || filledLoginFields.has(pw)) return;

    const password = getPassword();
    if (!password) return;
    filledLoginFields.add(pw);
    setValue(pw, password);
  }, 500);

  // ---- Dashboard: "Add to classroom" button, placed right after "Redeem Code" ----
  const BTN_ID = 'add-to-classroom-btn';
  let busy = false;

  // The dashboard's "Redeem Code" button (not the one inside the modal)
  function findRedeemButton() {
    const b = document.querySelector(
      '#root > div.dashboard-main.p-3.pb-4.p-lg-4.h-100 > div > div.mb-5.p-0.container-fluid > ul > li:nth-child(2) > button');
    if (b && /redeem code/i.test(b.textContent)) return b;
    return [...document.querySelectorAll('#root button')].find(x =>
      x.id !== BTN_ID && !x.closest('.modal') && x.offsetParent !== null &&
      x.textContent.trim().toLowerCase() === 'redeem code') || null;
  }

  setInterval(() => {
    const existing = document.getElementById(BTN_ID);

    if (!isDashboard()) {
      if (existing) existing.remove(); // client-side navigation away from the dashboard
      return;
    }

    const redeemBtn = findRedeemButton();
    if (!redeemBtn) return;
    // Already in the right spot
    if (existing && redeemBtn.nextElementSibling === existing) return;
    // Exists but the page re-rendered around it: move it back into place
    if (existing) existing.remove();

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = 'Add to classroom';
    btn.className = 'justify-content-center w-100 align-items-center';
    // Blue background, white text (!important so page styles can't override)
    btn.style.setProperty('background', '#0f6cbf', 'important');
    btn.style.setProperty('border-color', '#0f6cbf', 'important');
    btn.style.setProperty('color', '#fff', 'important');
    redeemBtn.insertAdjacentElement('afterend', btn);

    btn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      btn.disabled = true;
      btn.style.opacity = '0.6';
      try {
        await redeemClassroomCode();
      } catch (e) {
        console.warn('GMetrix add to classroom failed:', e.message);
        alert('Add to classroom failed: ' + e.message);
      } finally {
        busy = false;
        btn.disabled = false;
        btn.style.opacity = '';
      }
    });
  }, 500);

  async function redeemClassroomCode() {
    const classroomAccessCode = getClassroomAccessCode();
    if (!classroomAccessCode) throw new Error('No classroom access code stored');

    const open = await waitUntil(findRedeemButton, 30000);
    open.click();

    const input = await waitUntil(() => {
      const i = document.querySelector('#accessCodeInput');
      return i && i.offsetParent !== null ? i : null;
    });
    setValue(input, classroomAccessCode);

    const submit = await waitUntil(() => {
      const b = document.querySelector(
        '#accessCodeRedeem > div > div > div.modal-body > div > form > div.mt-3.d-flex.justify-content-center > button');
      return b && b.offsetParent !== null ? b : null;
    });
    await sleep(300); // let the framework register the input value
    submit.click();
  }

  // ---------- helpers ----------

  // Sets a value in a way React/Vue/Angular forms will notice
  function setValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el), 'value'
    ).set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Polls until fn() returns something truthy
  function waitUntil(fn, timeout = 15000, interval = 100) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const result = fn();
        if (result) return resolve(result);
        if (Date.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(tick, interval);
      };
      tick();
    });
  }
})();
