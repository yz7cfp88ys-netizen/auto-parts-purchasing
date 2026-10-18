<?php
declare(strict_types=1);
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

final class OrderError extends RuntimeException {
    public function __construct(public int $status, string $message) { parent::__construct($message); }
}
function failOrder(int $status, string $message): never { throw new OrderError($status, $message); }
function strField(array $data, string $key, int $limit = 1000, bool $required = true): string {
    $v = $data[$key] ?? '';
    if (!is_string($v) || strlen($v) > $limit || str_contains($v, "\0")) failOrder(422, 'Invalid ' . $key);
    $v = trim($v);
    if ($required && $v === '') failOrder(422, 'Missing ' . $key);
    return $v;
}
function intField(array $data, string $key, int $min = 0, int $max = 1000000000000): int {
    $v = $data[$key] ?? null;
    if (!is_int($v) || $v < $min || $v > $max) failOrder(422, 'Invalid ' . $key);
    return $v;
}
function jsonOrder(mixed $value): string { return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE); }
function queryOrder(PDO $db, string $sql, array $params = []): PDOStatement {
    $s = $db->prepare($sql); $s->execute($params); return $s;
}
function nowOrder(): string { return gmdate('Y-m-d\TH:i:s\Z'); }
function outputOrder(array $o, bool $admin): array {
    unset($o['quoteAccessHash']);
    if (!$admin) foreach ($o['items'] as &$i) unset($i['supplier'], $i['wholesaleCostCents'], $i['stockVerified']);
    return $o;
}
function sumOrder(array $items): array {
    $known = 0; $pending = 0;
    foreach ($items as $i) {
        if ($i['availability'] === 'unavailable') continue;
        if ($i['unitPriceCents'] === null) { $pending++; continue; }
        $known += $i['quantity'] * $i['unitPriceCents'];
        if ($known > 1000000000000) failOrder(422, 'Order amount exceeds limit');
    }
    return [$known, $pending];
}
function saveOrder(PDO $db, array $o, string $event): void {
    queryOrder($db, 'UPDATE orders SET document = ? WHERE order_no = ?', [jsonOrder($o), $o['orderNumber']]);
    queryOrder($db, 'INSERT INTO events(order_no, version, event, snapshot, created_at) VALUES(?,?,?,?,?)', [$o['orderNumber'], $o['version'], $event, jsonOrder($o), nowOrder()]);
}

