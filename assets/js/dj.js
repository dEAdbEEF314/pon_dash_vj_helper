document.addEventListener('DOMContentLoaded', () => {
    const sessionId = getSessionIdFromUrl();
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
        customTrack: null
    };

    let token = '';

    // ログイン処理
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('password').value;
        
        try {
            const res = await fetch(`${API_BASE}/action.php?action=login&role=dj`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, password: pwd })
            });
            const data = await res.json();
            if (data.success) {
                token = data.token; // 認証トークン
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
    function initState(serverState) {
        state.tracks = serverState.tracks;
        state.nowPlayingIdx = serverState.nowPlayingIdx;
        state.sentIdx = serverState.sentIdx;
        state.customTrack = serverState.customTrack || null;
        renderPlaylist();
        updateDisplay();
    }

    // プレイリスト描画
    function renderPlaylist() {
        playlistContainer.innerHTML = '';
        state.tracks.forEach((track, i) => {
            const item = document.createElement('div');
            item.className = 'playlist-item';
            if (i < state.nowPlayingIdx) item.classList.add('played');
            if (i === state.selectedIdx) item.classList.add('selected');
            
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

        // スクロール位置の自動調整（現在再生中へ）
        const activeItem = playlistContainer.children[state.nowPlayingIdx];
        if (activeItem) {
            activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // 左右往復スクロール適用
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

    // 表示更新
    function updateDisplay() {
        // 1. Now Playing (UIから削除済みのため変数取得のみ)
        const nowTrack = state.tracks[state.nowPlayingIdx];

        // 3. SEND to VJ (Preview) - タップされた曲のみ表示、未選択時はプレイリストの次の曲
        const previewTitleEl = document.getElementById('previewTitle');
        const previewArtistEl = document.getElementById('previewArtist');
        if (state.selectedIdx !== -1) {
            const previewTrack = state.tracks[state.selectedIdx];
            applyMarquee(previewTitleEl, previewTrack.title);
            applyMarquee(previewArtistEl, previewTrack.artist);
        } else if (nextPlaylistTrack) {
            // 未選択時は次の曲をデフォルト表示
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
                    window.open(url, '_blank');
                }
            });
        });
    }

    // Pusher初期化
    function initPusher() {
        // 設定値はconfig.jsから取得
        if(PUSHER_APP_KEY === 'YOUR_PUSHER_APP_KEY') {
            console.warn("Pusher API Key is not set.");
            // フォールバック用にポーリングを入れる事も可能だが今回はPusher前提
        }

        const pusher = new Pusher(PUSHER_APP_KEY, {
            cluster: PUSHER_CLUSTER
        });

        const channel = pusher.subscribe(`session-${sessionId}`);
        
        channel.bind('state-updated', function(data) {
            // 他のクライアント（VJなど）が操作した場合の反映
            if(data.action === 'vj-ready') {
                const badge = document.getElementById('vjReadyBadge');
                badge.style.display = 'inline-block';
                const sendBox = document.getElementById('sendTrackBox');
                sendBox.classList.remove('vj-ready-highlight');
                sendBox.classList.add('is-flashing-success');
                setTimeout(() => { 
                    sendBox.classList.remove('is-flashing-success');
                    // まだ別の操作でリセットされていなければ色反転を適用
                    if (badge.style.display !== 'none') {
                        sendBox.classList.add('vj-ready-highlight');
                    }
                }, 5000);
            } else if (data.action === 'auto-next') {
                state.nowPlayingIdx = data.nowPlayingIdx;
                // state.sentIdx = -1; // 変更: 次の曲に進んでもSEND情報は残す
                state.selectedIdx = -1;
                document.getElementById('vjReadyBadge').style.display = 'none';
                document.getElementById('sendTrackBox').classList.remove('vj-ready-highlight');
                renderPlaylist();
                updateDisplay();
            } else if (data.action === 'send') {
                state.sentIdx = data.sentIdx;
                state.customTrack = data.customTrack || null;
                renderPlaylist();
                updateDisplay();
            }
        });
    }

    // SENDボタン処理 (通常プレイリストからの送信)
    const sendBtn = document.getElementById('sendBtn');
    sendBtn.addEventListener('click', async () => {
        const targetIdx = state.selectedIdx !== -1 ? state.selectedIdx : state.nowPlayingIdx + 1;
        if (targetIdx >= state.tracks.length) {
            alert("次に送信する曲がありません。");
            return;
        }

        // SENDリクエスト送信
        try {
            await fetch(`${API_BASE}/action.php?action=send&role=dj`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, token, sendIdx: targetIdx })
            });

            // UI更新
            state.sentIdx = targetIdx;
            state.customTrack = null; // 通常送信のためクリア
            document.getElementById('vjReadyBadge').style.display = 'none'; // READYリセット
            document.getElementById('sendTrackBox').classList.remove('vj-ready-highlight'); // ハイライトもリセット
            
            // Sentに入ったため選択解除
            state.selectedIdx = -1; 
            
            renderPlaylist(); // re-render for selection off
            updateDisplay();
            
            const sendBox = document.getElementById('sendTrackBox');
            sendBox.classList.remove('is-flashing-danger');
            void sendBox.offsetWidth; // reflow
            sendBox.classList.add('is-flashing-danger');

            // 5秒カウントダウン
            startCountdown(5, () => {
                // カウントダウン終了で自動曲送り
                autoNextTrack(targetIdx);
            });

        } catch(e) {
            alert("SENDエラー: " + e.message);
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
                const res = await fetch(`${API_BASE}/action.php?action=send&role=dj`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, token, customTrack })
                });

                const data = await res.json();
                if (data.success) {
                    state.sentIdx = -2;
                    state.customTrack = customTrack;
                    document.getElementById('vjReadyBadge').style.display = 'none';
                    document.getElementById('sendTrackBox').classList.remove('vj-ready-highlight');
                    
                    state.selectedIdx = -1;
                    renderPlaylist();
                    updateDisplay();

                    closeModal();
                    // フォーム入力リセット
                    titleInput.value = '';
                    artistInput.value = '';

                    const sendBox = document.getElementById('sendTrackBox');
                    sendBox.classList.remove('is-flashing-danger');
                    void sendBox.offsetWidth;
                    sendBox.classList.add('is-flashing-danger');
                } else {
                    alert("送信に失敗しました");
                }
            } catch(e) {
                alert("手入力SENDエラー: " + e.message);
            }
        });
    }

    // 自動曲送り（カウントダウン後）
    async function autoNextTrack(newPlayingIdx) {
        try {
            const res = await fetch(`${API_BASE}/action.php?action=autonext&role=dj`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, token, nowPlayingIdx: newPlayingIdx })
            });
            const data = await res.json();
            if(data.success) {
                state.nowPlayingIdx = newPlayingIdx;
                // state.sentIdx = -1; // 変更: SEND情報を残す
                state.selectedIdx = -1;
                document.getElementById('vjReadyBadge').style.display = 'none';
                renderPlaylist();
                updateDisplay();
            }
        } catch(e) {
            console.error("AutoNextエラー", e);
        }
    }

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
