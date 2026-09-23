<?php
/**
 * CompanyTree — server-side encrypted vault endpoint.
 *
 * The frontend encrypts the whole org document with AES-256-GCM + PBKDF2
 * client-side and PUTs the opaque blob here. GETs return the same blob.
 * The server NEVER sees plaintext or the password.
 *
 * Data is stored in the sibling `private/` folder (a HestiaCP convention
 * that is outside doc root but inside PHP's open_basedir sandbox):
 *
 *   /home/USER/web/DOMAIN/private/tree-data/vault.bin
 *
 * If your host lacks a `private/` folder, the script falls back to a
 * `.data/` subfolder inside public_html (protected by .htaccess).
 *
 * Concurrency: PUT with `If-Match: <version>` (version = mtime). If
 * versions don't match, server returns 409 so the client can reload.
 *
 * Write authentication: every PUT also carries `X-Write-Proof`, a stable
 * digest the client derives from the password (see crypto/vault.ts) — the
 * server just compares it to what's on file and rejects a mismatch (403).
 * A write whose proof legitimately changes (a deliberate password change,
 * or establishing the first baseline on a vault that predates this) must
 * also carry a valid `X-Admin-Token`, minted by totp.php after a correct
 * 2FA code.
 */

declare(strict_types=1);
require __DIR__ . '/_lib.php';

header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');

$dataDir = resolve_data_dir(__DIR__);
$path = $dataDir . '/vault.bin';

// Version = mtime + 6-char content hash. Adding the hash defeats the
// same-second-collision failure mode where two saves within one second get
// the same mtime — the client would then miss the 409 and silently overwrite.
function version_of(string $file): string {
    if (!file_exists($file)) return '';
    $mt = (string)filemtime($file);
    $sz = (string)filesize($file);
    $hash = substr(md5_file($file) ?: '000000', 0, 6);
    return $mt . '-' . $sz . '-' . $hash;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'HEAD' || $method === 'GET') {
    // Generous: normal traffic is one HEAD per open tab every ~20s (App.tsx
    // sync poll) plus occasional loads. This budget comfortably covers many
    // devices sharing one NAT'd IP while still capping scraping bursts.
    rate_limit($dataDir, 'read', 60, 60);

    if (!file_exists($path)) {
        http_response_code(404);
        header('Content-Type: application/json; charset=utf-8');
        if ($method === 'GET') echo json_encode(['error' => 'no vault']);
        exit;
    }
    header('Content-Type: application/octet-stream');
    header('X-Vault-Version: ' . version_of($path));
    header('Content-Length: ' . filesize($path));
    if ($method === 'GET') readfile($path);
    exit;
}

if ($method === 'PUT') {
    // Writes are rarer and more expensive (encryption + disk I/O) than
    // reads, so a tighter budget — still generous enough for autosave
    // retries and several people editing at once behind one NAT'd IP.
    rate_limit($dataDir, 'write', 20, 60);

    $body = file_get_contents('php://input');
    if ($body === false || $body === '') fail(400, 'empty body');
    if (strlen($body) > 20 * 1024 * 1024) fail(413, 'too large');

    // Sanity: the client-side blob is base64(RIGITREE1 | salt | iv | ct).
    // Base64 of the literal "RIGITREE1" prefix is "UklHSVRSRUUx" — reject any
    // payload that doesn't start with that so random PUTs can't corrupt the
    // vault into an un-openable state.
    if (strncmp($body, 'UklHSVRSRUUx', 12) !== 0) {
        fail(400, 'invalid vault format');
    }

    $vaultExisted = file_exists($path);
    $proofPath = $dataDir . '/write-proof';
    $storedProof = trim((string)(@file_get_contents($proofPath) ?: ''));
    $incomingProof = trim($_SERVER['HTTP_X_WRITE_PROOF'] ?? '');

    // Write-proof gate. Only matters once real data exists — a brand-new
    // vault has nothing to protect yet, so its first write is unconditional
    // and simply establishes the baseline going forward.
    if ($vaultExisted) {
        $proofMismatch = ($storedProof === '') || !hash_equals($storedProof, $incomingProof);
        if ($proofMismatch) {
            $adminToken = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
            if (!admin_token_is_valid($dataDir, $adminToken)) {
                fail(403, $storedProof === ''
                    ? 'admin verification required to establish write protection'
                    : 'admin verification required to change the vault password');
            }
            consume_admin_token($dataDir, $adminToken);
        }
    }

    // Serialise the read-version → write pair with a sidecar advisory lock.
    // Without this, two concurrent PUTs can both pass the version check and
    // then race the rename, silently losing one save.
    $lockPath = $dataDir . '/vault.lock';
    $lockFp = @fopen($lockPath, 'c');
    if ($lockFp === false) fail(500, 'lock open failed');
    if (!flock($lockFp, LOCK_EX)) {
        fclose($lockFp);
        fail(500, 'lock failed');
    }

    // Optimistic concurrency — re-read version INSIDE the lock.
    // A vault that already exists MUST be conflicted if the client sends no
    // If-Match (or the wrong one) — treating a missing header as "go ahead"
    // would let a stale "no vault yet" client (e.g. one that mis-read a
    // transient error as 404) blindly clobber real data with a fresh
    // "create" write. Only a truly empty $current (no file yet) skips this.
    $expected = $_SERVER['HTTP_IF_MATCH'] ?? '';
    $current  = version_of($path);
    $conflict = ($current !== '' && $expected !== $current);

    if ($conflict) {
        http_response_code(409);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Vault-Version: ' . $current);
        echo json_encode(['error' => 'version mismatch', 'currentVersion' => $current]);
    } else {
        $tmp = $path . '.tmp.' . bin2hex(random_bytes(4));
        if (file_put_contents($tmp, $body) === false) {
            $err = 'write failed: ' . (error_get_last()['message'] ?? 'unknown');
            flock($lockFp, LOCK_UN); fclose($lockFp);
            fail(500, $err);
        }
        if (!rename($tmp, $path)) {
            $err = 'rename failed: ' . (error_get_last()['message'] ?? 'unknown');
            @unlink($tmp);
            flock($lockFp, LOCK_UN); fclose($lockFp);
            fail(500, $err);
        }
        @chmod($path, 0600);
        if ($incomingProof !== '') {
            @file_put_contents($proofPath, $incomingProof);
            @chmod($proofPath, 0600);
        }
        header('X-Vault-Version: ' . version_of($path));
        http_response_code(204);
    }

    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    exit;
}

if ($method === 'DELETE') {
    // Explicit reset for admin — requires a specific header token that only
    // an operator can set (no default value → route disabled unless the
    // deployment adds it). Kept minimal: not used by the client UI.
    fail(405, 'reset via UI is disabled');
}

http_response_code(405);
header('Allow: GET, HEAD, PUT');
fail(405, 'method not allowed');
