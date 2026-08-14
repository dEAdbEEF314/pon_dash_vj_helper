<?php
/**
 * Pon Dash VJ Helper - フロントエンド用公開設定取得 API
 * 
 * env.php から Pusher の App Key や Cluster などの公開設定のみを安全に返却します。
 * PUSHER_SECRET などの秘密情報は絶対に返却しません。
 */

header('Content-Type: application/json; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

// env.php から設定を読み込み
if (!file_exists(__DIR__ . '/env.php')) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Server configuration error']);
    exit;
}
require_once __DIR__ . '/env.php';

if (!isset($PUSHER_KEY, $PUSHER_CLUSTER, $SESSION_LIFETIME) || $SESSION_LIFETIME <= 0) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Server configuration error']);
    exit;
}

echo json_encode([
    'PUSHER_APP_KEY' => $PUSHER_KEY,
    'PUSHER_CLUSTER' => $PUSHER_CLUSTER,
    'SESSION_LIFETIME' => $SESSION_LIFETIME,
    'API_BASE'       => 'backend/api'
]);
