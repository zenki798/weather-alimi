const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

/* weather-api.js 의 순수 함수들. 화면 없이 계산 결과만 확인한다. */
test.describe('데이터 계층 (WeatherAPI)', () => {
  test.beforeEach(async ({ page }) => { await open(page); });

  test('모든 WMO 코드에 한국어 설명과 아이콘이 있다', async ({ page }) => {
    const r = await page.evaluate(() => {
      const A = window.WeatherAPI;
      return {
        bad: A._codes.filter((c) => {
          const d = A.describe(c);
          return !d.text || d.text === '정보 없음' || !d.icon;
        }),
        count: A._codes.length,
        unknown: A.describe(12345),
        sample: [A.describe(0).text, A.describe(3).text, A.describe(63).text, A.describe(95).text],
      };
    });
    expect(r.bad).toEqual([]);
    expect(r.count).toBe(28);
    expect(r.unknown.text).toBe('정보 없음');
    expect(r.sample).toEqual(['맑음', '흐림', '비', '뇌우']);
  });

  test('풍향 각도를 8방위로 바꾼다', async ({ page }) => {
    const r = await page.evaluate(() => [0, 22, 23, 45, 90, 180, 270, 315, 359, 360, -45, null]
      .map((d) => window.WeatherAPI.windDir(d)));
    expect(r).toEqual(['북풍', '북풍', '북동풍', '북동풍', '동풍', '남풍', '서풍', '북서풍', '북풍', '북풍', '북서풍', '']);
  });

  test('날짜 계산: 월·연 넘김, 윤년 2월 29일', async ({ page }) => {
    const r = await page.evaluate(() => {
      const A = window.WeatherAPI;
      return {
        add: [A._addDays('2026-12-30', 3), A._addDays('2026-10-31', 1), A._addDays('2028-02-28', 1)],
        shift: [A._shiftYear('2028-02-29', 1), A._shiftYear('2028-02-29', 4), A._shiftYear('2026-10-17', 3)],
      };
    });
    expect(r.add).toEqual(['2027-01-02', '2026-11-01', '2028-02-29']);
    expect(r.shift).toEqual(['2027-02-28', '2024-02-29', '2023-10-17']);
  });

  test('한달을 채울 나머지 날짜는 예보 다음 날부터 이어진다', async ({ page }) => {
    const r = await page.evaluate(() => {
      const days = window.WeatherApp.state.data.days;
      return { last: days.at(-1).date, tail: window.WeatherAPI.monthTailDates(days), n: days.length };
    });
    expect(r.n).toBe(16);
    expect(r.tail).toHaveLength(14);
    expect(r.tail[0]).toBe('2026-10-17');
    expect(r.tail.at(-1)).toBe('2026-10-30');
  });

  test('예년값: 윤년 2월 29일은 평년(윤년 아닌 해)의 2월 28일 값으로 채운다', async ({ page }) => {
    const r = await page.evaluate(() =>
      window.WeatherAPI.normals(37.5, 127, ['2028-02-28', '2028-02-29', '2028-03-01']));
    expect(r.map((d) => d.date)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
    for (const d of r) {
      expect(d.kind).toBe('normal');
      expect(d.years).toBe(3);
      expect(typeof d.tmax).toBe('number');
    }
  });

  test('예년 날씨 설명은 비·눈 빈도와 운량으로 정한다', async ({ page }) => {
    const r = await page.evaluate(() => {
      const f = window.WeatherAPI._normalSky;
      return [
        f(3, 0, 3, 90), f(2, 0, 3, 90), f(1, 0, 3, 10),
        f(2, 2, 3, 80), f(1, 1, 3, 80), f(2, 1, 3, 80),
        f(0, 0, 3, 10), f(0, 0, 3, 50), f(0, 0, 3, 85), f(0, 0, 3, null),
      ].map((s) => s.text);
    });
    expect(r).toEqual([
      '비 잦음', '비 잦음', '가끔 비',
      '눈 잦음', '가끔 눈', '비·눈 잦음',
      '대체로 맑음', '구름 많음', '흐림', '강수 적음',
    ]);
  });

  test('여러 시간의 날씨 코드를 하나로 요약한다 (오전·오후, 3시간 칸)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const f = window.WeatherAPI._summarizeCodes;
      return [
        f([0, 0, 1, 61], 3),   // 비 1시간 < 기준 3 → 비 아닌 것 중 최빈: 맑음
        f([0, 61, 61, 63], 3), // 비 3시간 ≥ 3 → 비 중 최빈: 약한 비
        f([1, 2, 1, 2], 3),    // 동률 → 큰 코드(더 흐린 쪽)
        f([0, 1, 51], 1),      // 3시간 칸은 1시간만 비여도 비
        f([61, 63], 3),        // 비만 있으면 기준 미달이어도 비, 동률 → 더 궂은 쪽
        f([], 3), f([null], 1),
      ];
    });
    expect(r).toEqual([0, 61, 2, 51, 63, null, null]);
  });

  test('서머타임으로 23시간인 날도 날짜별로 제대로 묶는다', async ({ page }) => {
    const r = await page.evaluate(() => {
      const time = [];
      for (let d = 0; d < 2; d++) {
        for (let h = 0; h < 24; h++) {
          if (d === 0 && h === 2) continue; // 02시가 없는 날
          time.push('2026-03-0' + (8 + d) + 'T' + String(h).padStart(2, '0') + ':00');
        }
      }
      const fill = (v) => time.map(() => v);
      const out = window.WeatherAPI._normalizeForecast({
        current: { time: '2026-03-08T10:00' },
        hourly: {
          time, temperature_2m: time.map((t, i) => i), relative_humidity_2m: fill(50),
          weather_code: fill(0), wind_speed_10m: fill(1), precipitation_probability: fill(10),
        },
        daily: {
          time: ['2026-03-08', '2026-03-09'], weather_code: [0, 0], temperature_2m_max: [1, 1],
          temperature_2m_min: [0, 0], wind_speed_10m_max: [1, 1], precipitation_sum: [0, 0],
        },
      });
      return out.days.map((d) => ({
        slots: d.slots.map((s) => s.hour), first: d.slots[0].time, amMin: d.am.tmin, pmMax: d.pm.tmax,
      }));
    });
    expect(r[0].slots).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
    expect(r[1].slots).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
    /* 24개씩 잘랐다면 다음 날이 한 시간 밀린다 */
    expect(r[1].first).toBe('2026-03-09T00:00');
    expect(r[0].pmMax).toBe(22);
    expect(r[1].amMin).toBe(23);
  });

  test('거리 계산 (같은 이름 후보 합치기에 쓴다)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const d = window.WeatherAPI._distanceKm;
      return [
        d({ lat: 35.1637531, lon: 129.1587469 }, { lat: 35.1636846, lon: 129.1588087 }),
        d({ lat: 37.5665, lon: 126.978 }, { lat: 35.1796, lon: 129.0756 }),
      ];
    });
    expect(r[0]).toBeLessThan(0.02);
    expect(r[1]).toBeGreaterThan(320);
    expect(r[1]).toBeLessThan(330);
  });

  test('주소에서 짧은 지명을 만든다', async ({ page }) => {
    const r = await page.evaluate(() => {
      const f = window.WeatherAPI._nameFromAddress;
      return [
        f({ quarter: '다동', suburb: '명동', borough: '중구', city: '서울특별시', country: '대한민국' }),
        f({ province: '제주특별자치도', city: '제주시', country: '대한민국' }),
        f({}, '', '어딘가, 먼 곳, 바다'),
        f(null, '', ''),
        /* 시골: 읍·면(town)과 리(village)를 둘 다 살린다 */
        f({ village: '행현리', town: '상면', county: '가평군', province: '경기도', country: '대한민국' }),
        f({ village: '창동리', town: '증평읍', county: '증평군', province: '충청북도', country: '대한민국' }),
        f({ village: '창동리', city: '충주시', province: '충청북도', country: '대한민국' }),
        f({ town: '봉평면', county: '평창군', province: '강원특별자치도', country: '대한민국' }),
      ];
    });
    expect(r[0]).toEqual({ name: '중구 명동', detail: '서울특별시 · 대한민국' });
    expect(r[1]).toEqual({ name: '제주특별자치도 제주시', detail: '대한민국' });
    expect(r[2].name).toBe('어딘가, 먼 곳');
    expect(r[3].name).toBe('이름 없는 지점');
    expect(r[4]).toEqual({ name: '상면 행현리', detail: '경기도 가평군 · 대한민국' });
    expect(r[5]).toEqual({ name: '증평읍 창동리', detail: '충청북도 증평군 · 대한민국' });
    expect(r[6]).toEqual({ name: '충주시 창동리', detail: '충청북도 · 대한민국' });
    expect(r[7]).toEqual({ name: '평창군 봉평면', detail: '강원특별자치도 · 대한민국' });
  });
});
