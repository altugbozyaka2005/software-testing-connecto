// Acceptance tests: user stories from docs/requirements.md written as executable acceptance criteria
// (Given / When / Then), run through the real UI in two browsers. These are the criteria a product owner
// would sign off; the usability study in docs/acceptance/usability-study.md validates them with people.
const { test, expect } = require('@playwright/test');
const { startServer } = require('../support/server-process');
const { person, signUp, search, card } = require('../support/ui');

let server;
test.beforeAll(async () => { server = await startServer(); });
test.afterAll(() => server.stop());

async function twoPeople(browser, first = 'Ece', second = 'Finn') {
  const ctx = [await browser.newContext(), await browser.newContext()];
  const pages = [await ctx[0].newPage(), await ctx[1].newPage()];
  const people = [person(first, { last: 'Yilmaz' }), person(second, { last: 'Murray' })];
  await signUp(pages[0], server, people[0]);
  await signUp(pages[1], server, people[1]);
  return { pages, people, close: () => Promise.all(ctx.map((c) => c.close())) };
}

test('US-1: Given two people studying the same thing, when they search, then each sees the other and they are in a call after one click each', async ({ browser }) => {
  const { pages: [a, b], close } = await twoPeople(browser);
  const t0 = Date.now();
  await search(a, 'revising for my biology exam');
  await search(b, 'biology revision');
  await expect(card(b, 'Ece Y.')).toBeVisible({ timeout: 2000 }); // "right now": within 2 s
  expect(Date.now() - t0).toBeLessThan(10_000);
  await expect(card(b, 'Ece Y.').locator('.score b')).toHaveText(/\d+%/);
  await card(b, 'Ece Y.').locator('.match-hit').click(); // click 1 (Finn)
  await a.locator('#incoming-list .req-card').getByRole('button', { name: 'Accept · join call' }).click(); // click 1 (Ece)
  await expect(a.locator('#screen-room')).toBeVisible();
  await expect(b.locator('#screen-room')).toBeVisible();
  await close();
});

test('US-2: Given a stranger sees me in matches, requests or a call, then they never see my surname, email or date of birth', async ({ browser }) => {
  const { pages: [a, b], people: [ece], close } = await twoPeople(browser, 'Gul', 'Hana');
  await search(a, 'learning to play the piano');
  await search(b, 'piano practice');
  await card(b, 'Gul Y.').locator('.match-hit').click();
  await expect(a.locator('#incoming-list .req-card')).toBeVisible();
  for (const [page, where] of [[b, '#screen-matches'], [a, '#screen-matches']]) {
    const text = await page.locator(where).innerText();
    expect(text).not.toContain(ece.email);
    expect(text).not.toContain('Yilmaz');
    expect(text).not.toContain(ece.dob);
  }
  await a.locator('#incoming-list .req-card').getByRole('button', { name: 'Accept · join call' }).click();
  await expect(b.locator('#screen-room')).toBeVisible();
  const roomText = await b.locator('#screen-room').innerText();
  expect(roomText).not.toContain('Yilmaz');
  expect(roomText).not.toContain(ece.email);
  await close();
});

test('US-3: Given I am in a call with someone abusive, when I report and block them, then the call ends and we never see each other again', async ({ browser }) => {
  const { pages: [a, b], close } = await twoPeople(browser, 'Ida', 'Jon');
  await search(a, 'playing chess online');
  await search(b, 'chess');
  await card(b, 'Ida Y.').locator('.match-hit').click();
  await a.locator('#incoming-list .req-card').getByRole('button', { name: 'Accept · join call' }).click();
  await expect(a.locator('#screen-room')).toBeVisible();

  await a.locator('#report-btn').click(); // step 1
  const dialog = a.locator('#report-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[name=block]')).toBeChecked(); // blocking is the default
  await dialog.getByLabel('Harassment or bullying').check(); // step 2
  await dialog.getByRole('button', { name: 'Send report' }).click(); // step 3

  await expect(a.locator('#screen-room')).toBeHidden();
  await expect(b.locator('#screen-room')).toBeHidden();
  // Both are back on their match lists, still searching for chess: neither appears to the other.
  await expect(b.locator('#screen-matches')).toBeVisible();
  await expect(a.locator('#screen-matches')).toBeVisible();
  await a.waitForTimeout(800);
  await expect(card(b, 'Ida Y.')).toHaveCount(0);
  await expect(card(a, 'Jon M.')).toHaveCount(0);
  await close();
});

test('US-4: Given two people doing unrelated things, then they are not offered to each other', async ({ browser }) => {
  const { pages: [a, b], close } = await twoPeople(browser, 'Kai', 'Lea');
  await search(a, 'practicing guitar scales');
  await search(b, 'doing my tax return spreadsheet');
  await b.waitForTimeout(800);
  await expect(card(b, 'Kai Y.')).toHaveCount(0);
  await expect(card(a, 'Lea M.')).toHaveCount(0);
  await close();
});
