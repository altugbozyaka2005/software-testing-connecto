// Usability verification that can be automated (Y&P ch. 22.4 "factoring usability testing"): objective
// measures of the core tasks, to be compared with what real participants do in the usability study
// (docs/acceptance/usability-study.md).
//  - Number of user operations per task (clicks, fields, characters typed) on the shortest path.
//  - Predicted expert task time with the Keystroke-Level Model (Card, Moran & Newell 1980), a technique
//    from HCI, outside this course: K keystroke 0.28 s, P point 1.1 s, B click 0.2 s, H hand to keyboard
//    or mouse 0.4 s, M mental preparation 1.35 s (one per new decision / field).
//  - System response time actually observed for each step.
// Requirement QA-U1: shortest-path task times and click counts below the targets in docs/requirements.md.
// Also captures screenshots of every screen (desktop and phone) used for the heuristic evaluation.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { startServer } = require('../support/server-process');
const { person } = require('../support/ui');

const OUT = path.join(__dirname, '..', '..', 'reports', 'usability');
const KLM = { K: 0.28, P: 1.1, B: 0.2, H: 0.4, M: 1.35 };
const TARGETS = { 'T1 sign up and see matches': { clicks: 6, klmS: 60 }, 'T2 match to call': { clicks: 1, klmS: 5 }, 'T3 report and block': { clicks: 3, klmS: 10 } };

// Records each operation, its KLM operators, and how long the app took to respond.
function recorder(page) {
  const ops = [];
  let hand = 'mouse';
  const add = (kind, detail, operators, ms) => ops.push({ kind, detail, operators, ms: Math.round(ms) });
  return {
    ops,
    async click(locator, detail) {
      const ops0 = (hand === 'keyboard' ? 'H' : '') + 'MPB';
      hand = 'mouse';
      const t = Date.now();
      await locator.click();
      add('click', detail, ops0, Date.now() - t);
    },
    async type(locator, text, detail) {
      const t = Date.now();
      await locator.click();
      await locator.fill(text);
      // point at the field, click, move hand to keyboard, think, type
      add('type', detail, `MPBH${'K'.repeat(text.length)}`, Date.now() - t);
      hand = 'keyboard';
    },
    async key(key, detail) {
      const t = Date.now();
      await page.keyboard.press(key);
      add('key', detail, (hand === 'mouse' ? 'H' : '') + 'MK', Date.now() - t);
      hand = 'keyboard';
    },
    summary(task) {
      const operators = ops.map((o) => o.operators).join('');
      const seconds = [...operators].reduce((s, op) => s + KLM[op], 0);
      return {
        task,
        clicks: ops.filter((o) => o.kind === 'click').length,
        fields: ops.filter((o) => o.kind === 'type').length,
        keystrokes: [...operators].filter((o) => o === 'K').length,
        klmOperators: operators,
        klmSeconds: +seconds.toFixed(1),
        systemResponseMs: ops.reduce((s, o) => s + o.ms, 0),
        steps: ops,
      };
    },
  };
}

let server;
const tasks = [];
test.beforeAll(async () => { server = await startServer(); fs.mkdirSync(path.join(OUT, 'screens'), { recursive: true }); });
test.afterAll(() => server.stop());

const shot = (page, name) => page.screenshot({ path: path.join(OUT, 'screens', `${name}-${test.info().project.name}.png`), fullPage: false });

