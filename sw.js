/* 서비스 워커 — 앱 설치 조건을 채우고, 오프라인에서도 앱 화면이 뜨게 한다.
   네트워크 우선: 새 버전을 올리면 다음 실행 때 바로 반영되고, 연결이 없을 때만 캐시를 쓴다.
   날씨·지명·지도 서버(다른 출처) 요청은 건드리지 않는다. 오래된 날씨를 새것처럼 보여주면 안 되기 때문이다.
   (연결이 없으면 화면은 뜨고, 날씨 칸에 "불러오지 못했습니다 · 다시 시도" 가 나온다) */
const CACHE = 'weatheralimi-v1';
const SHELL = [
  './', 'index.html', 'app.js', 'weather-api.js', 'manifest.webmanifest',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      // ?source=pwa 처럼 주소 뒤가 달라도 같은 화면이므로 뒤를 무시하고 찾는다
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html')))
  );
});
