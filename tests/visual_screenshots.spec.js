const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const host = 'http://172.19.0.2';

const devices = [
    { id: 'pc_desktop', name: 'PC (Desktop 1280x800)', viewport: { width: 1280, height: 800 }, isPc: true },
    { id: 'iphone_15_pro', name: 'iPhone 15/16 Pro (393x852)', viewport: { width: 393, height: 852 } },
    { id: 'iphone_14_13', name: 'iPhone 14/13 (390x844)', viewport: { width: 390, height: 844 } },
    { id: 'iphone_se', name: 'iPhone SE 3rd (375x667)', viewport: { width: 375, height: 667 } },
    { id: 'android_pixel', name: 'Android Pixel 7/8 (412x915)', viewport: { width: 412, height: 915 } },
    { id: 'android_galaxy', name: 'Android Galaxy (360x800)', viewport: { width: 360, height: 800 } },
    { id: 'android_compact', name: 'Android Compact (360x740)', viewport: { width: 360, height: 740 } }
];

const realPlaylists = [
    { id: 'playlist_1', file: 'tests/20250224_playlist_1.m3u8', name: '20250224_playlist_1 (10 tracks)' },
    { id: 'playlist_2', file: 'tests/20260131_playlist_2.m3u8', name: '20260131_playlist_2 (20 tracks)' },
    { id: 'playlist_3', file: 'tests/20260514_playlist_3.m3u8', name: '20260514_playlist_3 (36 tracks)' }
];

