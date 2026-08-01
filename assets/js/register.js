document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('playlistFile');
    const previewArea = document.getElementById('previewArea');
    const previewList = document.getElementById('previewList');
    const trackCount = document.getElementById('trackCount');
    const registerForm = document.getElementById('registerForm');
    
    let parsedTracks = [];

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
            
            // プレビュー表示
            previewList.innerHTML = '';
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
                previewList.appendChild(item);
            });
            
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
            const response = await fetch(`${API_BASE}/register.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accountName,
                    djPassword,
                    vjPassword,
                    tracks: parsedTracks
                })
            });

            const result = await response.json();

            if (result.success) {
                // 登録成功、URL表示
                document.getElementById('registration-panel').classList.add('hidden');
                document.getElementById('result-panel').classList.remove('hidden');

                const baseUrl = window.location.origin + window.location.pathname.replace('index.html', '');
                
                const djUrl = `${baseUrl}dj.html?sid=${result.sessionId}`;
                // VJ用URLに閲覧許可パスワード(vp)を含めて自動ログイン可能なフルURLにする
                const vjUrl = `${baseUrl}vj.html?sid=${result.sessionId}&vp=${vjPassword}`;

                document.getElementById('djUrlBox').textContent = djUrl;
                document.getElementById('vjUrlBox').textContent = vjUrl;
                
                document.getElementById('djLink').href = djUrl;
                document.getElementById('vjLink').href = vjUrl;

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
                        if (!code || code.length !== 6) {
                            alert("6文字のロビーコードを入力してください。");
                            return;
                        }

                        pushBtn.disabled = true;
                        pushBtn.textContent = '送信中...';
                        pushResult.style.display = 'none';

                        try {
                            const res = await fetch(`${API_BASE}/action.php?action=push_to_lobby`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    lobbyCode: code,
                                    vjUrl: vjUrl,
                                    djName: accountName
                                })
                            });
                            const data = await res.json();
                            if (data.success) {
                                pushResult.style.display = 'block';
                                pushResult.style.color = '#00ffcc';
                                pushResult.textContent = '✅ VJロビーへ送信成功！VJ画面に自動追加されました。';
                            } else {
                                throw new Error(data.error || '送信失敗');
                            }
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
                                    text: `VJ用自動ログインリンクです`,
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
                                alert("VJ用URL（自動ログイン付き）をクリップボードにコピーしました！");
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
