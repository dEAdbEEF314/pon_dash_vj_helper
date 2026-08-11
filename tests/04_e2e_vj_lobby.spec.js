const { test, expect } = require('@playwright/test');

test.describe('E2E Test: VJ Lobby & Multi-DJ Session Flow', () => {
    const host = 'http://172.19.0.2';

    test('VJ Lobby Code Generation & Multi-DJ Tab Management', async ({ browser }) => {
        const vjContext = await browser.newContext();
        const dj1Context = await browser.newContext();

        const vjPage = await vjContext.newPage();
        const dj1Page = await dj1Context.newPage();

        // 1. VJがロビーを開く
        await vjPage.goto(`${host}/vj.html`);
        await vjPage.click('#startLobbyBtn');

        await vjPage.waitForSelector('#lobbyScreen', { state: 'visible' });

        // 非同期でコードが生成されるまで待つ
        await vjPage.waitForFunction(() => {
            const code = document.getElementById('lobbyCodeDisplay').textContent.trim();
            return code && code !== '------' && code.length === 6;
        }, { timeout: 10000 });

        const lobbyCode = await vjPage.textContent('#lobbyCodeDisplay');
        expect(lobbyCode.trim()).toMatch(/^[A-Z0-9]{6}$/);

        // 2. DJ 1 がロビーコードを指定して事前登録
        await dj1Page.goto(`${host}/index.html`);
        await dj1Page.fill('#accountName', 'DJ_ALPHA_SET');
        await dj1Page.fill('#djPassword', '1111');
        await dj1Page.fill('#vjPassword', '2222');

        await dj1Page.setInputFiles('#playlistFile', {
            name: 'playlist.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('Alpha Artist - Alpha Song')
        });

        await dj1Page.click('#registerBtn');
        await dj1Page.waitForFunction(() => {
            const panel = document.getElementById('result-panel');
            return panel && !panel.classList.contains('hidden');
        }, { timeout: 10000 });

        // 登録完了後にロビーコードを送信
        const lobbyInput = dj1Page.locator('#lobbyCodeInput');
        if (await lobbyInput.isVisible()) {
            await lobbyInput.fill(lobbyCode.trim());
            await dj1Page.click('#pushToLobbyBtn');
        }

        await vjContext.close();
        await dj1Context.close();
    });
});
