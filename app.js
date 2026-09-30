/*
 * 화면 로직 — 검색 · 지도 핀 · 현재 날씨 · 하루/일주일/한달 탭
 * 데이터는 모두 window.WeatherAPI (weather-api.js) 를 거친다.
 */
(function () {
  'use strict';

  var API = window.WeatherAPI;
  var STORE_PLACE = 'weather.lastPlace';
  var STORE_TAB = 'weather.tab';
  var DEFAULT_PLACE = { name: '서울특별시', detail: '대한민국', lat: 37.5665, lon: 126.978 };
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var state = {
    place: null,
    data: null,
    normals: null,
    normalsState: 'idle', // idle | loading | ok | error
    openDays: {},         // 펼친 날짜 "weekList:2026-10-02" → true (다시 그려도 유지)
    tab: 'day',
    seq: 0,
    ctrl: null,
  };
  var map = null;
  var marker = null;
  var searchSeq = 0;
  var hideChartTip = null;

  function $(id) { return document.getElementById(id); }
  function isAbort(err) { return err && err.name === 'AbortError'; }
  function setPhase(p) { document.documentElement.setAttribute('data-state', p); }

  /* ---------- 저장 (file:// 나 사생활 보호 모드에서 막혀도 죽지 않게) ---------- */

  function load(key) {
    try { return JSON.parse(window.localStorage.getItem(key)); } catch (e) { return null; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장 못 해도 화면은 계속 */ }
  }
  function validPlace(p) {
    return p && typeof p.lat === 'number' && typeof p.lon === 'number' &&
      Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && typeof p.name === 'string';
  }

  /* ---------- 표시 형식 ---------- */

  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  function num(v) { return typeof v === 'number' && !isNaN(v); }
  function fmtTemp(v) { return num(v) ? Math.round(v) + '°' : '–'; }
  function fmtPct(v) { return num(v) ? Math.round(v) + '%' : '–'; }
  function fmtWind(v) { return num(v) ? v.toFixed(1) + ' m/s' : '–'; }
  function fmtMm(v) { return num(v) ? (v < 0.05 ? '0' : v.toFixed(1)) + 'mm' : '–'; }
  function dow(date) {
    var p = date.split('-').map(Number);
    return WEEK[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  }
  function mmdd(date) { return Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10)); }
  function hourLabel(time) { return Number(time.slice(11, 13)) + '시'; }
  function normLon(lon) { return ((((lon + 180) % 360) + 360) % 360) - 180; }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  /* ---------- 상태 메시지 ---------- */

  function setStatus(text, kind, action) {
    var box = $('status');
    box.textContent = '';
    if (!text) return;
    var msg = el('div', 'msg' + (kind ? ' ' + kind : ''));
    msg.appendChild(el('span', null, text));
    if (action) {
      var b = el('button', 'btn ghost', action.label);
      b.type = 'button';
      b.addEventListener('click', action.run);
      msg.appendChild(b);
    }
    box.appendChild(msg);
  }

  /* ---------- 지도 ---------- */

  /*
   * 지도 그림(타일) 서버. 앞에서부터 쓰고, 한 곳이 계속 실패하면 다음 곳으로 넘어간다.
   *
   * OSM 공식 서버는 Referer 가 없는 브라우저 요청에 "Access blocked" 그림을 보낸다.
   * index.html 을 더블클릭(file://)하면 Referer 가 없으므로 그때는 공식 서버를 건너뛴다.
   * 오류가 아니라 정상 그림으로 오기 때문에 tileerror 로는 알아챌 수 없어서 미리 거른다.
   */
  var OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var TILE_SOURCES = [
    {
      id: 'osm', needsReferer: true, maxZoom: 19,
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: OSM_CREDIT,
    },
    {
      id: 'osm-hot', maxZoom: 19,
      url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      attribution: OSM_CREDIT + ', 타일 <a href="https://www.hotosm.org/">HOT</a> · <a href="https://openstreetmap.fr/">OSM France</a>',
    },
    {
      id: 'osm-de', maxZoom: 18,
      url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
      attribution: OSM_CREDIT + ', 타일 <a href="https://www.openstreetmap.de/">OSM Deutschland</a>',
    },
  ];
  var TILE_GIVE_UP = 3; // 한 장도 못 받고 이만큼 실패하면 다음 서버로
  var tileLayer = null;

  function setMapNotice(text) {
    var box = $('mapNotice');
    box.textContent = text || '';
    box.hidden = !text;
  }

  function useTiles(list, i) {
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = null;
    if (i >= list.length) {
      $('map').setAttribute('data-tiles', 'none');
      setMapNotice('지도 그림을 불러오지 못했습니다. 인터넷이나 회사 방화벽에서 지도 서버가 막혔을 수 있습니다. ' +
        '지역명 검색과 날씨는 그대로 쓸 수 있습니다.');
      return;
    }
    var src = list[i];
    var loaded = 0;
    var failed = 0;
    var gaveUp = false;
    var layer = L.tileLayer(src.url, { maxZoom: src.maxZoom, attribution: src.attribution });
    layer.on('tileload', function () { loaded++; setMapNotice(''); });
    layer.on('tileerror', function () {
      if (gaveUp || loaded > 0) return;
      if (++failed >= TILE_GIVE_UP) { gaveUp = true; useTiles(list, i + 1); }
    });
    tileLayer = layer.addTo(map);
    $('map').setAttribute('data-tiles', src.id);
  }

  function initMap() {
    var box = $('map');
    if (!window.L) {
      box.classList.add('map-failed');
      box.textContent = '지도를 불러오지 못했습니다. 지역명 검색은 그대로 쓸 수 있습니다.';
      return;
    }
    map = L.map(box, { worldCopyJump: true }).setView([36.4, 127.9], 7);
    var noReferer = location.protocol === 'file:';
    useTiles(TILE_SOURCES.filter(function (s) { return !(s.needsReferer && noReferer); }), 0);
    map.on('click', function (e) { pickPoint(e.latlng.lat, e.latlng.lng); });
  }

  function placeMarker(lat, lon) {
    if (!map) return;
    if (marker) { marker.setLatLng([lat, lon]); return; }
    marker = L.marker([lat, lon], {
      draggable: true,
      title: '선택한 위치 — 끌어서 옮길 수 있습니다',
      alt: '선택한 위치',
      icon: L.divIcon({ className: 'pin-wrap', html: '<div class="pin"></div>', iconSize: [26, 26], iconAnchor: [13, 30] }),
    }).addTo(map);
    marker.on('dragend', function () {
      var p = marker.getLatLng();
      pickPoint(p.lat, p.lng);
    });
  }

  /* 지도에서 찍은 지점: 이름은 모르니 좌표로 먼저 날씨를 받고, 이름은 따로 채운다 */
  function pickPoint(lat, lon) {
    hideCandidates();
    loadPlace({ name: '선택한 위치', detail: '지명 확인 중…', lat: lat, lon: normLon(lon) }, { reverse: true });
  }

  /* ---------- 위치 → 날씨 ---------- */

  function loadPlace(place, opts) {
    opts = opts || {};
    if (state.ctrl) state.ctrl.abort();
    var ctrl = new AbortController();
    var seq = ++state.seq;
    state.ctrl = ctrl;
    state.place = place;
    state.normals = null;
    state.normalsState = 'loading';
    state.openDays = {};

    placeMarker(place.lat, place.lon);
    if (opts.fly && map) {
      /* 첫 화면은 애니메이션 없이 — 줌 애니메이션 중에는 핀을 끌 수 없다 */
      map.setView([place.lat, place.lon], Math.max(map.getZoom(), 11), { animate: !opts.initial });
    }
    renderPlace();
    setPhase('loading');
    $('results').classList.add('is-busy');
    setStatus('날씨를 불러오는 중…');

    if (opts.reverse) {
      API.reverse(place.lat, place.lon, ctrl.signal).then(function (n) {
        if (seq !== state.seq) return;
        place.name = n ? n.name : '선택한 위치';
        place.detail = n ? n.detail : '지명을 확인하지 못했습니다';
        renderPlace();
        save(STORE_PLACE, place);
      }, function () { /* 중단됨 */ });
    } else {
      save(STORE_PLACE, place);
    }

    API.forecast(place.lat, place.lon, ctrl.signal).then(function (data) {
      if (seq !== state.seq) return;
      state.data = data;
      $('results').classList.remove('is-busy');
      setStatus('');
      renderAll();
      setPhase('ready');

      return API.normals(place.lat, place.lon, API.monthTailDates(data.days), ctrl.signal).then(function (n) {
        if (seq !== state.seq) return;
        state.normals = n;
        state.normalsState = 'ok';
        renderMonth();
      }, function (err) {
        if (seq !== state.seq || isAbort(err)) return;
        state.normalsState = 'error';
        renderMonth();
      });
    }).catch(function (err) {
      if (seq !== state.seq || isAbort(err)) return;
      $('results').classList.remove('is-busy');
      setPhase('error');
      setStatus('날씨 정보를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요. (' + err.message + ')', 'error', {
        label: '다시 시도',
        run: function () { loadPlace(state.place, { reverse: opts.reverse }); },
      });
    });
  }

  /* ---------- 검색 ---------- */

  function hideCandidates() {
    var box = $('candidates');
    box.hidden = true;
    box.textContent = '';
  }

  function showCandidates(list, activeIndex) {
    var box = $('candidates');
    box.textContent = '';
    if (list.length < 2) { box.hidden = true; return; }
    box.appendChild(el('span', 'label', '다른 후보'));
    list.forEach(function (p, i) {
      var b = el('button', 'chip', p.area ? p.name + ' · ' + p.area : p.name);
      b.type = 'button';
      b.title = [p.name, p.detail].filter(Boolean).join(' · ');
      b.setAttribute('aria-pressed', String(i === activeIndex));
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(box.querySelectorAll('.chip'), function (c) { c.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        loadPlace({ name: p.name, detail: p.detail, lat: p.lat, lon: p.lon }, { fly: true });
      });
      box.appendChild(b);
    });
    box.hidden = false;
  }

  function doSearch(query) {
    var seq = ++searchSeq;
    hideCandidates();
    setStatus('“' + query + '” 찾는 중…');
    API.search(query).then(function (list) {
      if (seq !== searchSeq) return;
      if (!list.length) {
        setStatus('“' + query + '”에 해당하는 지역을 찾지 못했습니다. 다른 이름으로 검색하거나 지도에서 직접 골라 보세요.', 'warn');
        return;
      }
      var first = list[0];
      loadPlace({ name: first.name, detail: first.detail, lat: first.lat, lon: first.lon }, { fly: true });
      showCandidates(list, 0);
    }).catch(function (err) {
      if (seq !== searchSeq) return;
      setStatus('지역 검색에 실패했습니다. 잠시 후 다시 시도해 주세요. (' + err.message + ')', 'error');
    });
  }

  /* ---------- 렌더링 ---------- */

  function renderPlace() {
    var p = state.place;
    $('placeName').textContent = p.name;
    $('placeDetail').textContent = p.detail || '';
    $('coords').textContent = '위도 ' + p.lat.toFixed(4) + ' · 경도 ' + p.lon.toFixed(4);
  }

  function renderAll() {
    renderCurrent();
    renderDay();
    renderWeek();
    renderMonth();
  }

  function renderCurrent() {
    var d = state.data;
    var now = d.now;
    var info = API.describe(now.code);
    var today = d.days[0] || {};
    $('nowIcon').textContent = info.icon;
    $('nowTemp').textContent = fmtTemp(now.temp);
    $('nowDesc').textContent = info.text;
    $('nowFeels').textContent = '체감 ' + fmtTemp(now.feels);
    $('nowHumidity').textContent = fmtPct(now.humidity);
    $('nowWind').textContent = fmtWind(now.wind);
    $('nowWindDir').textContent = API.windDir(now.windDeg) || '풍향 정보 없음';
    $('nowPop').textContent = fmtPct(today.pop);
    $('nowPrecip').textContent = '예상 강수량 ' + fmtMm(today.precip);
    $('nowRange').textContent = fmtTemp(today.tmax) + ' / ' + fmtTemp(today.tmin);
    $('obsTime').textContent = now.time ? '· 현지 ' + now.time.slice(11, 16) + ' 기준' : '';
  }

  /* 하루: 24시간 기온 선 그래프 + 시간별 카드 */
  /* 날씨 아이콘. 글자 설명은 aria-label·title 로 붙여 색·그림만으로 전달되지 않게 한다. */
  function skyIcon(tag, cls, info) {
    var icon = el(tag, cls, info.icon);
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', info.text);
    icon.title = info.text;
    return icon;
  }

  /* 시간 카드 — 하루 탭(1시간)과 일별 펼침(3시간)이 같이 쓴다 */
  function hourCard(label, h) {
    var li = el('li', 'hour');
    li.setAttribute('data-time', h.time);
    li.appendChild(el('div', 'h-time', label));
    li.appendChild(skyIcon('div', 'h-icon', h.sky || API.describe(h.code)));
    li.appendChild(el('div', 'h-temp', fmtTemp(h.temp)));
    var meta = el('div', 'h-meta');
    meta.appendChild(el('div', 'hm-pop', '강수 ' + fmtPct(h.pop)));
    meta.appendChild(el('div', 'hm-hum', '습도 ' + fmtPct(h.humidity)));
    meta.appendChild(el('div', 'hm-wind', fmtWind(h.wind)));
    li.appendChild(meta);
    return li;
  }

  function renderDay() {
    var list = $('hourList');
    list.textContent = '';
    state.data.hours.forEach(function (h, i) {
      list.appendChild(hourCard(i === 0 ? '지금' : hourLabel(h.time), h));
    });
    renderDayChart();
  }

  function niceScale(lo, hi) {
    var span = Math.max(hi - lo, 1);
    var step = [1, 2, 5, 10, 20].find(function (s) { return span / s <= 4; }) || 20;
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step: step };
  }

  function renderDayChart() {
    var box = $('dayChart');
    box.textContent = '';
    var hours = state.data ? state.data.hours.filter(function (h) { return num(h.temp); }) : [];
    if (hours.length < 2) { box.appendChild(el('p', 'note', '시간별 기온 자료가 없습니다.')); return; }

    var W = Math.max(280, Math.round(box.clientWidth || 640));
    var H = 210;
    var pad = { l: 34, r: 14, t: 26, b: 26 };
    var temps = hours.map(function (h) { return h.temp; });
    var tMin = Math.min.apply(null, temps);
    var tMax = Math.max.apply(null, temps);
    var sc = niceScale(tMin - 1, tMax + 1);
    var n = hours.length;
    var xStep = (W - pad.l - pad.r) / (n - 1);
    function x(i) { return pad.l + i * xStep; }
    function y(v) { return pad.t + (sc.hi - v) / (sc.hi - sc.lo) * (H - pad.t - pad.b); }

    var root = svg('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: W, height: H,
      role: 'img', tabindex: '0',
      'aria-label': '앞으로 24시간 기온 그래프. 최저 ' + Math.round(tMin) + '도, 최고 ' + Math.round(tMax) + '도',
    });

    for (var v = sc.lo; v <= sc.hi + 1e-9; v += sc.step) {
      root.appendChild(svg('line', { class: 'grid', x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }));
      var t = svg('text', { class: 'axis-text', x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' });
      t.textContent = v + '°';
      root.appendChild(t);
    }

    var every = W < 520 ? 6 : 3;
    hours.forEach(function (h, i) {
      if (i % every !== 0) return;
      var t = svg('text', { class: 'axis-text', x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : 'middle' });
      t.textContent = i === 0 ? '지금' : hourLabel(h.time);
      root.appendChild(t);
    });

    var line = hours.map(function (h, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(h.temp).toFixed(1); }).join(' ');
    var base = y(sc.lo).toFixed(1);
    root.appendChild(svg('path', { class: 'area', d: line + ' L' + x(n - 1).toFixed(1) + ' ' + base + ' L' + x(0).toFixed(1) + ' ' + base + ' Z' }));
    root.appendChild(svg('path', { class: 'line', d: line }));

    /* 최고·최저만 라벨을 단다. 나머지는 툴팁과 아래 시간별 카드가 맡는다. */
    var iMax = temps.indexOf(tMax);
    var iMin = temps.indexOf(tMin);
    [[iMax, -10], [iMin, 18]].forEach(function (pair, k) {
      var i = pair[0];
      if (k === 1 && iMin === iMax) return;
      root.appendChild(svg('circle', { class: 'dot', cx: x(i), cy: y(temps[i]), r: 4 }));
      var anchor = i < 2 ? 'start' : i > n - 3 ? 'end' : 'middle';
      var lab = svg('text', { class: 'extreme-text', x: x(i), y: y(temps[i]) + pair[1], 'text-anchor': anchor });
      lab.textContent = (k === 0 ? '최고 ' : '최저 ') + Math.round(temps[i]) + '°';
      root.appendChild(lab);
    });

    var cross = svg('line', { class: 'cross', y1: pad.t - 8, y2: H - pad.b, visibility: 'hidden' });
    var focusDot = svg('circle', { class: 'dot', r: 5, visibility: 'hidden' });
    root.appendChild(cross);
    root.appendChild(focusDot);
    var hit = svg('rect', { x: pad.l - xStep / 2, y: 0, width: W - pad.l - pad.r + xStep, height: H, fill: 'transparent' });
    root.appendChild(hit);

    var tip = el('div', 'tooltip');
    tip.hidden = true;
    box.appendChild(root);
    box.appendChild(tip);

    var current = -1;
    function show(i) {
      i = Math.max(0, Math.min(n - 1, i));
      current = i;
      var h = hours[i];
      var info = API.describe(h.code);
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      focusDot.setAttribute('cx', x(i)); focusDot.setAttribute('cy', y(h.temp));
      focusDot.setAttribute('visibility', 'visible');

      tip.textContent = '';
      tip.appendChild(el('div', 'tt-time', (i === 0 ? '지금 · ' : '') + mmdd(h.time.slice(0, 10)) + ' ' + h.time.slice(11, 16)));
      tip.appendChild(el('div', 'tt-val', fmtTemp(h.temp) + ' ' + info.icon));
      [['날씨', info.text], ['습도', fmtPct(h.humidity)], ['바람', fmtWind(h.wind)], ['강수확률', fmtPct(h.pop)]].forEach(function (r) {
        var row = el('div', 'tt-row');
        row.appendChild(el('span', null, r[0]));
        row.appendChild(el('b', null, r[1]));
        tip.appendChild(row);
      });
      tip.hidden = false;

      var scale = root.getBoundingClientRect().width / W || 1;
      var px = x(i) * scale;
      var tw = tip.offsetWidth;
      var left = px + 12 + tw > box.clientWidth ? px - 12 - tw : px + 12;
      tip.style.left = Math.max(0, left) + 'px';
    }
    function hide() {
      current = -1;
      tip.hidden = true;
      cross.setAttribute('visibility', 'hidden');
      focusDot.setAttribute('visibility', 'hidden');
    }
    function indexAt(clientX) {
      var r = root.getBoundingClientRect();
      var px = (clientX - r.left) * (W / r.width);
      return Math.round((px - pad.l) / xStep);
    }

    hit.addEventListener('pointermove', function (e) { show(indexAt(e.clientX)); });
    hit.addEventListener('pointerdown', function (e) { show(indexAt(e.clientX)); });
    /* 터치는 손을 떼면 바로 pointerleave 가 온다. 탭한 값이 남도록 마우스일 때만 숨기고,
     * 터치는 차트 밖을 누르면 숨긴다(init 의 document pointerdown). */
    root.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
    hideChartTip = hide;
    root.addEventListener('focus', function () { show(current < 0 ? 0 : current); });
    root.addEventListener('blur', hide);
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { show(current + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { show(current - 1); e.preventDefault(); }
      else if (e.key === 'Home') { show(0); e.preventDefault(); }
      else if (e.key === 'End') { show(n - 1); e.preventDefault(); }
      else if (e.key === 'Escape') { hide(); }
    });
  }

  /* 오전·오후 칸 하나 */
  function halfCell(which, label, h) {
    var cell = el('span', 'half');
    cell.setAttribute('data-half', which);
    cell.title = label + ' ' + h.sky.text + ' · 강수확률 ' + fmtPct(h.pop);
    cell.appendChild(el('span', 'h-lab', label));
    cell.appendChild(skyIcon('span', 'i', h.sky));
    cell.appendChild(el('span', 'h-pop', fmtPct(h.pop)));
    return cell;
  }

  /* 날짜를 펼치면 3시간 간격 예보. 오늘은 이미 지난 시간대를 뺀다. */
  function renderSlots(panel, d) {
    var now = state.data.now.time || '';
    var today = now.slice(0, 10) === d.date;
    var nowHour = Number(now.slice(11, 13));
    var ul = el('ul', 'hours slots');
    ul.setAttribute('aria-label', mmdd(d.date) + ' ' + dow(d.date) + '요일 3시간 간격 예보');
    d.slots.forEach(function (s) {
      if (today && s.hour + 3 <= nowHour) return;
      ul.appendChild(hourCard(s.hour + '시', s));
    });
    panel.textContent = '';
    panel.appendChild(ul);
  }

  function setOpen(key, row, panel, d, open) {
    row.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    if (open) {
      state.openDays[key] = true;
      if (!panel.firstChild) renderSlots(panel, d);
    } else {
      delete state.openDays[key];
    }
  }

  /*
   * 일별 목록 (일주일·한달 공용). 막대 눈금은 목록 전체가 한 축을 쓴다.
   * 예보일은 오전·오후로 나눠 보여주고, 누르면 3시간 간격이 펼쳐진다.
   * 예년일(17일째~)은 예보가 없어 하루 요약 한 칸만 두고 펼치지 않는다.
   */
  function renderDays(list, days) {
    list.textContent = '';
    var lows = days.map(function (d) { return d.tmin; }).filter(num);
    var highs = days.map(function (d) { return d.tmax; }).filter(num);
    var lo = Math.floor(Math.min.apply(null, lows));
    var hi = Math.ceil(Math.max.apply(null, highs));
    var span = Math.max(hi - lo, 1);

    days.forEach(function (d, i) {
      if (d.kind === 'normal' && (i === 0 || days[i - 1].kind !== 'normal')) {
        list.appendChild(el('li', 'normal-divider',
          '여기부터 예년 참고값 — 예보가 아니라 최근 ' + API.NORMAL_YEARS + '년 같은 날짜의 평균입니다.'));
      }
      var li = el('li', 'day');
      li.setAttribute('data-kind', d.kind);
      li.setAttribute('data-date', d.date);

      var canOpen = d.kind === 'forecast' && d.slots && d.slots.length > 0;
      var row = el(canOpen ? 'button' : 'div', 'day-row');

      var date = el('span', 'd-date');
      var label = i === 0 && d.kind === 'forecast' ? '오늘' : i === 1 && d.kind === 'forecast' ? '내일' : dow(d.date);
      var b = el('b', null, label);
      if (d.kind === 'normal') b.appendChild(el('span', 'badge', '예년'));
      date.appendChild(b);
      date.appendChild(el('span', 'd-md', mmdd(d.date) + (label === dow(d.date) ? '' : ' ' + dow(d.date))));
      row.appendChild(date);

      var halves = el('span', 'd-halves');
      if (d.am || d.pm) {
        if (d.am) halves.appendChild(halfCell('am', '오전', d.am));
        if (d.pm) halves.appendChild(halfCell('pm', '오후', d.pm));
      } else {
        var info = d.sky || API.describe(d.code);
        var whole = el('span', 'half whole');
        whole.appendChild(skyIcon('span', 'i', info));
        whole.appendChild(el('span', 't', info.text));
        halves.appendChild(whole);
      }
      row.appendChild(halves);

      var temp = el('span', 'd-temp');
      temp.appendChild(el('span', 't-min', fmtTemp(d.tmin)));
      var range = el('span', 'range');
      range.setAttribute('aria-hidden', 'true');
      if (num(d.tmin) && num(d.tmax)) {
        var fill = el('span', 'range-fill');
        fill.style.left = ((d.tmin - lo) / span * 100).toFixed(1) + '%';
        fill.style.width = ((d.tmax - d.tmin) / span * 100).toFixed(1) + '%';
        range.appendChild(fill);
      }
      temp.appendChild(range);
      temp.appendChild(el('span', 't-max', fmtTemp(d.tmax)));
      row.appendChild(temp);

      var meta = el('span', 'd-meta');
      if (d.kind === 'normal') {
        meta.appendChild(el('span', 'm-rain', (d.snowYears ? '눈·비' : '비') + ' 온 해 ' + d.wetYears + '/' + d.years));
      } else {
        meta.appendChild(el('span', 'm-rain', '강수량 ' + fmtMm(d.precip)));
      }
      meta.appendChild(el('span', 'm-hum', '습도 ' + fmtPct(d.humidity)));
      meta.appendChild(el('span', 'm-wind', '바람 ' + fmtWind(d.wind)));
      row.appendChild(meta);
      li.appendChild(row);

      if (canOpen) {
        var key = list.id + ':' + d.date;
        var panel = el('div', 'slots-panel');
        panel.id = list.id + '-' + d.date;
        row.type = 'button';
        row.setAttribute('aria-controls', panel.id);
        var chev = el('span', 'chev', '▾');
        chev.setAttribute('aria-hidden', 'true');
        row.appendChild(chev);
        li.appendChild(panel);
        setOpen(key, row, panel, d, !!state.openDays[key]);
        row.addEventListener('click', function () {
          setOpen(key, row, panel, d, row.getAttribute('aria-expanded') !== 'true');
        });
      }

      list.appendChild(li);
    });
  }

  function renderWeek() {
    renderDays($('weekList'), state.data.days.slice(0, 7));
  }

  function renderMonth() {
    if (!state.data) return;
    var days = state.data.days.slice();
    var note = $('monthNote');
    note.classList.remove('warn');
    var fc = days.length;
    var farNote = ' 예보는 멀수록 부정확하니 8일째 이후는 참고만 하세요.';
    if (state.normalsState === 'ok' && state.normals) {
      days = days.concat(state.normals);
      note.textContent = '1~' + fc + '일째는 예보, ' + (fc + 1) + '~' + days.length + '일째는 예보가 없어 최근 ' +
        API.NORMAL_YEARS + '년 같은 날짜의 평균(예년 참고값)을 보여줍니다.' + farNote;
    } else if (state.normalsState === 'error') {
      note.classList.add('warn');
      note.textContent = (fc + 1) + '일째 이후의 예년 자료를 불러오지 못했습니다. ' + fc + '일 예보만 표시합니다.' + farNote;
    } else {
      note.textContent = (fc + 1) + '일째 이후의 예년 자료를 불러오는 중…';
    }
    renderDays($('monthList'), days);
  }

  /* ---------- 탭 ---------- */

  function selectTab(name, focus) {
    state.tab = name;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
    save(STORE_TAB, name);
    /* 숨겨진 상태에서 그리면 폭이 0 이므로 보일 때 다시 그린다 */
    if (name === 'day' && state.data) renderDayChart();
  }

  function initTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { selectTab(t.getAttribute('data-tab')); });
      t.addEventListener('keydown', function (e) {
        var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
        if (j === null) return;
        e.preventDefault();
        selectTab(tabs[(j + tabs.length) % tabs.length].getAttribute('data-tab'), true);
      });
    });
    var saved = load(STORE_TAB);
    selectTab(['day', 'week', 'month'].indexOf(saved) >= 0 ? saved : 'day');
  }

  /* ---------- 시작 ---------- */

  function init() {
    setPhase('loading');
    initMap();
    initTabs();

    $('searchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('q').value.trim();
      if (!q) { $('q').focus(); return; }
      doSearch(q);
    });

    var locate = $('locateBtn');
    if (!navigator.geolocation || !map) {
      locate.hidden = true;
    } else {
      locate.addEventListener('click', function () {
        setStatus('현재 위치를 확인하는 중…');
        navigator.geolocation.getCurrentPosition(function (pos) {
          map.setView([pos.coords.latitude, pos.coords.longitude], Math.max(map.getZoom(), 12));
          pickPoint(pos.coords.latitude, pos.coords.longitude);
        }, function () {
          setStatus('현재 위치를 가져올 수 없습니다. 브라우저의 위치 권한을 확인하거나 지도를 직접 눌러 주세요.', 'warn');
        }, { timeout: 10000, maximumAge: 300000 });
      });
    }

    document.addEventListener('pointerdown', function (e) {
      if (hideChartTip && !$('dayChart').contains(e.target)) hideChartTip();
    });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (state.tab === 'day' && state.data) renderDayChart();
      }, 150);
    });

    var saved = load(STORE_PLACE);
    loadPlace(validPlace(saved) ? saved : DEFAULT_PLACE, { fly: true, initial: true });
  }

  /* 테스트에서 지도·상태를 들여다보기 위한 창구 */
  window.WeatherApp = {
    state: state,
    map: function () { return map; },
    marker: function () { return marker; },
  };

  init();
})();
