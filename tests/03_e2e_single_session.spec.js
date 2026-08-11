const { test, expect } = require('@playwright/test');

test.describe('E2E Test: Single Session Flow (Register -> DJ -> VJ)', () => {
    const host = 'http://172.19.0.2';

    test('Full DJ and VJ Interaction Scenario', async ({ browser }) => {
        const djContext = await browser.newContext();
        const vjContext = await browser.newContext();

        const djPage = await djContext.newPage();
        const vjPage = await vjContext.newPage();

        // 1. DJ 事前登録
        await djPage.goto(`${host}/index.html`);
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

        // 3. VJ画面 ログイン
        await vjPage.goto(vjUrl.trim());
        await vjPage.waitForSelector('#mainApp', { state: 'visible' });

        // 4. DJが「SEND TO VJ」を押下
        await djPage.click('#sendBtn');

        // UI表示が更新されたことを確認
        await djPage.waitForSelector('#sendTrackBox', { state: 'visible' });

        await djContext.close();
        await vjContext.close();
    });
});
