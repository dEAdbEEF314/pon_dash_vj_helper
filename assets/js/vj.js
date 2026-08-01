document.addEventListener('DOMContentLoaded', () => {
    // UI要素の取得
    const loginScreen = document.getElementById('loginScreen');
    const modeSelectPanel = document.getElementById('modeSelectPanel');
    const lobbyScreen = document.getElementById('lobbyScreen');
    const directLoginForm = document.getElementById('directLoginForm');
    const loginForm = document.getElementById('loginForm');
    const mainApp = document.getElementById('mainApp');
    
    const lobbyCodeDisplay = document.getElementById('lobbyCodeDisplay');
    const lobbySessionList = document.getElementById('lobbySessionList');
    const lobbySessionCount = document.getElementById('lobbySessionCount');
    const lobbyEmptyMsg = document.getElementById('lobbyEmptyMsg');
    const enterVjModeBtn = document.getElementById('enterVjModeBtn');
    
    const sessionTabBar = document.getElementById('sessionTabBar');
    const playlistContainer = document.getElementById('playlistContainer');
    const sessionNameDisplay = document.getElementById('sessionNameDisplay');
    
    // モーダル要素
    const addSessionModal = document.getElementById('addSessionModal');
    const modalUrlInput = document.getElementById('modalUrlInput');
    const modalSidInput = document.getElementById('modalSidInput');
    const modalVpInput = document.getElementById('modalVpInput');
    
    // データ構造
    let pusherInstance = null;
    let currentLobbyCode = null;
    let lobbyPollInterval = null;
    let pendingLobbySessions = []; // ロビーで受信した未追加セッションのキュー

    // セッション Map<sessionId, SessionObject>
    const sessions = new Map();
    let activeSessionId = null;

    // ----------------------------------------------------
    // 0. 初期判定 (自動ログインURLパラメータチェック)
    // ----------------------------------------------------
    const urlParams = new URLSearchParams(window.location.search);
    const initialSid = urlParams.get('sid');
    const initialVp = urlParams.get('vp');

    if (initialSid && initialVp) {
        // パスワード込みURLからの自動ログイン
        autoLogin(initialSid, initialVp);
    }

    // ----------------------------------------------------
    // 1. モード選択 & UI切替イベント
    // ----------------------------------------------------
    document.getElementById('startLobbyBtn').addEventListener('click', () => {
        modeSelectPanel.classList.add('hidden');
        lobbyScreen.classList.remove('hidden');
        startLobby();
    });

    document.getElementById('showDirectLoginBtn').addEventListener('click', () => {
        modeSelectPanel.classList.add('hidden');
        directLoginForm.classList.remove('hidden');
    });

    document.getElementById('backToModeBtn').addEventListener('click', () => {
        directLoginForm.classList.add('hidden');
        modeSelectPanel.classList.remove('hidden');
    });

    // 直接ログインフォームの送信
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('password').value;
        const sid = initialSid || getSessionIdFromUrl();
        if (!sid) {
            alert("URLにセッションID (sid) が含まれていません。");
            return;
        }
        await autoLogin(sid, pwd);
    });

    // ロビーからVJモード開始
    enterVjModeBtn.addEventListener('click', () => {
        if (sessions.size === 0) return;
        
        if (lobbyPollInterval) clearInterval(lobbyPollInterval);
        loginScreen.classList.add('hidden');
        mainApp.classList.remove('hidden');
        
        // ロビーコードをヘッダーに常時表示
        if (typeof currentLobbyCode !== 'undefined' && currentLobbyCode) {
            const headerCodeTag = document.getElementById('headerLobbyCodeTag');
            const headerCodeValue = document.getElementById('headerLobbyCodeValue');
            if (headerCodeTag && headerCodeValue) {
                headerCodeValue.textContent = currentLobbyCode;
                headerCodeTag.classList.remove('hidden');
            }
        }

        // 最初のセッションをアクティブ化
        const firstSid = Array.from(sessions.keys())[0];
        switchSession(firstSid);
    });

    // ----------------------------------------------------
    // 2. Pusher インスタンスの取得 (単一管理)
    // ----------------------------------------------------
    function getPusher() {
        if (!pusherInstance) {
            if (typeof PUSHER_APP_KEY === 'undefined' || PUSHER_APP_KEY === 'YOUR_PUSHER_APP_KEY') {
                console.warn("Pusher App Key is not set.");
            }
            pusherInstance = new Pusher(PUSHER_APP_KEY, {
                cluster: PUSHER_CLUSTER
            });
        }
        return pusherInstance;
    }

    // ----------------------------------------------------
    // 3. VJロビー処理 (ロビー作成・受信・ポーリング)
    // ----------------------------------------------------
    async function startLobby() {
        try {
            const res = await fetch(`${API_BASE}/action.php?action=create_lobby`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                currentLobbyCode = data.lobbyCode;
                lobbyCodeDisplay.textContent = currentLobbyCode;

                // Pusher ロビーチャネルの購読
                const pusher = getPusher();
                const lobbyChannel = pusher.subscribe(`lobby-${currentLobbyCode}`);
                lobbyChannel.bind('session-pushed', (eventData) => {
                    if (eventData.vjUrl) {
                        handlePushedSession(eventData.vjUrl, eventData.djName);
                    }
                });

                // バックグラウンドポーリング (Pusher漏れフォロー: 30秒毎)
                lobbyPollInterval = setInterval(pollLobbySessions, 30000);
            } else {
                alert("ロビーの作成に失敗しました: " + (data.error || ''));
            }
        } catch (e) {
            alert("ロビー通信エラー: " + e.message);
        }
    }

    async function pollLobbySessions() {
        if (!currentLobbyCode) return;
        try {
            const res = await fetch(`${API_BASE}/action.php?action=poll_lobby`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lobbyCode: currentLobbyCode })
            });
            const data = await res.json();
            if (data.success && Array.isArray(data.sessions)) {
                data.sessions.forEach(s => handlePushedSession(s.vjUrl, s.djName));
            }
        } catch (e) {
            console.error("ロビーポーリングエラー", e);
        }
    }

    async function handlePushedSession(vjUrl, djName) {
        try {
            const parsed = parseVjUrl(vjUrl);
            if (!parsed || !parsed.sid || !parsed.vp) return;

            // すでにログイン済みセッションならスキップ
            if (sessions.has(parsed.sid)) return;

            // バックグラウンドでログイン処理
            const loginRes = await fetch(`${API_BASE}/action.php?action=login&role=vj`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: parsed.sid, password: parsed.vp })
            });
            const data = await loginRes.json();
            if (data.success) {
                addSession(parsed.sid, parsed.vp, data, djName);
                
                // ロビー画面のリストを更新
                if (lobbyEmptyMsg) lobbyEmptyMsg.style.display = 'none';
                
                const item = document.createElement('div');
                item.style.cssText = "display: flex; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.85rem;";
                item.innerHTML = `<span style="font-weight: bold; color: #00ffcc;">🎧 ${data.state.accountName || djName}</span><span style="color: #64748b;">連携済み</span>`;
                lobbySessionList.appendChild(item);

                lobbySessionCount.textContent = sessions.size;
                enterVjModeBtn.disabled = false;
            }
        } catch (e) {
            console.error("ロビーセッション追加エラー", e);
        }
    }

    // ----------------------------------------------------
    // 4. 自動ログイン & セッション追加
    // ----------------------------------------------------
    async function autoLogin(sid, vp) {
        try {
            const res = await fetch(`${API_BASE}/action.php?action=login&role=vj`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sid, password: vp })
            });
            const data = await res.json();
            if (data.success) {
                // URLから vp パラメータを除去してブラウザ履歴をクリア
                const cleanUrl = new URL(window.location.href);
                cleanUrl.searchParams.delete('vp');
                history.replaceState(null, '', cleanUrl.toString());

                addSession(sid, vp, data);
                loginScreen.classList.add('hidden');
                mainApp.classList.remove('hidden');
                switchSession(sid);
                initSearchButtons();
                initCopyableToSearchInput();
            } else {
                document.getElementById('loginError').style.display = 'block';
            }
        } catch (e) {
            alert("ログインエラー: " + e.message);
        }
    }

    function addSession(sessionId, password, loginData, customDjName = null) {
        if (sessions.has(sessionId)) {
            switchSession(sessionId);
            return;
        }

        const djName = customDjName || loginData.state.accountName || 'DJ';
        
        const sessionObj = {
            sessionId,
            password,
            token: loginData.token,
            djName,
            state: {
                tracks: loginData.state.tracks,
                nowPlayingIdx: loginData.state.nowPlayingIdx,
                sentIdx: loginData.state.sentIdx
            },
            hasUnread: false
        };

        // Pusher セッションチャネルの購読
        const pusher = getPusher();
        const channel = pusher.subscribe(`session-${sessionId}`);
        sessionObj.channel = channel;

        channel.bind('state-updated', (data) => {
            if (data.action === 'send') {
                sessionObj.state.sentIdx = data.sentIdx;
                if (activeSessionId === sessionId) {
                    renderPlaylist();
                    updateDisplay();
                    flashSendBox('is-flashing-danger');
                } else {
                    sessionObj.hasUnread = true;
                    renderSessionTabs();
                }
            } else if (data.action === 'auto-next') {
                sessionObj.state.nowPlayingIdx = data.nowPlayingIdx;
                if (activeSessionId === sessionId) {
                    renderPlaylist();
                    updateDisplay();
                }
            } else if (data.action === 'vj-ready') {
                if (activeSessionId === sessionId) {
                    flashSendBox('is-flashing-success');
                }
            }
        });

        sessions.set(sessionId, sessionObj);
        renderSessionTabs();
    }

    // ----------------------------------------------------
    // 5. セッション切り替え & 削除
    // ----------------------------------------------------
    function switchSession(sessionId) {
        if (!sessions.has(sessionId)) return;
        activeSessionId = sessionId;

        const current = sessions.get(activeSessionId);
        current.hasUnread = false;

        if (sessionNameDisplay) {
            sessionNameDisplay.textContent = `DJ: ${current.djName}`;
        }
        renderSessionTabs();
        renderPlaylist();
        updateDisplay();
    }

    function removeSession(sessionId) {
        const sessionObj = sessions.get(sessionId);
        if (!sessionObj) return;

        if (!confirm(`「${sessionObj.djName}」のセッションを削除しますか？`)) return;

        // Pusher 解除
        if (sessionObj.channel) {
            getPusher().unsubscribe(`session-${sessionId}`);
        }
        sessions.delete(sessionId);

        if (sessions.size > 0) {
            const nextSid = Array.from(sessions.keys())[0];
            switchSession(nextSid);
        } else {
            // 全削除されたらアプリを隠してモード選択へ
            mainApp.classList.add('hidden');
            loginScreen.classList.remove('hidden');
            modeSelectPanel.classList.remove('hidden');
            lobbyScreen.classList.add('hidden');
            directLoginForm.classList.add('hidden');
        }
    }

    // ----------------------------------------------------
    // 6. UI描画 (セッションタブ, プレイリスト, ステータス)
    // ----------------------------------------------------
    function renderSessionTabs() {
        sessionTabBar.innerHTML = '';
        
        sessions.forEach((sess, sid) => {
            const tab = document.createElement('div');
            tab.className = `session-tab ${sid === activeSessionId ? 'active' : ''}`;
            
            let labelHtml = `<span>🎧 ${escapeHtml(sess.djName)}</span>`;
            if (sess.hasUnread && sid !== activeSessionId) {
                labelHtml += `<span class="badge-unread" title="新曲SEND受信"></span>`;
            }
            labelHtml += `<span class="close-btn" title="削除">×</span>`;
            tab.innerHTML = labelHtml;

            // クリックで切り替え
            tab.addEventListener('click', (e) => {
                if (e.target.classList.contains('close-btn')) {
                    e.stopPropagation();
                    removeSession(sid);
                } else {
                    switchSession(sid);
                }
            });

            // 長押しで削除 (500ms) - スマホ向け
            let pressTimer = null;
            tab.addEventListener('touchstart', (e) => {
                pressTimer = setTimeout(() => {
                    removeSession(sid);
                }, 600);
            }, { passive: true });

            tab.addEventListener('touchend', () => {
                if (pressTimer) clearTimeout(pressTimer);
            });
            tab.addEventListener('touchmove', () => {
                if (pressTimer) clearTimeout(pressTimer);
            });

            sessionTabBar.appendChild(tab);
        });

        // 「+ セッション追加」ボタン
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'session-add-btn';
        addBtn.id = 'addSessionBtn';
        addBtn.textContent = '+ 追加';
        addBtn.addEventListener('click', openAddSessionModal);
        sessionTabBar.appendChild(addBtn);
    }

    function renderPlaylist() {
        const current = sessions.get(activeSessionId);
        if (!current) return;

        playlistContainer.innerHTML = '';
        const { tracks, nowPlayingIdx, sentIdx } = current.state;

        tracks.forEach((track, i) => {
            const item = document.createElement('div');
            item.className = 'playlist-item';
            
            if (i < nowPlayingIdx) item.classList.add('played');
            if (i === nowPlayingIdx) item.style.borderLeft = "3px solid #fff";
            if (i === sentIdx) {
                item.style.borderLeft = "3px solid var(--danger-color, #ff3366)";
                item.style.background = "rgba(255, 51, 102, 0.1)";
            }

            const pTitle = document.createElement('div');
            pTitle.className = 'p-title';
            pTitle.textContent = `${i + 1}. ${track.title}`;
            const pArtist = document.createElement('div');
            pArtist.className = 'p-artist';
            pArtist.textContent = track.artist;
            item.appendChild(pTitle);
            item.appendChild(pArtist);
            playlistContainer.appendChild(item);
        });

        const activeIdx = sentIdx !== -1 ? sentIdx : nowPlayingIdx;
        const activeItem = playlistContainer.children[activeIdx];
        if (activeItem) {
            activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function applyMarquee(el, text) {
        if (!el) return;
        el.textContent = text;
        el.classList.remove('is-marquee');
        el.style.transform = 'translateX(0)';
        
        requestAnimationFrame(() => {
            // 親要素の幅と比較してはみ出しているか判定
            if (el.scrollWidth > el.parentElement.clientWidth) {
                const dist = el.scrollWidth - el.parentElement.clientWidth + 10;
                el.style.setProperty('--scroll-dist', `-${dist}px`);
                el.classList.add('is-marquee');
            }
        });
    }

    function updateDisplay() {
        const current = sessions.get(activeSessionId);
        if (!current) return;

        const { tracks, nowPlayingIdx, sentIdx } = current.state;

        // 1. SENDされた曲
        const targetSentIdx = sentIdx !== -1 ? sentIdx : 0;
        const sentTrack = tracks[targetSentIdx];
        const sendTitleEl = document.getElementById('sendTitle');
        const sendArtistEl = document.getElementById('sendArtist');
        if (sentTrack) {
            applyMarquee(sendTitleEl, sentTrack.title);
            applyMarquee(sendArtistEl, sentTrack.artist);
        } else {
            applyMarquee(sendTitleEl, "-");
            applyMarquee(sendArtistEl, "-");
        }

        // 2. 次の曲
        let nextIdx = sentIdx !== -1 ? sentIdx + 1 : nowPlayingIdx + 1;
        const nextTrack = tracks[nextIdx];
        const nextTitleEl = document.getElementById('nextTitle');
        const nextArtistEl = document.getElementById('nextArtist');

        if (nextTitleEl && nextArtistEl) {
            if (nextTrack) {
                applyMarquee(nextTitleEl, nextTrack.title);
                applyMarquee(nextArtistEl, nextTrack.artist);
            } else {
                applyMarquee(nextTitleEl, "(end of playlist)");
                applyMarquee(nextArtistEl, "-");
            }
        }
    }

    function flashSendBox(className) {
        const sendBox = document.getElementById('sendTrackBox');
        if (!sendBox) return;
        sendBox.classList.remove('is-flashing-danger', 'is-flashing-success');
        void sendBox.offsetWidth;
        sendBox.classList.add(className);
    }

    // ----------------------------------------------------
    // 7. 素材検索 & タップコピー
    // ----------------------------------------------------
    function initSearchButtons() {
        const searchInput = document.getElementById('vjSearchInput');
        const buttons = document.querySelectorAll('#searchLinksSend button');
        
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const query = encodeURIComponent(searchInput.value.trim());
                if (!query) {
                    alert('検索ワードを入力してください（SEND曲名をタップすると入力されます）');
                    return;
                }
                
                let url = '';
                switch (btn.dataset.search) {
                    case 'google':
                        url = `https://www.google.com/search?q=${query}`;
                        break;
                    case 'google_image':
                        url = `https://www.google.com/search?tbm=isch&q=${query}`;
                        break;
                    case 'youtube':
                        url = `https://www.youtube.com/results?search_query=${query}`;
                        break;
                    case 'niconico':
                        url = `https://www.nicovideo.jp/search/${query}`;
                        break;
                    case 'giphy':
                        url = `https://giphy.com/search/${query}`;
                        break;
                }
                if (url) {
                    window.open(url, '_blank');
                }
            });
        });
    }

    function initCopyableToSearchInput() {
        const searchInput = document.getElementById('vjSearchInput');
        if (!searchInput) return;

        const copyables = document.querySelectorAll('#sendTrackBox .copyable');
        copyables.forEach(el => {
            el.addEventListener('click', () => {
                const text = el.textContent.trim();
                if (text && text !== '-') {
                    searchInput.value = text;
                    searchInput.focus();
                }
            });
        });
    }

    // ----------------------------------------------------
    // 8. モーダルダイアログ (手動セッション追加)
    // ----------------------------------------------------
    function openAddSessionModal() {
        modalUrlInput.value = '';
        modalSidInput.value = '';
        modalVpInput.value = '';
        addSessionModal.classList.remove('hidden');
    }

    document.getElementById('modalCloseBtn').addEventListener('click', () => {
        addSessionModal.classList.add('hidden');
    });

    document.getElementById('modalAddByUrlBtn').addEventListener('click', async () => {
        const rawUrl = modalUrlInput.value.trim();
        const parsed = parseVjUrl(rawUrl);
        if (!parsed || !parsed.sid || !parsed.vp) {
            alert("有効なVJ用URLをペーストしてください (例: vj.html?sid=xxx&vp=1234)");
            return;
        }
        await autoLogin(parsed.sid, parsed.vp);
        addSessionModal.classList.add('hidden');
    });

    document.getElementById('modalAddManualBtn').addEventListener('click', async () => {
        const sid = modalSidInput.value.trim();
        const vp = modalVpInput.value.trim();
        if (!sid || !vp) {
            alert("セッションIDとパスワードの両方を入力してください。");
            return;
        }
        await autoLogin(sid, vp);
        addSessionModal.classList.add('hidden');
    });

    // ----------------------------------------------------
    // 9. ユーティリティ関数
    // ----------------------------------------------------
    function parseVjUrl(urlStr) {
        try {
            const url = new URL(urlStr, window.location.origin);
            const sid = url.searchParams.get('sid');
            const vp = url.searchParams.get('vp');
            return { sid, vp };
        } catch(e) {
            return null;
        }
    }

    function escapeHtml(str) {
        return (str || '').replace(/[&<>"']/g, (m) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[m]);
    }

    // READYボタン処理
    const readyBtn = document.getElementById('readyBtn');
    if (readyBtn) {
        readyBtn.addEventListener('click', async () => {
            const current = sessions.get(activeSessionId);
            if (!current) return;
            try {
                await fetch(`${API_BASE}/action.php?action=ready&role=vj`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: current.sessionId, token: current.token })
                });
                flashSendBox('is-flashing-success');
            } catch(e) {
                console.error("READY送信エラー", e);
            }
        });
    }

    // イベントリスナーの初期化実行
    initSearchButtons();
    initCopyableToSearchInput();
});
