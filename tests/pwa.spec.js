const { test, expect } = require('@playwright/test');
const { open, collectErrors, waitReady } = require('./helpers');

/*
 * 앱(PWA) 설치 — 홈 화면에 추가하면 주소창·툴바 없이(standalone) 뜨는지,
 * 설치 조건(manifest·아이콘·서비스 워커)을 크롬이 인정하는지, 앱 모드 동작이 맞는지.
 */

test('manifest: 단독 실행(standalone), 시작 주소·범위, 아이콘 3종(일반 192·512, 마스커블)', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('./?source=pwa');
  expect(m.scope).toBe('./');
  expect(m.name).toBeTruthy();
  expect(m.short_name.length).toBeLessThanOrEqual(12); // 홈 화면 아이콘 아래 글자가 잘리지 않게
  const has = (size, purpose) => m.icons.some((i) => i.sizes === size && i.type === 'image/png' && (i.purpose || 'any').includes(purpose));
  expect(has('192x192', 'any')).toBe(true);
  expect(has('512x512', 'any')).toBe(true);
  expect(has('512x512', 'maskable')).toBe(true);
});

test('아이콘 파일이 실제로 있고 적힌 크기와 같다 (apple-touch-icon 포함)', async ({ page }) => {
  await open(page);
  const sizes = await page.evaluate(async () => {
    const m = await (await fetch('manifest.webmanifest')).json();
    const list = m.icons.map((i) => ({ src: i.src, want: Number(i.sizes.split('x')[0]) }))
      .concat({ src: document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href'), want: 180 });
    return Promise.all(list.map(({ src, want }) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ src, want, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ src, want, w: 0, h: 0 });
      img.src = src;
    })));
  });
  for (const s of sizes) expect(s, s.src).toMatchObject({ w: s.want, h: s.want });
});

test('홈 화면 앱용 설정: 안전 영역(노치)·테마 색·아이폰 단독 실행 메타 태그', async ({ page }) => {
  await open(page);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', /^#/);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
});

test.describe('서비스 워커를 켜고 검사', () => {
  test.use({ serviceWorkers: 'allow' });

  test('크롬이 설치 가능한 앱으로 인정한다 (설치 불가 사유 0건)', async ({ page, context }) => {
    const errors = collectErrors(page);
    const calls = await open(page, { context });
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send('Page.getAppManifest');
    expect(manifest.errors).toEqual([]);
    await expect.poll(async () => (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, { timeout: 10000 })
      .toEqual([]);
    expect(errors).toEqual([]);
    expect(calls.unexpected).toEqual([]);
  });

  test('한 번 연 뒤에는 인터넷이 끊겨도 앱 화면이 뜬다', async ({ page, context }) => {
    await open(page, { context });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // 서비스 워커가 페이지를 맡은 상태로
    await waitReady(page);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);
    await page.goto('/?source=pwa');
    await expect(page.locator('h1')).toContainText('날씨알리미');
    await expect(page.locator('#map.leaflet-container')).toBeAttached(); // 지도 코드(leaflet)도 캐시에서
    await expect(page.locator('html')).toHaveAttribute('data-state', /ready|error/);
    await context.setOffline(false);
  });
});

