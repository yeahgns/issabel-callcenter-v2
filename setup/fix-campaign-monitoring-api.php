<?php
// Corrige a injeção de comando em campaign_monitoring/libs/api.php
$f = '/var/www/html/modules/campaign_monitoring/libs/api.php';
if (isset($argv[1])) $f = $argv[1];
$src = file_get_contents($f);
if ($src === false) { fwrite(STDERR, "Nao consegui ler $f\n"); exit(1); }
if (strpos($src, 'CCX-FIX') !== false) { echo "Ja corrigido: $f\n"; exit(0); }
$novo = '$queueNumber = isset($_GET[\'queue\']) ? (string) $_GET[\'queue\'] : \'\'; /* CCX-FIX */ '
      . 'if (!preg_match(\'/^[0-9]{1,10}$/D\', $queueNumber)) { http_response_code(400); exit; }';
$out = preg_replace('/\$queueNumber\s*=\s*\$_GET\[\'queue\'\];/', $novo, $src, -1, $n);
if ($n !== 2) { fwrite(STDERR, "Esperava 2 ocorrencias, achei $n. Nada foi alterado.\n"); exit(1); }
$bak = '/root/api.php.bak-' . date('YmdHis'); copy($f, $bak);
file_put_contents($f, $out);
echo "Corrigido ($n pontos). Backup em $bak\n";
