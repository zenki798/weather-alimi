const path = require('path');
const { pathToFileURL } = require('url');
const { expect } = require('@playwright/test');

/*
 * 외부 API 를 전부 가짜 응답으로 바꿔 끼운다.
 *
 * - 실제 날씨는 매번 달라서 값으로 검증할 수 없다.
 * - 테스트가 인터넷 상태·API 사용량 제한에 흔들리면 안 된다.
 * 응답 모양은 2026-09-30 에 실제 API 를 호출해 확인한 형식을 따른다.
 */

const TODAY = '2026-10-01';
const FILE_URL = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const CORS = { 'access-control-allow-origin': '*' };

/* 1x1 투명 PNG — 지도 타일 대용 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function pad(n) { return String(n).padStart(2, '0'); }
const r1 = (v) => Math.round(v * 10) / 10;

/* 위도가 달라지면 기온도 달라지게 해서 "다른 곳을 골랐다" 가 값으로 드러나게 한다 */
function baseTemp(lat) { return Math.round((40 - lat) * 2 + 10); }

const DAILY_CODES = [0, 2, 3, 61, 63, 71, 95, 1, 45, 80, 0, 2, 3, 81, 1, 0];

function forecastFixture(lat, lon) {
  const b = baseTemp(lat);
  const hourly = {
    time: [], temperature_2m: [], relative_humidity_2m: [], weather_code: [],
    wind_speed_10m: [], wind_direction_10m: [], precipitation_probability: [],
  };
  for (let d = 0; d < 16; d++) {
    for (let h = 0; h < 24; h++) {
      hourly.time.push(addDays(TODAY, d) + 'T' + pad(h) + ':00');
      hourly.temperature_2m.push(r1(b + 5 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + d * 0.1));
      hourly.relative_humidity_2m.push(50 + (h % 5) * 5);
      hourly.weather_code.push([0, 1, 2, 3, 61][(d + h) % 5]);
      hourly.wind_speed_10m.push(r1(1.5 + (h % 4) * 0.7));
      hourly.wind_direction_10m.push((h * 15) % 360);
      hourly.precipitation_probability.push((h * 7) % 100);
    }
  }
  const daily = {
    time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [],
    relative_humidity_2m_mean: [], wind_speed_10m_max: [], wind_direction_10m_dominant: [],
    precipitation_sum: [], precipitation_probability_max: [],
  };
  for (let d = 0; d < 16; d++) {
    daily.time.push(addDays(TODAY, d));
    daily.weather_code.push(DAILY_CODES[d]);
    daily.temperature_2m_max.push(b + 6 + (d % 3));
    daily.temperature_2m_min.push(b - 3 - (d % 2));
    daily.relative_humidity_2m_mean.push(50 + d);
    daily.wind_speed_10m_max.push(r1(2 + d * 0.3));
    daily.wind_direction_10m_dominant.push((d * 40) % 360);
    daily.precipitation_sum.push(d % 4 === 3 ? 4.2 : 0);
    daily.precipitation_probability_max.push(d % 4 === 3 ? 80 : 10);
  }
  return {
    latitude: lat, longitude: lon, timezone: 'Asia/Seoul', utc_offset_seconds: 32400,
    current: {
      time: TODAY + 'T10:15', interval: 900,
      temperature_2m: b + 0.4, apparent_temperature: b - 1.2, relative_humidity_2m: 55,
      weather_code: 2, wind_speed_10m: 3.4, wind_direction_10m: 315, precipitation: 0,
    },
    hourly, daily,
  };
}

/*
 * 예년 자료: 해마다 값이 달라서 "3년 평균" 이 제대로 나는지 확인할 수 있게 한다.
 *   2025 → 최고 18 · 비 3mm   · 운량 90
 *   2024 → 최고 20 · 비 0.1mm · 운량 40   (1mm 미만은 비 온 날로 치지 않는다)
 *   2023 → 최고 19 · 비 없음  · 운량 50
 * ⇒ 평균 최고 19°, 최저 11°, 비 온 해 1/3 → "가끔 비"
 */
