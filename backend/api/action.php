<?php
/**
 * Pon Dash VJ Helper - アクション API
 * 
 * セキュリティ対策:
 * - HMAC秘密鍵を外部ファイル(env.php)から読み込み (C-1)
 * - SSL証明書検証を有効化 (H-2)
 * - CORSヘッダーによるオリジン制限 (H-3)
 * - ブルートフォース対策（ログイン試行回数制限） (M-2)
 * - セッション有効期限チェック (L-1)
 */

header('Content-Type: application/json; charset=UTF-8');
ini_set('display_errors', 0);
error_reporting(E_ALL);

// CORS設定 (H-3): 同一オリジンからのリクエストのみ許可
$allowedOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($allowedOrigin !== '' && strpos($allowedOrigin, $_SERVER['HTTP_HOST']) !== false) {
    header("Access-Control-Allow-Origin: {$allowedOrigin}");
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// OPTIONSリクエスト（プリフライト）への対応
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

const DATA_DIR = __DIR__ . '/../data/';

// ブルートフォース対策の設定 (M-2)
const MAX_LOGIN_ATTEMPTS = 5;       // 最大試行回数
const LOCKOUT_DURATION   = 900;     // ロックアウト時間（秒）= 15分

// セッション有効期限 (L-1)
// 8時間（28800秒）無操作でファイル自体を物理削除(Garbage Collection)するよう変更
const SESSION_LIFETIME = 28800;

// ==========================================
// APIログ出力ヘルパー
// ==========================================
function apiLog($actionName, $message) {
    $logFile = DATA_DIR . 'api.log';
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'Unknown';
    $timestamp = date('Y-m-d H:i:s');
    $logMsg = "[{$timestamp}] [IP: {$ip}] Action: {$actionName} - {$message}\n";
    file_put_contents($logFile, $logMsg, FILE_APPEND | LOCK_EX);
}

function sendErrorAndExit($errorMsg, $actionName = '') {
    global $action;
    $act = $actionName ?: ($action ?? 'unknown');
    apiLog($act, "Error: " . $errorMsg);
    echo json_encode(['success' => false, 'error' => $errorMsg]);
    exit;
}
// ==========================================

// Pusher 認証情報 & HMAC秘密鍵 (外部ファイルから読み込み)
if (file_exists(__DIR__ . '/env.php')) {
    require_once __DIR__ . '/env.php';
} else {
    $PUSHER_APP_ID = 'YOUR_PUSHER_APP_ID';
    $PUSHER_KEY    = 'YOUR_PUSHER_APP_KEY';
    $PUSHER_SECRET = 'YOUR_PUSHER_SECRET';
    $PUSHER_CLUSTER= 'ap3';
    $HMAC_SECRET   = 'CHANGE_THIS_DEFAULT_KEY';
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendErrorAndExit('Method not allowed');
}

$action = $_GET['action'] ?? '';
$role = $_GET['role'] ?? ''; // 'dj' or 'vj'
$input = json_decode(file_get_contents('php://input'), true) ?? [];

// ========================================
// VJロビー管理アクション (sessionIdを必須としない)
// ========================================
if ($action === 'create_lobby') {
    $chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    $code = '';
    for ($i = 0; $i < 6; $i++) {
        $code .= $chars[random_int(0, strlen($chars) - 1)];
    }
    
    $lobbyFile = DATA_DIR . 'lobby_' . $code . '.json';
    $lobbyData = [
        'code' => $code,
        'created_at' => time(),
        'sessions' => []
    ];
    
    $result = file_put_contents($lobbyFile, json_encode($lobbyData), LOCK_EX);
    if ($result === false) {
        sendErrorAndExit('Failed to create lobby file. Check directory permissions.');
    }
    
    echo json_encode(['success' => true, 'lobbyCode' => $code]);
    exit;
}

if ($action === 'push_to_lobby') {
    $lobbyCode = strtoupper(trim($input['lobbyCode'] ?? ''));
    $vjUrl = trim($input['vjUrl'] ?? '');
    $djName = trim($input['djName'] ?? '');
    
    if (empty($lobbyCode) || empty($vjUrl)) {
        sendErrorAndExit('Missing parameters');
    }
    
    $lobbyFile = DATA_DIR . 'lobby_' . $lobbyCode . '.json';
    if (!file_exists($lobbyFile)) {
        sendErrorAndExit('Lobby not found');
    }
    
    // 8時間以上無操作なら削除
    if (filemtime($lobbyFile) < time() - SESSION_LIFETIME) {
        unlink($lobbyFile);
        apiLog($action, "Garbage collected expired lobby file: {$lobbyCode}");
        sendErrorAndExit('Lobby expired and deleted');
    }
    
    $fp = fopen($lobbyFile, 'r+');
    if (!$fp || !flock($fp, LOCK_EX)) {
        sendErrorAndExit('Could not lock lobby file');
    }
    
    $filesize = filesize($lobbyFile);
    $lobbyData = json_decode(fread($fp, $filesize > 0 ? $filesize : 1024), true);
    
    // 有効期限チェック (ファイル更新時刻基準にもなるが、一応 created_at からもチェック)
    if (time() - ($lobbyData['created_at'] ?? 0) > SESSION_LIFETIME) {
        flock($fp, LOCK_UN);
        fclose($fp);
        unlink($lobbyFile);
        apiLog($action, "Lobby expired by created_at and deleted: {$lobbyCode}");
        sendErrorAndExit('Lobby expired and deleted');
    }
    
    $newItem = [
        'vjUrl' => $vjUrl,
        'djName' => $djName !== '' ? $djName : 'DJ',
        'addedAt' => time()
    ];
    
    $lobbyData['sessions'][] = $newItem;
    
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($lobbyData));
    flock($fp, LOCK_UN);
    fclose($fp);
    
    if ($PUSHER_APP_ID !== 'YOUR_PUSHER_APP_ID') {
        sendPusherEvent($PUSHER_APP_ID, $PUSHER_KEY, $PUSHER_SECRET, $PUSHER_CLUSTER, "lobby-{$lobbyCode}", 'session-pushed', [
            'action' => 'session-pushed',
            'vjUrl' => $vjUrl,
            'djName' => $newItem['djName']
        ]);
    }
    
    echo json_encode(['success' => true]);
    exit;
}

