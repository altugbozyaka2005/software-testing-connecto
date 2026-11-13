// Accessibility testing (Y&P ch. 22.4): automated WCAG 2.1 A/AA checks with axe-core on every main
// screen and dialog, through the real UI. Requirement QA-ACC1: no critical or serious violations.
// Automated checks find roughly a third of WCAG issues; the manual checklist in
// docs/acceptance/usability-study.md covers the rest (keyboard-only use, screen-reader wording).
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { startServer } = require('../support/server-process');
const { person, register, signUp, search, card } = require('../support/ui');

const OUT = path.join(__dirname, '..', '..', 'reports', 'accessibility', 'screens');
let server;
test.beforeAll(async () => { server = await startServer(); fs.mkdirSync(OUT, { recursive: true }); });
test.afterAll(() => server.stop());

async function audit(page, screen) {
  await page.waitForTimeout(400); // let screen transitions finish
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const violations = r.violations.map((v) => ({
    id: v.id, impact: v.impact, help: v.help, wcag: v.tags.filter((t) => /^wcag\d/.test(t)),
    nodes: v.nodes.length, examples: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
  // Written straight away: a failing test restarts the worker and would lose in-memory results.
  const file = path.join(OUT, `${test.info().project.name}--${screen.replace(/\W+/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ screen, project: test.info().project.name, passes: r.passes.length, violations }, null, 2));
  return violations;
}

const severe = (vs) => vs.filter((v) => v.impact === 'critical' || v.impact === 'serious');

test('A11Y-1: sign-in, create-account and check-your-inbox screens', async ({ page }) => {
  await page.goto(server.base);
  const login = await audit(page, 'sign in');
  await page.locator('#tab-register').click();
  const reg = await audit(page, 'create account');
  await register(page, server, person('Axe'));
  await expect(page.locator('#screen-verify')).toBeVisible();
  const verify = await audit(page, 'check your inbox');
  expect(severe([...login, ...reg, ...verify]), JSON.stringify(severe([...login, ...reg, ...verify]), null, 1)).toEqual([]);
});

test('A11Y-2: activity prompt, matches with a card, incoming panel, call and report dialog', async ({ browser }) => {
  const [ca, cb] = [await browser.newContext(), await browser.newContext()];
  const [a, b] = [await ca.newPage(), await cb.newPage()];
  await signUp(a, server, person('Ava'));
  await signUp(b, server, person('Bo'));
  const prompt = await audit(a, 'activity prompt');
  await search(a, 'axe audit painting with watercolors');
  await search(b, 'watercolor painting');
  await expect(card(b, 'Ava')).toBeVisible();
  const matches = await audit(b, 'matches');
  await card(b, 'Ava').locator('.match-hit').click();
  await expect(a.locator('#incoming-list .req-card')).toBeVisible();
  const drawer = await audit(a, 'incoming requests panel');
  await a.locator('#incoming-list .req-card').getByRole('button', { name: 'Accept · join call' }).click();
  await expect(a.locator('#screen-room')).toBeVisible();
  const room = await audit(a, 'call');
  await a.locator('#report-btn').click();
  const report = await audit(a, 'report dialog');
  const all = [...prompt, ...matches, ...drawer, ...room, ...report];
  await ca.close();
  await cb.close();
  expect(severe(all), JSON.stringify(severe(all), null, 1)).toEqual([]);
});

test('A11Y-3: everything on the sign-in screen can be reached and used with the keyboard alone', async ({ page }) => {
  await page.goto(server.base);
  const reached = new Set();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    reached.add(await page.evaluate(() => {
      const el = document.activeElement;
      return el?.id || el?.getAttribute('name') || el?.textContent?.trim().slice(0, 30);
    }));
  }
  for (const want of ['tab-login', 'tab-register', 'email', 'password', 'Sign in']) expect([...reached]).toContain(want);
  // Focus must be visible (WCAG 2.4.7): the focused control has an outline or box-shadow.
  await page.locator('#login-form input[name=email]').focus();
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return s.outlineStyle !== 'none' && s.outlineWidth !== '0px' ? 'outline' : s.boxShadow !== 'none' ? 'shadow' : 'none';
  });
  expect(ring).not.toBe('none');
});
