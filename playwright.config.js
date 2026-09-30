const { defineConfig, devices } = require('@playwright/test');

const PORT = 4179;
const BASE_URL = 'http://localhost:' + PORT;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30 * 1000,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    locale: 'ko-KR',
    /* 서비스 워커가 페이지 요청을 가로채면 가짜 API(page.route)가 흔들린다.
       기본은 막고, 앱 설치·오프라인 검사(pwa.spec.js)에서만 켠다. */
    serviceWorkers: 'block',
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],

  webServer: {
    command: 'node server.js',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
  },
});
