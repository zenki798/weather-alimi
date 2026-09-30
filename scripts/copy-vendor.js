/*
 * node_modules/leaflet 의 배포 파일을 vendor/leaflet 으로 복사한다.
 *
 * CDN 대신 저장소에 넣어 두는 이유
 * - index.html 을 더블클릭(file://)해서 열어도, 인터넷이 느려도 지도 코드가 뜬다.
 * - 테스트가 외부 CDN 상태에 흔들리지 않는다.
 * leaflet 버전을 올린 뒤 `npm run vendor` 로 다시 복사한다.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'leaflet');
const dst = path.join(__dirname, '..', 'vendor', 'leaflet');

fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(path.join(dst, 'images'), { recursive: true });

for (const f of ['leaflet.js', 'leaflet.css']) {
  fs.copyFileSync(path.join(src, 'dist', f), path.join(dst, f));
}
for (const f of fs.readdirSync(path.join(src, 'dist', 'images'))) {
  fs.copyFileSync(path.join(src, 'dist', 'images', f), path.join(dst, 'images', f));
}
fs.copyFileSync(path.join(src, 'LICENSE'), path.join(dst, 'LICENSE'));

const version = require(path.join(src, 'package.json')).version;
fs.writeFileSync(path.join(dst, 'VERSION'), version + '\n');
console.log('leaflet ' + version + ' → vendor/leaflet');
