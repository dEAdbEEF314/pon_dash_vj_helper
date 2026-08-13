<?php
/**
 * Pon Dash VJ Helper - セッション登録 API
 * 
 * セキュリティ対策:
 * - tracks 配列のバリデーション＆サニタイズ (H-1, M-3)
 * - CORSヘッダー (H-3)
 * - 登録数制限（DoS対策）
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

// CORS設定 (H-3)
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

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

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

define('DATA_DIR', '../data/');
const MAX_TRACKS = 500;        // プレイリストの最大曲数
const MAX_TITLE_LENGTH = 500;  // 曲名の最大文字数
const MAX_ARTIST_LENGTH = 200; // アーティスト名の最大文字数
define('SESSION_LIFETIME', $SESSION_LIFETIME);

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

garbageCollectExpiredData();

// データディレクトリが存在しなければ作成
if (!file_exists(DATA_DIR)) {
    mkdir(DATA_DIR, 0755, true);
    // セキュリティのための.htaccess作成
    file_put_contents(DATA_DIR . '.htaccess', "Deny from all\n");
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

if (!is_array($input)
    || !isset($input['accountName'], $input['djPassword'], $input['vjPassword'], $input['tracks'])
    || !is_string($input['accountName'])
    || !is_string($input['djPassword'])
    || !is_string($input['vjPassword'])
    || !preg_match('/^[A-Za-z0-9_-]{1,100}$/', $input['accountName'])
    || strlen($input['djPassword']) > 200
    || strlen($input['vjPassword']) > 200
    || $input['djPassword'] === ''
    || $input['vjPassword'] === '') {
    echo json_encode(['success' => false, 'error' => 'Invalid parameters']);
    exit;
}

// ========================================
// tracks 配列のバリデーション (M-3)
// ========================================
if (!is_array($input['tracks'])) {
    echo json_encode(['success' => false, 'error' => 'Tracks must be an array']);
    exit;
}
if (count($input['tracks']) > MAX_TRACKS) {
    echo json_encode(['success' => false, 'error' => 'Too many tracks (max ' . MAX_TRACKS . ')']);
    exit;
}
if (count($input['tracks']) === 0) {
    echo json_encode(['success' => false, 'error' => 'Tracks cannot be empty']);
    exit;
}

// 安全な文字列切り出し（mbstring非対応環境へのフォールバック）
function safe_truncate($str, $length) {
    if (function_exists('mb_substr')) {
        return mb_substr($str, 0, $length, 'UTF-8');
    }
    // mb_substrがない環境ではバイト単位で切り出し（文字化けリスクあり）
    return substr($str, 0, $length);
}

// tracks のサニタイズ (文字数制限のみ適用。XSS対策はJS側の textContent で担保)
$sanitizedTracks = [];
foreach ($input['tracks'] as $i => $track) {
    if (!is_array($track) || !isset($track['title']) || !is_string($track['title'])) {
        echo json_encode(['success' => false, 'error' => "Invalid track format at index {$i}"]);
        exit;
    }
    $sanitizedTracks[] = [
        'title' => safe_truncate(
            $track['title'],
            MAX_TITLE_LENGTH
        ),
        'artist' => safe_truncate(
            isset($track['artist']) && is_string($track['artist']) ? $track['artist'] : 'Unknown',
            MAX_ARTIST_LENGTH
        )
    ];
}

// セッションID生成
$sessionId = bin2hex(random_bytes(16));
$sessionFile = DATA_DIR . $sessionId . '.json';

// パスワードのハッシュ化
$djHash = password_hash($input['djPassword'], PASSWORD_DEFAULT);
$vjHash = password_hash($input['vjPassword'], PASSWORD_DEFAULT);

$sessionData = [
    // JS側で textContent 出力するためHTMLエンティティ化は不要。長さだけ制限。
    'accountName' => safe_truncate($input['accountName'], 100),
    'djPasswordHash' => $djHash,
    'vjPasswordHash' => $vjHash,
    'tracks' => $sanitizedTracks,  // サニタイズ済みの tracks を保存
    'nowPlayingIdx' => 0,
    'sentIdx' => -1,
    'created_at' => time()
];

// ファイル保存
$fp = fopen($sessionFile, 'w');
if ($fp) {
    if (flock($fp, LOCK_EX)) {
        fwrite($fp, json_encode($sessionData));
        flock($fp, LOCK_UN);
        fclose($fp);
        
        echo json_encode([
            'success' => true,
            'sessionId' => $sessionId
        ]);
    } else {
        fclose($fp);
        echo json_encode(['success' => false, 'error' => 'Could not lock data file']);
    }
} else {
    echo json_encode(['success' => false, 'error' => 'Could not write data file']);
}
