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
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');
ini_set('display_errors', 0);
error_reporting(E_ALL);

if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 1048576) {
    http_response_code(413);
    echo json_encode(['success' => false, 'error' => 'Request too large']);
    exit;
}

// CORS設定 (H-3): 同一オリジンからのリクエストのみ許可
$allowedOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
$requestScheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$sameOrigin = $requestScheme . '://' . ($_SERVER['HTTP_HOST'] ?? '');
if ($allowedOrigin !== '' && !hash_equals($sameOrigin, $allowedOrigin)) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Origin not allowed']);
    exit;
}
if ($allowedOrigin !== '' && hash_equals($sameOrigin, $allowedOrigin)) {
    header("Access-Control-Allow-Origin: {$allowedOrigin}");
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// OPTIONSリクエスト（プリフライト）への対応
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Pusher 認証情報・共通設定を外部ファイルから読み込み
if (file_exists(__DIR__ . '/env.php')) {
    require_once __DIR__ . '/env.php';
} else {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Server configuration error']);
    exit;
}

if (!isset($SESSION_LIFETIME) || $SESSION_LIFETIME <= 0) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Server configuration error']);
    exit;
}

define('DATA_DIR', __DIR__ . '/../data/');
define('SESSION_LIFETIME', $SESSION_LIFETIME);

// ブルートフォース対策の設定 (M-2)
const MAX_LOGIN_ATTEMPTS = 5;       // 最大試行回数
const LOCKOUT_DURATION   = 900;     // ロックアウト時間（秒）= 15分
const LOBBY_CODE_LENGTH  = 10;
const MAX_LOBBY_URL_LENGTH = 1000;
const MAX_DJ_NAME_LENGTH = 100;
const LOBBY_INVITE_LIFETIME = 300;
const LOBBY_RATE_WINDOW = 60;
const LOBBY_POLL_RATE_LIMIT = 60;
const LOBBY_PUSH_RATE_LIMIT = 20;
const LOBBY_CREATE_RATE_LIMIT = 10;

// セッション有効期限 (L-1)
// 8時間（28800秒）無操作でファイル自体を物理削除(Garbage Collection)するよう変更

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

function enforceLobbyRateLimit($actionName, $limit) {
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $rateFile = DATA_DIR . '.rate_' . hash('sha256', $actionName . '|' . $ip) . '.json';
    $now = time();
    $rateData = ['windowStart' => $now, 'count' => 0];

    $rateHandle = fopen($rateFile, 'c+');
    if (!$rateHandle || !flock($rateHandle, LOCK_EX)) {
        if ($rateHandle) fclose($rateHandle);
        sendErrorAndExit('Rate limit unavailable');
    }

    $stored = json_decode(stream_get_contents($rateHandle), true);
    if (is_array($stored) && ($now - ($stored['windowStart'] ?? 0)) < LOBBY_RATE_WINDOW) {
        $rateData = $stored;
    }

    $rateData['count']++;
    ftruncate($rateHandle, 0);
    rewind($rateHandle);
    fwrite($rateHandle, json_encode($rateData));
    fflush($rateHandle);
    flock($rateHandle, LOCK_UN);
    fclose($rateHandle);
    if ($rateData['count'] > $limit) {
        header('Retry-After: ' . max(1, LOBBY_RATE_WINDOW - ($now - $rateData['windowStart'])));
        sendErrorAndExit('Too many lobby requests');
    }
}

function removeSessionFromLobbies($sessionId) {
    foreach (glob(DATA_DIR . 'lobby_*.json') ?: [] as $lobbyFile) {
        $lobbyFp = fopen($lobbyFile, 'r+');
        if (!$lobbyFp || !flock($lobbyFp, LOCK_EX)) {
            if ($lobbyFp) fclose($lobbyFp);
            continue;
        }

        $size = filesize($lobbyFile);
        $lobbyData = json_decode(fread($lobbyFp, $size > 0 ? $size : 1024), true);
        if (is_array($lobbyData) && is_array($lobbyData['sessions'] ?? null)) {
            $lobbyData['sessions'] = array_values(array_filter(
                $lobbyData['sessions'],
                static fn($item) => ($item['sessionId'] ?? '') !== $sessionId
            ));
            ftruncate($lobbyFp, 0);
            rewind($lobbyFp);
            fwrite($lobbyFp, json_encode($lobbyData));
            fflush($lobbyFp);
        }
        flock($lobbyFp, LOCK_UN);
        fclose($lobbyFp);
    }
}

