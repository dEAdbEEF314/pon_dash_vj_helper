const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const host = 'http://172.19.0.2';
const playlistFiles = [
    '20250224_playlist_1.m3u8',
    '20260131_playlist_2.m3u8',
    '20260514_playlist_3.m3u8'
];

function playlistBuffer(fileName) {
    return fs.readFileSync(path.join(__dirname, fileName));
}

function firstTrack(fileName) {
    const line = playlistBuffer(fileName).toString('utf8')
        .split(/\r?\n/)
        .find(line => line.startsWith('#EXTINF:'));
    const text = line.slice(line.indexOf(',') + 1).trim();
    const [artist, ...title] = text.split(' - ');
    return {
        artist: artist.trim(),
        title: title.join(' - ').trim() || artist.trim()
    };
}

async function waitForRegistered(page) {
    await page.waitForFunction(() => {
        const panel = document.getElementById('result-panel');
        return panel && !panel.classList.contains('hidden');
    }, { timeout: 15000 });
}

async function registerAndPush(page, lobbyCode, index) {
    await page.goto(`${host}/dj-register.html?lobby=${lobbyCode}`);
    await page.fill('#accountName', `MULTI_DJ_${index + 1}`);
    await page.fill('#djPassword', `42${index + 1}0`);
    await page.fill('#vjPassword', '4299');
    await page.setInputFiles('#playlistFile', {
        name: playlistFiles[index],
        mimeType: 'application/vnd.apple.mpegurl',
        buffer: playlistBuffer(playlistFiles[index])
    });
    await expect(page.locator('#trackCount')).toContainText('tracks');
    await page.click('#registerBtn');
    await waitForRegistered(page);
    await page.fill('#lobbyCodeInput', lobbyCode);
    await page.click('#pushToLobbyBtn');
    await expect(page.locator('#lobbyPushResult')).toContainText('成功', { timeout: 10000 });
}

