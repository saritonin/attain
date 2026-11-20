// ==UserScript==
// @name         ATTAIN -> GMetrix registration
// @version      1.9
// @description  Sends participant information to the GMetrix registration form
// @match        https://learn.sunyattain.org/local/user/index.php*
// @match        https://gmetrix.net/register*
// @match        https://www.gmetrix.net/register*
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

  // ---------- locally stored password ----------
  // Stored in Tampermonkey's local storage, not in the script source.
  function getPassword() {
    let val = GM_getValue('gmetrixPassword');
    if (!val) {
      val = prompt('Enter the GMetrix password to use for new registrations:');
      if (val) GM_setValue('gmetrixPassword', val);
    }
    return val || null;
  }

  GM_registerMenuCommand('Set GMetrix password', () => {
    const v = prompt('New GMetrix password:');
    if (v) GM_setValue('gmetrixPassword', v);
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

      // Make sure the password exists before opening GMetrix (prompts on first use)
      if (!getPassword()) return;

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

  // ================= SITE B: GMetrix registration =================
  if (!location.hostname.endsWith('gmetrix.net')) return;

  const job = GM_getValue('gmetrixJob');
  if (!job || Date.now() - job.created > 5 * 60_000) return; // ignore stale data
  GM_deleteValue('gmetrixJob');

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