function garbageCollectExpiredData() {
    $now = time();
    foreach (glob(DATA_DIR . '*.json') ?: [] as $dataFile) {
        $data = json_decode((string)file_get_contents($dataFile), true);
        $createdAt = is_array($data) ? ($data['created_at'] ?? 0) : 0;
        $age = $createdAt > 0 ? $now - $createdAt : $now - (int)filemtime($dataFile);
        if ($age > SESSION_LIFETIME) {
            @unlink($dataFile);
        }
    }
}
// ==========================================

if (!isset($HMAC_SECRET) || $HMAC_SECRET === '' || $HMAC_SECRET === 'CHANGE_THIS_DEFAULT_KEY') {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Server configuration error']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendErrorAndExit('Method not allowed');
}

garbageCollectExpiredData();

$action = $_GET['action'] ?? '';
$role = $_GET['role'] ?? ''; // 'dj' or 'vj'
$rawInput = file_get_contents('php://input');
$input = $rawInput === '' ? [] : json_decode($rawInput, true);
if ($rawInput !== '' && (json_last_error() !== JSON_ERROR_NONE || !is_array($input))) {
    sendErrorAndExit('Invalid JSON');
}

$lobbyActions = ['create_lobby', 'push_to_lobby', 'poll_lobby'];
if (!in_array($action, $lobbyActions, true) && !in_array($role, ['dj', 'vj'], true)) {
    sendErrorAndExit('Invalid role');
}

if ($action === 'poll_lobby') {
    enforceLobbyRateLimit($action, LOBBY_POLL_RATE_LIMIT);
} elseif ($action === 'push_to_lobby') {
    enforceLobbyRateLimit($action, LOBBY_PUSH_RATE_LIMIT);
} elseif ($action === 'create_lobby') {
    enforceLobbyRateLimit($action, LOBBY_CREATE_RATE_LIMIT);
}

// ========================================
// VJロビー管理アクション (sessionIdを必須としない)
// ========================================
if ($action === 'create_lobby') {
    $chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    $code = '';
    for ($i = 0; $i < LOBBY_CODE_LENGTH; $i++) {
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
    $lobbyCodeInput = $input['lobbyCode'] ?? '';
    $sessionIdInput = $input['sessionId'] ?? '';
    $vjPasswordInput = $input['vjPassword'] ?? '';
    $djNameInput = $input['djName'] ?? '';
    if (!is_string($lobbyCodeInput) || !is_string($sessionIdInput)
        || !is_string($vjPasswordInput) || !is_string($djNameInput)) {
        sendErrorAndExit('Invalid parameters');
    }
    $lobbyCode = strtoupper(trim($lobbyCodeInput));
    $sessionId = trim($sessionIdInput);
    $vjPassword = $vjPasswordInput;
    $djName = trim($djNameInput);
    
    if (!preg_match('/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/', $lobbyCode)
        || !preg_match('/^[a-f0-9]{32}$/', $sessionId)
        || $vjPassword === '' || strlen($vjPassword) > 200
        || !is_string($djName) || strlen($djName) > MAX_DJ_NAME_LENGTH) {
        sendErrorAndExit('Missing parameters');
    }

    $sessionFile = DATA_DIR . $sessionId . '.json';
    if (!file_exists($sessionFile)) {
        sendErrorAndExit('Session not found');
    }
    $sessionFp = fopen($sessionFile, 'r+');
    if (!$sessionFp || !flock($sessionFp, LOCK_EX)) {
        sendErrorAndExit('Could not lock session file');
    }
    $sessionSize = filesize($sessionFile);
    $sessionData = json_decode(fread($sessionFp, $sessionSize > 0 ? $sessionSize : 1024), true);
    if (!is_array($sessionData) || !password_verify($vjPassword, $sessionData['vjPasswordHash'] ?? '')) {
        flock($sessionFp, LOCK_UN);
        fclose($sessionFp);
        sendErrorAndExit('Invalid VJ password');
    }
    if (time() - ($sessionData['created_at'] ?? 0) > SESSION_LIFETIME) {
        flock($sessionFp, LOCK_UN);
        fclose($sessionFp);
        sendErrorAndExit('Session expired and deleted');
    }

    $inviteToken = bin2hex(random_bytes(32));
    $sessionData['lobbyInviteTokenHash'] = hash('sha256', $inviteToken);
    $sessionData['lobbyInviteTokenExpiresAt'] = time() + LOBBY_INVITE_LIFETIME;
    ftruncate($sessionFp, 0);
    rewind($sessionFp);
    fwrite($sessionFp, json_encode($sessionData));
    flock($sessionFp, LOCK_UN);
    fclose($sessionFp);
    
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
        'sessionId' => $sessionId,
        'inviteToken' => $inviteToken,
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
            'sessionId' => $sessionId,
            'inviteToken' => $inviteToken,
            'djName' => $newItem['djName']
        ]);
    }
    
    echo json_encode(['success' => true]);
    exit;
}