test.describe('Real Playlist Visual Layout & Operations across Devices', () => {
    test.setTimeout(120000);

    const layoutReport = [];

    test.afterAll(async () => {
        const reportPath = path.join('test-results', 'layout_verification_report.json');
        fs.writeFileSync(reportPath, JSON.stringify(layoutReport, null, 2), 'utf-8');
        console.log(`[Layout Report] Saved ${layoutReport.length} layout verification records to ${reportPath}`);
    });

    for (const pl of realPlaylists) {
        test.describe(`Playlist: ${pl.name}`, () => {
            for (const dev of devices) {
                test(`Operate with ${pl.id} on ${dev.name}`, async ({ browser }) => {
                    const context = await browser.newContext({
                        viewport: dev.viewport,
                        deviceScaleFactor: 2
                    });
                    context.on('dialog', dialog => dialog.dismiss().catch(() => {}));

                    const page = await context.newPage();
                    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));

                    const screenshotDir = path.join('test-results', 'screenshots', 'real_playlists', pl.id, dev.id);
                    if (!fs.existsSync(screenshotDir)) {
                        fs.mkdirSync(screenshotDir, { recursive: true });
                    }

                    const checkLayoutFit = async (phaseName) => {
                        const overflowData = await page.evaluate(() => {
                            const docWidth = document.documentElement.clientWidth;
                            const scrollWidth = document.documentElement.scrollWidth;
                            
                            const overflowingEls = [];
                            const allEls = document.querySelectorAll('body *:not(script):not(style)');
                            allEls.forEach(el => {
                                const style = window.getComputedStyle(el);
                                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || el.classList.contains('is-marquee') || el.closest('.session-tab-bar')) return;
                                
                                const rect = el.getBoundingClientRect();
                                if (rect.right > docWidth + 2 && rect.width > 0) {
                                    overflowingEls.push({
                                        tag: el.tagName.toLowerCase(),
                                        id: el.id || '',
                                        class: el.className || '',
                                        right: Math.round(rect.right),
                                        docWidth: docWidth
                                    });
                                }
                            });

                            return {
                                docWidth,
                                scrollWidth,
                                hasOverflow: scrollWidth > docWidth + 2 || overflowingEls.length > 0,
                                overflowingEls: overflowingEls.slice(0, 5)
                            };
                        });

                        layoutReport.push({
                            playlist: pl.id,
                            device: dev.id,
                            deviceName: dev.name,
                            phase: phaseName,
                            docWidth: overflowData.docWidth,
                            scrollWidth: overflowData.scrollWidth,
                            hasOverflow: overflowData.hasOverflow,
                            overflowingEls: overflowData.overflowingEls,
                            passed: !overflowData.hasOverflow
                        });

                        expect(overflowData.hasOverflow, `Layout overflow detected in ${pl.id} on ${dev.name} during ${phaseName}`).toBe(false);
                    };

                    // ----------------------------------------------------
                    // 1. 事前登録画面 ＆ プレイリストファイル解析操作
                    // ----------------------------------------------------
                    await page.goto(`${host}/index.html`);
                    await page.fill('#accountName', `SET_${pl.id.toUpperCase()}`);
                    await page.fill('#djPassword', '8888');
                    await page.fill('#vjPassword', '7777');

                    // 実ファイルをセット
                    await page.setInputFiles('#playlistFile', pl.file);

                    // プレビュー表示待ち
                    await page.waitForSelector('#previewArea', { state: 'visible', timeout: 3000 }).catch(() => {});
                    await checkLayoutFit('01_index_preview');
                    await page.screenshot({ path: path.join(screenshotDir, '01_index_preview.png'), fullPage: true });

                    // 登録ボタン押下
                    await page.click('#registerBtn');
                    await page.waitForFunction(() => {
                        const panel = document.getElementById('result-panel');
                        return panel && !panel.classList.contains('hidden');
                    }, { timeout: 8000 }).catch(() => {});
                    await checkLayoutFit('02_index_registered');
                    await page.screenshot({ path: path.join(screenshotDir, '02_index_registered.png'), fullPage: true });

                    const djUrlBox = page.locator('#djUrlBox');
                    const vjUrlBox = page.locator('#vjUrlBox');
                    if (await djUrlBox.isVisible() && await vjUrlBox.isVisible()) {
                        const djUrl = (await djUrlBox.textContent()).trim();
                        const vjUrl = (await vjUrlBox.textContent()).trim();

                        if (djUrl && vjUrl) {
                            // ----------------------------------------------------
                            // 2. DJ画面 ログイン ＆ 操作 (SEND 実行)
                            // ----------------------------------------------------
                            await page.goto(djUrl);
                            await page.fill('#password', '8888');
                            await page.click('button[type="submit"]');
                            await page.waitForSelector('#mainApp', { state: 'visible' }).catch(() => {});
                            await page.evaluate(() => window.scrollTo(0, 0));
                            await page.waitForTimeout(200);

                            if (dev.isPc) {
                                const appWidth = await page.$eval('#mainApp', el => el.getBoundingClientRect().width).catch(() => 0);
                                if (appWidth > 0) expect(Math.round(appWidth)).toBeLessThanOrEqual(450);
                            }

                            console.log('Step 03_dj_main');
                            await checkLayoutFit('03_dj_main');
                            await page.screenshot({ path: path.join(screenshotDir, '03_dj_main.png') });

                            // DJページ: VIBES! ボタン押下 (手入力モーダル) 外観 & 機能テスト
                            console.log('Step 03b_dj_vibes_modal');
                            const vibesBtn = page.locator('#openVibesModalBtn');
                            if (await vibesBtn.isVisible()) {
                                await vibesBtn.click({ force: true }).catch(() => {});
                                await page.waitForSelector('#vibesModalOverlay.active', { state: 'visible', timeout: 3000 }).catch(() => {});
                                // フェードインアニメーション完了待ち (300ms)
                                await page.waitForTimeout(300);
                                await checkLayoutFit('03b_dj_vibes_modal');
                                await page.screenshot({ path: path.join(screenshotDir, '03b_dj_vibes_modal.png') });

                                // VIBES! フォームプリセットクリック＆送信機能テスト
                                const presetBtn = page.locator('.vibes-preset-btn').first();
                                if (await presetBtn.isVisible()) {
                                    await presetBtn.click().catch(() => {});
                                    await page.click('#sendVibesBtn').catch(() => {});
                                    await page.waitForTimeout(300);
                                } else {
                                    await page.evaluate(() => {
                                        const closeBtn = document.getElementById('closeVibesModalBtn');
                                        if (closeBtn) closeBtn.click();
                                        const overlay = document.getElementById('vibesModalOverlay');
                                        if (overlay) overlay.classList.remove('active');
                                    });
                                }
                            }

                            // DJページ: [Vibes!] バッジと [VJ READY] バッジ並び外観テスト
                            console.log('Step 03b2_dj_vibes_and_vj_ready');
                            await page.evaluate(() => {
                                const readyBadge = document.getElementById('vjReadyBadge');
                                const sendBox = document.getElementById('sendTrackBox');
                                if (readyBadge) readyBadge.style.display = 'inline-flex';
                                if (sendBox) sendBox.classList.add('vj-ready-highlight');
                            });
                            await page.waitForTimeout(200);
                            await checkLayoutFit('03b2_dj_vibes_and_vj_ready');
                            await page.screenshot({ path: path.join(screenshotDir, '03b2_dj_vibes_and_vj_ready.png') });

                            // DJページ: VJ検索タブ 外観テスト
                            console.log('Step 03c_dj_vj_search');
                            const vjSearchTabBtn = page.locator('button[data-tab="vj-search"]');
                            if (await vjSearchTabBtn.isVisible()) {
                                await vjSearchTabBtn.click({ force: true }).catch(() => {});
                                await page.waitForSelector('#tab-vj-search', { state: 'visible', timeout: 3000 }).catch(() => {});
                                const djSearchBtnsCount = await page.$$eval('#djSearchLinksSend button', els => els.length).catch(() => 0);
                                expect(djSearchBtnsCount).toBe(4);
                                await checkLayoutFit('03c_dj_vj_search');
                                await page.screenshot({ path: path.join(screenshotDir, '03c_dj_vj_search.png') });

                                // DJ操作タブに戻る
                                const djTabBtn = page.locator('button[data-tab="dj"]');
                                if (await djTabBtn.isVisible()) {
                                    await djTabBtn.click({ force: true }).catch(() => {});
                                    await page.waitForSelector('#tab-dj', { state: 'visible', timeout: 3000 }).catch(() => {});
                                }
                            }

                            // SEND TO VJ ボタン押下操作
                            console.log('Step 04_dj_after_send');
                            const sendBtn = page.locator('#sendBtn');
                            if (await sendBtn.isVisible()) {
                                await sendBtn.click();
                                await page.waitForSelector('#sendTrackBox', { state: 'visible' }).catch(() => {});
                            }
                            await checkLayoutFit('04_dj_after_send');
                            await page.screenshot({ path: path.join(screenshotDir, '04_dj_after_send.png') });

                            // ----------------------------------------------------
                            // 3. VJロビー画面 ＆ 複数DJ連携外観テスト (05a: VJモード開始前)
                            // ----------------------------------------------------
                            console.log('Step 05a_vj_lobby_multi_djs');
                            // 原点ドメインのストレージをクリアしてからVJページへ移動
                            await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => {});
                            await page.goto(`${host}/vj.html`);

                            const startLobbyBtn = page.locator('#startLobbyBtn');
                            if (await startLobbyBtn.isVisible()) {
                                await startLobbyBtn.click({ force: true }).catch(() => {});
                                await page.waitForSelector('#lobbyScreen', { state: 'visible', timeout: 5000 }).catch(() => {});
                                
                                // ロビーコード生成待ち
                                await page.waitForFunction(() => {
                                    const code = document.getElementById('lobbyCodeDisplay')?.textContent?.trim();
                                    return code && code !== '------' && code.length === 6;
                                }, { timeout: 8000 }).catch(() => {});

                                const lobbyCode = (await page.textContent('#lobbyCodeDisplay').catch(() => ''))?.trim();

                                // DJ2 を事前登録し、ロビーコードへプッシュ
                                const dj2Context = await browser.newContext({ viewport: dev.viewport, deviceScaleFactor: 2 });
                                const dj2Page = await dj2Context.newPage();
                                await dj2Page.goto(`${host}/index.html`);
                                await dj2Page.fill('#accountName', 'DJ_GUEST_SET');
                                await dj2Page.fill('#djPassword', '8888');
                                await dj2Page.fill('#vjPassword', '7777');
                                await dj2Page.setInputFiles('#playlistFile', 'tests/20260131_playlist_2.m3u8');
                                await dj2Page.click('#registerBtn');
                                await dj2Page.waitForFunction(() => {
                                    const panel = document.getElementById('result-panel');
                                    return panel && !panel.classList.contains('hidden');
                                }, { timeout: 8000 }).catch(() => {});

                                const dj2VjUrlBox = dj2Page.locator('#vjUrlBox');
                                const dj2DjUrlBox = dj2Page.locator('#djUrlBox');
                                let djUrl2 = '';
                                let vjUrl2 = '';
                                if (await dj2VjUrlBox.isVisible() && await dj2DjUrlBox.isVisible()) {
                                    vjUrl2 = (await dj2VjUrlBox.textContent()).trim();
                                    djUrl2 = (await dj2DjUrlBox.textContent()).trim();
                                }

                                if (lobbyCode && lobbyCode !== '------') {
                                    // DJ 1 および DJ 2 のセッションをロビーへ送信
                                    await page.evaluate(async ({ code, url1, url2, name1 }) => {
                                        await fetch(`/backend/api/action.php?action=push_to_lobby`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ lobbyCode: code, vjUrl: url1, djName: name1 })
                                        }).catch(() => {});
                                        if (url2) {
                                            await fetch(`/backend/api/action.php?action=push_to_lobby`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ lobbyCode: code, vjUrl: url2, djName: 'DJ_GUEST_SET' })
                                            }).catch(() => {});
                                        }
                                    }, { code: lobbyCode, url1: vjUrl, url2: vjUrl2, name1: `SET_${pl.id.toUpperCase()}` }).catch(() => {});

                                    // VJロビー画面にDJセッションが反映されるのを待機
                                    await page.waitForFunction(() => {
                                        const countEl = document.getElementById('lobbySessionCount');
                                        return countEl && parseInt(countEl.textContent, 10) >= 1;
                                    }, { timeout: 6000 }).catch(() => {});
                                    await page.waitForTimeout(400);
                                }

                                // 05a_vj_lobby_multi_djs 外観テスト (VJモード開始ボタン押下前の複数DJ連携ロビー画面)
                                await checkLayoutFit('05a_vj_lobby_multi_djs');
                                await page.screenshot({ path: path.join(screenshotDir, '05a_vj_lobby_multi_djs.png') });

                                // ----------------------------------------------------
                                // 4. VJモード開始 ＆ VJ VIEW操作画面外観テスト (05: VJモード開始後)
                                // ----------------------------------------------------
                                console.log('Step 05_vj_main');
                                const enterVjModeBtn = page.locator('#enterVjModeBtn');
                                if (await enterVjModeBtn.isVisible() && !(await enterVjModeBtn.isDisabled())) {
                                    await enterVjModeBtn.click({ force: true }).catch(() => {});
                                } else {
                                    await page.goto(vjUrl);
                                }

                                await page.waitForSelector('#mainApp', { state: 'visible', timeout: 5000 }).catch(() => {});
                                await page.evaluate(() => window.scrollTo(0, 0));
                                await page.waitForTimeout(200);

                                if (dev.isPc) {
                                    const vjAppWidth = await page.$eval('#mainApp', el => el.getBoundingClientRect().width).catch(() => 0);
                                    if (vjAppWidth > 0) expect(Math.round(vjAppWidth)).toBeLessThanOrEqual(450);
                                }

                                // 05_vj_main 外観テスト (VJモード遷移後の画面)
                                const searchBtnsCount = await page.$$eval('#searchLinksSend button', els => els.length).catch(() => 0);
                                expect(searchBtnsCount).toBe(4);
                                await checkLayoutFit('05_vj_main');
                                await page.screenshot({ path: path.join(screenshotDir, '05_vj_main.png') });

                                // ----------------------------------------------------
                                // 5. セッション追加モーダル (+追加ボタン押下) 外観 & 挙動テスト
                                // ----------------------------------------------------
                                console.log('Step 06a_vj_add_session_modal');
                                const addSessionBtn = page.locator('#addSessionBtn');
                                if (await addSessionBtn.isVisible()) {
                                    await addSessionBtn.click({ force: true }).catch(() => {});
                                    await page.waitForSelector('#addSessionModal:not(.hidden)', { state: 'visible', timeout: 3000 }).catch(() => {});
                                    await page.waitForTimeout(200);

                                    // 06a_vj_add_session_modal 外観テスト (セッション追加モーダル)
                                    await checkLayoutFit('06a_vj_add_session_modal');
                                    await page.screenshot({ path: path.join(screenshotDir, '06a_vj_add_session_modal.png') });

                                    // モーダルキャンセルボタンで閉じる
                                    await page.click('#modalCloseBtn').catch(() => {});
                                    await page.waitForTimeout(200);
                                }

                                // 06b_vj_multi_dj 外観テスト (複数DJが並ぶセッションタブバー)
                                console.log('Step 06b_vj_multi_dj');
                                await checkLayoutFit('06b_vj_multi_dj');
                                await page.screenshot({ path: path.join(screenshotDir, '06b_vj_multi_dj.png') });

                                // ----------------------------------------------------
                                // 5. 非アクティブDJからのSEND受信通知 (未読赤点バッジ) 外観テスト
                                // ----------------------------------------------------
                                console.log('Step 07_vj_unread_from_other_dj');
                                if (djUrl2) {
                                    await dj2Page.goto(djUrl2);
                                    await dj2Page.fill('#password', '8888');
                                    await dj2Page.click('button[type="submit"]');
                                    await dj2Page.waitForSelector('#mainApp', { state: 'visible' }).catch(() => {});
                                    const dj2SendBtn = dj2Page.locator('#sendBtn');
                                    if (await dj2SendBtn.isVisible()) {
                                        await dj2SendBtn.click();
                                        await dj2Page.waitForTimeout(300);
                                    }

                                    // VJ画面にて DJ2のタブに未読バッジ (badge-unread) が点灯した状態をキャプチャ
                                    await page.waitForTimeout(500);
                                    await checkLayoutFit('07_vj_unread_from_other_dj');
                                    await page.screenshot({ path: path.join(screenshotDir, '07_vj_unread_from_other_dj.png') });
                                }

                                await dj2Context.close().catch(() => {});
                            } else {
                                // 単一VJ画面フォールバック
                                await page.goto(vjUrl);
                                await page.waitForSelector('#mainApp', { state: 'visible' }).catch(() => {});
                                await checkLayoutFit('05_vj_main');
                                await page.screenshot({ path: path.join(screenshotDir, '05_vj_main.png') });
                            }
                        }
                    }

                    await context.close();
                });
            }
        });
    }

    test.afterAll(async () => {
        const generateGallery = require('./generate_gallery');
        try {
            generateGallery();
        } catch (e) {
            console.error('Failed to generate gallery:', e);
        }
    });
});
