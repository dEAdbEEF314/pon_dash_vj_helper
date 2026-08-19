document.addEventListener('DOMContentLoaded', async () => {
    await fetchAppConfig();

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
    const recoveryKey = 'pdvh.vj.sessions';

    // セッション Map<sessionId, SessionObject>
    const sessions = new Map();
    const processingSessionIds = new Set();
    const lobbyKnownTokens = new Map();
    let activeSessionId = null;

    // --- LocalStorage ヘルパー ---
    function saveLobbyCode(code) {
        localStorage.setItem('vjLobbyCode', code);
        localStorage.setItem('vjLobbyCodeSavedAt', String(Date.now()));
    }
    function clearLobbyCode() {
        localStorage.removeItem('vjLobbyCode');
        localStorage.removeItem('vjLobbyCodeSavedAt');
        currentLobbyCode = null;
    }
    function saveSessions() {
        const expiresAt = Date.now() + SESSION_LIFETIME * 1000;
        const saved = Array.from(sessions.values()).map(session => ({
            sessionId: session.sessionId,
            djName: session.djName,
            expiresAt
        }));
        localStorage.setItem(recoveryKey, JSON.stringify(saved));
    }
    function loadSavedSessions() {
        try {
            const saved = JSON.parse(localStorage.getItem(recoveryKey) || '[]');
            const valid = Array.isArray(saved) ? saved.filter(item => item.expiresAt > Date.now()) : [];
            localStorage.setItem(recoveryKey, JSON.stringify(valid));
            return valid;
        } catch (error) {
            localStorage.removeItem(recoveryKey);
            return [];
        }
    }
    function removeSavedSessionBySid(sid) {
        const saved = loadSavedSessions().filter(item => item.sessionId !== sid);
        localStorage.setItem(recoveryKey, JSON.stringify(saved));
    }

    // ----------------------------------------------------
    // 0. 初期判定 (URLパラメータ & LocalStorage復元)
    // ----------------------------------------------------
    const urlParams = new URLSearchParams(window.location.search);
    const initialSid = urlParams.get('sid');
    const savedRecoverySessions = loadSavedSessions();
    let recoverySessionId = initialSid || savedRecoverySessions[0]?.sessionId || null;

    // 保存されているLobbyの復元
    const savedLobbyCode = localStorage.getItem('vjLobbyCode');
    const savedLobbyAt = Number(localStorage.getItem('vjLobbyCodeSavedAt') || 0);
    if (savedLobbyCode && savedLobbyAt > 0 && Date.now() - savedLobbyAt <= SESSION_LIFETIME * 1000) {
        currentLobbyCode = savedLobbyCode;
        lobbyCodeDisplay.textContent = currentLobbyCode;
        updateVdjRegisterLink();
        // 有効か確認しつつポーリング開始
        resumeLobby(savedLobbyCode);
    } else if (savedLobbyCode) {
        clearLobbyCode();
    }

    if (!initialSid && savedRecoverySessions.length > 0) {
        modeSelectPanel.classList.add('hidden');
        directLoginForm.classList.remove('hidden');
    }

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

    function updateVdjRegisterLink() {
        const link = document.getElementById('vdjRegisterLink');
        if (link && currentLobbyCode) {
            link.href = `dj-register.html?lobby=${encodeURIComponent(currentLobbyCode)}`;
        }
    }

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
        const sid = recoverySessionId || getSessionIdFromUrl();
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
            const data = await apiRequest('action.php?action=create_lobby', { method: 'POST' });
            if (data.success) {
                currentLobbyCode = data.lobbyCode;
                lobbyCodeDisplay.textContent = currentLobbyCode;
                updateVdjRegisterLink();
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
            await pollLobbySessions(code, true);
            if (currentLobbyCode) setupLobbySubscription(code);
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
            if (eventData.sessionId && eventData.inviteToken) {
                lobbyKnownTokens.set(
                    eventData.sessionId,
                    eventData.inviteTokenHash || ''
                );
                handlePushedSession(
                    eventData.sessionId,
                    eventData.inviteToken,
                    eventData.djName
                );
            }
        });
        lobbyChannel.bind('session-replaced', (eventData) => {
            if (!eventData.sessionId || !eventData.inviteToken) return;
            lobbyKnownTokens.set(
                eventData.sessionId,
                eventData.inviteTokenHash || ''
            );
            reauthenticateReplacedSession(eventData);
        });
        lobbyChannel.bind('session-removed', (eventData) => {
            if (!eventData.sessionId) return;
            lobbyKnownTokens.delete(eventData.sessionId);
            removeSessionLocally(eventData.sessionId);
        });

        if (lobbyPollInterval) clearInterval(lobbyPollInterval);
        lobbyPollInterval = setInterval(() => {
            pollLobbySessions(code);
        }, 30000);
    }

    async function pollLobbySessions(code, isInitial = false) {
        if (!code) return;
        try {
            const knownSessionIds = Array.from(lobbyKnownTokens.keys());
            const knownTokenHashes = Object.fromEntries(lobbyKnownTokens);
            const data = await apiRequest('action.php?action=poll_lobby', {
                method: 'POST',
                body: JSON.stringify({
                    lobbyCode: code,
                    knownSessionIds,
                    knownTokenHashes
                })
            });
            if (!data.success) return;

            const added = Array.isArray(data.added) ? data.added : [];
            const removed = Array.isArray(data.removedSessionIds)
                ? data.removedSessionIds
                : [];
            await Promise.all(added.map(s => {
                lobbyKnownTokens.set(s.sessionId, s.inviteTokenHash || '');
                return handlePushedSession(s.sessionId, s.inviteToken, s.djName);
            }));

            removed.forEach((sid) => {
                lobbyKnownTokens.delete(sid);
                if (sessions.has(sid)) removeSessionLocally(sid);
            });

            if (isInitial && added.length === 0 && removed.length === 0) {
                renderLobbySessions();
            }
        } catch (e) {
            if (e.status === 404 || /expired|not found|deleted/i.test(e.message)) {
                clearLobbyCode();
                if (lobbyPollInterval) clearInterval(lobbyPollInterval);
            }
            console.error("ロビーポーリングエラー", e);
        }
    }

    // BUG FIX: 一覧と件数をsessionsから同時に再描画し、非同期登録前の件数読み取りを防止する。
    function renderLobbySessions() {
        if (!lobbySessionList || !lobbySessionCount) return;

        lobbySessionList.innerHTML = '';
        sessions.forEach((session) => {
            const item = document.createElement('div');
            item.style.cssText = "display: flex; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.85rem;";

            const accountLabel = document.createElement('span');
            accountLabel.style.cssText = 'font-weight: bold; color: #00ffcc;';
            accountLabel.textContent = `🎧 ${session.djName || 'DJ'}`;

            const linkedLabel = document.createElement('span');
            linkedLabel.style.color = '#64748b';
            linkedLabel.textContent = '連携済み';
            item.append(accountLabel, linkedLabel);
            lobbySessionList.appendChild(item);
        });

        lobbySessionCount.textContent = String(sessions.size);
        if (lobbyEmptyMsg) {
            lobbyEmptyMsg.style.display = sessions.size === 0 ? '' : 'none';
            if (sessions.size === 0) lobbySessionList.appendChild(lobbyEmptyMsg);
        }
        if (enterVjModeBtn) enterVjModeBtn.disabled = sessions.size === 0;
    }

    // BUG FIX: Pusher通知とポーリングの同時到着による同一セッションの二重ログインを防止する。
    async function reauthenticateReplacedSession(eventData) {
        const sessionId = eventData.sessionId;
        const current = sessions.get(sessionId);
        if (!current) {
            await handlePushedSession(
                sessionId,
                eventData.inviteToken,
                eventData.djName
            );
            return;
        }
        try {
            const data = await apiRequest('action.php?action=login&role=vj', {
                method: 'POST',
                body: JSON.stringify({ sessionId, inviteToken: eventData.inviteToken })
            });
            if (!data.success) throw new Error(data.error || '再認証に失敗しました');
            current.token = data.token;
            current.state.tracks = data.state.tracks;
            current.state.nowPlayingIdx = data.state.nowPlayingIdx;
            current.state.sentIdx = data.state.sentIdx;
            current.state.customTrack = data.state.customTrack || null;
            current.state.stateVersion = Number.isInteger(data.state.stateVersion)
                ? data.state.stateVersion
                : 0;
            current.state.vjReady = false;
            current.state.readyForVersion = null;
            if (activeSessionId === sessionId) {
                renderPlaylist();
                updateDisplay();
            }
        } catch (error) {
            console.warn('置換セッションの再認証に失敗しました', error);
            removeSessionLocally(sessionId);
        }
    }

    async function handlePushedSession(sessionId, inviteToken, djName) {
        if (!sessionId || !inviteToken || sessions.has(sessionId) || processingSessionIds.has(sessionId)) return;

        processingSessionIds.add(sessionId);
        try {
            const data = await apiRequest('action.php?action=login&role=vj', {
                method: 'POST',
                body: JSON.stringify({ sessionId, inviteToken })
            });
            if (data.success) {
                await addSession(sessionId, null, data, djName);
                renderLobbySessions();
            }
        } catch (e) {
            console.error("ロビーセッション追加エラー", e);
        } finally {
            processingSessionIds.delete(sessionId);
        }
    }

    // ----------------------------------------------------
    // 4. パスワードログイン & セッション追加
    // ----------------------------------------------------
    async function autoLogin(sid, vp, customDjName = null) {
        try {
            const data = await apiRequest('action.php?action=login&role=vj', {
                method: 'POST',
                body: JSON.stringify({ sessionId: sid, password: vp })
            });
                if (data.success) {
                // 旧形式URLに残るvpパラメータをブラウザ履歴から除去
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
                customTrack: loginData.state.customTrack || null,
                stateVersion: Number.isInteger(loginData.state.stateVersion)
                    ? loginData.state.stateVersion
                    : 0,
                vjReady: false,
                readyForVersion: null
            },
            hasUnread: false
        };

        const pusher = await getPusher();
        const channel = pusher.subscribe(`session-${sessionId}`);
        sessionObj.channel = channel;

        channel.bind('state-updated', (data) => {
            if (!data || !Number.isInteger(data.stateVersion)) return;
            const currentVersion = sessionObj.state.stateVersion;

            if (data.action === 'rollback') {
                sessionObj.state.sentIdx = data.sentIdx;
                sessionObj.state.nowPlayingIdx = data.nowPlayingIdx;
                sessionObj.state.customTrack = data.customTrack || null;
                sessionObj.state.stateVersion = data.stateVersion;
                sessionObj.state.vjReady = false;
                sessionObj.state.readyForVersion = null;
            } else if (data.action === 'vj-ready') {
                if (data.stateVersion !== currentVersion
                    || data.readyForVersion !== currentVersion
                    || sessionObj.state.readyForVersion === data.readyForVersion) {
                    return;
                }
                sessionObj.state.vjReady = true;
                sessionObj.state.readyForVersion = data.readyForVersion;
                if (activeSessionId === sessionId) {
                    updateDisplay();
                    flashSendBox('is-flashing-success');
                }
                return;
            } else {
                if (data.stateVersion <= currentVersion) return;
                if (data.stateVersion !== currentVersion + 1) {
                    syncVjSession(sessionObj);
                    return;
                }
                if (data.action === 'send') {
                    sessionObj.state.sentIdx = data.sentIdx;
                    if (Object.prototype.hasOwnProperty.call(data, 'nowPlayingIdx')) {
                        sessionObj.state.nowPlayingIdx = data.nowPlayingIdx;
                    }
                    sessionObj.state.customTrack = data.customTrack || null;
                } else if (data.action === 'auto-next') {
                    sessionObj.state.nowPlayingIdx = data.nowPlayingIdx;
                } else {
                    return;
                }
                sessionObj.state.stateVersion = data.stateVersion;
                sessionObj.state.vjReady = false;
                sessionObj.state.readyForVersion = null;
            }

            if (activeSessionId === sessionId) {
                renderPlaylist();
                updateDisplay();
                if (data.action === 'send') flashSendBox('is-flashing-danger');
            } else {
                sessionObj.hasUnread = true;
                renderSessionTabs();
            }
        });
        channel.bind('session-removed', () => {
            if (sessions.has(sessionId)) removeSessionLocally(sessionId);
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

    function removeSessionLocally(sessionId) {
        const sessionObj = sessions.get(sessionId);
        if (!sessionObj) return;

        if (sessionObj.channel) {
            pusherInstance?.unsubscribe(`session-${sessionId}`);
        }
        sessions.delete(sessionId);
        if (activeSessionId === sessionId) activeSessionId = null;
        saveSessions();
        renderLobbySessions();

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

    async function removeSession(sessionId) {
        const sessionObj = sessions.get(sessionId);
        if (!sessionObj || !confirm(`「${sessionObj.djName}」のセッションを削除しますか？`)) return;

        try {
            await apiRequest('action.php?action=delete_session&role=vj', {
                method: 'POST',
                body: JSON.stringify({ sessionId, token: sessionObj.token })
            });
            removeSessionLocally(sessionId);
        } catch (error) {
            alert(`削除エラー: ${error.message}`);
        }
    }

    // ----------------------------------------------------
    // 6. UI描画 (セッションタブ, プレイリスト, ステータス)
    // ----------------------------------------------------
    // セッションタブ描画（差分更新対応）
    let lastRenderedSessionKeys = '';

    function renderSessionTabs() {
        const currentSessionKeys = Array.from(sessions.keys()).join('|');
        const needsFullRebuild = lastRenderedSessionKeys !== currentSessionKeys;

        if (needsFullRebuild) {
            sessionTabBar.innerHTML = '';
            
            sessions.forEach((sess, sid) => {
                const tab = document.createElement('div');
                tab.className = `session-tab ${sid === activeSessionId ? 'active' : ''}`;
                tab.dataset.sid = sid;

                const label = document.createElement('span');
                label.textContent = `🎧 ${sess.djName || 'DJ'}`;
                tab.appendChild(label);

                const unreadBadge = document.createElement('span');
                unreadBadge.className = 'badge-unread';
                unreadBadge.title = '新曲SEND受信';
                unreadBadge.style.display = (sess.hasUnread && sid !== activeSessionId) ? 'inline-block' : 'none';
                tab.appendChild(unreadBadge);

                const closeButton = document.createElement('span');
                closeButton.className = 'close-btn';
                closeButton.title = '削除';
                closeButton.textContent = '×';
                tab.appendChild(closeButton);

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

            lastRenderedSessionKeys = currentSessionKeys;
        } else {
            // 差分更新: active クラスと未読バッジの切り替えのみ
            const tabs = sessionTabBar.querySelectorAll('.session-tab');
            tabs.forEach((tab) => {
                const sid = tab.dataset.sid;
                const sess = sessions.get(sid);
                if (!sess) return;

                if (sid === activeSessionId) {
                    tab.classList.add('active');
                } else {
                    tab.classList.remove('active');
                }

                const badge = tab.querySelector('.badge-unread');
                if (badge) {
                    badge.style.display = (sess.hasUnread && sid !== activeSessionId) ? 'inline-block' : 'none';
                }
            });
        }
    }

    // 前回描画時のトラック数を保持（差分更新判定用）
    let lastRenderedTrackCount = -1;
    let lastRenderedSessionId = null;

    function renderPlaylist() {
        const current = sessions.get(activeSessionId);
        if (!current) return;
        if (currentLobbyCode) {
            const headerCodeTag = document.getElementById('headerLobbyCodeTag');
            const headerCodeValue = document.getElementById('headerLobbyCodeValue');
            if (headerCodeTag && headerCodeValue) {
                headerCodeValue.textContent = currentLobbyCode;
                headerCodeTag.classList.remove('hidden');
            }
        }

        const { tracks, nowPlayingIdx, sentIdx } = current.state;

        // トラックリストが変更された場合のみ全再構築（セッション切替 or トラック数変動）
        const needsFullRebuild = lastRenderedSessionId !== activeSessionId
            || lastRenderedTrackCount !== tracks.length
            || playlistContainer.children.length !== tracks.length;

        if (needsFullRebuild) {
            playlistContainer.innerHTML = '';
            tracks.forEach((track, i) => {
                const item = document.createElement('div');
                item.className = 'playlist-item';

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
            lastRenderedTrackCount = tracks.length;
            lastRenderedSessionId = activeSessionId;
        }

        // クラス・スタイルのみ差分更新（DOM再構築なし）
        for (let i = 0; i < playlistContainer.children.length; i++) {
            const item = playlistContainer.children[i];
            // クラスをリセット
            item.className = 'playlist-item';
            item.style.borderLeft = '';
            item.style.background = '';

            if (i < nowPlayingIdx) item.classList.add('played');
            if (i === nowPlayingIdx) item.style.borderLeft = '3px solid #fff';
            if (i === sentIdx) {
                item.style.borderLeft = '3px solid var(--danger-color, #ff3366)';
                item.style.background = 'rgba(255, 51, 102, 0.1)';
            }
        }

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
        const normalizedText = String(text ?? '');
        if (el.dataset.lastMarqueeText === normalizedText) return;
        el.dataset.lastMarqueeText = normalizedText;

        el.textContent = normalizedText;
        el.classList.remove('is-marquee');
        el.style.transform = 'translateX(0)';
        
        requestAnimationFrame(() => {
            if (el.parentElement && el.scrollWidth > el.parentElement.clientWidth) {
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

        const readyBadge = document.getElementById('vjReadyBadge');
        if (readyBadge) {
            readyBadge.style.display = current.state.vjReady ? 'inline-block' : 'none';
        }

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
        document.body.classList.remove('is-flashing-danger', 'is-flashing-success');
        void document.body.offsetWidth; // reflow強制でアニメーション再発火

        document.body.classList.add(className);

        setTimeout(() => {
            document.body.classList.remove(className);
        }, 3000);
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
                    window.open(url, '_blank', 'noopener,noreferrer');
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
        const vp = modalVpInput.value.trim();
        if (!parsed || !parsed.sid || !vp) {
            alert("VJ用URLをペーストし、VJ用パスワードを手動入力してください。");
            return;
        }
        await autoLogin(parsed.sid, vp);
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
            return { sid };
        } catch(e) {
            return null;
        }
    }

    function escapeHtml(str) {
        return (str || '').replace(/[&<>"']/g, (m) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[m]);
    }

    async function syncVjSession(sessionObj) {
        if (!sessionObj || sessionObj.syncInFlight) return;
        sessionObj.syncInFlight = true;
        try {
            const data = await apiRequest('action.php?action=sync&role=vj', {
                method: 'POST',
                body: JSON.stringify({ sessionId: sessionObj.sessionId, token: sessionObj.token })
            });
            if (!data.state || !Number.isInteger(data.state.stateVersion)) {
                throw new Error('Invalid VJ sync state');
            }
            const previousVersion = sessionObj.state.stateVersion;
            sessionObj.state.tracks = data.state.tracks;
            sessionObj.state.nowPlayingIdx = data.state.nowPlayingIdx;
            sessionObj.state.sentIdx = data.state.sentIdx;
            sessionObj.state.customTrack = data.state.customTrack || null;
            sessionObj.state.stateVersion = data.state.stateVersion;
            if (previousVersion !== sessionObj.state.stateVersion) {
                sessionObj.state.vjReady = false;
                sessionObj.state.readyForVersion = null;
            }
            if (activeSessionId === sessionObj.sessionId) {
                renderPlaylist();
                updateDisplay();
            }
        } catch (error) {
            console.warn('VJ状態同期に失敗しました', error);
            sessionObj.syncRetryOnReconnect = true;
        } finally {
            sessionObj.syncInFlight = false;
        }
    }

    // READYボタン処理
    const readyBtn = document.getElementById('readyBtn');
    if (readyBtn) {
        readyBtn.addEventListener('click', async () => {
            const current = sessions.get(activeSessionId);
            if (!current || current.state.readyForVersion === current.state.stateVersion) return;
            try {
                const response = await apiRequest('action.php?action=ready&role=vj', {
                    method: 'POST',
                    body: JSON.stringify({
                        sessionId: current.sessionId,
                        token: current.token,
                        readyForVersion: current.state.stateVersion
                    })
                });
                if (response.action === 'vj-ready'
                    && response.readyForVersion === current.state.stateVersion) {
                    current.state.vjReady = true;
                    current.state.readyForVersion = response.readyForVersion;
                    updateDisplay();
                    flashSendBox('is-flashing-success');
                }
            } catch(e) {
                console.error("READY送信エラー", e);
            }
        });
    }
});
