const { test, expect } = require('@playwright/test');
const { open, collectErrors, FILE_URL } = require('./helpers');

/*
 * 사용자는 index.html 을 더블클릭(file://)해서 열 수도 있다.
 * 이때 ES 모듈은 막히고 localStorage 도 막힐 수 있다. 로컬 서버에서만 통과하면 안 된다.
 */
test.describe('file:// 로 직접 열었을 때', () => {
  test('지도·날씨가 모두 뜨고 콘솔 에러가 없다', async ({ page }) => {
    const errors = collectErrors(page);
    const calls = await open(page, { url: FILE_URL });

    await expect(page.locator('#placeName')).toHaveText('서울특별시');
    await expect(page.locator('#map.leaflet-container')).toBeVisible();
    await expect(page.locator('#map .pin')).toBeVisible();
    await expect(page.locator('#hourList .hour')).toHaveCount(24);
    expect(errors).toEqual([]);
    expect(calls.unexpected).toEqual([]);
  });

  test('검색과 지도 누르기가 file:// 에서도 동작한다', async ({ page }) => {
    await open(page, { url: FILE_URL });
    await page.locator('#q').fill('강남구');
    await page.locator('#q').press('Enter');
    await expect(page.locator('#placeName')).toHaveText('강남구');

    const box = await page.locator('#map').boundingBox();
    await page.locator('#map').click({ position: { x: Math.round(box.width * 0.3), y: Math.round(box.height * 0.3) } });
    await expect(page.locator('#placeName')).toHaveText('가상구 핀동');
  });

  test('localStorage 를 못 써도 화면이 죽지 않는다', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new Error('localStorage blocked'); },
      });
    });
    const errors = collectErrors(page);
    await open(page, { url: FILE_URL });

    await expect(page.locator('#placeName')).toHaveText('서울특별시');
    await page.locator('#tab-week').click();
    await expect(page.locator('#weekList .day')).toHaveCount(7);
    expect(errors).toEqual([]);
  });
});
