// Shared steps for browser tests: real clicks and typing through the UI, no API shortcuts, except
// opening the emailed confirmation link (read from the server's console mail output).
const { expect } = require('@playwright/test');

let n = 0;
function person(first, overrides = {}) {
  n++;
  return {
    first, last: 'Tester', email: `${first.toLowerCase()}${n}_${Date.now()}@example.com`,
    password: 'goodpass123', dob: '1996-04-12', ...overrides,
  };
}

async function register(page, server, p) {
  await page.goto(server.base);
  await page.locator('#tab-register').click();
  const f = page.locator('#register-form');
  await f.locator('input[name=firstName]').fill(p.first);
  await f.locator('input[name=lastName]').fill(p.last);
  await f.locator('input[name=email]').fill(p.email);
  await f.locator('input[name=password]').fill(p.password);
  await f.locator('input[name=dateOfBirth]').fill(p.dob);
  await f.locator('input[name=acceptTerms]').check();
  await f.getByRole('button', { name: 'Create account' }).click();
}

// Registers, confirms the email by opening the link, and lands on "What are you doing right now?".
async function signUp(page, server, p) {
  await register(page, server, p);
  await expect(page.locator('#screen-verify')).toBeVisible();
  await page.goto(`${server.base}/?verify=${await server.link(p.email)}`);
  await expect(page.locator('#screen-activity')).toBeVisible();
}

async function search(page, activity) {
  await page.locator('#activity-input').fill(activity);
  await page.getByRole('button', { name: 'Find people' }).click();
  await expect(page.locator('#screen-matches')).toBeVisible();
}

const card = (page, name) => page.locator('#match-grid .match-card', { hasText: name });

module.exports = { person, register, signUp, search, card };
