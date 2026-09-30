/* 앱 아이콘 PNG 를 만든다 (`npm run make:icons`). 이미지 도구 없이 SVG 를 브라우저로 찍는다.
   - icon-192/512      : 일반 아이콘 (둥근 모서리, 바깥은 투명)
   - icon-maskable-512 : 안드로이드 모양 마스크용 (배경을 끝까지 채우고, 그림은 가운데 안전 영역 안에)
   - apple-touch-icon  : iOS 홈 화면용 180px (배경을 끝까지 채운다. 모서리는 iOS 가 둥글린다) */
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'icons');
const SKY_TOP = '#4a97ec';
const SKY_BOTTOM = '#1c5cab';

// 해 + 구름(구름 조금). 100×100 좌표계에서 그림 전체가 가운데(50,50)에 오도록 잡았다.
function glyph(scale) {
  const t = (100 - 100 * scale) / 2;
  return `
  <g transform="translate(${t} ${t}) scale(${scale})">
    <circle cx="61" cy="37.5" r="15" fill="#ffc83d"/>
    <g fill="#ffffff">
      <circle cx="35" cy="61.5" r="14"/>
      <circle cx="51" cy="53.5" r="18"/>
      <circle cx="67" cy="63.5" r="12"/>
      <rect x="21" y="61.5" width="58" height="16" rx="8"/>
    </g>
  </g>`;
}

function svg({ rounded, scale }) {
  const defs = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${SKY_TOP}"/><stop offset="1" stop-color="${SKY_BOTTOM}"/></linearGradient></defs>`;
  const bg = rounded
    ? `<rect x="4" y="4" width="92" height="92" rx="22" fill="url(#sky)"/>`
    : `<rect width="100" height="100" fill="url(#sky)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${defs}${bg}${glyph(scale)}</svg>`;
}

const ICONS = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 0.86 },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 0.86 },
  { file: 'icon-maskable-512.png', size: 512, rounded: false, scale: 0.72 }, // 안전 영역: 가운데 지름 80%
  { file: 'apple-touch-icon.png', size: 180, rounded: false, scale: 0.8 },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const icon of ICONS) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${icon.size}px;height:${icon.size}px}</style>${svg(icon)}`);
    await page.locator('svg').screenshot({ path: path.join(OUT, icon.file), omitBackground: true });
    console.log('icons/' + icon.file);
  }
  await browser.close();
})();