test('USE-1 @mobile: core tasks T1-T3 on the shortest path, with KLM time estimates and screenshots', async ({ browser }, info) => {
  const device = info.project.use;
  const ctxA = await browser.newContext({ ...device });
  const ctxB = await browser.newContext({ ...device });
  const [a, b] = [await ctxA.newPage(), await ctxB.newPage()];

  // T1: new user, from the landing page to seeing matches (email confirmation happens outside the app).
  const t1 = recorder(a);
  const pa = person('Uma', { last: 'Soto' });
  await a.goto(server.base);
  await shot(a, '01-sign-in');
  await t1.click(a.locator('#tab-register'), 'Create account tab');
  await shot(a, '02-create-account');
  const f = a.locator('#register-form');
  await t1.type(f.locator('input[name=firstName]'), pa.first, 'first name');
  await t1.type(f.locator('input[name=lastName]'), pa.last, 'last name');
  await t1.type(f.locator('input[name=email]'), pa.email, 'email');
  await t1.type(f.locator('input[name=password]'), pa.password, 'password');
  await t1.type(f.locator('input[name=dateOfBirth]'), pa.dob.replaceAll('-', ''), 'date of birth (typed as digits)');
  await f.locator('input[name=dateOfBirth]').fill(pa.dob);
  await t1.click(f.locator('input[name=acceptTerms]'), 'accept guidelines');
  await t1.click(f.getByRole('button', { name: 'Create account' }), 'Create account');
  await expect(a.locator('#screen-verify')).toBeVisible();
  await shot(a, '03-check-inbox');
  await a.goto(`${server.base}/?verify=${await server.link(pa.email)}`); // the email link (outside the app)
  await expect(a.locator('#screen-activity')).toBeVisible();
  await shot(a, '04-activity-prompt');
  await t1.type(a.locator('#activity-input'), 'learning japanese', 'activity');
  await t1.key('Enter', 'submit activity');
  await expect(a.locator('#screen-matches')).toBeVisible();
  tasks.push({ device: info.project.name, ...t1.summary('T1 sign up and see matches') });

  // Second person (set up without measurement) searching for something similar.
  const pb = person('Vic', { last: 'Ng' });
  await b.goto(`${server.base}`);
  await b.locator('#tab-register').click();
  const g = b.locator('#register-form');
  for (const [n, v] of [['firstName', pb.first], ['lastName', pb.last], ['email', pb.email], ['password', pb.password], ['dateOfBirth', pb.dob]]) await g.locator(`input[name=${n}]`).fill(v);
  await g.locator('input[name=acceptTerms]').check();
  await g.getByRole('button', { name: 'Create account' }).click();
  await expect(b.locator('#screen-verify')).toBeVisible();
  await b.goto(`${server.base}/?verify=${await server.link(pb.email)}`);
  await b.locator('#activity-input').fill('japanese study session');
  await b.locator('#activity-input').press('Enter');
  const cardForB = b.locator('#match-grid .match-card', { hasText: 'Uma S.' });
  await expect(cardForB).toBeVisible();
  await a.waitForTimeout(300);
  await shot(b, '05-matches');

  // T2: from seeing a match to being in a call (requester's side; the other person accepts once).
  const t2 = recorder(b);
  await t2.click(cardForB.locator('.match-hit'), 'match card');
  await expect(a.locator('#incoming-list .req-card')).toBeVisible();
  await shot(a, '06-incoming-request');
  await a.locator('#incoming-list .req-card').getByRole('button', { name: 'Accept · join call' }).click();
  await expect(b.locator('#screen-room')).toBeVisible();
  await b.waitForTimeout(1500);
  await shot(b, '07-call');
  tasks.push({ device: info.project.name, ...t2.summary('T2 match to call') });

  // T3: report and block the other person from the call.
  const t3 = recorder(b);
  await t3.click(b.locator('#report-btn'), 'report button');
  await shot(b, '08-report-dialog');
  await t3.click(b.locator('#report-dialog').getByLabel('Spam, scam or advertising'), 'reason');
  await t3.click(b.locator('#report-dialog').getByRole('button', { name: 'Send report' }), 'send');
  await expect(b.locator('#screen-room')).toBeHidden();
  await b.waitForTimeout(600);
  await shot(b, '09-after-report');
  tasks.push({ device: info.project.name, ...t3.summary('T3 report and block') });

  // One file per device, written before the assertions so a failure still leaves the evidence.
  fs.writeFileSync(path.join(OUT, `task-metrics-${info.project.name}.json`), JSON.stringify({ klm: KLM, targets: TARGETS, tasks }, null, 2));
  for (const t of tasks.filter((x) => x.device === info.project.name)) {
    expect.soft(t.clicks, `${t.task}: clicks`).toBeLessThanOrEqual(TARGETS[t.task].clicks);
    expect.soft(t.klmSeconds, `${t.task}: KLM seconds`).toBeLessThanOrEqual(TARGETS[t.task].klmS);
  }
  await ctxA.close();
  await ctxB.close();
});
