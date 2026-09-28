<?php
/* Gera uma página única (HTML + CSS + JS embutidos) com o painel em modo demo.
   Uso: php build/build-demo.php > painel-demo.html */
$a = dirname(__DIR__) . '/modules/ccx_common/assets/';
$css = file_get_contents($a . 'painel.css');
$demo = file_get_contents($a . 'painel-demo.js');
$js = file_get_contents($a . 'painel.js');
?><!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Painel do call center (demonstração)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
html, body { margin: 0; height: 100%; background: #F3F6FA; }
:root { box-sizing: border-box; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
<?php echo $css; ?>
</style>
</head>
<body>
<div class="ccx" id="ccx-painel" data-api="" data-poll="5" data-demo="1" data-company=""></div>
<script><?php echo $demo; ?></script>
<script><?php echo $js; ?></script>
</body>
</html>
