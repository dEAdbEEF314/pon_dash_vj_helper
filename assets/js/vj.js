document.addEventListener('DOMContentLoaded', () => {
    const sessionId = getSessionIdFromUrl();
    if (!sessionId) {
        alert("無効なURLです。");
        return;
    }

    const loginForm = document.getElementById('loginForm');
    const mainApp = document.getElementById('mainApp');
    const loginScreen = document.getElementById('loginScreen');
    const playlistContainer = document.getElementById('playlistContainer');
    
    let state = {
        tracks: [],
        nowPlayingIdx: 0,
        sentIdx: -1
    };

    let token = '';

    // ログイン処理
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('password').value;
        
        try {
            const res = await fetch(`${API_BASE}/action.php?action=login&role=vj`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, password: pwd })
            });
            const data = await res.json();
            if (data.success) {
                token = data.token;
                loginScreen.classList.add('hidden');
                mainApp.classList.remove('hidden');
                document.getElementById('sessionNameDisplay').textContent = "Playlist: " + data.state.accountName;
                initState(data.state);
                initPusher();
                initSearchButtons();
            } else {
                document.getElementById('loginError').style.display = 'block';
            }
        } catch(e) {
            alert("ログインエラー: " + e.message);
        }
    });

    function initState(serverState) {
        state.tracks = serverState.tracks;
        state.nowPlayingIdx = serverState.nowPlayingIdx;
        state.sentIdx = serverState.sentIdx;
        renderPlaylist();
        updateDisplay();
    }

    // プレイリスト描画 (VJ用は閲覧のみ)
    function renderPlaylist() {
        playlistContainer.innerHTML = '';
        state.tracks.forEach((track, i) => {
            const item = document.createElement('div');
            item.className = 'playlist-item';
            
            // スタイル付け
            if (i < state.nowPlayingIdx) item.classList.add('played');
            if (i === state.nowPlayingIdx) item.style.borderLeft = "3px solid #fff";
            if (i === state.sentIdx) {
                item.style.borderLeft = "3px solid var(--danger-color)";
                item.style.background = "rgba(255, 51, 102, 0.1)";
            }

            // XSS対策: innerHTML ではなく textContent を使用 (H-1)
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

        // 自動スクロール
        const activeIdx = state.sentIdx !== -1 ? state.sentIdx : state.nowPlayingIdx;
        const activeItem = playlistContainer.children[activeIdx];
        if (activeItem) {
            activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function updateDisplay() {
        // 1. Now Playing (要素があれば更新)
        const nowTrack = state.tracks[state.nowPlayingIdx];
        const nowTitleEl = document.getElementById('nowPlayingTitle');
        const nowArtistEl = document.getElementById('nowPlayingArtist');
        if (nowTitleEl) nowTitleEl.textContent = nowTrack ? nowTrack.title : '-';
        if (nowArtistEl) nowArtistEl.textContent = nowTrack ? nowTrack.artist : '-';

        // 2. Next from DJ (DJからSENDされた曲)
        // 初回アクセス時等、DJから未送信の場合は1曲目を表示
        const targetSentIdx = state.sentIdx !== -1 ? state.sentIdx : 0;
        const sentTrack = state.tracks[targetSentIdx];
        const sendTitleEl = document.getElementById('sendTitle');
        const sendArtistEl = document.getElementById('sendArtist');
        if (sentTrack) {
            sendTitleEl.textContent = sentTrack.title;
            sendArtistEl.textContent = sentTrack.artist;
        } else {
            sendTitleEl.textContent = "-";
            sendArtistEl.textContent = "-";
        }

        // 3. Next in Playlist (プレイリスト上の次の曲)
        // DJがSENDした場合はSENDされた曲の次、SENDされていない場合は現在の次
        let nextIdx = state.sentIdx !== -1 ? state.sentIdx + 1 : state.nowPlayingIdx + 1;
        const nextTrack = state.tracks[nextIdx];
        const nextTitleEl = document.getElementById('nextTitle');
        const nextArtistEl = document.getElementById('nextArtist');

        if (nextTitleEl && nextArtistEl) {
            if (nextTrack) {
                nextTitleEl.textContent = nextTrack.title;
                nextArtistEl.textContent = nextTrack.artist;
            } else {
                nextTitleEl.textContent = "(end of playlist)";
                nextArtistEl.textContent = "-";
            }
        }
    }

    function initSearchButtons() {
        const searchInput = document.getElementById('vjSearchInput');
        const buttons = document.querySelectorAll('#searchLinksSend button');
        
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const query = encodeURIComponent(searchInput.value.trim());
                if (!query) {
                    alert('検索ワードを入力してください');
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

    function initPusher() {
        if(PUSHER_APP_KEY === 'YOUR_PUSHER_APP_KEY') {
            console.warn("Pusher API Key is not set.");
        }

        const pusher = new Pusher(PUSHER_APP_KEY, {
            cluster: PUSHER_CLUSTER
        });

        const channel = pusher.subscribe(`session-${sessionId}`);
        
        channel.bind('state-updated', function(data) {
            if (data.action === 'send') {
                state.sentIdx = data.sentIdx;
                renderPlaylist();
                updateDisplay();
                
                // フラッシュ (10秒)
                const sendBox = document.getElementById('sendTrackBox');
                sendBox.classList.remove('is-flashing-danger');
                void sendBox.offsetWidth;
                sendBox.classList.add('is-flashing-danger');
                
            } else if (data.action === 'auto-next') {
                state.nowPlayingIdx = data.nowPlayingIdx;
                // state.sentIdx = -1; // 変更: SEND情報を維持
                renderPlaylist();
                updateDisplay();
                // フラッシュを消す
                document.getElementById('sendTrackBox').classList.remove('is-flashing-danger');
            } else if (data.action === 'vj-ready') {
                const sendBox = document.getElementById('sendTrackBox');
                sendBox.classList.remove('is-flashing-success');
                void sendBox.offsetWidth;
                sendBox.classList.add('is-flashing-success');
            }
        });
    }

    // READYボタン処理
    const readyBtn = document.getElementById('readyBtn');
    readyBtn.addEventListener('click', async () => {
        try {
            await fetch(`${API_BASE}/action.php?action=ready&role=vj`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, token })
            });
            
            // 自画面のフラッシュ (10秒)
            const sendBox = document.getElementById('sendTrackBox');
            sendBox.classList.remove('is-flashing-danger'); // 赤を消して緑にする
            sendBox.classList.remove('is-flashing-success');
            void sendBox.offsetWidth;
            sendBox.classList.add('is-flashing-success');
            
        } catch(e) {
            console.error("READY送信エラー", e);
        }
    });
});
