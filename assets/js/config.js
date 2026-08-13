// Pusher Configuration (Frontend)
// 公開設定 (PUSHER_APP_KEY, PUSHER_CLUSTER) は backend/api/config.php から動的取得されます。
let PUSHER_APP_KEY = ''; 
let PUSHER_CLUSTER = ''; 
let SESSION_LIFETIME = 0;

// API Base URL (相対パス)
const API_BASE = 'backend/api';

// 設定非同期取得用キャッシュプロミス
let configPromise = null;

/**
 * バックエンドから公開用アプリケーション設定を取得します。
 * (呼び出しは一度のみ実行され、結果はキャッシュされます)
 */
function fetchAppConfig() {
    if (!configPromise) {
        configPromise = fetch(`${API_BASE}/config.php`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                return res.json();
            })
            .then(data => {
                if (data.PUSHER_APP_KEY) PUSHER_APP_KEY = data.PUSHER_APP_KEY;
                if (data.PUSHER_CLUSTER) PUSHER_CLUSTER = data.PUSHER_CLUSTER;
                if (Number.isInteger(data.SESSION_LIFETIME) && data.SESSION_LIFETIME > 0) {
                    SESSION_LIFETIME = data.SESSION_LIFETIME;
                }
                return data;
            })
            .catch(err => {
                console.warn("Pusher設定の取得に失敗しました。デフォルト設定/空値で続行します:", err);
                return { PUSHER_APP_KEY, PUSHER_CLUSTER, API_BASE };
            });
    }
    return configPromise;
}

// スクリプト読み込み時に設定取得を先行開始
fetchAppConfig();

// Utility functions
function getSessionIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('sid');
}

function showOverlayMessage(elementId, duration = 3000) {
    const el = document.getElementById(elementId);
    if(el) {
        el.classList.add('active');
        setTimeout(() => el.classList.remove('active'), duration);
    }
}
