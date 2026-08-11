const { test, expect } = require('@playwright/test');
const fs = require('fs');

test('Verify Specification Alignment', async ({ page }) => {
    const results = {
        timestamp: new Date().toISOString(),
        tests: []
    };

    const host = 'http://172.19.0.2';

    // Test 1: PC Frame Width (450px)
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`${host}/dj.html?s=test_session`);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
        const el = document.getElementById('mainApp');
        if (el) el.classList.remove('hidden');
    });
    const container = page.locator('#mainApp');
    await expect(container).toBeVisible();
    const box = await container.boundingBox();
    const widthMatches = box && Math.abs(box.width - 450) < 5;
    results.tests.push({
        name: "PC Frame Width (450px)",
        passed: !!widthMatches,
        actual: box ? `${box.width}px` : "null",
        expected: "450px"
    });

    // Test 2: Search Buttons in VJ View (4 buttons: Google, YouTube, ニコニコ動画, GIPHY)
    await page.goto(`${host}/vj.html?s=test_session`);
    await page.waitForLoadState('domcontentloaded');
    const buttons = page.locator('#searchLinksSend button');
    const count = await buttons.count();
    const texts = await buttons.allInnerTexts();
    const expectedTexts = ['Google', 'YouTube', 'ニコニコ動画', 'GIPHY'];
    const buttonsMatch = count === 4 && JSON.stringify(texts) === JSON.stringify(expectedTexts);
    results.tests.push({
        name: "Search Buttons (4 Buttons: Google, YouTube, ニコニコ動画, GIPHY)",
        passed: buttonsMatch,
        actual: `${count} buttons: [${texts.join(', ')}]`,
        expected: "4 buttons: [Google, YouTube, ニコニコ動画, GIPHY]"
    });

    // Test 3: Full screen flash handling
    await page.goto(`${host}/dj.html?s=test_session`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => typeof window.flashScreen === 'function');
    await page.evaluate(() => {
        if (typeof window.flashScreen === 'function') {
            window.flashScreen('is-flashing-danger');
        }
    });
    const bodyClass = await page.getAttribute('body', 'class');
    const flashMatches = bodyClass && bodyClass.includes('is-flashing-danger');
    results.tests.push({
        name: "Full Screen Flash on Body",
        passed: !!flashMatches,
        actual: bodyClass || "none",
        expected: "includes 'is-flashing-danger'"
    });

    if (!fs.existsSync('test-results')) {
        fs.mkdirSync('test-results', { recursive: true });
    }
    fs.writeFileSync('test-results/spec_verification_report.json', JSON.stringify(results, null, 2));

    console.log("TEST RESULTS:\n" + JSON.stringify(results, null, 2));

    expect(widthMatches).toBe(true);
    expect(buttonsMatch).toBe(true);
    expect(flashMatches).toBe(true);
});
