<?php
/**
 * Shared helpers for the CompanyTree API scripts (tree.php, totp.php).
 * Nothing in this file produces output on its own — it's only ever
 * `require`d, never a request target itself.
 */
declare(strict_types=1);

function resolve_data_dir(string $apiDir): string {
    // __DIR__ of the caller = .../public_html/api → siblings: ../../private
    $candidates = [
        $apiDir . '/../../private/tree-data',   // HestiaCP / Vestacp layout
        $apiDir . '/../.data',                  // fallback inside public_html (blocked by .htaccess)
    ];
    $dataDir = null;
    foreach ($candidates as $c) {
        $parent = dirname($c);
        if (@is_dir($parent) && @is_writable($parent)) { $dataDir = $c; break; }
        if (@is_dir($c) && @is_writable($c)) { $dataDir = $c; break; }
    }
    if ($dataDir === null) {
        $dataDir = $apiDir . '/../.data';
    }
    if (!is_dir($dataDir)) {
        @mkdir($dataDir, 0700, true);
    }
    return $dataDir;
}

function fail(int $code, string $msg): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $msg]);
    exit;
}

// Best-effort real client IP. HestiaCP's stack is nginx (TLS) proxying to
// Apache/PHP, so REMOTE_ADDR may be the local proxy rather than the visitor.
// Trust X-Forwarded-For / X-Real-IP (set by the front proxy) when present;
// fall back to REMOTE_ADDR otherwise. This is only used to bucket rate
// limits, never for access control, so a spoofed header at worst shares a
// bucket with someone else — it can't be used to bypass a limit.
function client_ip(): string {
    $xff = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($xff !== '') {
        $first = trim(explode(',', $xff)[0]);
        if ($first !== '') return $first;
    }
    $xri = $_SERVER['HTTP_X_REAL_IP'] ?? '';
    if ($xri !== '') return trim($xri);
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

// Simple fixed-window per-IP rate limit backed by a small file in the same
// private data directory used for the vault. Fails OPEN (never blocks a
// legitimate request) if the lock/file can't be created — a limiter that
// breaks saves is worse than no limiter.
function rate_limit(string $dataDir, string $bucket, int $limit, int $windowSec): void {
    $ip = client_ip();
    $safeIp = preg_replace('/[^a-zA-Z0-9.:]/', '_', $ip) ?: 'unknown';
    $rlPath = $dataDir . '/.rl-' . $bucket . '-' . $safeIp;
    $lockFp = @fopen($rlPath . '.lock', 'c');
    if ($lockFp === false) return; // fail open
    if (!flock($lockFp, LOCK_EX)) { fclose($lockFp); return; } // fail open

    $now = time();
    $state = ['count' => 0, 'start' => $now];
    $raw = @file_get_contents($rlPath);
    if ($raw !== false) {
        $decoded = json_decode($raw, true);
        if (is_array($decoded) && isset($decoded['count'], $decoded['start'])) $state = $decoded;
    }
    if ($now - $state['start'] >= $windowSec) {
        $state = ['count' => 0, 'start' => $now];
    }
    $state['count']++;
    @file_put_contents($rlPath, json_encode($state));

    $exceeded = $state['count'] > $limit;
    $retryAfter = max(1, $windowSec - ($now - $state['start']));

    flock($lockFp, LOCK_UN);
    fclose($lockFp);

    // Opportunistic cleanup so .rl-* files don't accumulate forever as IPs
    // churn — cheap (1-in-50 requests), independent of the fail-open path.
    if (random_int(1, 50) === 1) {
        foreach (glob($dataDir . '/.rl-*') ?: [] as $f) {
            if (is_file($f) && @filemtime($f) < $now - 3600) @unlink($f);
        }
    }

    if ($exceeded) {
        http_response_code(429);
        header('Retry-After: ' . $retryAfter);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'rate limited', 'retryAfter' => $retryAfter]);
        exit;
    }
}

// --- Admin tokens ---------------------------------------------------------
// Minted by totp.php after a correct 2FA code, required by tree.php to
// accept any write whose write-proof differs from what's on file (i.e. a
// password change, or establishing the very first baseline on a vault that
// predates this feature). Single-use, short-lived, stored as a salted hash
// so a stolen admin-tokens.json alone isn't a bearer credential forever
// (tokens expire in minutes regardless).

function mint_admin_token(string $dataDir): string {
    $token = bin2hex(random_bytes(24));
    $hash = hash('sha256', $token);
    $lockFp = @fopen($dataDir . '/admin-tokens.lock', 'c');
    if ($lockFp !== false && flock($lockFp, LOCK_EX)) {
        $list = admin_token_list_load($dataDir);
        $now = time();
        $list = array_values(array_filter($list, fn($e) => ($e['expires'] ?? 0) > $now));
        $list[] = ['hash' => $hash, 'expires' => $now + 300]; // 5 minutes
        @file_put_contents($dataDir . '/admin-tokens.json', json_encode($list));
        @chmod($dataDir . '/admin-tokens.json', 0600);
        flock($lockFp, LOCK_UN);
        fclose($lockFp);
    }
    return $token;
}

function admin_token_list_load(string $dataDir): array {
    $raw = @file_get_contents($dataDir . '/admin-tokens.json');
    if ($raw === false) return [];
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

function admin_token_is_valid(string $dataDir, string $token): bool {
    if ($token === '') return false;
    $hash = hash('sha256', $token);
    $now = time();
    foreach (admin_token_list_load($dataDir) as $e) {
        if (($e['hash'] ?? '') !== '' && hash_equals((string)$e['hash'], $hash) && ($e['expires'] ?? 0) > $now) {
            return true;
        }
    }
    return false;
}

function consume_admin_token(string $dataDir, string $token): void {
    $hash = hash('sha256', $token);
    $lockFp = @fopen($dataDir . '/admin-tokens.lock', 'c');
    if ($lockFp === false || !flock($lockFp, LOCK_EX)) return;
    $now = time();
    $list = array_values(array_filter(
        admin_token_list_load($dataDir),
        fn($e) => ($e['hash'] ?? '') !== $hash && ($e['expires'] ?? 0) > $now
    ));
    @file_put_contents($dataDir . '/admin-tokens.json', json_encode($list));
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
}
