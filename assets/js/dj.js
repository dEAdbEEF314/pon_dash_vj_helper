document.addEventListener('DOMContentLoaded', async () => {
    await fetchAppConfig();

    window.flashScreen = function flashScreen(className) {
        document.body.classList.remove('is-flashing-danger', 'is-flashing-success');
        void document.body.offsetWidth; // reflow強制でアニメーション再発火

        document.body.classList.add(className);

        setTimeout(() => {
            document.body.classList.remove(className);
        }, 3000);
    };


    const recoveryKey = 'pdvh.dj.session';
    let savedRecovery = null;
    try {
        savedRecovery = JSON.parse(localStorage.getItem(recoveryKey) || 'null');
    } catch (error) {
        localStorage.removeItem(recoveryKey);
    }
    const savedSessionId = savedRecovery && savedRecovery.expiresAt > Date.now() ? savedRecovery.sessionId : null;
    if (!savedSessionId) localStorage.removeItem(recoveryKey);
    const sessionId = getSessionIdFromUrl() || savedSessionId;
    if (!sessionId) {
        alert("無効なURLです。事前登録ページからURLを取得してください。");
        return;
    }

    const loginForm = document.getElementById('loginForm');
    const mainApp = document.getElementById('mainApp');
    const loginScreen = document.getElementById('loginScreen');
    const playlistContainer = document.getElementById('playlistContainer');
    
    let state = {
        tracks: [],
        nowPlayingIdx: 0,
        selectedIdx: -1,
        sentIdx: -1,
        customTrack: null,
        stateVersion: 0,
        vjReadyForVersion: null
    };
    let syncInFlight = false;
    let syncRetryOnReconnect = false;
    let syncRequired = false;
    let pendingStateEvents = [];
    let pusherConnection = null;

    let token = '';

    let requestInFlight = false;
    document.getElementById('deleteSessionBtn').addEventListener('click', async () => {
        if (requestInFlight || !token || !confirm('このセッションとプレイリストを削除しますか？')) return;
        requestInFlight = true;
        try {
            await apiRequest('action.php?action=delete_session&role=dj', {
                method: 'POST',
                body: JSON.stringify({ sessionId, token })
            });
            localStorage.removeItem(recoveryKey);
            window.location.href = 'index.html';
        } catch (error) {
            alert(`削除エラー: ${error.message}`);
        } finally {
            requestInFlight = false;
        }
    });

    // ログイン処理
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('password').value;
        
        try {
            const data = await apiRequest('action.php?action=login&role=dj', {
                method: 'POST',
                body: JSON.stringify({ sessionId, password: pwd })
            });
            if (data.success) {
                token = data.token; // 認証トークン
                localStorage.setItem(recoveryKey, JSON.stringify({
                    sessionId,
                    accountName: data.state.accountName,
                    expiresAt: Date.now() + SESSION_LIFETIME * 1000
                }));
                loginScreen.classList.add('hidden');
                mainApp.classList.remove('hidden');
                document.getElementById('sessionNameDisplay').textContent = "Playlist: " + data.state.accountName;
                initState(data.state);
                initPusher();
                initTabs();
                initCopyableToSearchInput();
                initDjSearchButtons();
                initVibesModal();
            } else {
                document.getElementById('loginError').style.display = 'block';
            }
        } catch(e) {
            alert("ログインエラー: " + e.message);
        }
    });

    // 初期状態セット
    function initState(serverState, preserveReady = false) {
        const previousReady = state.vjReadyForVersion;
        state.tracks = serverState.tracks;
        state.nowPlayingIdx = serverState.nowPlayingIdx;
        state.sentIdx = serverState.sentIdx;
        state.customTrack = serverState.customTrack || null;
        state.stateVersion = Number.isInteger(serverState.stateVersion) ? serverState.stateVersion : 0;
        state.vjReadyForVersion = preserveReady ? previousReady : null;
        if (!preserveReady) resetReady();
        renderPlaylist();
        updateDisplay();
    }

    function resetReady() {
        state.vjReadyForVersion = null;
        const badge = document.getElementById('vjReadyBadge');
        const sendBox = document.getElementById('sendTrackBox');
        if (badge) badge.style.display = 'none';
        if (sendBox) sendBox.classList.remove('vj-ready-highlight');
    }

    function applyStateEvent(data) {
        if (!data || !Number.isInteger(data.stateVersion)) return false;

        if (data.action === 'rollback') {
            const versionChanged = data.stateVersion !== state.stateVersion;
            state.sentIdx = data.sentIdx;
            state.nowPlayingIdx = data.nowPlayingIdx;
            state.customTrack = data.customTrack || null;
            state.stateVersion = data.stateVersion;
            if (versionChanged) {
                resetReady();
            } else if (state.vjReadyForVersion !== state.stateVersion) {
                resetReady();
            }
            renderPlaylist();
            updateDisplay();
            return true;
        }

        if (data.stateVersion <= state.stateVersion) return true;
        if (data.stateVersion !== state.stateVersion + 1) return false;

        if (data.action === 'send') {
            state.sentIdx = data.sentIdx;
            if (Object.prototype.hasOwnProperty.call(data, 'nowPlayingIdx')) {
                state.nowPlayingIdx = data.nowPlayingIdx;
            }
            state.customTrack = data.customTrack || null;
            state.stateVersion = data.stateVersion;
            resetReady();
        } else if (data.action === 'auto-next') {
            state.nowPlayingIdx = data.nowPlayingIdx;
            state.stateVersion = data.stateVersion;
            resetReady();
        } else {
            return false;
        }

        renderPlaylist();
        updateDisplay();
        return true;
    }

    function queueStateEvent(data) {
        if (data && Number.isInteger(data.stateVersion)) {
            pendingStateEvents.push(data);
        }
    }

    async function drainPendingStateEvents() {
        const events = pendingStateEvents
            .sort((a, b) => a.stateVersion - b.stateVersion);
        pendingStateEvents = [];

        for (const event of events) {
            if (syncRequired || syncInFlight) {
                queueStateEvent(event);
                return;
            }
            if (!applyStateEvent(event)) {
                syncRequired = true;
                queueStateEvent(event);
                await syncState();
                return;
            }
        }
    }

    async function syncState() {
        if (syncInFlight) return;
        syncInFlight = true;
        syncRequired = true;
        try {
            const data = await apiRequest('action.php?action=sync&role=dj', {
                method: 'POST',
                body: JSON.stringify({ sessionId, token })
            });
            if (!data.state || !Number.isInteger(data.state.stateVersion)) {
                throw new Error('Invalid sync state');
            }

            const previousVersion = state.stateVersion;
            initState(data.state, data.state.stateVersion === previousVersion);
            syncRetryOnReconnect = false;
            syncRequired = false;
            await drainPendingStateEvents();
        } catch (error) {
            syncRetryOnReconnect = true;
            console.warn('同期に失敗しました。Pusher復旧時に再試行します。', error);
        } finally {
            syncInFlight = false;
        }
    }

    // プレイリスト描画（差分更新: トラック数変更時のみ全再構築）
    let lastDjRenderedTrackCount = -1;

    function renderPlaylist() {
        const needsFullRebuild = lastDjRenderedTrackCount !== state.tracks.length
            || playlistContainer.children.length !== state.tracks.length;

        if (needsFullRebuild) {
            playlistContainer.innerHTML = '';
            state.tracks.forEach((track, i) => {
                const item = document.createElement('div');
                item.className = 'playlist-item';

                // XSS対策: innerHTML ではなく textContent を使用 (H-1)
                const pTitle = document.createElement('div');
                pTitle.className = 'p-title';
                pTitle.textContent = `${i + 1}. ${track.title}`;
                const pArtist = document.createElement('div');
                pArtist.className = 'p-artist';
                pArtist.textContent = track.artist;
                item.appendChild(pTitle);
                item.appendChild(pArtist);

                item.addEventListener('click', () => {
                    // すでに再生済みの曲より前の曲は選択不可にしてもよいが、今回は自由選択とする
                    state.selectedIdx = i;
                    renderPlaylist();
                    updateDisplay();
                });

                playlistContainer.appendChild(item);
            });
            lastDjRenderedTrackCount = state.tracks.length;
        }

        // クラスのみ差分更新（DOM再構築なし）
        for (let i = 0; i < playlistContainer.children.length; i++) {
            const item = playlistContainer.children[i];
            item.className = 'playlist-item';
            if (i < state.nowPlayingIdx) item.classList.add('played');
            if (i === state.selectedIdx) item.classList.add('selected');
        }

        // スクロール位置の自動調整（現在再生中へ、コンテナ外部スクロール防止）
        const activeItem = playlistContainer.children[state.nowPlayingIdx];
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

    // 左右往復スクロール適用（テキスト差分ガード付きでレイアウトスラッシングを防止）
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

    // 表示更新
    function updateDisplay() {
        // 1. Now Playing (UIから削除済みのため変数取得のみ)
        const nowTrack = state.tracks[state.nowPlayingIdx];

        // 3. SEND to VJ (Preview) - タップされた曲のみ表示、未選択時は次に送信予定の曲（初回アクセス時は1曲目）
        const previewTitleEl = document.getElementById('previewTitle');
        const previewArtistEl = document.getElementById('previewArtist');
        const defaultNextIdx = (state.sentIdx === -1) ? 0 : state.nowPlayingIdx + 1;
        const nextPlaylistTrack = state.tracks[defaultNextIdx];
        if (state.selectedIdx !== -1) {
            const previewTrack = state.tracks[state.selectedIdx];
            applyMarquee(previewTitleEl, previewTrack.title);
            applyMarquee(previewArtistEl, previewTrack.artist);
        } else if (nextPlaylistTrack) {
            // 未選択時はデフォルトの曲を表示（初回は1曲目、以降は次の曲）
            applyMarquee(previewTitleEl, nextPlaylistTrack.title);
            applyMarquee(previewArtistEl, nextPlaylistTrack.artist);
        } else {
            applyMarquee(previewTitleEl, "-");
            applyMarquee(previewArtistEl, "-");
        }

        // 4. Sent to VJ (SENDボタンで送信された曲)
        const sendTitleEl = document.getElementById('sendTitle');
        const sendArtistEl = document.getElementById('sendArtist');
        const vjSearchTitleEl = document.getElementById('vjSearchSendTitle');
        const vjSearchArtistEl = document.getElementById('vjSearchSendArtist');
        const sendTrackLabel = document.getElementById('sendTrackLabel');

        // Vibes! バッジ表示管理
        let vibesBadge = document.getElementById('djVibesBadge');
        if (state.customTrack && (state.sentIdx === -2 || state.customTrack.isVibes)) {
            if (!vibesBadge && sendTrackLabel) {
                vibesBadge = document.createElement('span');
                vibesBadge.id = 'djVibesBadge';
                vibesBadge.className = 'badge-vibes';
                vibesBadge.textContent = '[Vibes!]';
                sendTrackLabel.appendChild(vibesBadge);
            }
            if (vibesBadge) vibesBadge.style.display = 'inline-block';

            applyMarquee(sendTitleEl, state.customTrack.title);
            applyMarquee(sendArtistEl, state.customTrack.artist);
            if (vjSearchTitleEl) applyMarquee(vjSearchTitleEl, state.customTrack.title);
            if (vjSearchArtistEl) applyMarquee(vjSearchArtistEl, state.customTrack.artist);
        } else {
            if (vibesBadge) vibesBadge.style.display = 'none';
            const sentTrack = state.tracks[state.sentIdx];
            if (sentTrack) {
                applyMarquee(sendTitleEl, sentTrack.title);
                applyMarquee(sendArtistEl, sentTrack.artist);
                if (vjSearchTitleEl) applyMarquee(vjSearchTitleEl, sentTrack.title);
                if (vjSearchArtistEl) applyMarquee(vjSearchArtistEl, sentTrack.artist);
            } else {
                applyMarquee(sendTitleEl, "-");
                applyMarquee(sendArtistEl, "-");
                if (vjSearchTitleEl) applyMarquee(vjSearchTitleEl, "-");
                if (vjSearchArtistEl) applyMarquee(vjSearchArtistEl, "-");
            }
        }
    }

    // タブ切り替え処理
    function initTabs() {
        const tabBtns = document.querySelectorAll('#djTabBar .tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.tab;
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                document.querySelectorAll('.tab-content').forEach(content => {
                    if (content.id === `tab-${targetTab}`) {
                        content.classList.remove('hidden');
                    } else {
                        content.classList.add('hidden');
                    }
                });
                
                // タブが表示されて要素の幅が確定したタイミングで再描画（左右スクロール適用のため）
                updateDisplay();
            });
        });
    }

    // 曲名/アーティスト名タップで検索窓にコピー
    function initCopyableToSearchInput() {
        const searchInput = document.getElementById('djVjSearchInput');
        if (!searchInput) return;

        const copyables = document.querySelectorAll('#tab-vj-search .copyable');
        copyables.forEach(el => {
            el.addEventListener('click', () => {
                const text = el.textContent.trim();
                if (text && text !== '-') {
                    searchInput.value = text;
                    // フォーカスを当てる
                    searchInput.focus();
                }
            });
        });
    }

    // DJページ用 素材検索ボタン処理
    function initDjSearchButtons() {
        const searchInput = document.getElementById('djVjSearchInput');
        const buttons = document.querySelectorAll('#djSearchLinksSend button');
        if (!searchInput || buttons.length === 0) return;

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

    // Pusher初期化
    async function initPusher() {
        // バックエンドからの設定非同期読み込みを待機
        await fetchAppConfig();

        if(!PUSHER_APP_KEY || PUSHER_APP_KEY === 'YOUR_PUSHER_APP_KEY') {
            console.warn("Pusher API Key is not set.");
            // フォールバック用にポーリングを入れる事も可能だが今回はPusher前提
        }

        const pusher = new Pusher(PUSHER_APP_KEY, {
            cluster: PUSHER_CLUSTER
        });

        pusherConnection = pusher.connection;
        pusherConnection.bind('state_change', (states) => {
            if (states.current === 'connected' && syncRetryOnReconnect) {
                syncState();
            }
            if (states.current === 'disconnected' || states.current === 'unavailable') {
                syncState();
            }
        });

        const channel = pusher.subscribe(`session-${sessionId}`);
        channel.bind('state-updated', async function(data) {
            if (syncInFlight || syncRequired) {
                queueStateEvent(data);
                return;
            }

            if (data.action === 'vj-ready') {
                if (!Number.isInteger(data.stateVersion)
                    || data.stateVersion < state.stateVersion
                    || data.stateVersion !== state.stateVersion
                    || data.readyForVersion !== state.stateVersion) {
                    return;
                }
                if (state.vjReadyForVersion === data.readyForVersion) return;

                state.vjReadyForVersion = data.readyForVersion;
                const badge = document.getElementById('vjReadyBadge');
                if (badge) badge.style.display = 'inline-block';
                const sendBox = document.getElementById('sendTrackBox');
                if (sendBox) sendBox.classList.remove('vj-ready-highlight');
                flashScreen('is-flashing-success');
                setTimeout(() => {
                    if (state.vjReadyForVersion === state.stateVersion && sendBox) {
                        sendBox.classList.add('vj-ready-highlight');
                    }
                }, 5000);
                return;
            }

            if (!applyStateEvent(data)) {
                queueStateEvent(data);
                await syncState();
            }
        });
    }

    // SENDボタン処理 (通常プレイリストからの送信)
    const sendBtn = document.getElementById('sendBtn');
    let sendInFlight = false;
    sendBtn.addEventListener('click', async () => {
        if (sendInFlight) return;
        const targetIdx = state.selectedIdx !== -1 ? state.selectedIdx : (state.sentIdx === -1 ? 0 : state.nowPlayingIdx + 1);
        if (targetIdx >= state.tracks.length) {
            alert("次に送信する曲がありません。");
            return;
        }

        // SENDリクエスト送信
        sendInFlight = true;
        sendBtn.disabled = true;
        try {
            const response = await apiRequest('action.php?action=send&role=dj', {
                method: 'POST',
                body: JSON.stringify({ sessionId, token, sendIdx: targetIdx })
            });

            // 成功レスポンスの差分を適用する。
            applyStateEvent(response);
            state.selectedIdx = -1;
            document.getElementById('vjReadyBadge').style.display = 'none'; // READYリセット
            document.getElementById('sendTrackBox').classList.remove('vj-ready-highlight'); // ハイライトもリセット
            
            // Sentに入ったため選択解除
            state.selectedIdx = -1; 
            
            renderPlaylist(); // re-render for selection off
            updateDisplay();
            flashScreen('is-flashing-danger');

        } catch(e) {
            alert("SENDエラー: " + e.message);
        } finally {
            sendInFlight = false;
            sendBtn.disabled = false;
        }
    });

    // 手入力 (Vibes!) モーダル機能の初期化
    function initVibesModal() {
        const modalOverlay = document.getElementById('vibesModalOverlay');
        const openBtn = document.getElementById('openVibesModalBtn');
        const closeBtn = document.getElementById('closeVibesModalBtn');
        const vibesForm = document.getElementById('vibesForm');
        const titleInput = document.getElementById('vibesTitleInput');
        const artistInput = document.getElementById('vibesArtistInput');
        const presetBtns = document.querySelectorAll('.vibes-preset-btn');

        if (!modalOverlay || !openBtn || !vibesForm) return;

        openBtn.addEventListener('click', () => {
            modalOverlay.classList.add('active');
            setTimeout(() => titleInput.focus(), 100);
        });

        const closeModal = () => {
            modalOverlay.classList.remove('active');
        };

        if (closeBtn) closeBtn.addEventListener('click', closeModal);

        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal();
        });

        // プリセットボタン
        presetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                titleInput.value = btn.dataset.title || '';
                artistInput.value = btn.dataset.artist || '';
                titleInput.focus();
            });
        });

        // フォーム送信
        vibesForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = titleInput.value.trim();
            const artist = artistInput.value.trim() || '-';

            if (!title) return;

            const customTrack = { title, artist, isVibes: true };

            try {
                const response = await apiRequest('action.php?action=send&role=dj', {
                    method: 'POST',
                    body: JSON.stringify({ sessionId, token, customTrack })
                });

                applyStateEvent(response);
                document.getElementById('vjReadyBadge').style.display = 'none';
                document.getElementById('sendTrackBox').classList.remove('vj-ready-highlight');

                state.selectedIdx = -1;
                renderPlaylist();
                updateDisplay();

                closeModal();
                // フォーム入力リセット
                titleInput.value = '';
                artistInput.value = '';

                flashScreen('is-flashing-danger');
            } catch(e) {
                alert("手入力SENDエラー: " + e.message);
            }
        });
    }

    // SENDと自動曲送りはサーバー側で原子化する。
    async function autoNextTrack() {}

    // カウントダウンUI
    function startCountdown(seconds, callback) {
        const overlay = document.getElementById('countdownOverlay');
        const numEl = document.getElementById('countdownNumber');
        overlay.classList.add('active');
        
        let current = seconds;
        numEl.textContent = current;

        const interval = setInterval(() => {
            current--;
            if (current > 0) {
                numEl.textContent = current;
            } else {
                clearInterval(interval);
                overlay.classList.remove('active');
                if (callback) callback();
            }
        }, 1000);
    }
});
