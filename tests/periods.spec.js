const { test, expect } = require('@playwright/test');
const { open, baseTemp, addDays, TODAY } = require('./helpers');

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
    await expect(rows.nth(3).locator('.m-rain')).toHaveText('강수 80% · 4.2mm');
    await expect(rows.nth(3).locator('.d-sky [role="img"]')).toHaveAttribute('aria-label', '약한 비');

    const fills = await page.locator('#weekList .range-fill').evaluateAll((els) =>
      els.map((e) => ({ left: parseFloat(e.style.left), width: parseFloat(e.style.width) })));
    expect(fills).toHaveLength(7);
    for (const f of fills) {
      expect(f.left).toBeGreaterThanOrEqual(0);
      expect(f.width).toBeGreaterThan(0);
      expect(f.left + f.width).toBeLessThanOrEqual(100.05);
    }
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
    await expect(normal.locator('.d-sky [role="img"]')).toHaveAttribute('aria-label', '가끔 비');
    await expect(normal.locator('.d-sky .t')).toHaveText('가끔 비');
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
