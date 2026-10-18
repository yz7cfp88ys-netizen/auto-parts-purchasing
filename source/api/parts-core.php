<?php
declare(strict_types=1);

// Shared by search, sourcing and the existing order service. No catalogue is seeded.
final class PartsError extends RuntimeException {
    public function __construct(public int $status, string $message) { parent::__construct($message); }
}
function partsFail(int $status, string $message): never { throw new PartsError($status, $message); }
function partsJson(mixed $value): string { return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE); }
function partsText(array $data, string $key, int $max = 500, bool $required = false): string {
    $v = $data[$key] ?? '';
    if (!is_string($v) || strlen($v) > $max || str_contains($v, "\0")) partsFail(422, 'Invalid ' . $key);
    $v = trim($v);
    if ($required && $v === '') partsFail(422, 'Please provide ' . $key);
    return $v;
}
function partsInt(mixed $v, int $min, int $max): int {
    if (!is_int($v) || $v < $min || $v > $max) partsFail(422, 'Invalid numeric value');
    return $v;
}
function partsNow(): string { return gmdate('Y-m-d\TH:i:s\Z'); }
function partsQuery(PDO $db, string $sql, array $params = []): PDOStatement {
    $s = $db->prepare($sql); $s->execute($params); return $s;
}
function partsPrivateDir(): string {
    $public = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    if (!$public) partsFail(503, 'A PHP document root is required');
    $dir = getenv('PARTS_STORAGE_DIR') ?: (getenv('ORDER_STORAGE_DIR') ?: dirname($public) . '/private/auto-parts-orders');
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) partsFail(503, 'Private storage is unavailable');
    $dir = realpath($dir);
    $prefix = fn($p) => strtolower(rtrim(str_replace('\\', '/', $p), '/') . '/');
    if (!$dir || str_starts_with($prefix($dir), $prefix($public))) partsFail(503, 'Storage must be outside the public website');
    return $dir;
}
function partsDb(): PDO {
    $dir = partsPrivateDir();
    $db = new PDO('sqlite:' . $dir . '/parts.sqlite', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    @chmod($dir . '/parts.sqlite', 0600);
    $db->exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000; PRAGMA synchronous=FULL;');
    $db->exec(file_get_contents(__DIR__ . '/parts-schema.sql'));
    return $db;
}
function partsAdmin(): void {
    $file = getenv('ORDER_SETTINGS_FILE') ?: partsPrivateDir() . '/settings.json';
    $public = realpath($_SERVER['DOCUMENT_ROOT']);
    $resolved = realpath($file);
    if (!$resolved || str_starts_with(strtolower(str_replace('\\','/',$resolved)), strtolower(rtrim(str_replace('\\','/',$public),'/').'/'))) partsFail(503, 'Private administrator settings are required');
    $settings = json_decode(file_get_contents($file), true, 16, JSON_THROW_ON_ERROR);
    $secret = $settings['adminToken'] ?? '';
    if (!is_string($secret) || strlen($secret) < 32 || str_starts_with($secret, 'REPLACE_')) partsFail(503, 'Administrator is not configured');
    $bearer = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!hash_equals('Bearer ' . $secret, $bearer)) partsFail(401, 'Administrator authorization required');
}
function partsOrigin(): void {
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') partsFail(403, 'Same-origin requests only');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $host = parse_url($origin, PHP_URL_HOST); $port = parse_url($origin, PHP_URL_PORT);
        if (strtolower((string)$host . ($port ? ':' . $port : '')) !== strtolower($_SERVER['HTTP_HOST'] ?? '')) partsFail(403, 'Same-origin requests only');
    }
}
function partsBody(int $limit = 2097152): array {
    partsOrigin();
    if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') partsFail(415, 'JSON required');
    $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
    if ($raw === false || strlen($raw) > $limit) partsFail(413, 'Request too large');
    try { $d = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); } catch (JsonException) { partsFail(400, 'Invalid JSON'); }
    if (!is_array($d) || array_is_list($d)) partsFail(422, 'Object required');
    return $d;
}
// Spaces and case are insignificant. Hyphens, punctuation, letters and digits are significant.
function partsNumber(string $number): string {
    return strtoupper(preg_replace('/[\s\x{00A0}]+/u', '', trim($number)) ?? $number);
}
function partsEvidence(array $data): array {
    $source = partsText($data, 'source', 2000, true);
    $verified = partsText($data, 'verifiedAt', 40, true);
    $time = strtotime($verified);
    if ($time === false || $time > time() + 300) partsFail(422, 'Invalid verification date');
    return ['source'=>$source,'verifiedAt'=>gmdate('Y-m-d\TH:i:s\Z', $time)];
}
function partsVehicle(array $v): array {
    $type = partsText($v, 'type', 16, true);
    if (!in_array($type, ['auto','moto'], true)) partsFail(422, 'Vehicle type must be auto or moto');
    return ['type'=>$type,'make'=>partsText($v,'make',100,true),'model'=>partsText($v,'model',150,true),'year'=>partsInt($v['year'] ?? null,1900,2100),'engine'=>partsText($v,'engine',200,true)];
}
function partsUpsert(PDO $db, array $p, string $actor): string {
    $sku = partsText($p,'sku',64,true);
    if (!preg_match('/^[A-Z0-9_-]{1,64}$/D',$sku) || str_starts_with($sku,'SRC-')) partsFail(422,'Invalid or reserved SKU');
    $name = partsText($p,'name',250,true); $brand = partsText($p,'brand',150,true);
    $system = partsText($p,'system',150,true); $category = partsText($p,'category',150,true);
    $description = partsText($p,'description',3000);
    $evidence = partsEvidence($p);
    $image = partsText($p,'image',1000);
    if ($image && !preg_match('~^(?:\./assets/[a-zA-Z0-9_./-]+|https://[^\s<>]+)$~D',$image)) partsFail(422,'Use a local asset or HTTPS image URL');
    $price = $p['unitPriceCents'] ?? null; $moq = $p['moq'] ?? null;
    if ($price !== null) partsInt($price,1,100000000);
    if ($moq !== null) partsInt($moq,1,1000000);
    $supply = partsText($p,'supplyStatus',40) ?: 'unconfirmed';
    if (!in_array($supply,['unconfirmed','on_request','available','unavailable'],true)) partsFail(422,'Invalid supply status');
    $commercial = partsText($p,'commercialEvidence',2000);
    if (($price !== null || $moq !== null || $supply !== 'unconfirmed') && !$commercial) partsFail(422,'Price, MOQ and supply claims need commercialEvidence');
    $published = $p['published'] ?? false;
    if (!is_bool($published)) partsFail(422,'published must be boolean');
    $numbers = $p['numbers'] ?? []; $fitments = $p['fitments'] ?? [];
    if (!is_array($numbers) || !array_is_list($numbers) || count($numbers)>100 || !is_array($fitments) || !array_is_list($fitments) || count($fitments)>300) partsFail(422,'Invalid numbers or fitments');
    $old = partsQuery($db,'SELECT revision FROM part_products WHERE sku=?',[$sku])->fetchColumn();
    if ($old !== false && ($p['expectedRevision'] ?? null) !== (int)$old) partsFail(409,'Product changed. Export the latest revision before updating');
    $revision = $old === false ? 1 : (int)$old + 1;
    $values = [$name,$brand,$description,$image,$system,$category,$price,$moq,$supply,$commercial,(int)$published,$evidence['source'],$evidence['verifiedAt'],$revision,partsNow()];
    if ($old === false) partsQuery($db,'INSERT INTO part_products(name,brand,description,image,system,category,price_cents,moq,supply_status,commercial_evidence,published,source,verified_at,revision,updated_at,sku) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[...$values,$sku]);
    else partsQuery($db,'UPDATE part_products SET name=?,brand=?,description=?,image=?,system=?,category=?,price_cents=?,moq=?,supply_status=?,commercial_evidence=?,published=?,source=?,verified_at=?,revision=?,updated_at=? WHERE sku=?',[...$values,$sku]);
    partsQuery($db,'DELETE FROM part_numbers WHERE sku=?',[$sku]);
    foreach ($numbers as $n) {
        if (!is_array($n)) partsFail(422,'Invalid part number');
        $kind = partsText($n,'kind',24,true);
        if (!in_array($kind,['oem','manufacturer','cross'],true)) partsFail(422,'Invalid part-number kind');
        $number = partsText($n,'number',100,true); $normalized = partsNumber($number);
        if (!preg_match('/^[A-Z0-9][A-Z0-9._\/-]{0,99}$/D',$normalized)) partsFail(422,'Unsupported characters in part number');
        $ne = partsEvidence($n);
        partsQuery($db,'INSERT INTO part_numbers(sku,kind,brand,number,normalized,source,verified_at) VALUES(?,?,?,?,?,?,?)',[$sku,$kind,partsText($n,'brand',150,true),$number,$normalized,$ne['source'],$ne['verifiedAt']]);
    }
    partsQuery($db,'DELETE FROM part_fitments WHERE sku=?',[$sku]);
    foreach ($fitments as $f) {
        if (!is_array($f)) partsFail(422,'Invalid fitment');
        $v = partsVehicle($f); $fe = partsEvidence($f);
        $params = array_values($v);
        $id = partsQuery($db,'SELECT id FROM part_vehicles WHERE type=? AND make=? AND model=? AND year=? AND engine=?',$params)->fetchColumn();
        if ($id === false) { partsQuery($db,'INSERT INTO part_vehicles(type,make,model,year,engine) VALUES(?,?,?,?,?)',$params); $id=$db->lastInsertId(); }
        partsQuery($db,'INSERT INTO part_fitments(sku,vehicle_id,source,verified_at) VALUES(?,?,?,?)',[$sku,$id,$fe['source'],$fe['verifiedAt']]);
    }
    partsQuery($db,'INSERT INTO parts_audit(event,reference,document,actor,created_at) VALUES(?,?,?,?,?)',['product_saved',$sku,partsJson($p),$actor,partsNow()]);
    return $sku;
}
function partsProduct(PDO $db, array $row, bool $admin = false): array {
    $sku = $row['sku'];
    $numbers = partsQuery($db,'SELECT kind,brand,number,source,verified_at AS verifiedAt FROM part_numbers WHERE sku=? ORDER BY id',[$sku])->fetchAll(PDO::FETCH_ASSOC);
    $fitments = partsQuery($db,'SELECT v.*,f.source,f.verified_at AS verifiedAt FROM part_fitments f JOIN part_vehicles v ON v.id=f.vehicle_id WHERE f.sku=? ORDER BY v.type,v.make,v.model,v.year',[$sku])->fetchAll(PDO::FETCH_ASSOC);
    foreach ($fitments as &$v) { $v['year']=(int)$v['year']; unset($v['id']); } unset($v);
    $p = ['sku'=>$sku,'name'=>$row['name'],'brand'=>$row['brand'],'description'=>$row['description'],'image'=>$row['image'],'system'=>$row['system'],'category'=>$row['category'],'unitPriceCents'=>$row['price_cents'] === null ? null : (int)$row['price_cents'],'currency'=>'USD','moq'=>$row['moq'] === null ? null : (int)$row['moq'],'supplyStatus'=>$row['supply_status'],'source'=>$row['source'],'verifiedAt'=>$row['verified_at'],'numbers'=>$numbers,'fitments'=>$fitments,'revision'=>(int)$row['revision']];
    if ($admin) $p += ['published'=>(bool)$row['published'],'commercialEvidence'=>$row['commercial_evidence'],'expectedRevision'=>(int)$row['revision']];
    return $p;
}
function partsFilter(array $d): array {
    $where = ['p.published=1']; $params = [];
    foreach (['system','category'] as $key) if (($value=partsText($d,$key,150)) !== '') { $where[]='p.'.$key.'=?'; $params[]=$value; }
    $vehicle=[]; $vp=[];
    foreach (['type'=>16,'make'=>100,'model'=>150,'year'=>4,'engine'=>200] as $key=>$max) {
        $value=partsText($d,$key,$max);
        if ($value!=='') { $vehicle[]='v.'.$key.'=?'; $vp[]=$value; }
    }
    if ($vehicle) { $where[]='EXISTS(SELECT 1 FROM part_fitments f JOIN part_vehicles v ON v.id=f.vehicle_id WHERE f.sku=p.sku AND '.implode(' AND ',$vehicle).')'; $params=[...$params,...$vp]; }
    return [implode(' AND ',$where),$params];
}
function partsSearch(PDO $db, array $d): array {
    [$where,$params]=partsFilter($d); $q=partsText($d,'q',150); $normalized=partsNumber($q);
    $page = filter_var($d['page'] ?? '1',FILTER_VALIDATE_INT,['options'=>['min_range'=>1,'max_range'=>10000]]);
    if ($page===false) partsFail(422,'Invalid page');
    $matches=[]; $matchParams=[]; $kind='catalog';
    if ($q!=='') {
        $exact=partsQuery($db,'SELECT n.sku,n.kind,n.number,n.brand FROM part_numbers n JOIN part_products p ON p.sku=n.sku WHERE n.normalized=? AND '.$where,[$normalized,...$params])->fetchAll(PDO::FETCH_ASSOC);
        foreach ($exact as $n) $matches[$n['sku']][]=$n;
        if ($matches) { $keys=array_keys($matches); $where.=' AND p.sku IN ('.implode(',',array_fill(0,count($keys),'?')).')'; $matchParams=$keys; $kind='exact'; }
        else {
            $tokens=preg_split('/\s+/u',$q,-1,PREG_SPLIT_NO_EMPTY);
            foreach ($tokens as $t) {
                $where.=" AND (lower(p.name) LIKE lower(?) ESCAPE '!' OR lower(p.brand) LIKE lower(?) ESCAPE '!' OR lower(p.description) LIKE lower(?) ESCAPE '!')";
                $t='%'.strtr($t,['!'=>'!!','%'=>'!%','_'=>'!_']).'%'; array_push($matchParams,$t,$t,$t);
            }
            $kind='keyword';
        }
    }
    $total=(int)partsQuery($db,'SELECT count(*) FROM part_products p WHERE '.$where,[...$params,...$matchParams])->fetchColumn();
    $rows=partsQuery($db,'SELECT p.* FROM part_products p WHERE '.$where.' ORDER BY p.name,p.sku LIMIT 24 OFFSET '.(($page-1)*24),[...$params,...$matchParams])->fetchAll(PDO::FETCH_ASSOC);
    $results=[];
    foreach ($rows as $row) {
        $p=partsProduct($db,$row); $ns=$matches[$p['sku']] ?? [];
        $hasIdentity=count(array_filter($ns,fn($n)=>$n['kind']!=='cross'))>0;
        $p['matchType']=$ns ? ($hasIdentity?'part_number_exact':'cross_reference_exact') : ($q===''?'verified_catalog':'keyword_candidate');
        $p['matchedNumbers']=$ns; $results[]=$p;
    }
    $suggestions=[];
    if (!$total && strlen($normalized)>=4 && strlen($normalized)<=100) {
        [$fw,$fp]=partsFilter($d);
        $near=partsQuery($db,'SELECT DISTINCT n.sku,n.normalized FROM part_numbers n JOIN part_products p ON p.sku=n.sku WHERE '.$fw.' AND length(n.normalized) BETWEEN CAST(? AS INTEGER) AND CAST(? AS INTEGER) ORDER BY n.sku,n.normalized LIMIT 2000',[...$fp,strlen($normalized)-1,strlen($normalized)+1])->fetchAll(PDO::FETCH_ASSOC);
        foreach ($near as $n) if (levenshtein($normalized,$n['normalized'])===1 && !isset($suggestions[$n['sku']])) {
            $p=partsProduct($db,partsQuery($db,'SELECT * FROM part_products WHERE sku=?',[$n['sku']])->fetch(PDO::FETCH_ASSOC));
            $p['matchType']='fuzzy_candidate'; $p['matchedNumbers']=[]; $suggestions[$p['sku']]=$p;
            if (count($suggestions)>=6) break;
        }
    }
    return ['query'=>$q,'normalizedNumber'=>$normalized,'total'=>$total,'page'=>$page,'pageSize'=>24,'products'=>$results,'suggestions'=>array_values($suggestions),'reliableMatch'=>($kind==='exact' && $total>0) || ($q==='' && $total>0),'catalogCount'=>(int)$db->query('SELECT count(*) FROM part_products WHERE published=1')->fetchColumn()];
}
