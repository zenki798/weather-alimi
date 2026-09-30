const { test, expect } = require('@playwright/test');
const { open, collectErrors, baseTemp, waitReady } = require('./helpers');

test.describe('첫 화면 · 현재 날씨', () => {
  test('저장된 위치가 없으면 서울 날씨가 뜬다', async ({ page }) => {
    const errors = collectErrors(page);
    const calls = await open(page);

    const b = baseTemp(37.5665);
    await expect(page.locator('#placeName')).toHaveText('서울특별시');
    await expect(page.locator('#nowTemp')).toHaveText(Math.round(b + 0.4) + '°');
    await expect(page.locator('#nowFeels')).toHaveText('체감 ' + Math.round(b - 1.2) + '°');
    await expect(page.locator('#nowDesc')).toHaveText('구름 조금');
    await expect(page.locator('#nowHumidity')).toHaveText('55%');
    await expect(page.locator('#nowWind')).toHaveText('3.4 m/s');
    await expect(page.locator('#nowWindDir')).toHaveText('북서풍');
    await expect(page.locator('#nowPop')).toHaveText('10%');
    await expect(page.locator('#nowRange')).toHaveText((b + 6) + '° / ' + (b - 3) + '°');
    await expect(page.locator('#obsTime')).toContainText('10:15');
    await expect(page.locator('#coords')).toHaveText('위도 37.5665 · 경도 126.9780');

    expect(errors).toEqual([]);
    expect(calls.unexpected).toEqual([]);
  });

  test('예보 요청에 필요한 항목과 단위를 모두 담는다', async ({ page }) => {
    const calls = await open(page);
    const url = calls.forecast[0];
    const p = url.searchParams;

    expect(p.get('latitude')).toBe('37.5665');
    expect(p.get('longitude')).toBe('126.978');
    expect(p.get('wind_speed_unit')).toBe('ms');
    expect(p.get('timezone')).toBe('auto');
    expect(p.get('forecast_days')).toBe('16');
    for (const v of ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'weather_code']) {
      expect(p.get('current')).toContain(v);
      expect(p.get('hourly')).toContain(v);
    }
    for (const v of ['temperature_2m_max', 'temperature_2m_min', 'relative_humidity_2m_mean', 'wind_speed_10m_max', 'weather_code', 'precipitation_probability_max']) {
      expect(p.get('daily')).toContain(v);
    }
  });

  test('예보를 못 받으면 오류와 "다시 시도" 가 보이고, 누르면 복구된다', async ({ page }) => {
    await open(page, { failForecastTimes: 1, wait: false });

    await expect(page.locator('html')).toHaveAttribute('data-state', 'error');
    const msg = page.locator('#status .msg.error');
    await expect(msg).toContainText('불러오지 못했습니다');

    await msg.getByRole('button', { name: '다시 시도' }).click();
    await waitReady(page);
    await expect(page.locator('#status')).toBeEmpty();
    await expect(page.locator('#nowTemp')).not.toHaveText('–');
  });

  test('마지막으로 본 위치를 새로고침 후에도 기억한다', async ({ page }) => {
    const calls = await open(page);
    await page.locator('#q').fill('강남구');
    await page.locator('#q').press('Enter');
    await expect(page.locator('#placeName')).toHaveText('강남구');
    await waitReady(page);

    const searchCount = calls.search.length;
    await page.reload();
    await waitReady(page);
    await expect(page.locator('#placeName')).toHaveText('강남구');
    expect(calls.search.length).toBe(searchCount);
    expect(calls.forecast.at(-1).searchParams.get('latitude')).toBe('37.5177');
  });

  test('저장된 값이 깨져 있으면 무시하고 서울로 연다', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('weather.lastPlace', '{"lat":"abc","name":1}'); } catch (e) { /* ignore */ }
    });
    await open(page);
    await expect(page.locator('#placeName')).toHaveText('서울특별시');
  });
});