if ($action === 'poll_lobby') {
    $lobbyCode = strtoupper(trim($input['lobbyCode'] ?? ''));
    $lobbyFile = DATA_DIR . 'lobby_' . $lobbyCode . '.json';
    
    if (!file_exists($lobbyFile)) {
        sendErrorAndExit('Lobby not found');
    }
    
    if (filemtime($lobbyFile) < time() - SESSION_LIFETIME) {
        unlink($lobbyFile);
        apiLog($action, "Garbage collected expired lobby file: {$lobbyCode}");
        sendErrorAndExit('Lobby expired and deleted');
    }
    
    $lobbyData = json_decode(file_get_contents($lobbyFile), true);
    echo json_encode(['success' => true, 'sessions' => $lobbyData['sessions'] ?? []]);
    exit;
}

if (empty($input['sessionId'])) {
    sendErrorAndExit('Missing session ID');
}

$sessionId = basename($input['sessionId']);
$sessionFile = DATA_DIR . $sessionId . '.json';

if (!file_exists($sessionFile)) {
    sendErrorAndExit('Session not found');
}

if (filemtime($sessionFile) < time() - SESSION_LIFETIME) {
    unlink($sessionFile);
    apiLog($action, "Garbage collected expired session file: {$sessionId}");
    sendErrorAndExit('Session expired and deleted');
}

// ファイルの読み込みとロック
$fp = fopen($sessionFile, 'r+');
if (!$fp || !flock($fp, LOCK_EX)) {
    sendErrorAndExit('Could not lock session file');
}

$filesize = filesize($sessionFile);
$sessionData = json_decode(fread($fp, $filesize > 0 ? $filesize : 1024), true);

$createdAt = $sessionData['created_at'] ?? 0;
if (time() - $createdAt > SESSION_LIFETIME) {
    flock($fp, LOCK_UN);
    fclose($fp);
    unlink($sessionFile);
    apiLog($action, "Session expired by created_at and deleted: {$sessionId}");
    sendErrorAndExit('Session expired and deleted');
}

// ========================================
// ログインアクション
// ========================================
if ($action === 'login') {
    $failKey = "loginFailures_{$role}";
    $lastFailKey = "lastFailedLogin_{$role}";
    $failures = $sessionData[$failKey] ?? 0;
    $lastFailTime = $sessionData[$lastFailKey] ?? 0;

    if ($failures >= MAX_LOGIN_ATTEMPTS && (time() - $lastFailTime) < LOCKOUT_DURATION) {
        $remaining = LOCKOUT_DURATION - (time() - $lastFailTime);
        flock($fp, LOCK_UN);
        fclose($fp);
        sendErrorAndExit("Too many login attempts. Try again in {$remaining} seconds.");
    }

    if ($failures >= MAX_LOGIN_ATTEMPTS && (time() - $lastFailTime) >= LOCKOUT_DURATION) {
        $failures = 0;
    }

    $password = $input['password'] ?? '';
    $hashToVerify = ($role === 'dj') ? $sessionData['djPasswordHash'] : $sessionData['vjPasswordHash'];
    
    if (password_verify($password, $hashToVerify)) {
        $sessionData[$failKey] = 0;
        $token = hash_hmac('sha256', $sessionId . $role, $HMAC_SECRET);
        
        $stateForClient = [
            'accountName' => $sessionData['accountName'],
            'tracks' => $sessionData['tracks'],
            'nowPlayingIdx' => $sessionData['nowPlayingIdx'],
            'sentIdx' => $sessionData['sentIdx']
        ];
        
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($sessionData));
        
        // ログイン成功時も軽くログを残す（運用次第だが、今回は除外するか、infoレベルで残すか。不正追跡用には残しておく）
        apiLog($action, "Successful login for session: {$sessionId} (Role: {$role})");

        echo json_encode(['success' => true, 'token' => $token, 'state' => $stateForClient]);
    } else {
        $sessionData[$failKey] = $failures + 1;
        $sessionData[$lastFailKey] = time();
        
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($sessionData));

        flock($fp, LOCK_UN);
        fclose($fp);
        sendErrorAndExit('Invalid password');
    }
    
    flock($fp, LOCK_UN);
    fclose($fp);
    exit;
}

