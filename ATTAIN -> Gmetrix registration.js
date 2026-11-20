// ==UserScript==
// @name         ATTAIN -> GMetrix registration
// @version      1.7
// @description  Sends participant information to GMetrix registration form, then signs in and redeems the classroom access code
// @match        https://learn.sunyattain.org/local/user/index.php*
// @match        https://gmetrix.net/*
// @match        https://www.gmetrix.net/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  // button position
  const POS = { position: 'fixed', bottom: '104px', right: '16px', zIndex: '9999' };

  const SECRET_QUESTION = 'What place on earth would you most like to visit?';
  const SECRET_ANSWER = 'ATTAIN';
  const FLOW_TTL = 2 * 60_000; // how long the login/redeem flow stays active

  // ---------- locally stored secrets ----------
  // Stored in Tampermonkey's local storage, not in the script source.
  const SECRETS = {
    gmetrixPassword:     'the GMetrix password to use for new registrations',
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

  // ================= SITE A: ATTAIN =================
  if (location.hostname === 'learn.sunyattain.org') {
    const btn = document.createElement('button');
    btn.textContent = 'Send to GMetrix Registration';
    Object.assign(btn.style, POS, {
      padding: '8px 12px', background: '#0f6cbf', color: '#fff',
      border: 'none', borderRadius: '4px', cursor: 'pointer'
    });
    document.body.appendChild(btn);

    btn.addEventListener('click', () => {
      const form = document.querySelector('#mform1');
      if (!form) return alert('Could not find #mform1');

      // Make sure secrets exist before opening GMetrix (prompts on first use)
      if (!getPassword() || !getClassroomAccessCode()) return;

      const get = name => form.querySelector(`[name="${name}"]`)?.value.trim() || '';
      const job = {
        created: Date.now(),
        firstname: get('firstname'),
        lastname: get('lastname'),
        email: get('email'),
        username: get('username'),
      };

      GM_setValue('gmetrixJob', job);
      GM_openInTab('https://gmetrix.net/register', { active: true });
    });
    return;
  }

  // ================= SITE B: GMetrix =================
  if (!location.hostname.endsWith('gmetrix.net')) return;

  // ---- Step 1: registration form ----
  if (location.pathname.startsWith('/register')) {
    const job = GM_getValue('gmetrixJob');
    if (job && Date.now() - job.created <= 5 * 60_000) {
      GM_deleteValue('gmetrixJob');
      GM_setValue('gmetrixFlow', { step: 'login', started: Date.now() });
      fillRegistration(job);
    }
  }

  // ---- Steps 2 and 3: login, then redeem code ----
  // Polls instead of relying on page loads, so it also works if the
  // site changes pages with client-side routing (no reload).
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    const flow = GM_getValue('gmetrixFlow');
    if (!flow) return;
    if (Date.now() - flow.started > FLOW_TTL) return GM_deleteValue('gmetrixFlow');

    busy = true;
    try {
      if (flow.step === 'login' && location.pathname.startsWith('/login')) {
        flow.step = 'signing-in';
        GM_setValue('gmetrixFlow', flow);
        await doLogin();
        flow.step = 'redeem';
        GM_setValue('gmetrixFlow', flow);
      } else if (flow.step === 'redeem' && (location.pathname === '/' || location.pathname === '')) {
        flow.step = 'redeeming';
        GM_setValue('gmetrixFlow', flow);
        await doRedeem();
        GM_deleteValue('gmetrixFlow');
      }
    } catch (e) {
      console.warn('GMetrix flow step failed:', e.message);
      GM_deleteValue('gmetrixFlow');
    } finally {
      busy = false;
    }
  }, 500);

  async function doLogin() {
    const password = getPassword();
    if (!password) throw new Error('No password stored');

    const pw = await waitUntil(() =>
      document.querySelector('#root main form input[type="password"]'));
    setValue(pw, password);

    const btn = await waitUntil(() => {
      const b = document.querySelector('#root > div.h-100 > div > div > main > form > button');
      if (b && /sign in/i.test(b.textContent)) return b;
      return findButtonByText('Sign In', document.querySelector('#root main form'));
    });
    await sleep(300); // let the framework register the password value
    btn.click();
  }

  async function doRedeem() {
    const classroomAccessCode = getClassroomAccessCode();
    if (!classroomAccessCode) throw new Error('No classroom access code stored');

    const open = await waitUntil(() => {
      const b = document.querySelector(
        '#root > div.dashboard-main.p-3.pb-4.p-lg-4.h-100 > div > div.mb-5.p-0.container-fluid > ul > li:nth-child(2) > button');
      if (b && /redeem code/i.test(b.textContent)) return b;
      return findButtonByText('Redeem Code', document.querySelector('#root'));
    }, 30000);
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
    await sleep(300);
    submit.click();
  }

  // ---- Registration filling ----
  function fillRegistration(job) {
    const password = getPassword();

    // Text fields: [value, selectors]
    const fields = [
      [job.firstname, ['input[name*="first" i]', 'input[id*="first" i]']],
      [job.lastname,  ['input[name*="last" i]',  'input[id*="last" i]']],
      [job.email,     ['input[type="email"]', 'input[name*="email" i]', 'input[id*="email" i]']],
      [job.username,  ['#regStudentNumber']],
      [job.username,  ['#regUsername']],
      [password,      ['#regPassword']],
      [password,      ['#regConfirmPassword']],
      [SECRET_ANSWER, ['#regSecretAnswer']],
    ];

    for (const [value, selectors] of fields) {
      if (!value) continue; // skip empty values (e.g. password prompt cancelled)
      waitForAny(selectors)
        .then(el => setValue(el, value))
        .catch(() => console.warn('GMetrix field not found:', selectors[0]));
    }

    // Checkboxes
    waitForAny(['#regTerms'])
      .then(el => { if (!el.checked) el.click(); })
      .catch(() => console.warn('GMetrix field not found: #regTerms'));

    // Secret question
    (async () => {
      try {
        const q = await waitUntil(() => {
          const s = document.querySelector('#regSecretQuestion');
          return s && hasOption(s, SECRET_QUESTION) ? s : null;
        });
        selectByText(q, SECRET_QUESTION);
      } catch (e) {
        console.warn('GMetrix secret question step failed:', e.message);
      }
    })();

    // Country, then state (state appears after country is chosen)
    (async () => {
      try {
        const country = await waitUntil(() => {
          const s = document.querySelector('#regCountry');
          return s && hasOption(s, 'United States of America') ? s : null;
        });
        selectByText(country, 'United States of America');

        const state = await waitUntil(() => {
          const s = document.querySelector('#regState');
          return s && s.offsetParent !== null && hasOption(s, 'New York') ? s : null;
        });
        selectByText(state, 'New York');
      } catch (e) {
        console.warn('GMetrix country/state step failed:', e.message);
      }
    })();
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

  function hasOption(select, text) {
    return [...select.options].some(o => o.textContent.trim() === text);
  }

  function selectByText(select, text) {
    const opt = [...select.options].find(o => o.textContent.trim() === text);
    if (!opt) throw new Error('Option not found: ' + text);
    select.value = opt.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findButtonByText(text, root = document) {
    return [...root.querySelectorAll('button')].find(b =>
      b.offsetParent !== null && b.textContent.trim().toLowerCase() === text.toLowerCase()) || null;
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

  function waitForAny(selectors, timeout = 15000) {
    return waitUntil(() => {
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el) return el;
      }
      return null;
    }, timeout);
  }
})();
