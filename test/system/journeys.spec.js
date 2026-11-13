// System tests (black box, through the browser UI): the main user journeys end to end, with two
// separate browser contexts acting as two people. Requirements FR1, FR2, FR4 (call), SR1, PR1.
const { test, expect } = require('@playwright/test');
const { startServer } = require('../support/server-process');
const { person, register, signUp, search, card } = require('../support/ui');

let server;
test.beforeAll(async () => { server = await startServer(); });
test.afterAll(() => server.stop());

test('ST-1: sign up, confirm email, find a match, request, accept, video call, chat, leave', async ({ browser }) => {
  const [ctxA, ctxB] = [await browser.newContext(), await browser.newContext()];
  const [a, b] = [await ctxA.newPage(), await ctxB.newPage()];
  const ana = person('Ana', { last: 'Lopez' });
  const ben = person('Ben', { last: 'Kaya' });
  await signUp(a, server, ana);
  await signUp(b, server, ben);

  await search(a, 'studying for my calculus exam');
  await search(b, 'calculus homework');

  // Each sees the other; strangers only see first name + last initial (PR1).
  await expect(card(b, 'Ana L.')).toBeVisible();
  await expect(card(a, 'Ben K.')).toBeVisible();
  await expect(b.locator('#match-grid')).not.toContainText('Lopez');

  await card(b, 'Ana L.').locator('.match-hit').click();
  // Ana's incoming-requests panel opens by itself.
  const incoming = a.locator('#incoming-list .req-card', { hasText: 'Ben K.' });
  await expect(incoming).toBeVisible();
  await incoming.getByRole('button', { name: 'Accept · join call' }).click();

  await expect(a.locator('#screen-room')).toBeVisible();
  await expect(b.locator('#screen-room')).toBeVisible();
  // WebRTC connected: each side shows a playing remote video tile.
  for (const p of [a, b]) {
    await expect.poll(() => p.evaluate(() => [...document.querySelectorAll('#tiles video')]
      .filter((v) => !v.muted && v.srcObject && v.readyState >= 2).length), { timeout: 20_000 }).toBeGreaterThan(0);
  }

  // The chat panel is always open on wide screens; on narrow ones it sits behind a toggle.
  const openChat = async (p) => { if (!(await p.locator('#chat-input').isVisible())) await p.locator('#chat-toggle').click(); };
  await openChat(b);
  await b.locator('#chat-input').fill('hi Ana, page 3?');
  await b.locator('#chat-input').press('Enter');
  await openChat(a);
  await expect(a.locator('#chat-panel')).toContainText('hi Ana, page 3?');

  await b.locator('#leave-btn').click();
  await expect(b.locator('#screen-room')).toBeHidden();
  await expect(a.locator('#screen-room')).toBeHidden();
  await ctxA.close();
  await ctxB.close();
});

test('ST-2: registration refuses under-18s and shows field errors in the form', async ({ page }) => {
  const young = new Date();
  young.setUTCFullYear(young.getUTCFullYear() - 17);
  await register(page, server, person('Kid', { dob: young.toISOString().slice(0, 10) }));
  await expect(page.locator('#register-form [data-for=dateOfBirth]')).toContainText('at least 18');
  await expect(page.locator('#screen-verify')).toBeHidden();
});

test('ST-3: an unconfirmed account waits on "Check your inbox" and cannot reach matching', async ({ page }) => {
  const p = person('Una');
  await register(page, server, p);
  await expect(page.locator('#screen-verify')).toBeVisible();
  await expect(page.locator('#verify-email')).toHaveText(p.email);
  await page.reload();
  await expect(page.locator('#screen-verify')).toBeVisible();
  await expect(page.locator('#screen-activity')).toBeHidden();
});

test('ST-4: sign out, wrong password, then sign back in', async ({ page }) => {
  const p = person('Sid');
  await signUp(page, server, p);
  await page.evaluate(() => document.querySelector('.logout-btn, [data-action=logout]')?.click());
  await page.goto(server.base);
  await page.context().clearCookies();
  await page.reload();
  const f = page.locator('#login-form');
  await f.locator('input[name=email]').fill(p.email);
  await f.locator('input[name=password]').fill('wrongpass999');
  await f.getByRole('button', { name: 'Sign in' }).click();
  await expect(f.locator('.form-error')).toContainText('Incorrect email or password');
  await f.locator('input[name=password]').fill(p.password);
  await f.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#screen-activity')).toBeVisible();
});

test('ST-5 @mobile: the main screens cannot be scrolled sideways (phone and desktop) [D7]', async ({ page }) => {
  const p = person('Mo');
  await signUp(page, server, p);
  // What a user would notice: can the page be scrolled sideways? (Off-canvas panels that are
  // clipped by overflow:hidden don't count.)
  const sideways = async () => {
    await page.mouse.move(200, 300);
    await page.mouse.wheel(600, 0); // a sideways trackpad swipe
    await page.waitForTimeout(150);
    const x = await page.evaluate(() => window.scrollX);
    await page.evaluate(() => window.scrollTo(0, window.scrollY));
    return x;
  };
  expect(await sideways()).toBe(0);
  await search(page, 'reading a fantasy novel');
  expect(await sideways()).toBe(0);
  await page.screenshot({ path: `reports/usability/screens/matches-${test.info().project.name}.png` });
});

// D9 (found by the usability measurements on a phone): the call screen's button row did not wrap, so
// the page grew to 524px on a 412px phone, mobile Chrome zoomed everything out, and the report
// dialog's "Send report" button ended up covered by a label.
test('ST-6 @mobile: in a call on a phone the page stays phone-width and a report can be sent', async ({ browser }, info) => {
  const device = info.project.use;
  const [ca, cb] = [await browser.newContext({ ...device }), await browser.newContext({ ...device })];
  const [a, b] = [await ca.newPage(), await cb.newPage()];
  await signUp(a, server, person('Pia', { last: 'Ono' }));
  await signUp(b, server, person('Rex', { last: 'Lund' }));
  await search(a, 'phone layout test baking bread');
  await search(b, 'baking sourdough bread');
  await card(b, 'Pia O.').locator('.match-hit').click();
  await a.locator('#incoming-list .req-card').getByRole('button', { name: 'Accept · join call' }).click();
  await expect(b.locator('#screen-room')).toBeVisible();
  await b.waitForTimeout(800);
  expect(await b.evaluate(() => window.innerWidth)).toBe(device.viewport.width);
  await b.locator('#report-btn').click();
  await b.locator('#report-dialog').getByLabel('Spam, scam or advertising').check();
  await b.locator('#report-dialog').getByRole('button', { name: 'Send report' }).click({ timeout: 5000 });
  await expect(b.locator('#screen-room')).toBeHidden();
  await ca.close();
  await cb.close();
});
