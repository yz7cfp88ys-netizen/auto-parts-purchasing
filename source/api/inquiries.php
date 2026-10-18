<?php
declare(strict_types=1);

// Deploy only on PHP hosting. Records must remain outside the public document root.
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function reply(int $status, array $body): never {
    http_response_code($status);
    echo json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    exit;
}

function field(array $data, string $key, int $limit, bool $required = true): string {
    $value = $data[$key] ?? '';
    if (!is_string($value) || strlen($value) > $limit || str_contains($value, "\0")) {
        reply(422, ['error' => 'Invalid field: ' . $key]);
    }
    $value = trim($value);
    if ($required && $value === '') reply(422, ['error' => 'Missing field: ' . $key]);
    return $value;
}

function atomicSave(string $path, array $data): void {
    $json = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    $temporary = $path . '.' . bin2hex(random_bytes(8)) . '.tmp';
    $file = @fopen($temporary, 'xb');
    if ($file === false) throw new RuntimeException('Storage unavailable');
    try {
        @chmod($temporary, 0600);
        $offset = 0;
        while ($offset < strlen($json)) {
            $written = fwrite($file, substr($json, $offset));
            if ($written === false || $written === 0) throw new RuntimeException('Write failed');
            $offset += $written;
        }
        if (!fflush($file) || (function_exists('fsync') && !fsync($file))) throw new RuntimeException('Flush failed');
        fclose($file);
        $file = null;
        if (!rename($temporary, $path)) throw new RuntimeException('Commit failed');
        if (file_get_contents($path) !== $json) throw new RuntimeException('Readback failed');
    } finally {
        if (is_resource($file)) fclose($file);
        if (is_file($temporary)) @unlink($temporary);
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    reply(405, ['error' => 'Use POST to submit an inquiry.']);
}
if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') {
    reply(415, ['error' => 'JSON required.']);
}
// Browsers must submit from this site. No cross-origin access or external redirects.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    $originHost = parse_url($origin, PHP_URL_HOST);
    $originPort = parse_url($origin, PHP_URL_PORT);
    $authority = strtolower((string)$originHost . ($originPort ? ':' . $originPort : ''));
    if ($authority !== strtolower($_SERVER['HTTP_HOST'] ?? '')) reply(403, ['error' => 'Same-origin requests only.']);
}
if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') reply(403, ['error' => 'Same-origin requests only.']);
$raw = file_get_contents('php://input', false, null, 0, 65537);
if ($raw === false || strlen($raw) > 65536) reply(413, ['error' => 'Inquiry is too large.']);
try { $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR); }
catch (JsonException) { reply(400, ['error' => 'Invalid JSON.']); }
if (!is_array($data) || array_is_list($data)) reply(422, ['error' => 'An inquiry object is required.']);
$requestId = field($data, 'requestId', 36);
if (!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/D', $requestId)) {
    reply(422, ['error' => 'Invalid request ID.']);
}
if (field($data, 'website', 300, false) !== '') reply(422, ['error' => 'Unable to accept this inquiry.']);
$inquiry = [];
foreach (['name' => 400, 'email' => 200, 'company' => 640, 'country' => 400, 'business' => 100, 'orderType' => 100] as $key => $limit) {
    $inquiry[$key] = field($data, $key, $limit);
}
if (!filter_var($inquiry['email'], FILTER_VALIDATE_EMAIL)) reply(422, ['error' => 'Invalid email.']);
if (!in_array($inquiry['business'], ['Auto repair workshop', 'Motorcycle workshop', 'Parts distributor / wholesaler', 'Retailer / online seller', 'Other business'], true)
    || !in_array($inquiry['orderType'], ['Small batch / mixed parts', 'Bulk / factory order', 'Not sure yet'], true)) {
    reply(422, ['error' => 'Invalid business or order type.']);
}
$parts = $data['parts'] ?? null;
if (!is_array($parts) || !array_is_list($parts) || count($parts) < 1 || count($parts) > 30) reply(422, ['error' => 'Include 1 to 30 parts.']);
$inquiry['parts'] = [];
foreach ($parts as $part) {
    if (!is_array($part)) reply(422, ['error' => 'Invalid part.']);
    $quantity = $part['quantity'] ?? null;
    if (!is_int($quantity) || $quantity < 1 || $quantity > 1000000) reply(422, ['error' => 'Invalid quantity.']);
    $inquiry['parts'][] = ['description' => field($part, 'description', 1200), 'quantity' => $quantity];
}
$services = $data['services'] ?? [];
if (!is_array($services) || !array_is_list($services) || count($services) > 4) reply(422, ['error' => 'Invalid services.']);
foreach ($services as $service) {
    if (!is_string($service) || !in_array($service, ['Product sourcing', 'Factory sourcing', 'Inspection', 'Consolidated shipping'], true)) reply(422, ['error' => 'Invalid service.']);
}
$inquiry['services'] = array_values(array_unique($services));
$inquiry['notes'] = field($data, 'notes', 12000, false);
$reference = 'IQ-' . strtoupper(str_replace('-', '', $requestId));
$hash = hash('sha256', json_encode($inquiry, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));