if ($action === 'poll_lobby') {
    $lobbyCodeInput = $input['lobbyCode'] ?? '';
    if (!is_string($lobbyCodeInput)) {
        sendErrorAndExit('Invalid lobby code');
    }
    $lobbyCode = strtoupper(trim($lobbyCodeInput));
    if (!preg_match('/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/', $lobbyCode)) {
        sendErrorAndExit('Invalid lobby code');
    }
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

if (!isset($input['sessionId']) || !is_string($input['sessionId'])
    || !preg_match('/^[a-f0-9]{32}$/', $input['sessionId'])) {
    sendErrorAndExit('Missing session ID');
}

$sessionId = $input['sessionId'];
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
    $inviteToken = $input['inviteToken'] ?? '';
    $inviteHash = is_string($inviteToken) ? hash('sha256', $inviteToken) : '';
    $inviteValid = $role === 'vj'
        && is_string($inviteToken)
        && isset($sessionData['lobbyInviteTokenHash'], $sessionData['lobbyInviteTokenExpiresAt'])
        && time() <= $sessionData['lobbyInviteTokenExpiresAt']
        && hash_equals($sessionData['lobbyInviteTokenHash'], $inviteHash);
    
    if ($inviteValid || password_verify($password, $hashToVerify)) {
        $sessionData[$failKey] = 0;
        if ($inviteValid) {
            unset($sessionData['lobbyInviteTokenHash'], $sessionData['lobbyInviteTokenExpiresAt']);
        }
        $token = hash_hmac('sha256', $sessionId . $role, $HMAC_SECRET);
        
        $stateForClient = [
            'accountName' => $sessionData['accountName'],
            'tracks' => $sessionData['tracks'],
            'nowPlayingIdx' => $sessionData['nowPlayingIdx'],
            'sentIdx' => $sessionData['sentIdx'],
            'customTrack' => $sessionData['customTrack'] ?? null
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

if ($action === 'delete_session') {
    flock($fp, LOCK_UN);
    fclose($fp);
    removeSessionFromLobbies($sessionId);
    if (!unlink($sessionFile)) {
        sendErrorAndExit('Could not delete session');
    }
    if ($PUSHER_APP_ID !== 'YOUR_PUSHER_APP_ID') {
        sendPusherEvent($PUSHER_APP_ID, $PUSHER_KEY, $PUSHER_SECRET, $PUSHER_CLUSTER, "session-{$sessionId}", 'session-removed', [
            'action' => 'session-removed',
            'sessionId' => $sessionId
        ]);
    }
    echo json_encode(['success' => true]);
    exit;
}

// ========================================
// アクション処理
// ========================================
$eventPayload = null;

if ($action === 'send' && $role === 'dj') {
    $sendIdx = (int)($input['sendIdx'] ?? -1);
    $customTrack = $input['customTrack'] ?? null;
    
    if ($customTrack && !empty($customTrack['title'])) {
        $cleanTitle = htmlspecialchars(trim($customTrack['title']), ENT_QUOTES, 'UTF-8');
        $cleanArtist = htmlspecialchars(trim($customTrack['artist'] ?? ''), ENT_QUOTES, 'UTF-8');
        if (empty($cleanArtist)) $cleanArtist = '-';
        
        $sessionData['customTrack'] = [
            'title' => $cleanTitle,
            'artist' => $cleanArtist,
            'isVibes' => true
        ];
        $sessionData['sentIdx'] = -2; // 手入力特別インデックス
        $eventPayload = [
            'action' => 'send',
            'sentIdx' => -2,
            'customTrack' => $sessionData['customTrack']
        ];
    } elseif ($sendIdx >= 0 && $sendIdx < count($sessionData['tracks'])) {
        unset($sessionData['customTrack']);
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