function archiveFixture(start, end) {
  const year = Number(start.slice(0, 4));
  const tmax = { 2025: 18, 2024: 20, 2023: 19 }[year] ?? 15;
  const daily = {
    time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [],
    relative_humidity_2m_mean: [], wind_speed_10m_max: [], precipitation_sum: [],
    snowfall_sum: [], cloud_cover_mean: [],
  };
  for (let t = start; t <= end; t = addDays(t, 1)) {
    daily.time.push(t);
    /* 재분석 코드는 0.1mm 에도 이슬비(51)를 붙인다. 화면이 이 코드를 믿으면 안 된다. */
    daily.weather_code.push(year === 2025 ? 61 : year === 2024 ? 51 : 3);
    daily.temperature_2m_max.push(tmax);
    daily.temperature_2m_min.push(tmax - 8);
    daily.relative_humidity_2m_mean.push(60);
    daily.wind_speed_10m_max.push(3);
    daily.precipitation_sum.push(year === 2025 ? 3 : year === 2024 ? 0.1 : 0);
    daily.snowfall_sum.push(0);
    daily.cloud_cover_mean.push({ 2025: 90, 2024: 40, 2023: 50 }[year] ?? 50);
  }
  return { latitude: 37.5, longitude: 127, timezone: 'Asia/Seoul', daily };
}

const SEARCH = {
  '강남구': [{
    lat: '37.5177000', lon: '127.0473000', name: '강남구',
    display_name: '강남구, 서울특별시, 대한민국',
    address: { borough: '강남구', city: '서울특별시', country: '대한민국', country_code: 'kr' },
  }],
  /* 2026-09-30 실제 응답을 줄인 것: 같은 역이 노드 두 개(7m 차이)로, 서울의 같은 이름 음식점도 섞여 온다 */
  '해운대': [
    {
      lat: '35.1637531', lon: '129.1587469', name: '해운대',
      display_name: '해운대, 해운대로, 우동, 해운대구, 부산광역시, 대한민국',
      address: { railway: '해운대', suburb: '우1동', borough: '해운대구', city: '부산광역시', country: '대한민국' },
    },
    {
      lat: '35.1636846', lon: '129.1588087', name: '해운대',
      display_name: '해운대, 해운대로, 우동, 해운대구, 부산광역시, 대한민국',
      address: { railway: '해운대', suburb: '우1동', borough: '해운대구', city: '부산광역시', country: '대한민국' },
    },
    {
      lat: '35.1587000', lon: '129.1604000', name: '해운대해수욕장',
      display_name: '해운대해수욕장, 우동, 해운대구, 부산광역시, 대한민국',
      address: { suburb: '우1동', borough: '해운대구', city: '부산광역시', country: '대한민국' },
    },
    {
      lat: '37.5454818', lon: '126.9250888', name: '해운대',
      display_name: '해운대, 서강동, 마포구, 서울특별시, 대한민국',
      address: { amenity: '해운대', suburb: '서강동', borough: '마포구', city: '서울특별시', country: '대한민국' },
    },
  ],
};

const REVERSE = {
  name: '핀동', display_name: '핀동, 가상구, 테스트시, 대한민국',
  address: { suburb: '핀동', borough: '가상구', city: '테스트시', country: '대한민국' },
};

/**
 * @param {import('@playwright/test').Page} page
 * @param {object} [opt]
 * @param {boolean} [opt.failNominatim]   Nominatim 검색을 네트워크 오류로
 * @param {boolean} [opt.failReverse]     역지오코딩을 네트워크 오류로
 * @param {boolean} [opt.failArchive]     평년 자료를 500 으로
 * @param {number}  [opt.failForecastTimes] 처음 N 번의 예보 요청을 500 으로
 * @param {(lat:number)=>number} [opt.forecastDelay] 위도별 응답 지연(ms)
 */