test.describe('앱 모드 (홈 화면에서 실행)', () => {
  test('앱 모드 표시가 붙고, 설치 안내는 뜨지 않는다', async ({ page }) => {
    await open(page, { url: '/?source=pwa' });
    await expect(page.locator('html')).toHaveClass(/app-mode/);
    expect(await page.evaluate(() => window.WeatherApp.appMode)).toBe(true);
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = () => {};
      e.userChoice = Promise.resolve({});
      window.dispatchEvent(e);
    });
    await expect(page.locator('#install-bar')).toBeHidden();
  });

  test('새로고침 버튼: 보던 위치·탭·펼친 날짜는 그대로 두고 날씨만 새로 받는다', async ({ page }) => {
    const calls = await open(page, { url: '/?source=pwa' });
    await page.locator('#tab-week').click();
    const toggle = () => page.locator('#weekList .day').nth(1).locator('button.day-row');
    await toggle().click();
    await expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    const before = calls.forecast.length;
    await page.locator('#refreshBtn').click();
    await expect.poll(() => calls.forecast.length).toBe(before + 1);
    await waitReady(page);

    await expect(page.locator('#placeName')).toHaveText('서울특별시');
    await expect(page.locator('#tab-week')).toHaveAttribute('aria-selected', 'true');
    await expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#weekList .day').nth(1).locator('.slots-panel .hour')).toHaveCount(8);
    expect(calls.reverse.length).toBe(0); // 이름을 아는 곳은 지명을 다시 묻지 않는다
  });

  test('지명 확인 중에 새로고침하면 지명도 다시 확인한다', async ({ page }) => {
    const calls = await open(page, { url: '/?source=pwa', reverseDelay: 1000 });
    const box = await page.locator('#map').boundingBox();
    await page.locator('#map').click({ position: { x: Math.round(box.width * 0.4), y: Math.round(box.height * 0.4) } });
    await expect(page.locator('#placeDetail')).toHaveText('지명 확인 중…');
    await expect.poll(() => calls.reverse.length).toBe(1);

    await page.locator('#refreshBtn').click(); // 첫 지명 확인이 끝나기 전에
    await expect.poll(() => calls.reverse.length).toBe(2);
    await expect(page.locator('#placeName')).toHaveText('가상구 핀동');
    await waitReady(page);
  });
});

test.describe('설치 안내 (브라우저로 볼 때)', () => {
  const fire = (page) => page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });

  test('안드로이드 크롬: 설치 가능 신호가 오면 "앱으로 설치" 버튼을 보이고, 누르면 설치 창을 띄운다', async ({ page }) => {
    await open(page);
    await expect(page.locator('#install-bar')).toBeHidden();
    await fire(page);
    await expect(page.locator('#install-bar')).toBeVisible();
    await expect(page.locator('#install-text')).toContainText('주소창·툴바 없이');
    await page.locator('#install-btn').click();
    expect(await page.evaluate(() => window.__prompted)).toBe(true);
    await expect(page.locator('#install-bar')).toBeHidden();
  });

  test('닫기를 누르면 다음에 다시 열어도 안내하지 않는다', async ({ page }) => {
    await open(page);
    await fire(page);
    await page.locator('#install-close').click();
    await expect(page.locator('#install-bar')).toBeHidden();
    await page.reload();
    await waitReady(page);
    await fire(page);
    await expect(page.locator('#install-bar')).toBeHidden();
  });
});

test.describe('아이폰·아이패드 설치 안내 (사파리에는 설치 버튼이 없어 글로 안내한다)', () => {
  /* 페이지 스크립트가 보는 기기 정보를 바꾼다. 아이패드 사파리는 기본으로 Mac 처럼 자신을 밝힌다. */
  async function asDevice(page, { ua, platform, touchPoints }) {
    await page.addInitScript(([u, p, t]) => {
      Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => u });
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => p });
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => t });
    }, [ua, platform, touchPoints]);
    await open(page);
  }
  const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

  test('아이폰: 아래쪽 공유 버튼으로 홈 화면에 추가하라고 안내한다', async ({ page }) => {
    await asDevice(page, { ua: IPHONE, platform: 'iPhone', touchPoints: 5 });
    await expect(page.locator('#install-bar')).toBeVisible();
    await expect(page.locator('#install-text')).toContainText('아래쪽 공유 버튼');
    await expect(page.locator('#install-btn')).toBeHidden();
  });

  test('아이패드(사파리가 Mac 처럼 밝혀도): 오른쪽 위 공유 버튼으로 안내한다', async ({ page }) => {
    await asDevice(page, { ua: MAC_SAFARI, platform: 'MacIntel', touchPoints: 5 });
    await expect(page.locator('#install-bar')).toBeVisible();
    await expect(page.locator('#install-text')).toContainText('오른쪽 위 공유 버튼');
  });

  test('진짜 Mac(터치 없음)에는 안내하지 않는다', async ({ page }) => {
    await asDevice(page, { ua: MAC_SAFARI, platform: 'MacIntel', touchPoints: 0 });
    await expect(page.locator('#install-bar')).toBeHidden();
  });
});
