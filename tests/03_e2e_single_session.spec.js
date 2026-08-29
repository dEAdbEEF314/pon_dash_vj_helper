const { test, expect } = require('@playwright/test');

test.describe('E2E Test: Single Session Flow (Register -> DJ -> VJ)', () => {
    const host = 'http://172.19.0.2';

    test('Landing page and VDJ lobby handoff expose the new entry points', async ({ page }) => {
        await page.goto(`${host}/index.html`);
        await expect(page.locator('a[href="dj-register.html"]')).toHaveCount(2);
        await expect(page.locator('a[href="vj.html"]')).toHaveCount(3);
        await expect(page.locator('a[href="dj-manual.html"]').first()).toBeVisible();
        await expect(page.locator('a[href="vj-manual.html"]').first()).toBeVisible();

        await page.goto(`${host}/dj-register.html?lobby=ab12CD34ef`);
        await expect(page.locator('#lobbyCodeInput')).toHaveValue('AB12CD34EF');
        await expect(page.locator('#pushToLobbyBtn')).toBeAttached();
    });

    test('Full DJ and VJ Interaction Scenario', async ({ browser }) => {
        const djContext = await browser.newContext();
        const vjContext = await browser.newContext();

        const djPage = await djContext.newPage();
        const vjPage = await vjContext.newPage();

        // 1. DJ 事前登録
        await djPage.goto(`${host}/dj-register.html`);
        await djPage.fill('#accountName', 'E2E_PARTY_SET');
        await djPage.fill('#djPassword', '8888');
        await djPage.fill('#vjPassword', '7777');

        await djPage.setInputFiles('#playlistFile', {
            name: 'playlist.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('Artist One - Song One\nArtist Two - Song Two')
        });

        await djPage.click('#registerBtn');

        await djPage.waitForFunction(() => {
            const panel = document.getElementById('result-panel');
            return panel && !panel.classList.contains('hidden');
        }, { timeout: 10000 });

        const djUrl = await djPage.textContent('#djUrlBox');
        const vjUrl = await djPage.textContent('#vjUrlBox');

        expect(djUrl).toContain('dj.html?sid=');
        expect(vjUrl).toContain('vj.html?sid=');

        // 2. DJ画面 ログイン
        await djPage.goto(djUrl.trim());
        await djPage.fill('#password', '8888');
        await djPage.click('button[type="submit"]');
        await djPage.waitForSelector('#mainApp', { state: 'visible' });
        const djRecovery = await djPage.evaluate(() => JSON.parse(localStorage.getItem('pdvh.dj.session')));
        expect(djRecovery.sessionId).toMatch(/^[a-f0-9]{32}$/);
        expect(djRecovery.expiresAt).toBeGreaterThan(Date.now());
        expect(djRecovery).not.toHaveProperty('password');

        // 3. VJ画面 ログイン
        await vjPage.goto(vjUrl.trim());
        await vjPage.click('#showDirectLoginBtn');
        await vjPage.fill('#password', '7777');
        await vjPage.click('button[type="submit"]');
        await vjPage.waitForSelector('#mainApp', { state: 'visible' });
        expect(await vjPage.evaluate(() => localStorage.getItem('vjSessions'))).toBeNull();
        const vjRecovery = await vjPage.evaluate(() => JSON.parse(localStorage.getItem('pdvh.vj.sessions')));
        expect(vjRecovery[0].sessionId).toBe(djRecovery.sessionId);
        expect(vjRecovery[0].expiresAt).toBeGreaterThan(Date.now());
        expect(vjRecovery[0]).not.toHaveProperty('password');

        // 未SENDの初期状態では、SENDされた曲・次の曲ともに "-" (ブランク)
        await expect(vjPage.locator('#sendTitle')).toHaveText('-');
        await expect(vjPage.locator('#sendArtist')).toHaveText('-');
        await expect(vjPage.locator('#nextTitle')).toHaveText('-');
        await expect(vjPage.locator('#nextArtist')).toHaveText('-');

        // 4. DJが「SEND TO VJ」を押下
        await djPage.click('#sendBtn');

        // UI表示が更新され、1曲目がSEND曲、2曲目が次の曲として表示されることを確認
        await djPage.waitForSelector('#sendTrackBox', { state: 'visible' });
        await expect(vjPage.locator('#sendTitle')).toContainText('Song One', { timeout: 10000 });
        await expect(vjPage.locator('#nextTitle')).toContainText('Song Two', { timeout: 10000 });

        await djContext.close();
        await vjContext.close();
    });

    test('Initial VIBES! send shows custom track and first setlist track as next', async ({ browser }) => {
        const djContext = await browser.newContext();
        const vjContext = await browser.newContext();

        const djPage = await djContext.newPage();
        const vjPage = await vjContext.newPage();

        // 1. DJ 事前登録
        await djPage.goto(`${host}/dj-register.html`);
        await djPage.fill('#accountName', 'E2E_VIBES_FIRST_SET');
        await djPage.fill('#djPassword', '8888');
        await djPage.fill('#vjPassword', '7777');

        await djPage.setInputFiles('#playlistFile', {
            name: 'playlist.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('Artist First - Song First\nArtist Second - Song Second')
        });

        await djPage.click('#registerBtn');

        await djPage.waitForFunction(() => {
            const panel = document.getElementById('result-panel');
            return panel && !panel.classList.contains('hidden');
        }, { timeout: 10000 });

        const djUrl = (await djPage.textContent('#djUrlBox')).trim();
        const vjUrl = (await djPage.textContent('#vjUrlBox')).trim();

        // 2. DJ / VJ ログイン
        await djPage.goto(djUrl);
        await djPage.fill('#password', '8888');
        await djPage.click('button[type="submit"]');
        await djPage.waitForSelector('#mainApp', { state: 'visible' });

        await vjPage.goto(vjUrl);
        await vjPage.click('#showDirectLoginBtn');
        await vjPage.fill('#password', '7777');
        await vjPage.click('button[type="submit"]');
        await vjPage.waitForSelector('#mainApp', { state: 'visible' });

        // 初期状態はブランク
        await expect(vjPage.locator('#sendTitle')).toHaveText('-');
        await expect(vjPage.locator('#nextTitle')).toHaveText('-');

        // 3. DJがセットリスト曲を送信せずに VIBES! を送信
        await djPage.click('#openVibesModalBtn');
        await djPage.waitForSelector('#vibesModalOverlay.active', { state: 'visible' });
        await djPage.fill('#vibesTitleInput', 'Opening MC');
        await djPage.click('#sendVibesBtn');

        // VJ側: SENDされた曲にVIBES!内容、次の曲にセットリスト1曲目が表示されることを確認
        await expect(vjPage.locator('#vjVibesBadge')).toBeVisible({ timeout: 10000 });
        await expect(vjPage.locator('#sendTitle')).toContainText('Opening MC', { timeout: 10000 });
        await expect(vjPage.locator('#nextTitle')).toContainText('Song First', { timeout: 10000 });

        await djContext.close();
        await vjContext.close();
    });
});
