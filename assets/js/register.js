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
                const vjUrl = `${baseUrl}vj.html?sid=${result.sessionId}`;

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
});