$db = null; $transaction = false;
try {
    $method = $_SERVER['REQUEST_METHOD'];
    if (!in_array($method, ['GET', 'POST'], true)) { header('Allow: GET, POST'); failOrder(405, 'Use GET or POST'); }
    $catalogPath = getenv('ORDER_CATALOG_FILE') ?: __DIR__ . '/catalog.json';
    $catalog = json_decode(file_get_contents($catalogPath), true, 32, JSON_THROW_ON_ERROR);
    if (($catalog['currency'] ?? '') !== 'USD' || !is_array($catalog['products'] ?? null)) throw new RuntimeException('Invalid catalog');
    $products = [];
    foreach ($catalog['products'] as $p) {
        if (!preg_match('/^[A-Z0-9_-]{1,64}$/D', $p['sku'] ?? '') || isset($products[$p['sku']])) throw new RuntimeException('Invalid SKU');
        if ($p['unitPriceCents'] !== null && (!is_int($p['unitPriceCents']) || $p['unitPriceCents'] < 1 || $p['unitPriceCents'] > 100000000)) throw new RuntimeException('Invalid catalog price');
        $products[$p['sku']] = ['sku'=>$p['sku'], 'name'=>$p['name'], 'category'=>$p['category'], 'unitPriceCents'=>$p['unitPriceCents']];
    }
    // Verified searchable products join the existing mixed-parts ordering flow.
    // The legacy catalogue remains intact; no sample part numbers are introduced.
    $partsDb = null; $sourceRequest = null;
    if (is_file(__DIR__ . '/parts-core.php')) {
        require_once __DIR__ . '/parts-core.php';
        $partsDb = partsDb();
        foreach ($partsDb->query('SELECT sku,name,category,price_cents,moq,supply_status FROM part_products WHERE published=1')->fetchAll(PDO::FETCH_ASSOC) as $p) {
            $products[$p['sku']] = ['sku'=>$p['sku'],'name'=>$p['name'],'category'=>$p['category'],'unitPriceCents'=>$p['price_cents']===null?null:(int)$p['price_cents'],'moq'=>$p['moq']===null?null:(int)$p['moq'],'supplyStatus'=>$p['supply_status']];
        }
    }
    if ($method === 'GET') {
        echo jsonOrder(['currency'=>'USD', 'products'=>array_values($products)]); exit;
    }
    if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') failOrder(415, 'JSON required');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $h = parse_url($origin, PHP_URL_HOST); $p = parse_url($origin, PHP_URL_PORT);
        if (strtolower((string)$h . ($p ? ':' . $p : '')) !== strtolower($_SERVER['HTTP_HOST'] ?? '')) failOrder(403, 'Same-origin requests only');
    }
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') failOrder(403, 'Same-origin requests only');
    $raw = file_get_contents('php://input', false, null, 0, 131073);
    if ($raw === false || strlen($raw) > 131072) failOrder(413, 'Request is too large');
    try { $data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); }
    catch (JsonException) { failOrder(400, 'Invalid JSON'); }
    if (!is_array($data) || array_is_list($data)) failOrder(422, 'Object required');
    $action = strField($data, 'action', 32);
    if (!in_array($action, ['create','source_convert','read','confirm','paypal_create','paypal_capture','admin_reconcile','admin_list','admin_read','quote','ship'], true)) failOrder(422, 'Unknown action');
    $public = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    if ($public === false) throw new RuntimeException('No document root');
    $dir = getenv('ORDER_STORAGE_DIR') ?: dirname($public) . '/private/auto-parts-orders';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) throw new RuntimeException('Storage unavailable');
    $dir = realpath($dir);
    $prefix = fn(string $s) => strtolower(rtrim(str_replace('\\', '/', $s), '/') . '/');
    if ($dir === false || str_starts_with($prefix($dir), $prefix($public))) throw new RuntimeException('Private storage required');
    $settingsFile = getenv('ORDER_SETTINGS_FILE') ?: $dir . '/settings.json';
    if (is_file($settingsFile) && str_starts_with($prefix((string)realpath($settingsFile)), $prefix($public))) throw new RuntimeException('Private settings required');
    $settings = is_file($settingsFile) ? json_decode(file_get_contents($settingsFile), true, 16, JSON_THROW_ON_ERROR) : [];
    $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $credential = str_starts_with($authorization, 'Bearer ') ? substr($authorization, 7) : '';
    $adminActions = ['admin_list','admin_read','quote','ship','admin_reconcile','source_convert'];
    $admin = in_array($action, $adminActions, true);
    if ($admin) {
        $secret = $settings['adminToken'] ?? '';
        if (!is_string($secret) || strlen($secret) < 32 || str_starts_with($secret, 'REPLACE_')) failOrder(503, 'Order administration is not configured');
        if (!hash_equals($secret, $credential)) failOrder(401, 'Administrator authorization required');
    }
    if ($action === 'source_convert') {
        if (!$partsDb) failOrder(503,'Sourcing service is unavailable');
        $sourceNumber=strField($data,'sourcingNumber',40);
        $sourceRequest=partsQuery($partsDb,'SELECT * FROM sourcing_requests WHERE number=?',[$sourceNumber])->fetch(PDO::FETCH_ASSOC);
        if (!$sourceRequest) failOrder(404,'Sourcing request not found');
        if (!in_array($sourceRequest['status'],['located','order_created'],true)) failOrder(409,'Verify and mark the source as located before creating a private order');
        $sourceDetails=json_decode($sourceRequest['document'],true,16,JSON_THROW_ON_ERROR);
        $sku='SRC-'.strtoupper(substr(hash('sha256',$sourceNumber),0,24));
        $products[$sku]=['sku'=>$sku,'name'=>strField($data,'productName',250),'category'=>'Private sourced part','unitPriceCents'=>null];
        $credential=hash_hmac('sha256','sourced-order|'.$sourceNumber,$settings['adminToken']);
        $sourceCustomer=$data['customer'] ?? [];
        if (!is_array($sourceCustomer)) failOrder(422,'Invalid customer');
        $data=['action'=>'create','requestId'=>$sourceRequest['request_id'],'customer'=>[
            'name'=>$sourceDetails['name'],'email'=>$sourceDetails['email'],'country'=>$sourceDetails['country'],
            'company'=>$sourceDetails['company'] ?: $sourceDetails['name'],'address'=>strField($sourceCustomer,'address',2000)
        ],'items'=>[['sku'=>$sku,'quantity'=>$sourceDetails['quantity'],'specification'=>strField($data,'specification',2000)]],
            'notes'=>'Sourcing request '.$sourceNumber.' | Original number: '.$sourceDetails['partNumber'].' | Vehicle: '.$sourceDetails['vehicle'].' | '.$sourceDetails['requirements'],'website'=>''];
        $action='create';
    }
    $db = new PDO('sqlite:' . $dir . '/orders.sqlite', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    @chmod($dir . '/orders.sqlite', 0600);
    $db->exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
    $db->exec('CREATE TABLE IF NOT EXISTS orders (order_no TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL, access_hash TEXT NOT NULL, document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, order_no TEXT NOT NULL REFERENCES orders(order_no), version INTEGER NOT NULL, event TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(order_no,version));
        CREATE TABLE IF NOT EXISTS payments (reference TEXT PRIMARY KEY, order_no TEXT NOT NULL UNIQUE REFERENCES orders(order_no), amount_cents INTEGER NOT NULL, quote_revision INTEGER NOT NULL, received_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS paypal_orders (paypal_id TEXT PRIMARY KEY, order_no TEXT NOT NULL UNIQUE REFERENCES orders(order_no), quote_revision INTEGER NOT NULL, approval_url TEXT NOT NULL, environment TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS rate_limits (sender TEXT PRIMARY KEY, count INTEGER NOT NULL, until_time INTEGER NOT NULL);');
    // Serialize read/validate/write, including idempotency and quote confirmation.
    $db->exec('BEGIN IMMEDIATE'); $transaction = true;
    $status = 200;
    if ($action === 'create') {
        $requestId = strField($data, 'requestId', 36);
        if (!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/D', $requestId)) failOrder(422, 'Invalid request ID');
        if (!preg_match('/^[a-f0-9]{64}$/D', $credential)) failOrder(422, 'A secure order access key is required');
        if (strField($data, 'website', 200, false) !== '') failOrder(422, 'Unable to accept order');
        $customer = $data['customer'] ?? [];
        if (!is_array($customer)) failOrder(422, 'Invalid customer');
        $c = [];
        foreach (['name'=>200,'email'=>200,'company'=>500,'country'=>200,'address'=>2000] as $k=>$limit) $c[$k] = strField($customer, $k, $limit);
        if (!filter_var($c['email'], FILTER_VALIDATE_EMAIL)) failOrder(422, 'Invalid email');
        $items = $data['items'] ?? null;
        if (!is_array($items) || !array_is_list($items) || count($items) < 1 || count($items) > 100) failOrder(422, 'Include 1 to 100 items');
        $requested = []; $lines = [];
        foreach ($items as $i) {
            if (!is_array($i)) failOrder(422, 'Invalid item');
            $sku = strField($i, 'sku', 64); $qty = intField($i, 'quantity', 1, 1000000);
            if (isset($requested[$sku])) failOrder(422, 'Duplicate SKU; combine quantities');
            if (!isset($products[$sku])) failOrder(422, 'Unknown SKU: ' . $sku);
            if (isset($products[$sku]['moq']) && $qty < $products[$sku]['moq']) failOrder(422, 'Minimum order quantity for '.$sku.' is '.$products[$sku]['moq']);
            if (($products[$sku]['supplyStatus'] ?? '') === 'unavailable') failOrder(409,'This product is unavailable; submit a sourcing request instead');
            $spec = strField($i, 'specification', 2000, false);
            $requested[$sku] = ['sku'=>$sku,'quantity'=>$qty,'specification'=>$spec];
            $p = $products[$sku];
            $lines[] = [...$p, 'requestedQuantity'=>$qty, 'quantity'=>$qty, 'specification'=>$spec, 'availability'=>'pending', 'leadTime'=>'', 'note'=>'', 'subtotalCents'=>$p['unitPriceCents'] === null ? null : $qty * $p['unitPriceCents']];
        }
        ksort($requested);
        $notes = strField($data, 'notes', 6000, false);
        $hash = hash('sha256', jsonOrder([$c, $requested, $notes]));
        $existing = queryOrder($db, 'SELECT * FROM orders WHERE request_id = ?', [$requestId])->fetch(PDO::FETCH_ASSOC);
        if ($existing) {
            if (!hash_equals($existing['access_hash'], hash('sha256', $credential))) failOrder(403, 'Invalid order access key');
            if (!hash_equals($existing['payload_hash'], $hash)) failOrder(409, 'Request ID already used for different order details');
            $o = json_decode($existing['document'], true, 32, JSON_THROW_ON_ERROR);
        } else {
            $now = time();
            queryOrder($db, 'DELETE FROM rate_limits WHERE until_time <= ?', [$now]);
            $sender = hash('sha256', $dir . '|' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
            foreach ([$sender=>20, 'global'=>500] as $key=>$limit) {
                $rate = queryOrder($db, 'SELECT count FROM rate_limits WHERE sender = ?', [$key])->fetchColumn();
                if ($rate !== false && (int)$rate >= $limit) failOrder(429, 'Too many orders; retry later');
                queryOrder($db, 'INSERT INTO rate_limits(sender,count,until_time) VALUES(?,1,?) ON CONFLICT(sender) DO UPDATE SET count=count+1', [$key, $now+3600]);
            }
            [$known, $pending] = sumOrder($lines);
            $number = 'PO-' . gmdate('Ymd') . '-' . strtoupper(bin2hex(random_bytes(8)));
            $o = ['orderNumber'=>$number,'createdAt'=>nowOrder(),'updatedAt'=>nowOrder(),'version'=>1,'currency'=>'USD','customer'=>$c,'notes'=>$notes,'items'=>$lines,'knownSubtotalCents'=>$known,'pendingQuoteItems'=>$pending,'shippingCents'=>null,'totalCents'=>null,'quoteRevision'=>0,'confirmedRevision'=>null,'status'=>'awaiting_quote','paymentStatus'=>'unpaid','shippingTerms'=>'','quoteNote'=>'','shipment'=>null];
            queryOrder($db, 'INSERT INTO orders(order_no,request_id,payload_hash,access_hash,document) VALUES(?,?,?,?,?)', [$number,$requestId,$hash,hash('sha256',$credential),jsonOrder($o)]);
            saveOrder($db, $o, 'created'); $status = 201;
        }
        $result = ['order'=>outputOrder($o, false)];
    } elseif ($action === 'admin_list') {
        $rows = queryOrder($db, 'SELECT document FROM orders ORDER BY rowid DESC LIMIT 200')->fetchAll(PDO::FETCH_COLUMN);
        $result = ['orders'=>array_map(fn($s)=>outputOrder(json_decode($s,true,32,JSON_THROW_ON_ERROR),true),$rows)];
    } else {
        $number = strField($data, 'orderNumber', 40);
        $record = queryOrder($db, 'SELECT * FROM orders WHERE order_no = ?', [$number])->fetch(PDO::FETCH_ASSOC);
        if (!$record) failOrder(404, 'Order not found or access key is invalid');
        $o = json_decode($record['document'], true, 32, JSON_THROW_ON_ERROR);
        if (!$admin && !hash_equals($record['access_hash'], hash('sha256', $credential)) && !hash_equals($o['quoteAccessHash'] ?? '',hash('sha256',$credential))) failOrder(404, 'Order not found or access key is invalid');
        $extra = [];
        if (!in_array($action, ['read','admin_read'], true)) {
            if (!in_array($action,['paypal_capture','admin_reconcile'],true) && intField($data, 'expectedVersion', 1) !== $o['version']) failOrder(409, 'Order changed. Reload and review the latest version');
            if ($action === 'quote') {
                if ($o['paymentStatus'] === 'paid' || $o['status'] === 'shipped') failOrder(409, 'Paid orders cannot be repriced');
                if (queryOrder($db,'SELECT paypal_id FROM paypal_orders WHERE order_no = ?',[$number])->fetchColumn() !== false) failOrder(409,'PayPal checkout has started; reconcile it before changing the quotation');
                $updates = $data['items'] ?? null;
                if (!is_array($updates) || !array_is_list($updates) || count($updates) !== count($o['items'])) failOrder(422, 'Quote must include every order item');
                $map = [];
                foreach ($updates as $u) {
                    if (!is_array($u)) failOrder(422, 'Invalid quote item');
                    $sku = strField($u,'sku',64);
                    if (isset($map[$sku])) failOrder(422, 'Duplicate quote SKU');
                    $map[$sku] = $u;
                }
                $active = 0;
                foreach ($o['items'] as &$line) {
                    $u = $map[$line['sku']] ?? null;
                    if (!$u) failOrder(422, 'Quote SKU mismatch');
                    $availability = strField($u, 'availability', 20);
                    if (!in_array($availability, ['available','unavailable'], true)) failOrder(422, 'Verify availability for every item');
                    $line['availability'] = $availability;
                    $line['quantity'] = intField($u, 'quantity', 1, 1000000);
                    $line['note'] = strField($u, 'note', 2000, $availability === 'unavailable');
                    if ($availability === 'unavailable') { $line['subtotalCents'] = 0; $line['unitPriceCents'] = null; continue; }
                    $active++;
                    $line['unitPriceCents'] = intField($u, 'unitPriceCents', 1, 100000000);
                    $line['supplier'] = strField($u, 'supplier', 1000);
                    $line['wholesaleCostCents'] = intField($u, 'wholesaleCostCents', 0, 100000000);
                    $line['stockVerified'] = intField($u, 'stockVerified', $line['quantity'], 1000000000);
                    $line['leadTime'] = strField($u, 'leadTime', 500);
                    $line['subtotalCents'] = $line['quantity'] * $line['unitPriceCents'];
                }
                unset($line);
                if (!$active) failOrder(422, 'A quotation needs at least one available item');
                [$known, $pending] = sumOrder($o['items']);
                $shipping = intField($data, 'shippingCents', 0, 100000000);
                if ($known + $shipping > 1000000000000) failOrder(422, 'Order amount exceeds limit');
                $o['knownSubtotalCents'] = $known; $o['pendingQuoteItems'] = $pending; $o['shippingCents'] = $shipping;
                $o['totalCents'] = $known + $shipping;
                $o['shippingTerms'] = strField($data, 'shippingTerms', 2000);
                $o['quoteNote'] = strField($data, 'quoteNote', 3000, false);
                $o['quoteRevision']++; $o['confirmedRevision'] = null; $o['status'] = 'quoted'; $o['paymentStatus'] = 'unpaid';
                $quoteKey = bin2hex(random_bytes(32)); $o['quoteAccessHash'] = hash('sha256',$quoteKey);
                $extra['quoteAccessKey'] = $quoteKey;
            } elseif ($action === 'confirm') {
                if (!in_array($o['status'], ['quoted','confirmed'], true) || $o['totalCents'] === null) failOrder(409, 'A complete quotation is required');
                if (intField($data, 'quoteRevision', 1) !== $o['quoteRevision'] || intField($data, 'totalCents', 1) !== $o['totalCents']) failOrder(409, 'Quotation amount or revision changed; review again');
                $o['confirmedRevision'] = $o['quoteRevision']; $o['status'] = 'confirmed'; $o['confirmedAt'] = nowOrder();
            } elseif (in_array($action,['paypal_create','paypal_capture','admin_reconcile'],true)) {
                require_once __DIR__ . '/paypal.php';
                if ($o['paymentStatus'] === 'paid') {
                    $db->exec('COMMIT'); $transaction=false; echo jsonOrder(['order'=>outputOrder($o,$admin)]); exit;
                }
                if ($o['status'] !== 'confirmed' || $o['confirmedRevision'] !== $o['quoteRevision']) failOrder(409,'Confirm the latest quotation before payment');
                $intent = queryOrder($db,'SELECT * FROM paypal_orders WHERE order_no = ?',[$number])->fetch(PDO::FETCH_ASSOC);
                if ($intent && ($settings['paypal']['environment'] ?? '') !== $intent['environment']) failOrder(409,'PayPal environment changed; reconcile the original transaction');
                if ($action === 'paypal_create') {
                    if (!$intent) {
                        $base = $settings['publicBaseUrl'] ?? '';
                        if (!is_string($base) || !filter_var($base,FILTER_VALIDATE_URL) || parse_url($base,PHP_URL_SCHEME) !== 'https' || parse_url($base,PHP_URL_QUERY) || parse_url($base,PHP_URL_FRAGMENT)) failOrder(503,'Configure the public HTTPS website URL before PayPal checkout');
                        $ref = $number . '-Q' . $o['quoteRevision'];
                        $response = paypalRequest($settings,'POST','/v2/checkout/orders',[
                            'intent'=>'CAPTURE','purchase_units'=>[['reference_id'=>$ref,'custom_id'=>$ref,'invoice_id'=>$ref,'amount'=>['currency_code'=>$o['currency'],'value'=>paypalAmount($o['totalCents'])]]],
                            'payment_source'=>['paypal'=>['experience_context'=>['return_url'=>rtrim($base,'/').'/?paypal=return&order='.rawurlencode($number),'cancel_url'=>rtrim($base,'/').'/?paypal=cancel&order='.rawurlencode($number),'user_action'=>'PAY_NOW','shipping_preference'=>'NO_SHIPPING']]]
                        ],substr(hash('sha256','create|'.$ref),0,36));
                        $id = $response['id'] ?? ''; $approval = '';
                        foreach ($response['links'] ?? [] as $link) if (in_array($link['rel'] ?? '',['payer-action','approve'],true)) $approval=$link['href'] ?? '';
                        $host = ($settings['paypal']['environment'] ?? '') === 'live' ? 'www.paypal.com' : 'www.sandbox.paypal.com';
                        if (!preg_match('/^[A-Z0-9]{1,64}$/D',$id) || parse_url($approval,PHP_URL_SCHEME) !== 'https' || parse_url($approval,PHP_URL_HOST) !== $host) failOrder(502,'PayPal approval was not confirmed');
                        $intent = ['paypal_id'=>$id,'quote_revision'=>$o['quoteRevision'],'approval_url'=>$approval,'environment'=>$settings['paypal']['environment']];
                        queryOrder($db,'INSERT INTO paypal_orders(paypal_id,order_no,quote_revision,approval_url,environment) VALUES(?,?,?,?,?)',[$id,$number,$o['quoteRevision'],$approval,$intent['environment']]);
                    }
                    $extra=['approvalUrl'=>$intent['approval_url'],'paypalOrderId'=>$intent['paypal_id'],'environment'=>$intent['environment']];
                    $o['paypalOrderId']=$intent['paypal_id'];
                    $o['paymentEnvironment']=$intent['environment'];
                } else {
                    if (!$intent || (int)$intent['quote_revision'] !== $o['quoteRevision'] || strField($data,'paypalOrderId',64) !== $intent['paypal_id']) failOrder(409,'PayPal order does not match the current quotation');
                    $response = paypalRequest($settings,'POST','/v2/checkout/orders/'.$intent['paypal_id'].'/capture',null,substr(hash('sha256','capture|'.$intent['paypal_id']),0,36));
                    if ($response['alreadyCaptured'] ?? false) $response=paypalRequest($settings,'GET','/v2/checkout/orders/'.$intent['paypal_id']);
                    $capture=paypalCompleted($response,$o,$intent['paypal_id']);
                    queryOrder($db,'INSERT INTO payments(reference,order_no,amount_cents,quote_revision,received_at) VALUES(?,?,?,?,?)',[$capture['id'],$number,$o['totalCents'],$o['quoteRevision'],nowOrder()]);
                    $o['paymentStatus']='paid';$o['status']='paid';$o['paidAt']=nowOrder();
                    $o['payment']=['reference'=>$capture['id'],'amountCents'=>$o['totalCents'],'currency'=>$o['currency'],'method'=>'paypal','environment'=>$intent['environment']];
                }
            } elseif ($action === 'ship') {
                if ($o['paymentStatus'] !== 'paid' || $o['status'] !== 'paid' || ($o['payment']['environment'] ?? '') !== 'live') failOrder(409, 'Ship only a live paid, unshipped order');
                $o['shipment'] = ['carrier'=>strField($data,'carrier',200),'tracking'=>strField($data,'tracking',500),'dispatchedAt'=>nowOrder(),'skus'=>array_column(array_values(array_filter($o['items'],fn($i)=>$i['availability']==='available')),'sku')];
                $o['status'] = 'shipped';
            }
            $o['version']++; $o['updatedAt'] = nowOrder(); saveOrder($db, $o, $action);
        }
        $result = ['order'=>outputOrder($o, $admin),...$extra];
    }
    $db->exec('COMMIT'); $transaction = false;
    if ($sourceRequest !== null) {
        partsQuery($partsDb,'UPDATE sourcing_requests SET linked_order=?,status=\'order_created\',version=version+1 WHERE number=? AND linked_order IS NULL',[$o['orderNumber'],$sourceRequest['number']]);
        $result['orderAccessKey']=$credential;
        $result['sourcingNumber']=$sourceRequest['number'];
    }
    http_response_code($status); echo jsonOrder($result);
} catch (Throwable $e) {
    if ($transaction && $db) { try { $db->exec('ROLLBACK'); } catch (Throwable) {} }
    $knownError=$e instanceof OrderError || (class_exists('PartsError',false) && $e instanceof PartsError);
    http_response_code($knownError ? $e->status : 503);
    echo jsonOrder(['error'=>$knownError ? $e->getMessage() : 'Order service unavailable. Your order is not confirmed; retry using the same request']);
}
