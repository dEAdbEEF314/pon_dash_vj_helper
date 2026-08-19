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
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
header('Cache-Control: no-store');
ini_set('display_errors', 0);
error_reporting(E_ALL);

if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 1048576) {
    http_response_code(413);
    echo json_encode(['success' => false, 'error' => 'Request too large']);
    exit;
}

// CORS設定 (H-3): 同一オリジンからのリクエストのみ許可
$allowedOrigin = rtrim(trim((string)($_SERVER['HTTP_ORIGIN'] ?? '')), '/');
$requestScheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$requestHost = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
$sameOrigin = $requestHost !== '' ? $requestScheme . '://' . $requestHost : '';
if ($allowedOrigin !== '' && ($sameOrigin === '' || !hash_equals($sameOrigin, $allowedOrigin))) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Origin not allowed']);
    exit;
}
if ($allowedOrigin !== '') {
    header("Access-Control-Allow-Origin: {$allowedOrigin}");
    header('Vary: Origin');
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

function safeTruncate($value, $maxLength) {
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $maxLength, 'UTF-8');
    }
    return substr($value, 0, $maxLength);
}

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
// APIログ出力ヘルパー（ログローテーション対応）
// ==========================================
const MAX_LOG_SIZE = 524288; // 512KB

function apiLog($actionName, $message) {
    $logFile = DATA_DIR . 'api.log';
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'Unknown';
    $timestamp = date('Y-m-d H:i:s');
    $safeAction = preg_replace('/[^a-zA-Z0-9_.-]/', '_', (string)$actionName);
    $safeMessage = preg_replace('/[\r\n]+/', ' ', (string)$message);
    $safeMessage = preg_replace('/(password|token|secret|inviteToken)\s*[:=].*/i', '$1=[redacted]', $safeMessage);
    $logMsg = "[{$timestamp}] [IP: {$ip}] Action: {$safeAction} - {$safeMessage}\n";

    // ログサイズ上限チェック（512KBを超えたら .old にローテーション）
    if (@file_exists($logFile) && @filesize($logFile) > MAX_LOG_SIZE) {
        @rename($logFile, DATA_DIR . 'api.log.old');
    }

    file_put_contents($logFile, $logMsg, FILE_APPEND | LOCK_EX);
}

function sendErrorAndExit($errorMsg, $actionName = '', $status = 400, $errorCode = 'REQUEST_ERROR') {
    global $action;
    $act = $actionName ?: ($action ?? 'unknown');
    apiLog($act, "Error: " . $errorMsg);
    http_response_code($status);
    echo json_encode([
        'success' => false,
        'errorCode' => $errorCode,
        'error' => $errorMsg
    ]);
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
    $now = time();
    foreach (glob(DATA_DIR . 'lobby_*.json') ?: [] as $lobbyFile) {
        // 期限切れのロビーファイルはスキップ（GCに任せる）
        $mtime = @filemtime($lobbyFile);
        if ($mtime !== false && ($now - $mtime) > SESSION_LIFETIME) {
            @unlink($lobbyFile);
            continue;
        }

        $lobbyFp = fopen($lobbyFile, 'r+');
        if (!$lobbyFp || !flock($lobbyFp, LOCK_EX)) {
            if ($lobbyFp) fclose($lobbyFp);
            continue;
        }

        $size = filesize($lobbyFile);
        $lobbyData = json_decode(fread($lobbyFp, $size > 0 ? $size : 1024), true);
        if (is_array($lobbyData) && is_array($lobbyData['sessions'] ?? null)) {
            $originalCount = count($lobbyData['sessions']);
            $lobbyData['sessions'] = array_values(array_filter(
                $lobbyData['sessions'],
                static fn($item) => ($item['sessionId'] ?? '') !== $sessionId
            ));
            // セッションが実際に含まれていた場合のみ書き戻し
            if (count($lobbyData['sessions']) < $originalCount) {
                ftruncate($lobbyFp, 0);
                rewind($lobbyFp);
                fwrite($lobbyFp, json_encode($lobbyData));
                fflush($lobbyFp);
            }
        }
        flock($lobbyFp, LOCK_UN);
        fclose($lobbyFp);
    }
}