async function mockApis(page, opt = {}) {
  const calls = { forecast: [], archive: [], search: [], reverse: [], geocode: [], unexpected: [] };
  let forecastFails = opt.failForecastTimes || 0;

  /* 목록에 없는 외부 요청은 막고 기록한다. 뒤에 등록한 route 가 먼저 적용된다. */
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => {
    calls.unexpected.push(route.request().url());
    return route.abort();
  });

  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: CORS }));

  await page.route('https://api.open-meteo.com/v1/forecast?**', async (route) => {
    const url = new URL(route.request().url());
    calls.forecast.push(url);
    const lat = Number(url.searchParams.get('latitude'));
    const lon = Number(url.searchParams.get('longitude'));
    if (opt.forecastDelay) {
      const ms = opt.forecastDelay(lat);
      if (ms) {
        await new Promise((r) => setTimeout(r, ms));
        /* 기다리는 사이 페이지가 요청을 취소했을 수 있다 */
        return route.fulfill({ json: forecastFixture(lat, lon), headers: CORS }).catch(() => {});
      }
    }
    if (forecastFails > 0) {
      forecastFails--;
      return route.fulfill({ status: 500, headers: CORS, body: '{"error":true}' });
    }
    return route.fulfill({ json: forecastFixture(lat, lon), headers: CORS });
  });

  await page.route('https://archive-api.open-meteo.com/v1/archive?**', (route) => {
    const url = new URL(route.request().url());
    calls.archive.push(url);
    if (opt.failArchive) return route.fulfill({ status: 500, headers: CORS, body: '{"error":true}' });
    return route.fulfill({
      json: archiveFixture(url.searchParams.get('start_date'), url.searchParams.get('end_date')),
      headers: CORS,
    });
  });

  await page.route('https://nominatim.openstreetmap.org/search?**', (route) => {
    const url = new URL(route.request().url());
    calls.search.push(url);
    if (opt.failNominatim) return route.abort('internetdisconnected');
    return route.fulfill({ json: SEARCH[url.searchParams.get('q')] || [], headers: CORS });
  });

  await page.route('https://nominatim.openstreetmap.org/reverse?**', (route) => {
    const url = new URL(route.request().url());
    calls.reverse.push(url);
    if (opt.failReverse) return route.abort('internetdisconnected');
    return route.fulfill({ json: REVERSE, headers: CORS });
  });

  await page.route('https://geocoding-api.open-meteo.com/v1/search?**', (route) => {
    const url = new URL(route.request().url());
    calls.geocode.push(url);
    const name = url.searchParams.get('name');
    const results = name === '강남구'
      ? [{ name: '강남구', latitude: 37.5172, longitude: 127.0473, admin1: '서울특별시', country: '대한민국' }]
      : [];
    return route.fulfill({ json: { results }, headers: CORS });
  });

  return calls;
}

/* 콘솔 에러·페이지 예외를 모은다 */
function collectErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function waitReady(page) {
  await expect(page.locator('html')).toHaveAttribute('data-state', 'ready');
}

/* 지도 이동·줌 애니메이션이 끝날 때까지. 애니메이션 중엔 Leaflet 이 핀 끌기를 무시한다. */
async function waitMapIdle(page) {
  await page.waitForFunction(() => {
    const m = window.WeatherApp && window.WeatherApp.map();
    return m && !m._animatingZoom && !(m._panAnim && m._panAnim._inProgress);
  });
}

/* 가짜 API 를 끼우고 페이지를 연다 */
async function open(page, opt = {}) {
  const calls = await mockApis(page, opt);
  await page.goto(opt.url || '/');
  if (opt.wait !== false) {
    await waitReady(page);
    await waitMapIdle(page);
  }
  return calls;
}

/* 지도의 한 점(컨테이너 좌표)을 눌렀을 때 그 점의 위경도 */
async function latLngAt(page, x, y) {
  return page.evaluate(([px, py]) => {
    const ll = window.WeatherApp.map().containerPointToLatLng([px, py]);
    return { lat: ll.lat, lon: ll.lng };
  }, [x, y]);
}

module.exports = {
  TODAY, FILE_URL, baseTemp, addDays,
  mockApis, collectErrors, waitReady, waitMapIdle, open, latLngAt,
};
