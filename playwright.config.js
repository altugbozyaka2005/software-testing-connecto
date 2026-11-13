// Browser-level tests: system tests (test/system), acceptance tests incl. accessibility and usability
// measurements (test/acceptance). Each spec starts its own server process (test/support/server-process.js).
// Chromium gets a fake camera and microphone so real WebRTC calls connect headless.
const { defineConfig, devices } = require('@playwright/test');

const fakeMedia = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

module.exports = defineConfig({
  testDir: './test',
  testMatch: ['system/**/*.spec.js', 'acceptance/**/*.spec.js'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }], ['json', { outputFile: 'reports/system/playwright-results.json' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['camera', 'microphone'],
    launchOptions: { args: fakeMedia },
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    // Compatibility: phone-sized viewport with touch (the app is used on phones too).
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
});
