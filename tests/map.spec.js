const { test, expect } = require('@playwright/test');
const { open, waitReady, waitMapIdle, latLngAt } = require('./helpers');

function lastLatLon(calls) {
  const p = calls.forecast.at(-1).searchParams;
  return { lat: Number(p.get('latitude')), lon: Number(p.get('longitude')) };
}

test.describe('지도 핀으로 위치 고르기', () => {
  test('지도를 누르면 그 지점에 핀이 꽂히고 그 좌표의 날씨·지명이 뜬다', async ({ page }) => {
    const calls = await open(page);
    await expect(page.locator('#map .leaflet-tile-pane')).toBeAttached();

    const box = await page.locator('#map').boundingBox();
    const px = Math.round(box.width * 0.25);
    const py = Math.round(box.height * 0.3);
    const expected = await latLngAt(page, px, py);

    await page.locator('#map').click({ position: { x: px, y: py } });

    await expect(page.locator('#placeName')).toHaveText('가상구 핀동');
    await expect(page.locator('#placeDetail')).toContainText('테스트시');
    await waitReady(page);

    const got = lastLatLon(calls);
    expect(got.lat).toBeCloseTo(expected.lat, 3);
    expect(got.lon).toBeCloseTo(expected.lon, 3);
    expect(Number(calls.reverse.at(-1).searchParams.get('lat'))).toBeCloseTo(expected.lat, 3);

    /* 클릭 좌표는 반 픽셀 안쪽까지 오차가 날 수 있다 (줌 11 에서 약 0.0003°) */
    const pin = await page.evaluate(() => window.WeatherApp.marker().getLatLng());
    expect(pin.lat).toBeCloseTo(expected.lat, 3);
    expect(pin.lng).toBeCloseTo(expected.lon, 3);
    await expect(page.locator('#coords')).toHaveText(
      '위도 ' + pin.lat.toFixed(4) + ' · 경도 ' + pin.lng.toFixed(4));
  });

  test('핀을 끌어서 옮기면 옮긴 지점의 날씨로 바뀐다', async ({ page }) => {
    const calls = await open(page);
    const pinEl = page.locator('#map .pin');
    await expect(pinEl).toBeVisible();

    const before = lastLatLon(calls);
    const b = await pinEl.boundingBox();
    const sx = b.x + b.width / 2;
    const sy = b.y + b.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 40, sy + 20, { steps: 5 });
    await page.mouse.move(sx + 80, sy + 50, { steps: 5 });
    await page.mouse.up();

    await expect(page.locator('#placeName')).toHaveText('가상구 핀동');
    await waitReady(page);

    const pin = await page.evaluate(() => {
      const ll = window.WeatherApp.marker().getLatLng();
      return { lat: ll.lat, lon: ll.lng };
    });
    const got = lastLatLon(calls);
    expect(got.lat).toBeCloseTo(pin.lat, 3);
    expect(got.lon).toBeCloseTo(pin.lon, 3);
    /* 아래·오른쪽으로 끌었으니 위도는 줄고 경도는 는다 */
    expect(got.lat).toBeLessThan(before.lat);
    expect(got.lon).toBeGreaterThan(before.lon);
  });

  test('지명을 못 찾아도 좌표 날씨는 보여준다', async ({ page }) => {
    await open(page, { failReverse: true });
    const box = await page.locator('#map').boundingBox();
    await page.locator('#map').click({ position: { x: Math.round(box.width * 0.7), y: Math.round(box.height * 0.6) } });

    await expect(page.locator('#placeName')).toHaveText('선택한 위치');
    await expect(page.locator('#placeDetail')).toHaveText('지명을 확인하지 못했습니다');
    await waitReady(page);
    await expect(page.locator('#nowTemp')).not.toHaveText('–');
  });

  test('느린 응답이 늦게 도착해도 마지막에 고른 위치가 이긴다', async ({ page }) => {
    /* 강남구(37.5177) 예보만 1.5초 늦게 온다 */
    const calls = await open(page, { forecastDelay: (lat) => (Math.abs(lat - 37.5177) < 1e-6 ? 1500 : 0) });

    await page.locator('#q').fill('강남구');
    await page.locator('#q').press('Enter');
    await expect(page.locator('#placeName')).toHaveText('강남구');

    const box = await page.locator('#map').boundingBox();
    await page.locator('#map').click({ position: { x: Math.round(box.width * 0.2), y: Math.round(box.height * 0.8) } });
    await expect(page.locator('#placeName')).toHaveText('가상구 핀동');
    await waitReady(page);

    const clicked = lastLatLon(calls);
    await page.waitForTimeout(1800); // 늦은 강남구 응답이 도착할 시간
    await expect(page.locator('#placeName')).toHaveText('가상구 핀동');
    const shown = await page.evaluate(() => window.WeatherApp.state.data.lat);
    expect(shown).toBeCloseTo(clicked.lat, 4);
  });

  test('검색하면 지도가 그 지역으로 이동한다', async ({ page }) => {
    await open(page);
    await page.locator('#q').fill('해운대');
    await page.locator('#q').press('Enter');
    await expect(page.locator('#placeName')).toHaveText('해운대');
    await waitMapIdle(page);

    const center = await page.evaluate(() => {
      const c = window.WeatherApp.map().getCenter();
      return { lat: c.lat, lon: c.lng, zoom: window.WeatherApp.map().getZoom() };
    });
    expect(center.lat).toBeCloseTo(35.1638, 2);
    expect(center.lon).toBeCloseTo(129.1587, 2);
    expect(center.zoom).toBeGreaterThanOrEqual(11);
  });
});