test.describe('E2E Test: One VJ and Multiple DJs with Recovery', () => {
    test('three real playlists, multi-DJ SEND, session removal, reload, and browser-close recovery', async ({ browser }) => {
        const vjContext = await browser.newContext();
        const djContexts = await Promise.all([
            browser.newContext(),
            browser.newContext(),
            browser.newContext()
        ]);
        const vjPage = await vjContext.newPage();
        const djPages = await Promise.all(djContexts.map(context => context.newPage()));

        try {
            await vjPage.goto(`${host}/vj.html`);
            await vjPage.click('#startLobbyBtn');
            await vjPage.waitForSelector('#lobbyScreen', { state: 'visible' });
            await vjPage.waitForFunction(() => /^[A-Z0-9]{10}$/.test(
                document.getElementById('lobbyCodeDisplay')?.textContent.trim() || ''
            ), { timeout: 15000 });
            const lobbyCode = (await vjPage.textContent('#lobbyCodeDisplay')).trim();

            await Promise.all(djPages.map((page, index) => registerAndPush(page, lobbyCode, index)));

            await vjPage.waitForFunction(() => {
                const count = Number(document.getElementById('lobbySessionCount')?.textContent || '-1');
                const rows = Array.from(document.querySelectorAll('#lobbySessionList > div'))
                    .filter(row => row.id !== 'lobbyEmptyMsg');
                return count === 3 && rows.length === 3;
            }, { timeout: 20000 });
            await vjPage.click('#enterVjModeBtn');
            await vjPage.waitForSelector('#mainApp', { state: 'visible' });
            await expect(vjPage.locator('#sessionTabBar .session-tab')).toHaveCount(3);

            // 未SENDの初期状態では、SENDされた曲・次の曲ともに "-" (ブランク)
            await expect(vjPage.locator('#sendTitle')).toHaveText('-');
            await expect(vjPage.locator('#nextTitle')).toHaveText('-');

            const djUrls = await Promise.all(djPages.map(async page => (await page.textContent('#djUrlBox')).trim()));
            await Promise.all(djPages.map(async (page, index) => {
                await page.goto(djUrls[index]);
                await page.fill('#password', `42${index + 1}0`);
                await page.click('button[type="submit"]');
                await page.waitForSelector('#mainApp', { state: 'visible' });
                await expect(page.locator('#playlistContainer .playlist-item').first()).toBeVisible();
            }));

            for (let index = 0; index < djPages.length; index++) {
                // ロビーへの到着順は並列pushのため不定なので、DJ名で対象セッションを選択する。
                await vjPage.locator('#sessionTabBar .session-tab', { hasText: `MULTI_DJ_${index + 1}` }).click();
                await djPages[index].click('#sendBtn');
                const track = firstTrack(playlistFiles[index]);
                await expect(vjPage.locator('#sendTitle')).toContainText(track.title, { timeout: 15000 });
                await expect(vjPage.locator('#sendArtist')).toContainText(track.artist, { timeout: 15000 });
            }

            // 非アクティブDJからのSENDは未読バッジとして通知される。
            await vjPage.locator('#sessionTabBar .session-tab', { hasText: 'MULTI_DJ_1' }).click();
            const betaTab = vjPage.locator('#sessionTabBar .session-tab', { hasText: 'MULTI_DJ_2' });
            await djPages[1].click('#sendBtn');
            await expect(betaTab.locator('.badge-unread')).toBeVisible({ timeout: 15000 });

            // VJ側でDJ 2セッションを削除する。
            await vjPage.once('dialog', dialog => dialog.accept());
            await vjPage.locator('#sessionTabBar .session-tab', { hasText: 'MULTI_DJ_2' }).locator('.close-btn').click();
            await expect(vjPage.locator('#sessionTabBar .session-tab')).toHaveCount(2);

            // DJ 1のブラウザを閉じても、サーバーセッションは削除されず再入場できる。
            await djContexts[0].close();
            const recoveredDjContext = await browser.newContext();
            const recoveredDjPage = await recoveredDjContext.newPage();
            await recoveredDjPage.goto(djUrls[0]);
            await recoveredDjPage.fill('#password', '4210');
            await recoveredDjPage.click('button[type="submit"]');
            await recoveredDjPage.waitForSelector('#mainApp', { state: 'visible' });
            await expect(recoveredDjPage.locator('#playlistContainer .playlist-item').first()).toBeVisible();
            await recoveredDjPage.click('#sendBtn');
            await recoveredDjContext.close();

            // VJをリロードしても保存済みの残存2セッションを復元する。
            await vjPage.reload();
            const savedVjSessions = await vjPage.evaluate(() => JSON.parse(
                localStorage.getItem('pdvh.vj.sessions') || '[]'
            ));
            expect(savedVjSessions).toHaveLength(2);
            // VJはパスワードを保存しないため、リロード後は再認証して各セッションを復元する。
            await vjPage.waitForSelector('#directLoginForm', { state: 'visible', timeout: 15000 });
            await vjPage.fill('#password', '4299');
            await vjPage.click('#directLoginForm button[type="submit"]');
            await vjPage.waitForSelector('#mainApp', { state: 'visible', timeout: 15000 });
            await expect(vjPage.locator('#sessionTabBar .session-tab')).toHaveCount(1);
            await vjPage.click('#addSessionBtn');
            await vjPage.fill('#modalSidInput', savedVjSessions[1].sessionId);
            await vjPage.fill('#modalVpInput', '4299');
            await vjPage.click('#modalAddManualBtn');
            await expect(vjPage.locator('#sessionTabBar .session-tab')).toHaveCount(2, { timeout: 15000 });

            // VJブラウザを閉じてもセッションはサーバー上に残り、新しいブラウザで再認証できる。
            const vjStorage = await vjPage.evaluate(() => ({
                sessions: localStorage.getItem('pdvh.vj.sessions'),
                lobbyCode: localStorage.getItem('vjLobbyCode'),
                lobbySavedAt: localStorage.getItem('vjLobbyCodeSavedAt')
            }));
            await vjContext.close();
            const recoveredVjContext = await browser.newContext();
            await recoveredVjContext.addInitScript(storage => {
                localStorage.setItem('pdvh.vj.sessions', storage.sessions);
                localStorage.setItem('vjLobbyCode', storage.lobbyCode);
                localStorage.setItem('vjLobbyCodeSavedAt', storage.lobbySavedAt);
            }, vjStorage);
            const recoveredVjPage = await recoveredVjContext.newPage();
            await recoveredVjPage.goto(`${host}/vj.html`);
            await recoveredVjPage.waitForSelector('#directLoginForm', { state: 'visible', timeout: 15000 });
            await recoveredVjPage.fill('#password', '4299');
            await recoveredVjPage.click('#directLoginForm button[type="submit"]');
            await recoveredVjPage.waitForSelector('#mainApp', { state: 'visible', timeout: 15000 });
            await expect(recoveredVjPage.locator('#sessionTabBar .session-tab')).toHaveCount(1);
            await recoveredVjPage.click('#addSessionBtn');
            await recoveredVjPage.fill('#modalSidInput', savedVjSessions[1].sessionId);
            await recoveredVjPage.fill('#modalVpInput', '4299');
            await recoveredVjPage.click('#modalAddManualBtn');
            await expect(recoveredVjPage.locator('#sessionTabBar .session-tab')).toHaveCount(2, { timeout: 15000 });
            await recoveredVjContext.close();
        } finally {
            for (const context of djContexts) {
                await context.close().catch(() => {});
            }
            await vjContext.close().catch(() => {});
        }
    });
});
