// Pusher Configuration (Frontend)
// ユーザーが取得したApp Keysをここに入力します
const PUSHER_APP_KEY = 'App Key'; // App Key (公開情報)
const PUSHER_CLUSTER = 'ap3'; // Cluster (公開情報)

// API Base URL (相対パス)
const API_BASE = 'backend/api';

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
