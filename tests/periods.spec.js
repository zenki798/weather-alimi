const { test, expect } = require('@playwright/test');
const { open, baseTemp, hourTemp, addDays, TODAY } = require('./helpers');

test.describe('하루 · 일주일 · 한달 탭', () => {
  test('하루: 24시간 카드와 기온 그래프가 그려진다', async ({ page }) => {
    await open(page);
    await expect(page.locator('#tab-day')).toHaveAttribute('aria-selected', 'true');

    const hours = page.locator('#hourList .hour');
    await expect(hours).toHaveCount(24);
    /* 현재 시각(10:15)이 속한 10시부터 시작한다 */
    await expect(hours.first()).toHaveAttribute('data-time', TODAY + 'T10:00');
    await expect(hours.first().locator('.h-time')).toHaveText('지금');
    await expect(hours.nth(1).locator('.h-time')).toHaveText('11시');
    await expect(hours.first()).toContainText('습도');
    await expect(hours.first()).toContainText('m/s');

    await expect(page.locator('#dayChart svg path.line')).toHaveCount(1);
    await expect(page.locator('#dayChart .extreme-text')).toHaveCount(2);
    await expect(page.locator('#dayChart .extreme-text').first()).toContainText('최고');
  });

  test('하루: 그래프를 가리키면(휴대폰은 탭) 그 시각의 값이 툴팁으로 뜬다', async ({ page, isMobile }) => {
    await open(page);
    const svg = page.locator('#dayChart svg');
    const box = await svg.boundingBox();
    const tip = page.locator('#dayChart .tooltip');
    const at = { x: box.width - 16, y: box.height / 2 };

    if (isMobile) await svg.tap({ position: at });
    else await page.mouse.move(box.x + at.x, box.y + at.y);

    await expect(tip).toBeVisible();
    await expect(tip).toContainText('습도');
    await expect(tip).toContainText('바람');
    await expect(tip).toContainText('강수확률');
    await expect(tip.locator('.tt-time')).toContainText('09:00');

    /* 휴대폰은 손을 떼도 남아 있다가, 다른 곳을 탭하면 닫힌다 */
    if (isMobile) {
      await page.waitForTimeout(300);
      await expect(tip).toBeVisible();
      await page.locator('#panel-day h3').tap();
    } else {
      await page.mouse.move(box.x + box.width / 2, box.y - 40);
    }
    await expect(tip).toBeHidden();
  });

  test('하루: 키보드 방향키로도 시간을 옮겨 볼 수 있다', async ({ page }) => {
    await open(page);
    const svg = page.locator('#dayChart svg');
    const tip = page.locator('#dayChart .tooltip');

    await svg.focus();
    await expect(tip.locator('.tt-time')).toContainText('지금');
    await page.keyboard.press('ArrowRight');
    await expect(tip.locator('.tt-time')).toContainText('11:00');
    await page.keyboard.press('End');
    await expect(tip.locator('.tt-time')).toContainText('09:00');
  });

  test('일주일: 7일이 오늘·내일부터 나오고 막대가 범위 안에 있다', async ({ page }) => {
    await open(page);
    await page.locator('#tab-week').click();
    await expect(page.locator('#panel-week')).toBeVisible();
    await expect(page.locator('#panel-day')).toBeHidden();

    const rows = page.locator('#weekList .day');
    await expect(rows).toHaveCount(7);
    await expect(rows.nth(0).locator('.d-date b')).toHaveText('오늘');
    await expect(rows.nth(1).locator('.d-date b')).toHaveText('내일');
    await expect(rows.nth(0)).toHaveAttribute('data-date', TODAY);
    await expect(rows.nth(6)).toHaveAttribute('data-date', addDays(TODAY, 6));

    const b = baseTemp(37.5665);
    await expect(rows.nth(0).locator('.t-max')).toHaveText((b + 6) + '°');
    await expect(rows.nth(0).locator('.t-min')).toHaveText((b - 3) + '°');
    await expect(rows.nth(0).locator('.m-hum')).toHaveText('습도 50%');
    await expect(rows.nth(0).locator('.m-wind')).toHaveText('바람 2.0 m/s');
    await expect(rows.nth(0).locator('.m-rain')).toHaveText('강수량 0mm');
    await expect(rows.nth(3).locator('.m-rain')).toHaveText('강수량 4.2mm');

    const fills = await page.locator('#weekList .range-fill').evaluateAll((els) =>
      els.map((e) => ({ left: parseFloat(e.style.left), width: parseFloat(e.style.width) })));
    expect(fills).toHaveLength(7);
    for (const f of fills) {
      expect(f.left).toBeGreaterThanOrEqual(0);
      expect(f.width).toBeGreaterThan(0);
      expect(f.left + f.width).toBeLessThanOrEqual(100.05);
    }
  });

  /*
   * 오전(0~11시)·오후(12~23시) 요약. 가짜 시간별 코드는 [맑음,대체로 맑음,구름 조금,흐림,약한 비] 를 돈다.
   *   오늘  오전: 비 2시간(<3) → 비 아닌 것 중 최빈 동률(0·1) → 큰 쪽 "대체로 맑음" / 오후: 같은 식으로 "흐림"
   *   3일 뒤 오전: 비 3시간(≥3) → "약한 비"                     / 오후: "대체로 맑음"
   *   강수확률은 반나절 중 최댓값: 오전 77%, 오후 98%
   */
  test('일주일: 날마다 오전·오후 날씨와 강수확률을 보여준다', async ({ page }) => {
    await open(page);
    await page.locator('#tab-week').click();
    const rows = page.locator('#weekList .day');

    const half = (i, which) => rows.nth(i).locator('.half[data-half="' + which + '"]');
    await expect(half(0, 'am').locator('.h-lab')).toHaveText('오전');
    await expect(half(0, 'pm').locator('.h-lab')).toHaveText('오후');
    await expect(half(0, 'am').locator('[role="img"]')).toHaveAttribute('aria-label', '대체로 맑음');
    await expect(half(0, 'pm').locator('[role="img"]')).toHaveAttribute('aria-label', '흐림');
    await expect(half(3, 'am').locator('[role="img"]')).toHaveAttribute('aria-label', '약한 비');
    await expect(half(3, 'pm').locator('[role="img"]')).toHaveAttribute('aria-label', '대체로 맑음');
    await expect(half(3, 'am').locator('.h-pop')).toHaveText('77%');
    await expect(half(3, 'pm').locator('.h-pop')).toHaveText('98%');
    await expect(half(3, 'am')).toHaveAttribute('title', '오전 약한 비 · 강수확률 77%');
  });

  test('오전·오후 글자는 굵고 크게 보인다', async ({ page }) => {
    await open(page);
    await page.locator('#tab-week').click();
    const lab = page.locator('#weekList .half[data-half="am"] .h-lab').first();
    const style = await lab.evaluate((e) => {
      const c = getComputedStyle(e);
      return { weight: Number(c.fontWeight), size: parseFloat(c.fontSize) };
    });
    expect(style.weight).toBeGreaterThanOrEqual(700);
    expect(style.size).toBeGreaterThanOrEqual(13);
  });

  /*
   * 막대 읽는 법이 화면만 보고 통하도록: 맨 위 기온 눈금과 날마다의 막대가 같은 자리에 맞아야 한다.
   * 가짜 자료의 이번 주 최저는 11°, 최고는 23° → 5° 간격 눈금(15°, 20°). 첫날은 12°~21°.
   */
  test('일주일: 맨 위 기온 눈금이 막대와 같은 자리에 맞춰 있다', async ({ page }) => {
    await open(page);
    await page.locator('#tab-week').click();
    await expect(page.locator('#panel-week .note.how')).toContainText('오른쪽에 있을수록 따뜻한 날');

    const scale = page.locator('#weekList .day-scale');
    await expect(scale).toHaveCount(1);
    await expect(scale.locator('.t-min')).toHaveText('11°');
    await expect(scale.locator('.t-max')).toHaveText('23°');
    await expect(scale.locator('.tick')).toHaveText(['15°', '20°']);

    const first = page.locator('#weekList .day').first();
    const track = await first.locator('.range').boundingBox();
    const at = (t) => track.x + track.width * (t - 11) / (23 - 11);

    const tick = await scale.locator('.tick').first().boundingBox();
    expect(Math.abs(tick.x + tick.width / 2 - at(15))).toBeLessThan(1.5);

    const fill = await first.locator('.range-fill').boundingBox();
    expect(Math.abs(fill.x - at(12))).toBeLessThan(1.5);
    expect(Math.abs(fill.x + fill.width - at(21))).toBeLessThan(1.5);

    /* 마우스를 올리면 숫자로도 — 일교차까지 */
    await expect(first.locator('.d-temp')).toHaveAttribute('title', '최저 12° · 최고 21° · 일교차 9°');
  });

  test('일주일: 날짜를 누르면 3시간 간격 예보가 펼쳐지고, 다시 누르면 접힌다', async ({ page }) => {
    await open(page);
    await page.locator('#tab-week').click();
    const row = page.locator('#weekList .day').nth(1);
    const toggle = row.locator('button.day-row');
    const panel = row.locator('.slots-panel');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();

    /* 내일은 0시부터 21시까지 8칸 */
    const slots = panel.locator('.hour');
    await expect(slots.locator('.h-time')).toHaveText(['0시', '3시', '6시', '9시', '12시', '15시', '18시', '21시']);

    /* 3시 칸: 기온·습도는 3시 값, 날씨·강수확률은 3~5시 중 궂은 쪽 (4시 약한 비, 5시 35%) */
    const s3 = slots.nth(1);
    await expect(s3.locator('.h-temp')).toHaveText(Math.round(hourTemp(37.5665, 1, 3)) + '°');
    await expect(s3.locator('.h-icon')).toHaveAttribute('aria-label', '약한 비');
    await expect(s3.locator('.hm-pop')).toHaveText('강수 35%');
    await expect(s3.locator('.hm-hum')).toHaveText('습도 65%');
    await expect(s3.locator('.hm-wind')).toContainText('m/s');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();

    /* 키보드로도 펼친다 */
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('오늘을 펼치면 이미 지난 시간대는 빼고 보여준다', async ({ page }) => {
    await open(page);
    await page.locator('#tab-week').click();
    const today = page.locator('#weekList .day').nth(0);
    await today.locator('button.day-row').click();
    /* 현재 10:15 → 9시 칸(9~11시)부터 */
    await expect(today.locator('.slots-panel .h-time')).toHaveText(['9시', '12시', '15시', '18시', '21시']);
  });

  test('한달: 펼친 날짜는 예년 자료가 늦게 도착해 목록을 다시 그려도 펼쳐진 채로 남는다', async ({ page }) => {
    await open(page, { archiveDelay: 1500 });
    await page.locator('#tab-month').click();
    await expect(page.locator('#monthNote')).toContainText('불러오는 중');

    const toggle = page.locator('#monthList .day').nth(2).locator('button.day-row');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await expect(page.locator('#monthNote')).toContainText('예년 참고값');
    await expect(page.locator('#monthList .day')).toHaveCount(30);
    const again = page.locator('#monthList .day').nth(2);
    await expect(again.locator('button.day-row')).toHaveAttribute('aria-expanded', 'true');
    await expect(again.locator('.slots-panel .hour')).toHaveCount(8);
  });

  test('한달: 16일 예보 + 14일 예년값(최근 3년 평균)으로 30일을 채운다', async ({ page }) => {
    const calls = await open(page);
    await page.locator('#tab-month').click();

    const rows = page.locator('#monthList .day');
    await expect(rows).toHaveCount(30);
    await expect(page.locator('#monthList .day[data-kind="forecast"]')).toHaveCount(16);
    await expect(page.locator('#monthList .day[data-kind="normal"]')).toHaveCount(14);
    await expect(rows.nth(29)).toHaveAttribute('data-date', addDays(TODAY, 29));

    /* 예보와 예년값이 섞여 보이지 않게 경계와 표시가 있다 */
    await expect(page.locator('#monthList .normal-divider')).toHaveCount(1);
    await expect(page.locator('#monthList .normal-divider')).toContainText('예보가 아니라');
    await expect(page.locator('#monthNote')).toContainText('예년 참고값');
    await expect(rows.nth(16).locator('.badge')).toHaveText('예년');
    await expect(rows.nth(15).locator('.badge')).toHaveCount(0);

    /* 3년 평균: 최고 (18+20+19)/3=19, 최저 11. 1mm 이상 비는 2025년 한 번 → "가끔 비".
     * (2024년의 0.1mm "이슬비" 코드에 끌려가면 안 된다) */
    const normal = rows.nth(16);
    await expect(normal).toHaveAttribute('data-date', addDays(TODAY, 16));
    await expect(normal.locator('.t-max')).toHaveText('19°');
    await expect(normal.locator('.t-min')).toHaveText('11°');
    await expect(normal.locator('.m-rain')).toHaveText('비 온 해 1/3');
    await expect(normal.locator('.half.whole [role="img"]')).toHaveAttribute('aria-label', '가끔 비');
    await expect(normal.locator('.half.whole .t')).toHaveText('가끔 비');
    /* 예년일에는 오전·오후 예보가 없다 — 한 칸 요약만 있고 펼칠 수도 없다 */
    await expect(normal.locator('.half[data-half]')).toHaveCount(0);
    await expect(normal.locator('button')).toHaveCount(0);
    await expect(rows.nth(15).locator('.half[data-half="am"]')).toHaveCount(1);
    await expect(rows.nth(15).locator('button.day-row')).toHaveCount(1);
    await expect(page.locator('#monthNote')).toContainText('8일째 이후는 참고만');
    await expect(page.locator('#monthList .day-scale')).toHaveCount(1);
    await expect(normal.locator('.d-temp')).toHaveAttribute('title', '예년 평균 최저 11° · 최고 19° · 일교차 8°');
    expect(calls.archive[0].searchParams.get('daily')).toContain('cloud_cover_mean');

    /* 2025·2024·2023 년의 같은 기간을 요청했다 */
    const starts = calls.archive.map((u) => u.searchParams.get('start_date')).sort();
    const md = addDays(TODAY, 16).slice(4);
    expect(starts).toEqual(['2023' + md, '2024' + md, '2025' + md]);
  });

  test('한달: 예년 자료가 실패해도 16일 예보는 보이고 안내가 뜬다', async ({ page }) => {
    await open(page, { failArchive: true });
    await page.locator('#tab-month').click();

    await expect(page.locator('#monthNote')).toContainText('불러오지 못했습니다');
    await expect(page.locator('#monthNote')).toHaveClass(/warn/);
    await expect(page.locator('#monthList .day')).toHaveCount(16);
    await expect(page.locator('#monthList .normal-divider')).toHaveCount(0);
  });

  test('탭은 방향키로 옮겨지고, 고른 탭을 새로고침 후에도 기억한다', async ({ page }) => {
    await open(page);
    await page.locator('#tab-day').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-week')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-week')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-month')).toHaveAttribute('aria-selected', 'true');

    await page.reload();
    await expect(page.locator('#tab-month')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-month')).toBeVisible();
    await expect(page.locator('#monthList .day')).toHaveCount(30);
  });
});
