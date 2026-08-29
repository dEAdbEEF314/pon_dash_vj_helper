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
            return code && code !== '------' && code.length === 10;
        }, { timeout: 10000 });

        const lobbyCode = await vjPage.textContent('#lobbyCodeDisplay');
        expect(lobbyCode.trim()).toMatch(/^[A-Z0-9]{10}$/);

        // 2. DJ 1 がロビーコードを指定して事前登録
        await dj1Page.goto(`${host}/dj-register.html`);
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

        // 連携処理完了後は一覧行数と件数表示が一致し、1件少なくならないことを確認
        await vjPage.waitForFunction(() => {
            const count = Number(document.getElementById('lobbySessionCount')?.textContent || '-1');
            const rows = Array.from(document.querySelectorAll('#lobbySessionList > div'))
                .filter(row => row.id !== 'lobbyEmptyMsg');
            return count === 1 && rows.length === count;
        }, { timeout: 10000 });
        await expect(vjPage.locator('#lobbySessionCount')).toHaveText('1');

        // 3. VJがVJモードを開始
        await vjPage.click('#enterVjModeBtn');
        await vjPage.waitForSelector('#mainApp', { state: 'visible' });

        // DJ1表示時の初期状態確認
        await expect(vjPage.locator('#sendTitle')).toHaveText('-');
        await expect(vjPage.locator('#nextTitle')).toHaveText('-');

        // 4. VJモード開始後に DJ2 が登録してロビーに送信
        const dj2Context = await browser.newContext();
        const dj2Page = await dj2Context.newPage();
        await dj2Page.goto(`${host}/dj-register.html`);
        await dj2Page.fill('#accountName', 'DJ_BRAVO_SET');
        await dj2Page.fill('#djPassword', '1111');
        await dj2Page.fill('#vjPassword', '2222');
        await dj2Page.setInputFiles('#playlistFile', {
            name: 'playlist2.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('Bravo Artist 1 - Bravo Song 1\nBravo Artist 2 - Bravo Song 2')
        });
        await dj2Page.click('#registerBtn');
        await dj2Page.waitForFunction(() => {
            const panel = document.getElementById('result-panel');
            return panel && !panel.classList.contains('hidden');
        }, { timeout: 10000 });
        await dj2Page.fill('#lobbyCodeInput', lobbyCode.trim());
        await dj2Page.click('#pushToLobbyBtn');

        // VJ画面にDJ2のタブが自動追加されるのを待つ
        const dj2Tab = vjPage.locator('#sessionTabBar .session-tab', { hasText: 'DJ_BRAVO_SET' });
        await expect(dj2Tab).toBeVisible({ timeout: 15000 });

        // DJ2のタブに切り替える
        await dj2Tab.click();

        // 【検証】DJ2（未SEND）に切り替えた直後も、SENT/NEXTともに "-" (ブランク) であること
        await expect(vjPage.locator('#sendTitle')).toHaveText('-');
        await expect(vjPage.locator('#nextTitle')).toHaveText('-');

        // 5. 全DJがセッションを削除してロビーに戻るケースの検証
        // DJ1, DJ2 のセッションをVJ側から削除
        vjPage.on('dialog', async dialog => await dialog.accept());
        const closeBtns = vjPage.locator('#sessionTabBar .close-btn');
        await closeBtns.first().click();
        await expect(vjPage.locator('#sessionTabBar .session-tab')).toHaveCount(1);
        await closeBtns.first().click();

        // ロビー画面に戻ることを確認
        await vjPage.waitForSelector('#lobbyScreen', { state: 'visible' });

        // 6. 新規DJ3が登録してロビーに送信
        const dj3Context = await browser.newContext();
        const dj3Page = await dj3Context.newPage();
        await dj3Page.goto(`${host}/dj-register.html`);
        await dj3Page.fill('#accountName', 'DJ_CHARLIE_SET');
        await dj3Page.fill('#djPassword', '1111');
        await dj3Page.fill('#vjPassword', '2222');
        await dj3Page.setInputFiles('#playlistFile', {
            name: 'playlist3.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('Charlie Artist 1 - Charlie Song 1\nCharlie Artist 2 - Charlie Song 2')
        });
        await dj3Page.click('#registerBtn');
        await dj3Page.waitForFunction(() => {
            const panel = document.getElementById('result-panel');
            return panel && !panel.classList.contains('hidden');
        }, { timeout: 10000 });
        await dj3Page.fill('#lobbyCodeInput', lobbyCode.trim());
        await dj3Page.click('#pushToLobbyBtn');

        // ロビーにDJ3が反映されたらVJモード開始
        await expect(vjPage.locator('#lobbySessionCount')).toHaveText('1');
        await vjPage.click('#enterVjModeBtn');
        await vjPage.waitForSelector('#mainApp', { state: 'visible' });

        // 【検証】全削除後再接続したDJ3（未SEND）も、SENT/NEXTともに "-" (ブランク) であること
        await expect(vjPage.locator('#sendTitle')).toHaveText('-');
        await expect(vjPage.locator('#nextTitle')).toHaveText('-');

        await vjContext.close();
        await dj1Context.close();
        await dj2Context.close();
        await dj3Context.close();
    });
});
