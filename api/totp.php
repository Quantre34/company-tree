<?php
/**
 * CompanyTree — admin 2FA (TOTP, RFC 6238) verification endpoint.
 *
 * Gates the one admin-only operation the app has: changing the company
 * password (see tree.php's write-proof check, and App.tsx's admin panel).
 * A correct 6-digit code mints a short-lived, single-use admin token that
 * tree.php will accept once as X-Admin-Token on a write whose write-proof
 * changes.
 *
 * The TOTP secret itself is provisioned OUT OF BAND (SFTP, directly into
 * private/tree-data/totp-secret.txt) — never generated or returned by an
 * HTTP endpoint, so there's no "fetch the secret" attack surface at all.
 *
 * Unlike the vault endpoint, this performs a REAL server-side authentication
 * decision (a 6-digit code is only ~1M possibilities), so it's rate-limited
 * hard: 5 attempts per 5 minutes per IP.
 */

declare(strict_types=1);
require __DIR__ . '/_lib.php';

header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');

$dataDir = resolve_data_dir(__DIR__);

rate_limit($dataDir, 'totp', 5, 300);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    fail(405, 'method not allowed');
}

$secretPath = $dataDir . '/totp-secret.txt';
$secret = trim((string)(@file_get_contents($secretPath) ?: ''));
if ($secret === '') fail(503, 'admin 2FA not configured');

$body = json_decode(file_get_contents('php://input') ?: '', true);
$code = is_array($body) ? trim((string)($body['code'] ?? '')) : '';
if (!preg_match('/^\d{6}$/', $code)) fail(400, 'invalid code format');

// --- RFC 6238 TOTP (SHA-1, 30s step, 6 digits) ---
function totp_base32_decode(string $b32): string {
    $b32 = strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $b32) ?? '');
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    foreach (str_split($b32) as $c) {
        $val = strpos($alphabet, $c);
        if ($val === false) continue;
        $bits .= str_pad(decbin($val), 5, '0', STR_PAD_LEFT);
    }
    $bytes = '';
    foreach (str_split($bits, 8) as $byte) {
        if (strlen($byte) < 8) continue;
        $bytes .= chr(bindec($byte));
    }
    return $bytes;
}

function totp_code_at(string $secretB32, int $timestamp, int $step = 30, int $digits = 6): string {
    $counter = intdiv($timestamp, $step);
    $key = totp_base32_decode($secretB32);
    $counterBytes = pack('N*', 0, $counter);
    $hash = hash_hmac('sha1', $counterBytes, $key, true);
    $offset = ord($hash[strlen($hash) - 1]) & 0x0F;
    $truncated = ((ord($hash[$offset]) & 0x7F) << 24)
        | ((ord($hash[$offset + 1]) & 0xFF) << 16)
        | ((ord($hash[$offset + 2]) & 0xFF) << 8)
        | (ord($hash[$offset + 3]) & 0xFF);
    return str_pad((string)($truncated % (10 ** $digits)), $digits, '0', STR_PAD_LEFT);
}

// ±1 step tolerance for clock skew between server and the admin's phone.
$now = time();
$ok = false;
for ($i = -1; $i <= 1; $i++) {
    if (hash_equals(totp_code_at($secret, $now + ($i * 30)), $code)) { $ok = true; break; }
}

if (!$ok) fail(401, 'invalid code');

$token = mint_admin_token($dataDir);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['adminToken' => $token, 'expiresIn' => 300]);
