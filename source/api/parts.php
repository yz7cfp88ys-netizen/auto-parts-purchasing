<?php
declare(strict_types=1);
ini_set('display_errors','0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
require_once __DIR__.'/parts-core.php';
$db=null; $transaction=false;
try {
    $method=$_SERVER['REQUEST_METHOD'];
    if ($method==='GET') {
        $db=partsDb(); $action=partsText($_GET,'action',24) ?: 'search';
        if ($action==='search') $result=partsSearch($db,$_GET);
        elseif ($action==='options') {
            $level=partsText($_GET,'level',16,true);
            if (!in_array($level,['make','model','year','engine','system','category'],true)) partsFail(422,'Invalid filter level');
            // A selected value at this level and later levels must not restrict its options.
            $d=$_GET; $order=['make','model','year','engine','system','category'];
            foreach (array_slice($order,array_search($level,$order,true)) as $key) unset($d[$key]);
            [$where,$params]=partsFilter($d);
            if (in_array($level,['system','category'],true)) $sql='SELECT DISTINCT p.'.$level.' AS value FROM part_products p WHERE '.$where.' ORDER BY value';
            else {
                $extra=[]; $ep=[];
                foreach (['type','make','model','year','engine'] as $key) if (($value=partsText($d,$key,200))!=='') { $extra[]='v.'.$key.'=?'; $ep[]=$value; }
                $sql='SELECT DISTINCT v.'.$level.' AS value FROM part_vehicles v JOIN part_fitments f ON f.vehicle_id=v.id JOIN part_products p ON p.sku=f.sku WHERE '.$where.($extra?' AND '.implode(' AND ',$extra):'').' ORDER BY value';
                $params=[...$params,...$ep];
            }
            $result=['level'=>$level,'options'=>partsQuery($db,$sql,$params)->fetchAll(PDO::FETCH_COLUMN)];
        } else partsFail(422,'Unknown action');
    } elseif ($method==='POST') {
        $d=partsBody(); partsAdmin(); $action=partsText($d,'action',24,true);
        if ($action==='preflight') {
            $dir=partsPrivateDir();$sqlite=in_array('sqlite',PDO::getAvailableDrivers(),true);
            $result=['phpVersion'=>PHP_VERSION,'pdoSqlite'=>$sqlite,'curl'=>extension_loaded('curl'),'imageInspection'=>function_exists('getimagesize'),'privateStorageWritable'=>is_writable($dir),'uploadMaxFilesize'=>ini_get('upload_max_filesize'),'postMaxSize'=>ini_get('post_max_size'),'maxFileUploads'=>(int)ini_get('max_file_uploads'),'database'=>null];
            if ($sqlite) { $db=partsDb(); $result['database']=$db->query('PRAGMA quick_check')->fetchColumn(); }
        } elseif ($action==='export') {
            $db=partsDb();
            $rows=$db->query('SELECT * FROM part_products ORDER BY sku')->fetchAll(PDO::FETCH_ASSOC);
            $result=['products'=>array_map(fn($r)=>partsProduct($db,$r,true),$rows)];
        } elseif ($action==='import') {
            $db=partsDb();
            $products=$d['products'] ?? null;
            if (!is_array($products) || !array_is_list($products) || count($products)<1 || count($products)>100) partsFail(422,'Import 1–100 products at a time');
            $db->exec('BEGIN IMMEDIATE'); $transaction=true; $saved=[];
            foreach ($products as $p) { if (!is_array($p)) partsFail(422,'Invalid product'); $saved[]=partsUpsert($db,$p,'administrator'); }
            $db->exec('COMMIT'); $transaction=false; $result=['saved'=>$saved];
        } else partsFail(422,'Unknown action');
    } else { header('Allow: GET, POST'); partsFail(405,'Use GET or POST'); }
    echo partsJson($result);
} catch (Throwable $e) {
    if ($db && $transaction) $db->exec('ROLLBACK');
    http_response_code($e instanceof PartsError ? $e->status : 503);
    echo partsJson(['error'=>$e instanceof PartsError ? $e->getMessage() : 'Parts service unavailable. Please use the sourcing form or retry.']);
}