// ========================================
// 認証チェック (login以外のアクション)
// ========================================
$token = $input['token'] ?? '';
$expectedToken = hash_hmac('sha256', $sessionId . $role, $HMAC_SECRET); 
if (!hash_equals($expectedToken, $token)) {
    flock($fp, LOCK_UN);
    fclose($fp);
    sendErrorAndExit('Unauthorized');
}

// ========================================
// アクション処理
// ========================================
$eventPayload = null;

if ($action === 'send' && $role === 'dj') {
    $sendIdx = (int)($input['sendIdx'] ?? -1);
    if ($sendIdx >= 0 && $sendIdx < count($sessionData['tracks'])) {
        $sessionData['sentIdx'] = $sendIdx;
        $eventPayload = ['action' => 'send', 'sentIdx' => $sendIdx];
    }
} 
elseif ($action === 'autonext' && $role === 'dj') {
    $nowPlayingIdx = (int)($input['nowPlayingIdx'] ?? -1);
    if ($nowPlayingIdx >= 0 && $nowPlayingIdx < count($sessionData['tracks'])) {
        $sessionData['nowPlayingIdx'] = $nowPlayingIdx;
        $eventPayload = ['action' => 'auto-next', 'nowPlayingIdx' => $nowPlayingIdx];
    }
}
elseif ($action === 'ready' && $role === 'vj') {
    $eventPayload = ['action' => 'vj-ready'];
}

// データの保存（変更があった場合）
if (in_array($action, ['send', 'autonext'])) {
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($sessionData));
}

flock($fp, LOCK_UN);
fclose($fp);

if ($eventPayload && $PUSHER_APP_ID !== 'YOUR_PUSHER_APP_ID') {
    sendPusherEvent($PUSHER_APP_ID, $PUSHER_KEY, $PUSHER_SECRET, $PUSHER_CLUSTER, "session-{$sessionId}", 'state-updated', $eventPayload);
}

echo json_encode(['success' => true]);


/**
 * Pusher REST API にイベントを送信する関数 (ライブラリ不要)
 */
function sendPusherEvent($appId, $key, $secret, $cluster, $channel, $event, $data) {
    $host = "api-{$cluster}.pusher.com";
    $path = "/apps/{$appId}/events";
    
    $body = json_encode([
        'name' => $event,
        'channels' => [$channel],
        'data' => json_encode($data) // dataは文字列化したJSON
    ]);
    
    $body_md5 = md5($body);
    $auth_timestamp = time();
    $auth_version = '1.0';
    
    $method = 'POST';
    $auth_string = implode("\n", [$method, $path, "auth_key={$key}&auth_timestamp={$auth_timestamp}&auth_version={$auth_version}&body_md5={$body_md5}"]);
    $auth_signature = hash_hmac('sha256', $auth_string, $secret);
    
    $isLocalhost = ($_SERVER['REMOTE_ADDR'] === '127.0.0.1' || $_SERVER['REMOTE_ADDR'] === '::1');
    
    $scheme = $isLocalhost ? 'http' : 'https';
    $url = "{$scheme}://{$host}{$path}?auth_key={$key}&auth_timestamp={$auth_timestamp}&auth_version={$auth_version}&body_md5={$body_md5}&auth_signature={$auth_signature}";
    
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/json',
            'Content-Length: ' . strlen($body)
        ]);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, !$isLocalhost);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, $isLocalhost ? 0 : 2);
        
        $response = curl_exec($ch);
        if(curl_errno($ch)) {
            apiLog('Pusher', 'curl error: ' . curl_error($ch));
        }
        curl_close($ch);
        return $response;
    } else {
        $options = [
            'http' => [
                'method'  => 'POST',
                'header'  => "Content-Type: application/json\r\n" .
                             "Content-Length: " . strlen($body) . "\r\n",
                'content' => $body,
                'timeout' => 5,
                'ignore_errors' => true
            ],
            'ssl' => [
                'verify_peer' => !$isLocalhost,
                'verify_peer_name' => !$isLocalhost
            ]
        ];
        $context = stream_context_create($options);
        $response = @file_get_contents($url, false, $context);
        
        if ($response === false) {
            $error = error_get_last();
            apiLog('Pusher', 'file_get_contents error: ' . ($error['message'] ?? 'Unknown error'));
        }
        return $response;
    }
}
