const { test, expect } = require('@playwright/test');
const { open, waitReady, baseTemp } = require('./helpers');

async function search(page, q) {
  await page.locator('#q').fill(q);
  await page.getByRole('button', { name: '검색', exact: true }).click();
}

test.describe('지역명 검색', () => {
  test('지역명을 넣으면 그 지역 날씨로 바뀌고 핀도 옮겨진다', async ({ page }) => {
    const calls = await open(page);
    await search(page, '강남구');

    await expect(page.locator('#placeName')).toHaveText('강남구');
    await expect(page.locator('#placeDetail')).toContainText('서울특별시');
    await waitReady(page);
    expect(calls.search.at(-1).searchParams.get('accept-language')).toBe('ko');
    expect(calls.forecast.at(-1).searchParams.get('latitude')).toBe('37.5177');
    await expect(page.locator('#nowTemp')).toHaveText(Math.round(baseTemp(37.5177) + 0.4) + '°');

    const pin = await page.evaluate(() => {
      const ll = window.WeatherApp.marker().getLatLng();
      return { lat: ll.lat, lon: ll.lng };
    });
    expect(pin.lat).toBeCloseTo(37.5177, 4);
    expect(pin.lon).toBeCloseTo(127.0473, 4);

    /* 결과가 하나면 후보 목록은 띄우지 않는다 */
    await expect(page.locator('#candidates')).toBeHidden();
  });

  test('후보가 여럿이면 첫 번째를 보여주고, 다른 후보로 바꿀 수 있다', async ({ page }) => {
    const calls = await open(page);
    await search(page, '해운대');

    await expect(page.locator('#placeName')).toHaveText('해운대');
    const chips = page.locator('#candidates .chip');
    /* 7m 떨어진 같은 이름은 하나로 합치고, 같은 이름이 남으면 구 이름으로 구분한다 */
    await expect(chips).toHaveText(['해운대 · 해운대구', '해운대해수욕장 · 해운대구', '해운대 · 마포구']);
    await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.nth(2)).toHaveAttribute('title', /서울특별시/);

    await chips.nth(1).click();
    await expect(page.locator('#placeName')).toHaveText('해운대해수욕장');
    await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'false');
    await waitReady(page);
    expect(calls.forecast.at(-1).searchParams.get('latitude')).toBe('35.1587');
    await expect(page.locator('#nowTemp')).toHaveText(Math.round(baseTemp(35.1587) + 0.4) + '°');
  });

  test('없는 지역이면 안내하고 보던 날씨는 그대로 둔다', async ({ page }) => {
    const calls = await open(page);
    const before = calls.forecast.length;
    await search(page, '없는동네zzz');

    await expect(page.locator('#status .msg.warn')).toContainText('찾지 못했습니다');
    await expect(page.locator('#placeName')).toHaveText('서울특별시');
    expect(calls.forecast.length).toBe(before);
  });

  test('Nominatim 이 막히면 Open-Meteo 지명 검색으로 대신 찾는다', async ({ page }) => {
    const calls = await open(page, { failNominatim: true });
    await search(page, '강남구');

    await expect(page.locator('#placeName')).toHaveText('강남구');
    await waitReady(page);
    expect(calls.geocode.length).toBe(1);
    expect(calls.geocode[0].searchParams.get('language')).toBe('ko');
    expect(calls.forecast.at(-1).searchParams.get('latitude')).toBe('37.5172');
  });

  test('빈 검색어는 요청을 보내지 않는다', async ({ page }) => {
    const calls = await open(page);
    await search(page, '   ');
    await expect(page.locator('#q')).toBeFocused();
    expect(calls.search.length).toBe(0);
  });
});