test.describe('내 위치 버튼', () => {
  test.describe('위치 권한을 허용했을 때', () => {
    test.use({ geolocation: { latitude: 33.4996, longitude: 126.5312 }, permissions: ['geolocation'] });

    test('현재 위치로 핀을 옮기고 그곳 날씨를 보여준다', async ({ page }) => {
      const calls = await open(page);
      await page.locator('#locateBtn').click();

      await expect(page.locator('#placeName')).toHaveText('가상구 핀동');
      await waitReady(page);
      expect(lastLatLon(calls)).toEqual({ lat: 33.4996, lon: 126.5312 });
      const pin = await page.evaluate(() => window.WeatherApp.marker().getLatLng());
      expect(pin.lat).toBeCloseTo(33.4996, 4);
    });
  });

  test('위치 권한이 없으면 안내하고 보던 날씨는 그대로 둔다', async ({ page, context }) => {
    await context.clearPermissions();
    const calls = await open(page);
    const before = calls.forecast.length;
    await page.locator('#locateBtn').click();

    await expect(page.locator('#status .msg.warn')).toContainText('현재 위치를 가져올 수 없습니다');
    await expect(page.locator('#placeName')).toHaveText('서울특별시');
    expect(calls.forecast.length).toBe(before);
  });
});

test.describe('지도 그림(타일) 서버', () => {
  test('웹 주소(http)로 열면 OSM 공식 서버를 쓴다', async ({ page }) => {
    const calls = await open(page);
    await expect(page.locator('#map')).toHaveAttribute('data-tiles', 'osm');
    await expect.poll(() => calls.tiles.filter((u) => u.startsWith('https://tile.openstreetmap.org/')).length).toBeGreaterThan(0);
    await expect(page.locator('#mapNotice')).toBeHidden();
    await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
  });

  test('지도 서버가 모두 막히면 차례로 바꿔 보다가 안내를 띄우고, 날씨는 그대로 쓸 수 있다', async ({ page }) => {
    const calls = await open(page, { failTiles: ['openstreetmap'] });
    await expect(page.locator('#map')).toHaveAttribute('data-tiles', 'none');
    await expect(page.locator('#mapNotice')).toBeVisible();
    await expect(page.locator('#mapNotice')).toContainText('지도 그림을 불러오지 못했습니다');

    const hosts = [...new Set(calls.tiles.map((u) => new URL(u).hostname.replace(/^[abc]\./, '')))];
    expect(hosts).toEqual(['tile.openstreetmap.org', 'tile.openstreetmap.fr', 'tile.openstreetmap.de']);

    await page.locator('#q').fill('강남구');
    await page.locator('#q').press('Enter');
    await expect(page.locator('#placeName')).toHaveText('강남구');
  });
});
