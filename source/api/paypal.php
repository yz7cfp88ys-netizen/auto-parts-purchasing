<?php
declare(strict_types=1);

// Server-only REST integration. Credentials never enter public configuration or HTML.
function paypalRequest(array $settings, string $method, string $path, ?array $body = null, string $requestId = ''): array {
    $p = $settings['paypal'] ?? [];
    if (!in_array($p['environment'] ?? '', ['sandbox','live'], true) || trim($p['clientId'] ?? '') === '' || trim($p['clientSecret'] ?? '') === '') failOrder(503, 'PayPal is not configured. No payment has been taken');
    if (!function_exists('curl_init')) failOrder(503, 'PayPal requires the PHP cURL extension');
    $base = $p['environment'] === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    $ch = curl_init($base . '/v1/oauth2/token');
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>25,CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>'grant_type=client_credentials',CURLOPT_USERPWD=>$p['clientId'].':'.$p['clientSecret'],CURLOPT_HTTPHEADER=>['Accept: application/json']]);
    $raw = curl_exec($ch); $status = curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch);
    if ($raw === false || $status !== 200) failOrder(502, 'PayPal authentication unavailable; no payment is confirmed');
    $token = json_decode($raw,true,32,JSON_THROW_ON_ERROR)['access_token'] ?? '';
    if (!is_string($token) || $token === '') failOrder(502, 'PayPal authentication unavailable');
    $headers = ['Authorization: Bearer '.$token,'Content-Type: application/json','Prefer: return=representation'];
    if ($requestId !== '') $headers[] = 'PayPal-Request-Id: '.$requestId;
    $ch = curl_init($base . $path);
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>30,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>$headers]);
    if ($body !== null) curl_setopt($ch,CURLOPT_POSTFIELDS,jsonOrder($body));
    $raw = curl_exec($ch); $status = curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch);
    if ($raw === false) failOrder(502, 'PayPal response was not confirmed. Retry to reconcile the same payment');
    $response = json_decode($raw,true,64,JSON_THROW_ON_ERROR);
    if ($status < 200 || $status >= 300) {
        if ($status === 422 && ($response['details'][0]['issue'] ?? '') === 'ORDER_ALREADY_CAPTURED') return ['alreadyCaptured'=>true];
        failOrder(502, 'PayPal has not confirmed this payment. Retry or contact the sourcing team');
    }
    return $response;
}
function paypalAmount(int $cents): string { return intdiv($cents,100) . '.' . str_pad((string)($cents%100),2,'0',STR_PAD_LEFT); }
function paypalCompleted(array $response, array $order, string $paypalId): array {
    if (($response['id'] ?? '') !== $paypalId || ($response['status'] ?? '') !== 'COMPLETED') failOrder(409, 'PayPal payment is not completed');
    $units = $response['purchase_units'] ?? [];
    if (count($units) !== 1 || ($units[0]['custom_id'] ?? '') !== $order['orderNumber'] . '-Q' . $order['quoteRevision']) failOrder(409, 'PayPal order reference mismatch');
    $captures = $units[0]['payments']['captures'] ?? [];
    if (count($captures) !== 1) failOrder(409, 'PayPal capture needs reconciliation');
    $c = $captures[0];
    if (($c['status'] ?? '') !== 'COMPLETED' || ($c['amount']['currency_code'] ?? '') !== $order['currency'] || ($c['amount']['value'] ?? '') !== paypalAmount($order['totalCents']) || !preg_match('/^[A-Z0-9]{1,64}$/D',$c['id'] ?? '')) failOrder(409, 'PayPal captured amount or currency does not match the confirmed order');
    return $c;
}
