document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('playlistFile');
    const previewArea = document.getElementById('previewArea');
    const previewList = document.getElementById('previewList');
    const trackCount = document.getElementById('trackCount');
    const registerForm = document.getElementById('registerForm');
    
    let parsedTracks = [];

    // VDJ導線: VJロビーから渡されたコードは自動入力するが、自動送信はしない
    const lobbyCodeInput = document.getElementById('lobbyCodeInput');
    const lobbyCodeFromUrl = new URLSearchParams(window.location.search).get('lobby');
    if (lobbyCodeInput && lobbyCodeFromUrl && /^[A-Za-z0-9]{10}$/.test(lobbyCodeFromUrl)) {
        lobbyCodeInput.value = lobbyCodeFromUrl.toUpperCase();
        lobbyCodeInput.dataset.prefilled = 'true';
        lobbyCodeInput.setAttribute('aria-describedby', 'lobbyCodeHint');
        const hint = lobbyCodeInput.parentElement?.previousElementSibling;
        if (hint) {
            hint.textContent = 'VJロビーコードを確認して「送信」を押してください（VDJ向け）';
        }
    }

    // ファイル選択時のプレビュー処理
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) {
            previewArea.classList.add('hidden');
            parsedTracks = [];
            return;
        }

        try {
            parsedTracks = await PlaylistParser.parse(file);
            
            // プレビュー表示 (DocumentFragment による一括DOM挿入で高速化)
            previewList.innerHTML = '';
            const fragment = document.createDocumentFragment();
            parsedTracks.forEach((track, index) => {
                const item = document.createElement('div');
                item.className = 'playlist-item';
                // XSS対策: innerHTML ではなく textContent を使用 (H-1)
                const pTitle = document.createElement('div');
                pTitle.className = 'p-title';
                pTitle.textContent = `${index + 1}. ${track.title}`;
                const pArtist = document.createElement('div');
                pArtist.className = 'p-artist';
                pArtist.textContent = track.artist;
                item.appendChild(pTitle);
                item.appendChild(pArtist);
                fragment.appendChild(item);
            });
            previewList.appendChild(fragment);

            
            trackCount.textContent = `(${parsedTracks.length} tracks)`;
            previewArea.classList.remove('hidden');
            
        } catch (error) {
            alert(error.message);
            fileInput.value = '';
            previewArea.classList.add('hidden');
            parsedTracks = [];
        }
    });

    // フォーム送信（登録処理）
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (parsedTracks.length === 0) {
            alert("プレイリストが正常に読み込まれていません。");
            return;
        }

        const accountName = document.getElementById('accountName').value;
        const djPassword = document.getElementById('djPassword').value;
        const vjPassword = document.getElementById('vjPassword').value;
        const submitBtn = document.getElementById('registerBtn');

        submitBtn.disabled = true;
        submitBtn.textContent = '登録中...';

        try {
            const result = await apiRequest('register.php', {
                method: 'POST',
                body: JSON.stringify({
                    accountName,
                    djPassword,
                    vjPassword,
                    tracks: parsedTracks
                })
            });

            if (result.success) {
                // 登録成功、URL表示
                document.getElementById('registration-panel').classList.add('hidden');
                document.getElementById('result-panel').classList.remove('hidden');

                // 登録ページが index.html / dj-register.html のどちらでも正しくルートを求める
                const baseUrl = new URL('.', window.location.href).href;
                
                const djUrl = `${baseUrl}dj.html?sid=${result.sessionId}`;
                // VJ用URLには認証情報を含めず、VJ側でパスワードを入力する
                const vjUrl = `${baseUrl}vj.html?sid=${result.sessionId}`;

                const djUrlBox = document.getElementById('djUrlBox');
                if (djUrlBox) djUrlBox.textContent = djUrl;

                const vjUrlBox = document.getElementById('vjUrlBox');
                if (vjUrlBox) vjUrlBox.textContent = vjUrl;
                
                const djLink = document.getElementById('djLink');
                if (djLink) djLink.href = djUrl;

                const vjLink = document.getElementById('vjLink');
                if (vjLink) vjLink.href = vjUrl;

                // QRコード表示領域の取得と初期化（複数回登録時の増殖防止とキャッシュ対策）
                const djQrcodeEl = document.getElementById("djQrcode");
                if (djQrcodeEl) djQrcodeEl.innerHTML = '';

                // vjQrcodeが見つからない場合は古いバージョンのキャッシュ(qrcode)へのフォールバックを試みる
                const vjQrcodeEl = document.getElementById("vjQrcode") || document.getElementById("qrcode");
                if (vjQrcodeEl) vjQrcodeEl.innerHTML = '';

                // QRコード生成 (DJ用)
                if (djQrcodeEl) {
                    new QRCode(djQrcodeEl, {
                        text: djUrl,
                        width: 200,
                        height: 200,
                        colorDark : "#000000",
                        colorLight : "#ffffff",
                        correctLevel : QRCode.CorrectLevel.H
                    });
                }

                // QRコード生成 (VJ用)
                if (vjQrcodeEl) {
                    new QRCode(vjQrcodeEl, {
                        text: vjUrl,
                        width: 200,
                        height: 200,
                        colorDark : "#000000",
                        colorLight : "#ffffff",
                        correctLevel : QRCode.CorrectLevel.H
                    });
                }

                // ① VJロビー送信ボタンのハンドラ設定
                const pushBtn = document.getElementById('pushToLobbyBtn');
                const lobbyInput = document.getElementById('lobbyCodeInput');
                const pushResult = document.getElementById('lobbyPushResult');

                if (pushBtn && lobbyInput) {
                    pushBtn.onclick = async () => {
                        const code = lobbyInput.value.trim().toUpperCase();
                        if (!code || code.length !== 10) {
                            alert("10文字のロビーコードを入力してください。");
                            return;
                        }

                        pushBtn.disabled = true;
                        pushBtn.textContent = '送信中...';
                        pushResult.style.display = 'none';

                        try {
                            await apiRequest('action.php?action=push_to_lobby', {
                                method: 'POST',
                                body: JSON.stringify({
                                    lobbyCode: code,
                                    sessionId: result.sessionId,
                                    vjPassword,
                                    djName: accountName
                                })
                            });
                            pushResult.style.display = 'block';
                            pushResult.style.color = '#00ffcc';
                            pushResult.textContent = '✅ VJロビーへ送信成功！VJ画面に自動追加されました。';
                        } catch (e) {
                            pushResult.style.display = 'block';
                            pushResult.style.color = 'var(--danger-color, #ff3366)';
                            pushResult.textContent = '❌ 送信エラー: ' + e.message;
                        } finally {
                            pushBtn.disabled = false;
                            pushBtn.textContent = '送信';
                        }
                    };
                }

                // ② VJ用URLの Web Share / クリップボード コピー ボタン設定
                const shareBtn = document.getElementById('shareVjUrlBtn');
                if (shareBtn) {
                    shareBtn.onclick = async () => {
                        if (navigator.share) {
                            try {
                                await navigator.share({
                                    title: `PDVH VJ用リンク (${accountName})`,
                                    text: `VJ用セッションリンクです`,
                                    url: vjUrl
                                });
                            } catch (err) {
                                if (err.name !== 'AbortError') {
                                    alert("共有エラー: " + err.message);
                                }
                            }
                        } else if (navigator.clipboard) {
                            try {
                                await navigator.clipboard.writeText(vjUrl);
                                alert("VJ用URLをクリップボードにコピーしました！");
                            } catch (err) {
                                alert("コピーに失敗しました: " + err.message);
                            }
                        } else {
                            alert("このブラウザは共有/自動コピー非対応です。上のURLボックスからコピーしてください。");
                        }
                    };
                }
            } else {
                throw new Error(result.error || "登録エラー");
            }
        } catch (error) {
            alert("エラーが発生しました: " + error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '登録してURLを発行';
        }
    });

    // ガイドセクションの開閉トグル
    const guideHeader = document.getElementById('guideToggleHeader');
    const guideContent = document.getElementById('guideContent');
    const guideIcon = document.getElementById('guideToggleIcon');

    if (guideHeader && guideContent && guideIcon) {
        guideHeader.addEventListener('click', () => {
            if (guideContent.style.display === 'none') {
                guideContent.style.display = 'block';
                guideIcon.textContent = '[閉じる]';
            } else {
                guideContent.style.display = 'none';
                guideIcon.textContent = '[開く]';
            }
        });
    }

    // index.html ガイド用モックタブ切り替え処理
    const mockTabDj = document.getElementById('mockTabDj');
    const mockTabVj = document.getElementById('mockTabVj');
    const mockContentDj = document.getElementById('mockContentDj');
    const mockContentVj = document.getElementById('mockContentVj');

    if (mockTabDj && mockTabVj && mockContentDj && mockContentVj) {
        const resetMockTabs = () => {
            mockTabDj.style.background = 'transparent';
            mockTabDj.style.color = '#94a3b8';
            mockTabVj.style.background = 'transparent';
            mockTabVj.style.color = '#94a3b8';
            mockContentDj.style.display = 'none';
            mockContentVj.style.display = 'none';
        };

        mockTabDj.addEventListener('click', () => {
            resetMockTabs();
            mockTabDj.style.background = 'var(--accent-color, #00ffcc)';
            mockTabDj.style.color = '#000';
            mockContentDj.style.display = 'block';
        });

        mockTabVj.addEventListener('click', () => {
            resetMockTabs();
            mockTabVj.style.background = 'var(--accent-color, #00ffcc)';
            mockTabVj.style.color = '#000';
            mockContentVj.style.display = 'block';
        });
    }
});
