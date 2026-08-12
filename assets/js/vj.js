document.addEventListener('DOMContentLoaded', () => {
    // UI要素の取得
    const loginScreen = document.getElementById('loginScreen');
    const modeSelectPanel = document.getElementById('modeSelectPanel');
    const lobbyScreen = document.getElementById('lobbyScreen');
    const directLoginForm = document.getElementById('directLoginForm');
    const loginForm = document.getElementById('loginForm');
    const mainApp = document.getElementById('mainApp');
    
    // 実端末（AQUOS SH-M24等）でのフォーカス・レイアウトシフトによる全体系スクロールを強制キャンセル
    window.addEventListener('scroll', () => {
        if (window.scrollY !== 0 || window.scrollX !== 0) {
            window.scrollTo(0, 0);
        }
    }, { passive: true });

    if (mainApp) {
        mainApp.addEventListener('scroll', () => {
            if (mainApp.scrollTop !== 0 || mainApp.scrollLeft !== 0) {
                mainApp.scrollTop = 0;
                mainApp.scrollLeft = 0;
            }
        }, { passive: true });
    }
    
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

    // セッション Map<sessionId, SessionObject>
    const sessions = new Map();
    let activeSessionId = null;

    // --- LocalStorage ヘルパー ---
    function saveLobbyCode(code) {
        localStorage.setItem('vjLobbyCode', code);
    }
    function clearLobbyCode() {
        localStorage.removeItem('vjLobbyCode');
        currentLobbyCode = null;
    }
    function saveSessions() {
        const list = [];
        sessions.forEach((sess, sid) => {
            list.push({ sid, vp: sess.password, djName: sess.djName });
        });
        localStorage.setItem('vjSessions', JSON.stringify(list));
    }
    function loadSavedSessions() {
        try {
            const saved = localStorage.getItem('vjSessions');
            if (saved) return JSON.parse(saved);
        } catch(e) {}
        return [];
    }
    function removeSavedSessionBySid(sid) {
        const saved = loadSavedSessions();
        const filtered = saved.filter(s => s.sid !== sid);
        localStorage.setItem('vjSessions', JSON.stringify(filtered));
    }

    // ----------------------------------------------------
    // 0. 初期判定 (URLパラメータ & LocalStorage復元)
    // ----------------------------------------------------
    const urlParams = new URLSearchParams(window.location.search);
    const initialSid = urlParams.get('sid');
    const initialVp = urlParams.get('vp');

    if (initialSid && initialVp) {
        // パスワード込みURLからの自動ログイン
        autoLogin(initialSid, initialVp);
    }

    // 保存されているLobbyの復元
    const savedLobbyCode = localStorage.getItem('vjLobbyCode');
    if (savedLobbyCode) {
        currentLobbyCode = savedLobbyCode;
        lobbyCodeDisplay.textContent = currentLobbyCode;
        // 有効か確認しつつポーリング開始
        resumeLobby(savedLobbyCode);
    }

    // 保存されているSessionsの復元
    const savedSessions = loadSavedSessions();
    savedSessions.forEach(s => {
        // URLパラメータで処理中のものは二重に呼ばない
        if (!initialSid || s.sid !== initialSid) { 
            autoLogin(s.sid, s.vp, s.djName);
        }
    });

    // セッション復元完了時に画面を切り替える判定
    setTimeout(() => {
        if (sessions.size > 0 && loginScreen.classList.contains('hidden') === false && lobbyScreen.classList.contains('hidden') === true) {
            loginScreen.classList.add('hidden');
            mainApp.classList.remove('hidden');
            const firstSid = Array.from(sessions.keys())[0];
            switchSession(firstSid);
            initSearchButtons();
            initCopyableToSearchInput();
            
            if (currentLobbyCode) {
                const headerCodeTag = document.getElementById('headerLobbyCodeTag');
                const headerCodeValue = document.getElementById('headerLobbyCodeValue');
                if (headerCodeTag && headerCodeValue) {
                    headerCodeValue.textContent = currentLobbyCode;
                    headerCodeTag.classList.remove('hidden');
                }
            }
        }
    }, 1000); // ログインの非同期完了を少し待つ簡易対応

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
        const sid = initialSid || getSessionIdFromUrl(); // getSessionIdFromUrl() が無い場合はエラーになるので修正
        if (!sid) {
            alert("URLにセッションID (sid) が含まれていません。");
            return;
        }
        await autoLogin(sid, pwd);
    });

    // フォールバック用のURLからsid取得
    function getSessionIdFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('sid');
    }

    // ロビーからVJモード開始
    enterVjModeBtn.addEventListener('click', () => {
        if (sessions.size === 0) return;
        
        if (lobbyPollInterval) clearInterval(lobbyPollInterval);
        loginScreen.classList.add('hidden');
        mainApp.classList.remove('hidden');
        
        // ロビーコードをヘッダーに常時表示
        if (currentLobbyCode) {
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
        initSearchButtons();
        initCopyableToSearchInput();
    });

    // ----------------------------------------------------
    // 2. Pusher インスタンスの取得 (単一管理)
    // ----------------------------------------------------
    async function getPusher() {
        await fetchAppConfig();
        if (!pusherInstance) {
            if (!PUSHER_APP_KEY || PUSHER_APP_KEY === 'YOUR_PUSHER_APP_KEY') {
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
        if (currentLobbyCode) {
            setupLobbySubscription(currentLobbyCode);
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/action.php?action=create_lobby`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                currentLobbyCode = data.lobbyCode;
                lobbyCodeDisplay.textContent = currentLobbyCode;
                saveLobbyCode(currentLobbyCode);
                setupLobbySubscription(currentLobbyCode);
            } else {
                alert("ロビーの作成に失敗しました: " + (data.error || ''));
            }
        } catch (e) {
            alert("ロビー通信エラー: " + e.message);
        }
    }

    async function resumeLobby(code) {
        try {
            const res = await fetch(`${API_BASE}/action.php?action=poll_lobby`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lobbyCode: code })
            });
            const data = await res.json();
            if (data.success) {
                setupLobbySubscription(code);
                if (Array.isArray(data.sessions)) {
                    data.sessions.forEach(s => handlePushedSession(s.vjUrl, s.djName));
                }
            } else {
                // 期限切れや削除済みの場合はローカルストレージもクリア
                clearLobbyCode();
            }
        } catch (e) {
            console.error("ロビー復元通信エラー", e);
        }
    }

    async function setupLobbySubscription(code) {
        const pusher = await getPusher();
        // 既に購読済みならスキップ
        if (pusher.channel(`lobby-${code}`)) return;

        const lobbyChannel = pusher.subscribe(`lobby-${code}`);
        lobbyChannel.bind('session-pushed', (eventData) => {
            if (eventData.vjUrl) {
                handlePushedSession(eventData.vjUrl, eventData.djName);
            }
        });

        if (lobbyPollInterval) clearInterval(lobbyPollInterval);
        lobbyPollInterval = setInterval(() => {
            pollLobbySessions(code);
        }, 30000);
    }

    async function pollLobbySessions(code) {
        if (!code) return;
        try {
            const res = await fetch(`${API_BASE}/action.php?action=poll_lobby`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lobbyCode: code })
            });
            const data = await res.json();
            if (data.success && Array.isArray(data.sessions)) {
                data.sessions.forEach(s => handlePushedSession(s.vjUrl, s.djName));
            } else if (!data.success && (data.error.includes('expired') || data.error.includes('not found') || data.error.includes('deleted'))) {
                clearLobbyCode();
                if (lobbyPollInterval) clearInterval(lobbyPollInterval);
            }
        } catch (e) {
            console.error("ロビーポーリングエラー", e);
        }
    }

    async function handlePushedSession(vjUrl, djName) {
        try {
            const parsed = parseVjUrl(vjUrl);
            if (!parsed || !parsed.sid || !parsed.vp) return;

            if (sessions.has(parsed.sid)) return;

            const loginRes = await fetch(`${API_BASE}/action.php?action=login&role=vj`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: parsed.sid, password: parsed.vp })
            });
            const data = await loginRes.json();
            if (data.success) {
                addSession(parsed.sid, parsed.vp, data, djName);
                
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
    async function autoLogin(sid, vp, customDjName = null) {
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
                if (cleanUrl.searchParams.has('vp')) {
                    cleanUrl.searchParams.delete('vp');
                    history.replaceState(null, '', cleanUrl.toString());
                }

                addSession(sid, vp, data, customDjName);
                
                // 初回ログイン処理（UI切り替え）
                if (loginScreen.classList.contains('hidden') === false && lobbyScreen.classList.contains('hidden') === true) {
                    loginScreen.classList.add('hidden');
                    mainApp.classList.remove('hidden');
                    switchSession(sid);
                    initSearchButtons();
                    initCopyableToSearchInput();

                    // ヘッダーにロビーコードを表示（ログイン完了が早いとここで処理しないと漏れるため）
                    if (currentLobbyCode) {
                        const headerCodeTag = document.getElementById('headerLobbyCodeTag');
                        const headerCodeValue = document.getElementById('headerLobbyCodeValue');
                        if (headerCodeTag && headerCodeValue) {
                            headerCodeValue.textContent = currentLobbyCode;
                            headerCodeTag.classList.remove('hidden');
                        }
                    }
                }
            } else {
                const errBox = document.getElementById('loginError');
                if (errBox) {
                    errBox.style.display = 'block';
                    errBox.textContent = data.error || 'ログインエラー';
                }
                // 有効期限切れ等はローカルストレージから削除してクリーンアップ
                if (data.error && (data.error.includes('expired') || data.error.includes('not found') || data.error.includes('deleted') || data.error.includes('Invalid password'))) {
                    removeSavedSessionBySid(sid);
                }
            }
        } catch (e) {
            console.error("ログイン通信エラー", e);
        }
    }

    async function addSession(sessionId, password, loginData, customDjName = null) {
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
                sentIdx: loginData.state.sentIdx,
                customTrack: loginData.state.customTrack || null
            },
            hasUnread: false
        };

        const pusher = await getPusher();
        const channel = pusher.subscribe(`session-${sessionId}`);
        sessionObj.channel = channel;

        channel.bind('state-updated', (data) => {
            if (data.action === 'send') {
                sessionObj.state.sentIdx = data.sentIdx;
                sessionObj.state.customTrack = data.customTrack || null;
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
        saveSessions();
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

    async function removeSession(sessionId) {
        const sessionObj = sessions.get(sessionId);
        if (!sessionObj) return;

        if (!confirm(`「${sessionObj.djName}」のセッションを削除しますか？`)) return;

        if (sessionObj.channel) {
            const pusher = await getPusher();
            pusher.unsubscribe(`session-${sessionId}`);
        }
        sessions.delete(sessionId);
        saveSessions();

        if (sessions.size > 0) {
            const nextSid = Array.from(sessions.keys())[0];
            switchSession(nextSid);
        } else {
            mainApp.classList.add('hidden');
            loginScreen.classList.remove('hidden');
            modeSelectPanel.classList.remove('hidden');
            lobbyScreen.classList.add('hidden');
            directLoginForm.classList.add('hidden');
            if (currentLobbyCode) {
                // モード選択に戻った際にもLobbyを開いた状態にする
                modeSelectPanel.classList.add('hidden');
                lobbyScreen.classList.remove('hidden');
            }
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

            tab.addEventListener('click', (e) => {
                if (e.target.classList.contains('close-btn')) {
                    e.stopPropagation();
                    removeSession(sid);
                } else {
                    switchSession(sid);
                }
            });

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
        if (currentLobbyCode) {
            const headerCodeTag = document.getElementById('headerLobbyCodeTag');
            const headerCodeValue = document.getElementById('headerLobbyCodeValue');
            if (headerCodeTag && headerCodeValue) {
                headerCodeValue.textContent = currentLobbyCode;
                headerCodeTag.classList.remove('hidden');
            }
        }

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
            const itemTop = activeItem.offsetTop;
            const itemHeight = activeItem.offsetHeight;
            const containerHeight = playlistContainer.clientHeight;
            playlistContainer.scrollTo({
                top: Math.max(0, itemTop - (containerHeight / 2) + (itemHeight / 2)),
                behavior: 'smooth'
            });
        }
    }

    function applyMarquee(el, text) {
        if (!el) return;
        el.textContent = text;
        el.classList.remove('is-marquee');
        el.style.transform = 'translateX(0)';
        
        requestAnimationFrame(() => {
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

        const { tracks, nowPlayingIdx, sentIdx, customTrack } = current.state;

        const sendTitleEl = document.getElementById('sendTitle');
        const sendArtistEl = document.getElementById('sendArtist');
        const sendTrackBox = document.getElementById('sendTrackBox');
        const sendLabelEl = sendTrackBox ? sendTrackBox.querySelector('.label') : null;

        // Vibes! バッジ表示制御
        let vibesBadge = document.getElementById('vjVibesBadge');
        if (customTrack && (sentIdx === -2 || customTrack.isVibes)) {
            if (!vibesBadge && sendLabelEl) {
                vibesBadge = document.createElement('span');
                vibesBadge.id = 'vjVibesBadge';
                vibesBadge.className = 'badge-vibes';
                vibesBadge.textContent = '[Vibes!]';
                sendLabelEl.appendChild(vibesBadge);
            }
            if (vibesBadge) vibesBadge.style.display = 'inline-block';

            applyMarquee(sendTitleEl, customTrack.title);
            applyMarquee(sendArtistEl, customTrack.artist);
        } else {
            if (vibesBadge) vibesBadge.style.display = 'none';
            const targetSentIdx = (sentIdx >= 0) ? sentIdx : 0;
            const sentTrack = tracks[targetSentIdx];
            if (sentTrack) {
                applyMarquee(sendTitleEl, sentTrack.title);
                applyMarquee(sendArtistEl, sentTrack.artist);
            } else {
                applyMarquee(sendTitleEl, "-");
                applyMarquee(sendArtistEl, "-");
            }
        }

        // プレイリスト上の次の曲 (Next in Playlist)
        // 手入力 (sentIdx === -2) の場合でも、進行中・直前の nowPlayingIdx + 1 の予定曲を維持
        let nextIdx = (sentIdx >= 0) ? sentIdx + 1 : nowPlayingIdx + 1;
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
        const mainApp = document.getElementById('mainApp');
        const container = document.querySelector('.container');
        const panels = document.querySelectorAll('.glass-panel');

        document.body.classList.remove('is-flashing-danger', 'is-flashing-success');
        if (mainApp) mainApp.classList.remove('is-flashing-danger', 'is-flashing-success');
        if (container) container.classList.remove('is-flashing-danger', 'is-flashing-success');
        if (sendBox) sendBox.classList.remove('is-flashing-danger', 'is-flashing-success');
        panels.forEach(p => p.classList.remove('is-flashing-danger', 'is-flashing-success'));
        
        void document.body.offsetWidth;

        document.body.classList.add(className);
        if (mainApp) mainApp.classList.add(className);
        if (container) container.classList.add(className);
        if (sendBox) sendBox.classList.add(className);
        panels.forEach(p => p.classList.add(className));

        setTimeout(() => {
            document.body.classList.remove(className);
            if (mainApp) mainApp.classList.remove(className);
            if (container) container.classList.remove(className);
            if (sendBox) sendBox.classList.remove(className);
            panels.forEach(p => p.classList.remove(className));
        }, 5000);
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
            if (el.dataset.bound) return;
            el.dataset.bound = true;
            
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
});
