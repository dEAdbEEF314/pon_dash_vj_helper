<?php
/**
 * Pon Dash VJ Helper - フロントエンド用公開設定取得 API
 * 
 * env.php から Pusher の App Key や Cluster などの公開設定のみを安全に返却します。
 * PUSHER_SECRET などの秘密情報は絶対に返却しません。
 */

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// デフォルト値
$PUSHER_KEY     = 'YOUR_PUSHER_APP_KEY';
$PUSHER_CLUSTER = 'ap3';

// env.php から設定を読み込み
if (file_exists(__DIR__ . '/env.php')) {
    require_once __DIR__ . '/env.php';
}

echo json_encode([
    'PUSHER_APP_KEY' => $PUSHER_KEY,
    'PUSHER_CLUSTER' => $PUSHER_CLUSTER,
    'API_BASE'       => 'backend/api'
]);