function garbageCollectExpiredData() {
    // 確率的実行: 1/50 (2%) のリクエストでのみGCを実行し、通常リクエストの遅延を防ぐ。
    // 各セッションの有効期限チェックはリクエスト個別に filemtime で行われるため安全。
    if (random_int(1, 50) !== 1) {
        return;
    }
    $now = time();
    foreach (glob(DATA_DIR . '*.json') ?: [] as $dataFile) {
        // filemtime ベースの軽量判定: ファイル内容の読み込み・JSON解析を行わない
        $mtime = @filemtime($dataFile);
        if ($mtime !== false && ($now - $mtime) > SESSION_LIFETIME) {
            @unlink($dataFile);
        }
    }
    // 古いレートリミット一時ファイル (.rate_*.json) もクリーンアップ (ウィンドウ時間を超過したもの)
    foreach (glob(DATA_DIR . '.rate_*.json') ?: [] as $rateFile) {
        $mtime = @filemtime($rateFile);
        if ($mtime !== false && ($now - $mtime) > (LOBBY_RATE_WINDOW * 2)) {
            @unlink($rateFile);
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

    $replacedItem = null;
    $lobbyData['sessions'] = array_values(array_filter(
        $lobbyData['sessions'] ?? [],
        static function ($item) use ($sessionId, &$replacedItem) {
            if (($item['sessionId'] ?? '') === $sessionId) {
                $replacedItem = $item;
                return false;
            }
            return true;
        }
    ));
    $lobbyData['sessions'][] = $newItem;
    
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($lobbyData));
    flock($fp, LOCK_UN);
    fclose($fp);
    
    if ($PUSHER_APP_ID !== 'YOUR_PUSHER_APP_ID') {
        $lobbyEvent = $replacedItem !== null ? 'session-replaced' : 'session-pushed';
        sendPusherEvent($PUSHER_APP_ID, $PUSHER_KEY, $PUSHER_SECRET, $PUSHER_CLUSTER, "lobby-{$lobbyCode}", $lobbyEvent, [
            'action' => $lobbyEvent,
            'sessionId' => $sessionId,
            'inviteToken' => $inviteToken,
            'inviteTokenHash' => hash('sha256', $inviteToken),
            'djName' => $newItem['djName']
        ]);
    }
    
    echo json_encode(['success' => true]);
    exit;
}

if ($action === 'poll_lobby') {
    $lobbyCodeInput = $input['lobbyCode'] ?? '';
    if (!is_string($lobbyCodeInput)) {
        sendErrorAndExit('Invalid lobby code', $action, 400, 'INVALID_INPUT');
    }
    $lobbyCode = strtoupper(trim($lobbyCodeInput));
    if (!preg_match('/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/', $lobbyCode)) {
        sendErrorAndExit('Invalid lobby code', $action, 400, 'INVALID_INPUT');
    }
    $knownSessionIds = $input['knownSessionIds'] ?? [];
    $knownTokenHashes = $input['knownTokenHashes'] ?? [];
    if (!is_array($knownSessionIds) || !is_array($knownTokenHashes)) {
        sendErrorAndExit('Invalid known session data', $action, 400, 'INVALID_INPUT');
    }
    foreach ($knownSessionIds as $knownSid) {
        if (!is_string($knownSid) || !preg_match('/^[a-f0-9]{32}$/', $knownSid)) {
            sendErrorAndExit('Invalid known session ID', $action, 400, 'INVALID_INPUT');
        }
    }
    foreach ($knownTokenHashes as $knownSid => $knownHash) {
        if (!is_string($knownSid) || !preg_match('/^[a-f0-9]{32}$/', $knownSid)
            || !is_string($knownHash) || !preg_match('/^[a-f0-9]{64}$/', $knownHash)) {
            sendErrorAndExit('Invalid known token hash', $action, 400, 'INVALID_INPUT');
        }
    }
    $lobbyFile = DATA_DIR . 'lobby_' . $lobbyCode . '.json';
    if (!file_exists($lobbyFile)) {
        sendErrorAndExit('Lobby not found', $action, 404, 'LOBBY_NOT_FOUND');
    }
    if (filemtime($lobbyFile) < time() - SESSION_LIFETIME) {
        unlink($lobbyFile);
        sendErrorAndExit('Lobby expired and deleted', $action, 404, 'LOBBY_EXPIRED');
    }
    $lobbyData = json_decode(file_get_contents($lobbyFile), true);
    if (!is_array($lobbyData)) {
        sendErrorAndExit('Invalid lobby data', $action, 500, 'INVALID_LOBBY_DATA');
    }
    $added = [];
    $currentIds = [];
    foreach (($lobbyData['sessions'] ?? []) as $item) {
        $sid = $item['sessionId'] ?? '';
        $currentIds[] = $sid;
        $token = $item['inviteToken'] ?? '';
        $hash = hash('sha256', $token);
        $isKnown = in_array($sid, $knownSessionIds, true)
            && (($knownTokenHashes[$sid] ?? '') === $hash);
        if (!$isKnown) {
            $added[] = [
                'sessionId' => $sid,
                'inviteToken' => $token,
                'inviteTokenHash' => $hash,
                'djName' => $item['djName'] ?? 'DJ',
                'isNew' => !in_array($sid, $knownSessionIds, true)
            ];
        }
    }
    $removed = array_values(array_diff($knownSessionIds, $currentIds));
    echo json_encode([
        'success' => true,
        'added' => $added,
        'removedSessionIds' => $removed
    ]);
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

if (!is_array($sessionData)) {
    flock($fp, LOCK_UN);
    fclose($fp);
    sendErrorAndExit('Invalid session data', $action, 500, 'INVALID_SESSION_DATA');
}
if (!array_key_exists('stateVersion', $sessionData)) {
    $sessionData['stateVersion'] = 0;
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($sessionData));
    fflush($fp);
}

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
    
    if ($inviteValid || (is_string($password) && strlen($password) <= 200 && password_verify($password, $hashToVerify))) {
        $sessionData[$failKey] = 0;
        if ($inviteValid) {
            unset($sessionData['lobbyInviteTokenHash'], $sessionData['lobbyInviteTokenExpiresAt']);
        }
        $token = bin2hex(random_bytes(32));
        $sessionData[$role . 'AuthTokenHash'] = password_hash($token, PASSWORD_DEFAULT);
        
        $stateForClient = [
            'accountName' => $sessionData['accountName'],
            'tracks' => $sessionData['tracks'],
            'nowPlayingIdx' => $sessionData['nowPlayingIdx'],
            'sentIdx' => $sessionData['sentIdx'],
            'customTrack' => $sessionData['customTrack'] ?? null,
            'stateVersion' => (int)$sessionData['stateVersion']
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
$tokenHash = $sessionData[$role . 'AuthTokenHash'] ?? '';
if (!is_string($token) || $tokenHash === '' || strlen($token) > 200 || !password_verify($token, $tokenHash)) {
    flock($fp, LOCK_UN);
    fclose($fp);
    sendErrorAndExit('Unauthorized');
}

if ($action === 'sync') {
    $stateForClient = [
        'tracks' => $sessionData['tracks'],
        'nowPlayingIdx' => $sessionData['nowPlayingIdx'],
        'sentIdx' => $sessionData['sentIdx'],
        'customTrack' => $sessionData['customTrack'] ?? null,
        'stateVersion' => (int)$sessionData['stateVersion']
    ];
    flock($fp, LOCK_UN);
    fclose($fp);
    echo json_encode(['success' => true, 'state' => $stateForClient]);
    exit;
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
$previousSessionData = $sessionData;

if ($action === 'send' && $role === 'dj') {
    $sendIdx = filter_var($input['sendIdx'] ?? null, FILTER_VALIDATE_INT, ['options' => ['default' => -1]]);
    $customTrack = $input['customTrack'] ?? null;
    
    if (is_array($customTrack) && isset($customTrack['title']) && is_string($customTrack['title']) && trim($customTrack['title']) !== '') {
        $cleanTitle = safeTruncate(trim($customTrack['title']), 500);
        $cleanArtist = isset($customTrack['artist']) && is_string($customTrack['artist'])
            ? safeTruncate(trim($customTrack['artist']), 200) : '';
        if ($cleanArtist === '') $cleanArtist = '-';
        
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
        $sessionData['nowPlayingIdx'] = $sendIdx;
        $eventPayload = [
            'action' => 'send',
            'sentIdx' => $sendIdx,
            'nowPlayingIdx' => $sendIdx,
            'customTrack' => null
        ];
    } else {
        flock($fp, LOCK_UN);
        fclose($fp);
        sendErrorAndExit('Invalid send parameters');
    }
} 
elseif ($action === 'ready' && $role === 'vj') {
    $readyForVersion = filter_var($input['readyForVersion'] ?? null, FILTER_VALIDATE_INT, ['options' => ['default' => -1]]);
    if ($readyForVersion !== (int)$sessionData['stateVersion']) {
        flock($fp, LOCK_UN);
        fclose($fp);
        sendErrorAndExit('READY version does not match current state', $action, 409, 'READY_VERSION_MISMATCH');
    }
    $readyFile = DATA_DIR . $sessionId . '.ready.json';
    $readyData = is_file($readyFile) ? json_decode((string)file_get_contents($readyFile), true) : null;
    if (is_array($readyData) && ($readyData['stateVersion'] ?? -1) === $readyForVersion) {
        flock($fp, LOCK_UN);
        fclose($fp);
        sendErrorAndExit('READY already sent for this version', $action, 409, 'READY_DUPLICATE');
    }
    file_put_contents($readyFile, json_encode(['stateVersion' => $readyForVersion, 'created_at' => $sessionData['created_at']]), LOCK_EX);
    $eventPayload = [
        'action' => 'vj-ready',
        'stateVersion' => (int)$sessionData['stateVersion'],
        'readyForVersion' => $readyForVersion
    ];
}
else {
    flock($fp, LOCK_UN);
    fclose($fp);
    sendErrorAndExit('Invalid action');
}

// データの保存（変更があった場合）
if ($action === 'send') {
    $sessionData['stateVersion'] = (int)$sessionData['stateVersion'] + 1;
    $eventPayload['stateVersion'] = (int)$sessionData['stateVersion'];
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($sessionData));
    fflush($fp);
}

$eventNeedsPusher = is_array($eventPayload)
    && $PUSHER_APP_ID !== 'YOUR_PUSHER_APP_ID';
$pusherResponse = true;
if ($eventNeedsPusher) {
    $pusherResponse = sendPusherEvent(
        $PUSHER_APP_ID,
        $PUSHER_KEY,
        $PUSHER_SECRET,
        $PUSHER_CLUSTER,
        "session-{$sessionId}",
        'state-updated',
        $eventPayload
    );
}

if ($pusherResponse === false) {
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($previousSessionData));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    $rollbackPayload = [
        'action' => 'rollback',
        'stateVersion' => (int)$previousSessionData['stateVersion'],
        'sentIdx' => (int)$previousSessionData['sentIdx'],
        'nowPlayingIdx' => (int)$previousSessionData['nowPlayingIdx'],
        'customTrack' => $previousSessionData['customTrack'] ?? null
    ];
    if ($eventNeedsPusher) {
        sendPusherEvent(
            $PUSHER_APP_ID,
            $PUSHER_KEY,
            $PUSHER_SECRET,
            $PUSHER_CLUSTER,
            "session-{$sessionId}",
            'state-updated',
            $rollbackPayload
        );
    }
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'errorCode' => 'PUSHER_DELIVERY_FAILED',
        'error' => 'Pusher delivery failed'
    ]);
    exit;
}

flock($fp, LOCK_UN);
fclose($fp);

$response = ['success' => true];
if (is_array($eventPayload)) {
    $response += $eventPayload;
}
echo json_encode($response);


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
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if (curl_errno($ch)) {
            apiLog('Pusher', 'curl error: ' . curl_error($ch));
            curl_close($ch);
            return false;
        }
        curl_close($ch);
        return ($httpCode >= 200 && $httpCode < 300) ? $response : false;
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
            return false;
        }
        return $response;
    }
}
