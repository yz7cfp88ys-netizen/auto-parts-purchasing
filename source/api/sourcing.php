<?php
declare(strict_types=1);
ini_set('display_errors','0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
require_once __DIR__.'/parts-core.php';
$db=null; $transaction=false; $moved=[];
try {
    if ($_SERVER['REQUEST_METHOD']!=='POST') { header('Allow: POST'); partsFail(405,'Use POST'); }
    partsOrigin();
    $multipart=str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''),'multipart/form-data');
    if ($multipart) {
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0)>16000000) partsFail(413,'Upload at most 3 images, 5 MB each');
        try { $data=json_decode(partsText($_POST,'metadata',30000,true),true,16,JSON_THROW_ON_ERROR); }
        catch (JsonException) { partsFail(400,'Invalid request metadata'); }
        if (!is_array($data)) partsFail(422,'Invalid request metadata');
        $action=partsText($data,'action',32,true);
        if ($action!=='create') partsFail(422,'Only creation accepts image uploads');
    } else { $data=partsBody(65536); $action=partsText($data,'action',32,true); }
    if (!in_array($action,['create','admin_list','admin_read','admin_update','admin_file'],true)) partsFail(422,'Unknown action');
    if ($action!=='create') partsAdmin();
    $db=partsDb();
    if ($action==='create') {
        $id=partsText($data,'requestId',36,true);
        if (!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/D',$id)) partsFail(422,'Invalid request ID');
        if (partsText($data,'website',200)!=='') partsFail(422,'Unable to accept request');
        $request=[];
        foreach (['name'=>200,'email'=>200,'country'=>100,'company'=>500,'partNumber'=>150,'keywords'=>500,'vehicle'=>1000,'requirements'=>3000,'referenceUrl'=>2000] as $k=>$max) $request[$k]=partsText($data,$k,$max,in_array($k,['name','email','country'],true));
        if (!filter_var($request['email'],FILTER_VALIDATE_EMAIL)) partsFail(422,'Please provide a valid email');
        $request['quantity']=partsInt($data['quantity'] ?? null,1,1000000);
        $request['consent']=$data['consent'] ?? false;
        if ($request['consent']!==true) partsFail(422,'Consent is required to process this request');
        if ($request['referenceUrl'] && (!filter_var($request['referenceUrl'],FILTER_VALIDATE_URL) || !in_array(parse_url($request['referenceUrl'],PHP_URL_SCHEME),['https','http'],true) || parse_url($request['referenceUrl'],PHP_URL_USER))) partsFail(422,'Please use an HTTP(S) reference link without credentials');
        // Reference URLs are stored only. The server never fetches customer URLs.
        $files=[]; $incoming=$_FILES['photos'] ?? null;
        if ($incoming) {
            if (!is_array($incoming['error']) || count($incoming['error'])>3) partsFail(422,'Upload at most 3 images');
            foreach ($incoming['error'] as $i=>$error) {
                if ($error===UPLOAD_ERR_NO_FILE) continue;
                if ($error!==UPLOAD_ERR_OK) partsFail(422,'Image upload failed or exceeded the PHP upload limit');
                $temp=$incoming['tmp_name'][$i]; $size=(int)$incoming['size'][$i];
                if ($size<1 || $size>5*1024*1024 || !is_uploaded_file($temp)) partsFail(422,'Each image must be at most 5 MB');
                $info=@getimagesize($temp);
                if (!$info || !in_array($info['mime'] ?? '',['image/jpeg','image/png','image/webp'],true) || $info[0]*$info[1]>40000000) partsFail(422,'Use a valid JPG, PNG or WebP image (up to 40 megapixels)');
                $files[]=['temp'=>$temp,'mime'=>$info['mime'],'size'=>$size,'sha256'=>hash_file('sha256',$temp)];
            }
        }
        if (!$files && !$request['partNumber'] && !$request['keywords'] && !$request['referenceUrl'] && !$request['requirements']) partsFail(422,'Add a part number, description, image or reference link');
        $fingerprints=array_map(fn($f)=>[$f['mime'],$f['sha256']],$files);
        $hash=hash('sha256',partsJson([$request,$fingerprints]));
        $db->exec('BEGIN IMMEDIATE'); $transaction=true;
        $existing=partsQuery($db,'SELECT number,payload_hash FROM sourcing_requests WHERE request_id=?',[$id])->fetch(PDO::FETCH_ASSOC);
        if ($existing) {
            if (!hash_equals($existing['payload_hash'],$hash)) partsFail(409,'This request ID was already used for different details');
            $number=$existing['number']; $status=200;
        } else {
            $sender=hash('sha256',partsPrivateDir().'|'.($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
            partsQuery($db,'DELETE FROM sourcing_rates WHERE until_time<=?',[time()]);
            foreach ([$sender=>10,'global'=>200] as $key=>$limit) {
                $count=partsQuery($db,'SELECT count FROM sourcing_rates WHERE sender=?',[$key])->fetchColumn();
                if ($count!==false && (int)$count>=$limit) partsFail(429,'Too many new requests. Keep your details and try later');
                partsQuery($db,'INSERT INTO sourcing_rates(sender,count,until_time) VALUES(?,1,?) ON CONFLICT(sender) DO UPDATE SET count=count+1',[$key,time()+3600]);
            }
            $number='SR-'.gmdate('Ymd').'-'.strtoupper(bin2hex(random_bytes(8)));
            $request['imageAssessment']='Not assessed. Images may suggest candidates; vehicle fitment requires separate evidence.';
            partsQuery($db,'INSERT INTO sourcing_requests(number,request_id,payload_hash,document,created_at) VALUES(?,?,?,?,?)',[$number,$id,$hash,partsJson($request),partsNow()]);
            $uploadDir=partsPrivateDir().'/sourcing-images';
            if ($files && !is_dir($uploadDir) && !@mkdir($uploadDir,0700,true) && !is_dir($uploadDir)) partsFail(503,'Private image storage unavailable');
            foreach ($files as $f) {
                $fileId=bin2hex(random_bytes(16)); $disk=$fileId.'.bin'; $path=$uploadDir.'/'.$disk;
                if (!move_uploaded_file($f['temp'],$path)) partsFail(503,'Unable to store image. Retry with the same details');
                $moved[]=$path; @chmod($path,0600);
                if (hash_file('sha256',$path)!==$f['sha256']) partsFail(503,'Image verification failed');
                partsQuery($db,'INSERT INTO sourcing_files(id,request_number,disk_name,mime,size,sha256) VALUES(?,?,?,?,?,?)',[$fileId,$number,$disk,$f['mime'],$f['size'],$f['sha256']]);
            }
            partsQuery($db,'INSERT INTO parts_audit(event,reference,document,actor,created_at) VALUES(?,?,?,?,?)',['sourcing_received',$number,partsJson(['fileCount'=>count($files)]),'customer',partsNow()]);
            $status=201;
        }
        $db->exec('COMMIT'); $transaction=false; $moved=[];
        // Return only a receipt. No anonymous endpoint exposes contact details or images.
        http_response_code($status); $result=['status'=>'saved','sourcingNumber'=>$number,'fileCount'=>count($files)];
    } elseif ($action==='admin_list') {
        $rows=$db->query('SELECT number,status,version,linked_order AS linkedOrder,created_at AS createdAt,document FROM sourcing_requests ORDER BY rowid DESC LIMIT 200')->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$r) { $d=json_decode($r['document'],true,16,JSON_THROW_ON_ERROR); unset($r['document']); $r+=['name'=>$d['name'],'partNumber'=>$d['partNumber'],'keywords'=>$d['keywords']]; } unset($r);
        $result=['requests'=>$rows];
    } elseif ($action==='admin_file') {
        $id=partsText($data,'fileId',32,true);
        $f=partsQuery($db,'SELECT * FROM sourcing_files WHERE id=?',[$id])->fetch(PDO::FETCH_ASSOC);
        if (!$f) partsFail(404,'Image not found');
        $path=partsPrivateDir().'/sourcing-images/'.$f['disk_name'];
        if (!is_file($path) || hash_file('sha256',$path)!==$f['sha256']) partsFail(503,'Stored image could not be verified');
        header('Content-Type: '.$f['mime']); header('Content-Disposition: attachment; filename="part-'.$id.'.'.(['image/png'=>'png','image/jpeg'=>'jpg','image/webp'=>'webp'][$f['mime']]).'"');
        header('Content-Length: '.filesize($path)); readfile($path); exit;
    } else {
        $number=partsText($data,'sourcingNumber',40,true);
        if ($action==='admin_update') { $db->exec('BEGIN IMMEDIATE'); $transaction=true; }
        $r=partsQuery($db,'SELECT * FROM sourcing_requests WHERE number=?',[$number])->fetch(PDO::FETCH_ASSOC);
        if (!$r) partsFail(404,'Sourcing request not found');
        $document=json_decode($r['document'],true,16,JSON_THROW_ON_ERROR);
        if ($action==='admin_update') {
            if (($data['expectedVersion'] ?? null)!==(int)$r['version']) partsFail(409,'Request changed. Reload the latest version');
            $status=partsText($data,'status',32,true);
            if (!in_array($status,['received','reviewing','located','unable_to_source'],true) || $r['linked_order']) partsFail(409,'Invalid status or request already linked to an order');
            $note=partsText($data,'note',3000,true);
            $document['processingNote']=$note;
            partsQuery($db,'UPDATE sourcing_requests SET status=?,version=version+1,document=? WHERE number=?',[$status,partsJson($document),$number]);
            partsQuery($db,'INSERT INTO parts_audit(event,reference,document,actor,created_at) VALUES(?,?,?,?,?)',['sourcing_'.$status,$number,partsJson(['note'=>$note]),'administrator',partsNow()]);
            $db->exec('COMMIT'); $transaction=false; $r['status']=$status; $r['version']++;
        }
        $files=partsQuery($db,'SELECT id,mime,size,sha256 FROM sourcing_files WHERE request_number=?',[$number])->fetchAll(PDO::FETCH_ASSOC);
        $result=['request'=>['sourcingNumber'=>$number,'requestId'=>$r['request_id'],'status'=>$r['status'],'version'=>(int)$r['version'],'linkedOrder'=>$r['linked_order'],'createdAt'=>$r['created_at'],'details'=>$document,'files'=>$files]];
    }
    echo partsJson($result);
} catch (Throwable $e) {
    if ($db && $transaction) $db->exec('ROLLBACK');
    foreach ($moved as $path) @unlink($path);
    http_response_code($e instanceof PartsError ? $e->status : 503);
    echo partsJson(['error'=>$e instanceof PartsError ? $e->getMessage() : 'Sourcing service unavailable. Your receipt is unconfirmed; retry with the same details.']);
}