try {
    $publicRoot = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    if ($publicRoot === false) throw new RuntimeException('No document root');
    $directory = getenv('INQUIRY_STORAGE_DIR') ?: dirname($publicRoot) . '/private/auto-parts-inquiries';
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Cannot create storage');
    $directory = realpath($directory);
    $publicPrefix = rtrim(str_replace('\\', '/', $publicRoot), '/') . '/';
    $storagePrefix = rtrim(str_replace('\\', '/', (string)$directory), '/') . '/';
    if ($directory === false || str_starts_with(strtolower($storagePrefix), strtolower($publicPrefix))) throw new RuntimeException('Storage must be private');
    $lock = @fopen($directory . '/.write.lock', 'c');
    if ($lock === false || !flock($lock, LOCK_EX)) throw new RuntimeException('Cannot lock storage');
    $recordPath = $directory . '/' . $reference . '.json';
    if (is_file($recordPath)) {
        $record = json_decode(file_get_contents($recordPath), true, 64, JSON_THROW_ON_ERROR);
        if (!hash_equals($record['payloadHash'] ?? '', $hash)) reply(409, ['error' => 'Request ID already used for different details.']);
        reply(200, ['status' => 'saved', 'reference' => $reference, 'receivedAt' => $record['receivedAt']]);
    }
    $ratePath = $directory . '/.rate-limit.json';
    $rates = is_file($ratePath) ? json_decode(file_get_contents($ratePath), true, 64, JSON_THROW_ON_ERROR) : [];
    $now = time();
    $rates = array_filter($rates, fn($entry) => is_array($entry) && ($entry['until'] ?? 0) > $now);
    // Do not trust client-supplied forwarding headers or retain raw IP addresses.
    $sender = hash('sha256', $directory . '|' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    foreach ([$sender => 10, 'global' => 200] as $key => $limit) {
        if (($rates[$key]['count'] ?? 0) >= $limit) {
            header('Retry-After: ' . max(1, $rates[$key]['until'] - $now));
            reply(429, ['error' => 'Too many inquiries. Please try later or download your inquiry.']);
        }
        $rates[$key] = ['until' => $rates[$key]['until'] ?? $now + 3600, 'count' => ($rates[$key]['count'] ?? 0) + 1];
    }
    atomicSave($ratePath, $rates);
    $record = ['version' => 1, 'reference' => $reference, 'receivedAt' => gmdate('Y-m-d\TH:i:s\Z'), 'payloadHash' => $hash, 'inquiry' => $inquiry];
    atomicSave($recordPath, $record);
    flock($lock, LOCK_UN);
    fclose($lock);
    reply(201, ['status' => 'saved', 'reference' => $reference, 'receivedAt' => $record['receivedAt']]);
} catch (Throwable) {
    // Do not expose paths, customer details or server diagnostics in the response.
    reply(503, ['error' => 'Receipt could not be confirmed. Retry with the same details or download your inquiry.']);
}
