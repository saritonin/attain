// ==UserScript==
// @name         SUNY ATTAIN Form Warnings
// @namespace    http://tampermonkey.net/
// @version      2026-11-09
// @description  Shows warnings next to form values based on a list of rules
// @match        https://learn.sunyattain.org/local/user/index.php*
// @grant        none
// @icon         https://www.google.com/s2/favicons?sz=64&domain=sunyattain.org
// @run-at       document-idle
// ==/UserScript==

// ------------ Changelog ----------------------
// 2026-11-06 SL and TC added high_income check
// 2026-11-09 SL Added TANF rule
//            SL updated runChecks to allow display in more than one place
//
// -------------------------------------

(function () {
    'use strict';

    // ---------- Styles ----------
    const LEVELS = {
        error: { bg: '#f8d7da', color: '#721c24' }, // pale red
        warn:  { bg: '#FFE5B4', color: '#5c3d00' } // pale orange
    };

    // ---------- Helpers ----------
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

    // Parse MM/DD/YYYY -> Date (or null if invalid)
    function parseDate(str) {
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((str || '').trim());
        if (!m) return null;
        const [, mm, dd, yyyy] = m.map(Number);
        const d = new Date(yyyy, mm - 1, dd);
        const valid = d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd;
        return valid ? d : null;
    }

    function calcAge(dob, today = new Date()) {
        let age = today.getFullYear() - dob.getFullYear();
        const hadBirthday =
            today.getMonth() > dob.getMonth() ||
            (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
        if (!hadBirthday) age--;
        return age;
    }

    // Build a context object once so every rule can use the same values
    function buildContext(form) {
        const q = (sel) => form.querySelector(sel);

        const eduField = q('#id_edulevel');
        const dobField = q('#dobdate, [name="dobdate"]');
        const dob = dobField ? parseDate(dobField.value) : null;
        const incomeField = q('#yincome, [name="yincome"]');
        const income = incomeField ? Number(incomeField.value.replace(/[^0-9.-]/g, '')) : null;
        // TANF check inputs
        const kidAges = [1, 2, 3, 4, 5, 6]
            .map((i) => parseInt(val(`fhage${i}`), 10))
            .filter((a) => !Number.isNaN(a)); // blank / non-numeric ages are ignored

        const categoryField = q('#id_category, [name="category"]'); // <-- verify this selector
        // Add more values here as needed

        return {
            form,
            q,
            noUid: q('#id_nouid'),
            dobField,
            eduField,
            eduLevel: eduField && eduField.selectedOptions.length
                ? eduField.selectedOptions[0].textContent.trim()
                : '',
            age: dob ? calcAge(dob) : null,
            incomeField,
            income,
            firstNameField: q('#id_firstname, [name="firstname"]'),
            categoryText: categoryField && categoryField.tagName === 'SELECT'
                ? (categoryField.selectedOptions[0]?.textContent.trim() || '')
                : (categoryField ? categoryField.value.trim() : ''),
            categoryField,
            hasChildUnder18: kidAges.some((a) => a < 18),
            onAssistance: ['asafnet', 'atanf', 'afs', 'amaid', 'assi', 'ahp'].some(isOne)
            // Add more shared values here as needed
        };
    }

    // ---------- Rules ----------
    // Each rule: { id, anchor(ctx) -> element to place the warning after,
    //              check(ctx) -> { level: 'error'|'warn', message } or null }
    // A rule may also return an array of such results.
    const QUALIFYING_EDUCATION_LEVELS = [
        'Foreign High School Diploma',
        'High School Equivalency',
        'High School Diploma'
    ];

    const RULES = [
        {
            id: 'missing-ssn',
            anchor: (ctx) => {
                // Special case: the "No SSN" text is a bare text node inside the label,
                // so wrap it in a span to give the warning something to sit after.
                const label = ctx.noUid && ctx.noUid.closest('label');
                if (!label) return null;

                const textNode = [...label.childNodes].find(
                    (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()
                );
                if (!textNode) return null;

                const wrapper = document.createElement('span');
                textNode.replaceWith(wrapper);
                wrapper.appendChild(textNode);
                return wrapper;
            },
            check: (ctx) => {
                if (ctx.noUid && ctx.noUid.checked) {
                    return { level: 'error', message: 'Missing SSN - Please double-check with participant!' };
                }
                return null;
            }
        },
        {
            id: 'age',
            anchor: (ctx) => ctx.dobField,
            check: (ctx) => {
                const age = ctx.age;
                if (age === null) return null;

                if (age < 18) {
                    return { level: 'error', message: 'Applicant is under 18.' };
                }
                if (age < 19) {
                    if (QUALIFYING_EDUCATION_LEVELS.includes(ctx.eduLevel)) {
                        return { level: 'warn', message: 'Applicant is under 19, but has ' + ctx.eduLevel + '.' };
                    }
                    return { level: 'error', message: 'Applicant is under 19 - Check for minor status.' };
                }
                if (age > 100) {
                    return { level: 'warn', message: 'Applicant is over 100 - Check for age errors.' };
                }
                return null;
            },
        },
        {
            id: 'high-income',
            anchor: (ctx) => ctx.incomeField,
            check: (ctx) => {
                if (ctx.income > 100000) {
                    const currency = new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD'
                    });

                    const alt1 = currency.format((ctx.income / 52) * 12); // Weekly entered, meant monthly
                    const alt2 = currency.format((ctx.income / 52) * 1); // Weekly entered, meant yearly
                    const alt3 = currency.format((ctx.income / 12) * 1); // Monthly entered, meant yearly

                    return { level: 'warn', message: 'Income is high - did you mean ' + alt1 + ', ' + alt2 + ', or '+ alt3 + ' instead?' };
                }
                return null;
            }
        },
        {
            id: 'likely-tanf',
            anchor: (ctx) => [ctx.firstNameField, ctx.categoryField],
            check: (ctx) => {
                if (ctx.hasChildUnder18 && ctx.onAssistance && !ctx.categoryText.includes('TANF')) {
                    return { level: 'error', message: 'Participant is likely TANF-eligible. Double-check category!' };
                }
                return null;
            }
        }

        // Example of a new rule:
        // {
        //     id: 'example',
        //     anchor: (ctx) => ctx.q('#id_somefield'),
        //     check: (ctx) => ctx.q('#id_somefield').value === '' ?
        //         { level: 'warn', message: 'Some field is empty' } : null
        // }
    ];

    // ---------- Rendering ----------
    function showWarning(anchor, { level, message }, ruleId) {
        const style = LEVELS[level] || LEVELS.warn;
        const box = document.createElement('span');
        box.className = 'tm-form-warning';
        box.dataset.rule = ruleId;
        box.textContent = message;
        Object.assign(box.style, {
            display: 'inline-block',
            marginLeft: '10px',
            padding: '4px 10px',
            borderRadius: '4px',
            backgroundColor: style.bg,
            color: style.color,
            verticalAlign: 'middle',
            fontSize: '0.9em'
        });
        anchor.insertAdjacentElement('afterend', box);
    }

    function runChecks() {
        const form = document.querySelector('#mform1');
        if (!form) return;

        const ctx = buildContext(form);

        RULES.forEach((rule) => {
            try {
                // anchor may be a single element or an array of elements
                const anchors = [].concat(rule.anchor(ctx)).filter(Boolean);
                if (!anchors.length) return;

                const result = rule.check(ctx);
                if (!result) return;

                const results = Array.isArray(result) ? result : [result];
                anchors.forEach((anchor) =>
                                results.forEach((r) => showWarning(anchor, r, rule.id))
                               );
            } catch (err) {
                console.error('[Form Warnings] Rule failed:', rule.id, err);
            }
        });
    }

    // Run once on load
    runChecks();
})();