/*
 * 날씨·지명 데이터 계층 — window.WeatherAPI
 *
 * 화면 코드(app.js)는 이 파일이 돌려주는 "정리된 모양"만 안다. 외부 API 를 바꿔도
 * 여기만 고치면 된다. file:// 로 열어도 동작해야 하므로 ES 모듈이 아니라 전역 객체로 노출한다.
 *
 * 쓰는 API (모두 키 없음, CORS 허용)
 * - 날씨 예보: Open-Meteo Forecast  — 현재값 + 시간별 + 16일 일별
 * - 예년 참고: Open-Meteo Archive   — 17~30일째는 예보가 없으므로 최근 3년 같은 날짜 평균
 * - 지명 검색: OSM Nominatim (한국어 지명이 정확) → 실패 시 Open-Meteo Geocoding
 * - 좌표→지명: OSM Nominatim reverse
 */
(function () {
  'use strict';

  var FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
  var ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
  var NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
  var OM_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

  var FORECAST_DAYS = 16;
  var MONTH_DAYS = 30;
  var NORMAL_YEARS = 3;

  /* WMO 기상 코드 → 한국어 설명 + 아이콘 */
  var WMO = {
    0: ['맑음', '☀️'],
    1: ['대체로 맑음', '🌤️'],
    2: ['구름 조금', '⛅'],
    3: ['흐림', '☁️'],
    45: ['안개', '🌫️'],
    48: ['서리 안개', '🌫️'],
    51: ['약한 이슬비', '🌦️'],
    53: ['이슬비', '🌦️'],
    55: ['강한 이슬비', '🌧️'],
    56: ['어는 이슬비', '🌧️'],
    57: ['강한 어는 이슬비', '🌧️'],
    61: ['약한 비', '🌦️'],
    63: ['비', '🌧️'],
    65: ['강한 비', '🌧️'],
    66: ['어는 비', '🌧️'],
    67: ['강한 어는 비', '🌧️'],
    71: ['약한 눈', '🌨️'],
    73: ['눈', '🌨️'],
    75: ['강한 눈', '❄️'],
    77: ['싸락눈', '🌨️'],
    80: ['약한 소나기', '🌦️'],
    81: ['소나기', '🌧️'],
    82: ['강한 소나기', '⛈️'],
    85: ['약한 눈 소나기', '🌨️'],
    86: ['강한 눈 소나기', '❄️'],
    95: ['뇌우', '⛈️'],
    96: ['우박 동반 뇌우', '⛈️'],
    99: ['강한 우박 뇌우', '⛈️'],
  };

  function describe(code) {
    var hit = WMO[code];
    return hit ? { text: hit[0], icon: hit[1] } : { text: '정보 없음', icon: '❔' };
  }

  /* 풍향(바람이 불어오는 방향, 도) → "북서풍" */
  var DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  function windDir(deg) {
    if (deg == null || isNaN(deg)) return '';
    return DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] + '풍';
  }

  function getJSON(url, signal) {
    return fetch(url, { signal: signal }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function qs(params) {
    return Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
  }

  /* 소수 4자리(약 10m)면 충분하다. 요청 URL 이 길어지지 않게 자른다. */
  function round4(n) { return Math.round(n * 1e4) / 1e4; }

  /* ---------- 지명 ---------- */

  /* Nominatim 주소 → 큰 단위부터 [도, 시, 구, 동] */
  function regionParts(addr) {
    addr = addr || {};
    return [
      addr.province || addr.state,
      addr.city,
      addr.county || addr.borough || addr.city_district || addr.district,
      addr.town || addr.suburb || addr.village || addr.quarter || addr.neighbourhood || addr.hamlet,
    ].filter(Boolean).filter(function (p, i, a) { return a.indexOf(p) === i; });
  }

  /* 좌표로 찾은 지점 → "중구 명동" 같은 짧은 이름과 보조 설명 */
  function nameFromAddress(addr, fallbackName, displayName) {
    addr = addr || {};
    var parts = regionParts(addr);
    var name = parts.slice(-2).join(' ') || fallbackName || '';
    if (!name && displayName) name = displayName.split(',').slice(0, 2).join(',').trim();
    var detail = [parts.length > 2 ? parts[0] : '', addr.country || ''].filter(Boolean).join(' · ');
    return { name: name || '이름 없는 지점', detail: detail };
  }

  function searchNominatim(query, signal) {
    var url = NOMINATIM_URL + '/search?' + qs({
      q: query, format: 'jsonv2', limit: 5, addressdetails: 1, 'accept-language': 'ko',
    });
    return getJSON(url, signal).then(function (list) {
      return (list || []).map(function (r) {
        /* 검색으로 찾은 곳은 그 장소 이름을 앞세우고(예: "해운대해수욕장"), 행정구역은 설명으로 */
        var name = r.name || nameFromAddress(r.address, '', r.display_name).name;
        var region = regionParts(r.address).filter(function (p) { return p !== name; }).join(' ');
        var detail = [region, (r.address || {}).country].filter(Boolean).join(' · ');
        return { name: name, detail: detail, area: areaOf(r.address, name), lat: Number(r.lat), lon: Number(r.lon) };
      });
    });
  }

  /* 같은 이름의 후보를 가려 줄 한 단어 — 보통 "구·군", 없으면 시·도 */
  function areaOf(addr, name) {
    addr = addr || {};
    var area = addr.borough || addr.county || addr.city_district || addr.district ||
      addr.city || addr.town || addr.province || addr.state || addr.country || '';
    return area === name ? (addr.city || addr.province || addr.state || '') : area;
  }

  function searchOpenMeteo(query, signal) {
    var url = OM_GEOCODE_URL + '?' + qs({ name: query, count: 5, language: 'ko' });
    return getJSON(url, signal).then(function (data) {
      return (data.results || []).map(function (r) {
        return {
          name: r.name,
          detail: [r.admin1, r.country].filter(Boolean).join(' · '),
          area: r.admin2 || r.admin1 || r.country || '',
          lat: r.latitude,
          lon: r.longitude,
        };
      });
    });
  }

  function distanceKm(a, b) {
    var rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad;
    var dLon = (b.lon - a.lon) * rad;
    var h = Math.pow(Math.sin(dLat / 2), 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.pow(Math.sin(dLon / 2), 2);
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }

  /* 같은 이름이 2km 안에 또 있으면(역의 승강장·정류장 노드 등) 하나만 남긴다. 날씨가 같다. */
  function dedupe(list) {
    var out = [];
    list.forEach(function (p) {
      var dup = out.some(function (q) { return q.name === p.name && distanceKm(p, q) < 2; });
      if (!dup) out.push(p);
    });
    return out;
  }

  /* Nominatim 이 실패(네트워크·차단)하면 Open-Meteo 로 한 번 더 찾는다 */
  function search(query, signal) {
    query = String(query || '').trim();
    if (!query) return Promise.resolve([]);
    return searchNominatim(query, signal).then(function (list) {
      return list.length ? list : searchOpenMeteo(query, signal);
    }, function (err) {
      if (err && err.name === 'AbortError') throw err;
      return searchOpenMeteo(query, signal);
    }).then(dedupe);
  }

  /* 좌표 → 지명. 실패하면 null (화면은 좌표만 보여준다) */
  function reverse(lat, lon, signal) {
    var url = NOMINATIM_URL + '/reverse?' + qs({
      lat: round4(lat), lon: round4(lon), format: 'jsonv2', zoom: 14, 'accept-language': 'ko',
    });
    return getJSON(url, signal).then(function (r) {
      if (!r || r.error) return null;
      return nameFromAddress(r.address, r.name, r.display_name);
    }, function (err) {
      if (err && err.name === 'AbortError') throw err;
      return null;
    });
  }

  /* ---------- 예보 ---------- */

  function forecast(lat, lon, signal) {
    var url = FORECAST_URL + '?' + qs({
      latitude: round4(lat),
      longitude: round4(lon),
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation',
      hourly: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation_probability',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,wind_speed_10m_max,wind_direction_10m_dominant,precipitation_sum,precipitation_probability_max',
      forecast_days: FORECAST_DAYS,
      timezone: 'auto',
      wind_speed_unit: 'ms',
    });
    return getJSON(url, signal).then(normalizeForecast);
  }

  /* 가장 흔한 값. 동률이면 큰 코드(더 흐리거나 궂은 쪽)를 고른다. */
  function modeOf(list) {
    var count = {};
    var best = null;
    list.forEach(function (c) { count[c] = (count[c] || 0) + 1; });
    Object.keys(count).forEach(function (k) {
      var c = Number(k);
      if (best === null || count[k] > count[best] || (count[k] === count[best] && c > best)) best = c;
    });
    return best;
  }

  /*
   * 여러 시간의 기상 코드를 하나로. 비·눈 코드(51 이상)가 minWet 시간 이상이면 그중 가장 흔한 것,
   * 아니면 비 아닌 코드 중 가장 흔한 것. 한두 시간 이슬비로 반나절 전체를 "비" 로 만들지 않기 위해서다.
   */
  function summarizeCodes(codes, minWet) {
    codes = codes.filter(function (c) { return c != null; });
    if (!codes.length) return null;
    var wet = codes.filter(function (c) { return c >= 51; });
    var dry = codes.filter(function (c) { return c < 51; });
    if (wet.length >= minWet || !dry.length) return modeOf(wet);
    return modeOf(dry);
  }

  function maxOf(list) {
    var xs = list.filter(function (x) { return typeof x === 'number' && !isNaN(x); });
    return xs.length ? Math.max.apply(null, xs) : null;
  }
  function minOf(list) {
    var xs = list.filter(function (x) { return typeof x === 'number' && !isNaN(x); });
    return xs.length ? Math.min.apply(null, xs) : null;
  }

  /* 오전(0~11시)·오후(12~23시) 요약 — 기상청 중기예보와 같은 구분 */
  function summarizeHalf(list) {
    if (!list.length) return null;
    var code = summarizeCodes(list.map(function (x) { return x.code; }), Math.max(2, Math.ceil(list.length / 4)));
    return {
      code: code,
      sky: describe(code),
      pop: maxOf(list.map(function (x) { return x.pop; })),
      tmin: minOf(list.map(function (x) { return x.temp; })),
      tmax: maxOf(list.map(function (x) { return x.temp; })),
    };
  }

  /* 3시간 간격(0·3·…·21시). 기온·습도·바람은 그 시각 값, 날씨·강수확률은 3시간 중 궂은 쪽 */
  function threeHourSlots(list) {
    var slots = [];
    for (var s = 0; s < 24; s += 3) {
      var part = list.filter(function (x) { return x.hour >= s && x.hour < s + 3; });
      if (!part.length) continue;
      var at = part[0];
      var code = summarizeCodes(part.map(function (x) { return x.code; }), 1);
      slots.push({
        time: at.time,
        hour: s,
        temp: at.temp,
        humidity: at.humidity,
        wind: at.wind,
        code: code,
        sky: describe(code),
        pop: maxOf(part.map(function (x) { return x.pop; })),
      });
    }
    return slots;
  }

  function normalizeForecast(d) {
    var c = d.current || {};
    var h = d.hourly || { time: [] };
    var dy = d.daily || { time: [] };

    function hourAt(i) {
      return {
        time: h.time[i],
        hour: Number(h.time[i].slice(11, 13)),
        temp: h.temperature_2m[i],
        humidity: h.relative_humidity_2m[i],
        wind: h.wind_speed_10m[i],
        windDeg: h.wind_direction_10m ? h.wind_direction_10m[i] : null,
        code: h.weather_code[i],
        pop: h.precipitation_probability ? h.precipitation_probability[i] : null,
      };
    }

    /* 현재 시각이 속한 정시부터 24시간. 시각 문자열은 현지 시간 "YYYY-MM-DDTHH:mm" */
    var nowHour = String(c.time || '').slice(0, 13);
    var start = h.time.findIndex(function (t) { return t.slice(0, 13) === nowHour; });
    if (start < 0) start = 0;

    var hours = [];
    for (var i = start; i < Math.min(start + 24, h.time.length); i++) hours.push(hourAt(i));

    /* 날짜별로 묶는다. 서머타임이 있는 지역은 하루가 23·25시간이라 "24개씩" 자르면 어긋난다. */
    var byDate = {};
    h.time.forEach(function (t, k) {
      var key = t.slice(0, 10);
      (byDate[key] = byDate[key] || []).push(hourAt(k));
    });

    var days = dy.time.map(function (date, j) {
      var list = byDate[date] || [];
      return {
        date: date,
        kind: 'forecast',
        code: dy.weather_code[j],
        sky: describe(dy.weather_code[j]),
        tmax: dy.temperature_2m_max[j],
        tmin: dy.temperature_2m_min[j],
        humidity: dy.relative_humidity_2m_mean ? dy.relative_humidity_2m_mean[j] : null,
        wind: dy.wind_speed_10m_max[j],
        windDeg: dy.wind_direction_10m_dominant ? dy.wind_direction_10m_dominant[j] : null,
        precip: dy.precipitation_sum[j],
        pop: dy.precipitation_probability_max ? dy.precipitation_probability_max[j] : null,
        am: summarizeHalf(list.filter(function (x) { return x.hour < 12; })),
        pm: summarizeHalf(list.filter(function (x) { return x.hour >= 12; })),
        slots: threeHourSlots(list),
      };
    });

    return {
      timezone: d.timezone,
      lat: d.latitude,
      lon: d.longitude,
      now: {
        time: c.time,
        temp: c.temperature_2m,
        feels: c.apparent_temperature,
        humidity: c.relative_humidity_2m,
        wind: c.wind_speed_10m,
        windDeg: c.wind_direction_10m,
        code: c.weather_code,
        precip: c.precipitation,
      },
      hours: hours,
      days: days,
    };
  }

  /* ---------- 예년 참고값 (예보 범위 밖) ---------- */

  /* "2026-10-17" 에서 n 일 뒤 날짜. 시간대 영향을 받지 않게 UTC 로 계산한다. */
  function addDays(date, n) {
    var p = date.split('-').map(Number);
    var t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return t.toISOString().slice(0, 10);
  }

  /* k 년 전 같은 날짜. 윤년이 아니면 2월 29일은 28일로 바꾼다. */
  function shiftYear(date, k) {
    var y = Number(date.slice(0, 4)) - k;
    var md = date.slice(5);
    var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (md === '02-29' && !leap) md = '02-28';
    return y + '-' + md;
  }

  function mean(list) {
    var xs = list.filter(function (x) { return typeof x === 'number' && !isNaN(x); });
    if (!xs.length) return null;
    return xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
  }

  /*
   * 예년 날씨를 한마디로. 과거 기상 코드의 최빈값은 쓰지 않는다 — 재분석 자료는 0.1mm 에도
   * "이슬비" 코드를 붙여서, 코드로 고르면 실제보다 궂게 나온다. 대신 수치로 판단한다.
   *   wet  : 비·눈이 1mm 이상 온 해의 수     snow : 눈이 0.5cm 이상 온 해의 수
   *   cloud: 평균 운량(%)
   */
  function normalSky(wet, snow, years, cloud) {
    if (wet > 0) {
      var what = snow === 0 ? '비' : snow >= wet ? '눈' : '비·눈';
      var icon = snow === 0 ? '🌧️' : '🌨️';
      if (wet * 2 >= years) return { text: what + ' 잦음', icon: icon };
      return { text: '가끔 ' + what, icon: snow === 0 ? '🌦️' : icon };
    }
    if (cloud == null) return { text: '강수 적음', icon: '🌤️' };
    if (cloud < 35) return { text: '대체로 맑음', icon: '🌤️' };
    if (cloud < 70) return { text: '구름 많음', icon: '⛅' };
    return { text: '흐림', icon: '☁️' };
  }

  /*
   * dates(현지 날짜 문자열 배열)에 대해 최근 NORMAL_YEARS 년 같은 날짜의 평균을 낸다.
   * 한 해라도 받아오면 그 해만으로 평균을 낸다. 모두 실패하면 reject.
   */
  function normals(lat, lon, dates, signal) {
    if (!dates.length) return Promise.resolve([]);
    var first = dates[0];
    var last = dates[dates.length - 1];

    var jobs = [];
    for (var k = 1; k <= NORMAL_YEARS; k++) {
      var url = ARCHIVE_URL + '?' + qs({
        latitude: round4(lat),
        longitude: round4(lon),
        start_date: shiftYear(first, k),
        end_date: shiftYear(last, k),
        daily: 'temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,wind_speed_10m_max,precipitation_sum,snowfall_sum,cloud_cover_mean',
        timezone: 'auto',
        wind_speed_unit: 'ms',
      });
      jobs.push(getJSON(url, signal).then(function (d) { return d.daily; }, function (err) {
        if (err && err.name === 'AbortError') throw err;
        return null;
      }));
    }

    return Promise.all(jobs).then(function (years) {
      years = years.filter(Boolean);
      if (!years.length) throw new Error('예년 자료 없음');

      /* 해마다 "MM-DD" → 인덱스 */
      var indexed = years.map(function (d) {
        var map = {};
        d.time.forEach(function (t, i) { map[t.slice(5)] = i; });
        return { d: d, map: map };
      });

      return dates.map(function (date) {
        var md = date.slice(5);
        var rows = indexed.map(function (y) {
          var i = y.map[md];
          if (i === undefined && md === '02-29') i = y.map['02-28'];
          return i === undefined ? null : {
            tmax: y.d.temperature_2m_max[i],
            tmin: y.d.temperature_2m_min[i],
            humidity: y.d.relative_humidity_2m_mean ? y.d.relative_humidity_2m_mean[i] : null,
            wind: y.d.wind_speed_10m_max[i],
            precip: y.d.precipitation_sum[i],
            snow: y.d.snowfall_sum ? y.d.snowfall_sum[i] : null,
            cloud: y.d.cloud_cover_mean ? y.d.cloud_cover_mean[i] : null,
          };
        }).filter(Boolean);

        function pick(key) { return rows.map(function (r) { return r[key]; }); }
        var wet = rows.filter(function (r) { return r.precip >= 1 || r.snow >= 0.5; }).length;
        var snow = rows.filter(function (r) { return r.snow >= 0.5; }).length;
        var cloud = mean(pick('cloud'));
        return {
          date: date,
          kind: 'normal',
          years: rows.length,
          wetYears: wet,
          snowYears: snow,
          cloud: cloud,
          sky: normalSky(wet, snow, rows.length, cloud),
          code: null,
          tmax: mean(pick('tmax')),
          tmin: mean(pick('tmin')),
          humidity: mean(pick('humidity')),
          wind: mean(pick('wind')),
          precip: mean(pick('precip')),
          pop: null,
          windDeg: null,
        };
      });
    });
  }

  /* 예보 뒤에 이어 붙일 날짜들 (한달 = 30일) */
  function monthTailDates(forecastDays) {
    if (!forecastDays.length) return [];
    var last = forecastDays[forecastDays.length - 1].date;
    var out = [];
    for (var i = 1; forecastDays.length + out.length < MONTH_DAYS; i++) out.push(addDays(last, i));
    return out;
  }

  window.WeatherAPI = {
    FORECAST_DAYS: FORECAST_DAYS,
    MONTH_DAYS: MONTH_DAYS,
    NORMAL_YEARS: NORMAL_YEARS,
    describe: describe,
    windDir: windDir,
    search: search,
    reverse: reverse,
    forecast: forecast,
    normals: normals,
    monthTailDates: monthTailDates,
    /* 테스트용으로 노출하는 순수 함수 */
    _addDays: addDays,
    _shiftYear: shiftYear,
    _nameFromAddress: nameFromAddress,
    _normalSky: normalSky,
    _summarizeCodes: summarizeCodes,
    _normalizeForecast: normalizeForecast,
    _distanceKm: distanceKm,
    _codes: Object.keys(WMO).map(Number),
  };
})();
