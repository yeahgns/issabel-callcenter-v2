<?php
/*
 * Issabel Call Center Plus - Agentes (callback extensions): o login usado no console do agente.
 * Regras da classe original do cb_extensions (Agentes), via CcxAgentService.
 */
function _moduleContent(&$smarty, $module_name)
{
    require_once 'modules/ccx_common/libs/bootstrap.php';
    $cfg = ccx_config();
    $action = isset($_REQUEST['action']) ? (string) $_REQUEST['action'] : '';
    if (empty($_SESSION['ccx_csrf'])) $_SESSION['ccx_csrf'] = bin2hex(random_bytes(16));

    if ($action === '') {
        $h = function ($s) { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); };
        $a = 'modules/ccx_common/assets';
        $v = $h(CCX_VERSION);
        return '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;600;700&display=swap">'
            . '<link rel="stylesheet" href="' . $a . '/campanhas.css?v=' . $v . '">'
            . '<div class="ccxc" id="ccx-agentes" data-api="?menu=' . $h(rawurlencode($module_name)) . '&amp;rawmode=yes"'
            . ' data-token="' . $h($_SESSION['ccx_csrf']) . '"></div>'
            . '<script src="' . $a . '/agentes.js?v=' . $v . '"></script>';
    }

    require_once 'modules/ccx_common/libs/AgentService.php';
    if (in_array($action, array('create', 'update', 'delete', 'disconnect'), true)) {
        $tok = isset($_SERVER['HTTP_X_CCX_TOKEN']) ? (string) $_SERVER['HTTP_X_CCX_TOKEN'] : '';
        if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !hash_equals($_SESSION['ccx_csrf'], $tok)) {
            return ccx_json(array('error' => 'Sessão expirada. Recarregue a página.'), 403);
        }
    }
    $p = function ($k) { return isset($_POST[$k]) ? (string) $_POST[$k] : ''; };
    $num = isset($_REQUEST['number']) ? (string) $_REQUEST['number'] : '';
    // A classe original emite avisos do PHP (atribuição por referência). Se o servidor estiver
    // mostrando avisos, eles sairiam no meio do JSON: capturamos e descartamos.
    ob_start();
    try {
        $svc = new CcxAgentService($cfg);
        switch ($action) {
            case 'list':       $out = ccx_json(array('now' => time(), 'agents' => $svc->listAll())); break;
            case 'free':       $out = ccx_json(array('extensions' => $svc->freeExtensions())); break;
            case 'create':     $svc->create($p('channel'), $p('name'), $p('password'), $p('password2')); $out = ccx_json(array('ok' => true)); break;
            case 'update':     $svc->update($num, $p('name'), $p('password'), $p('password2')); $out = ccx_json(array('ok' => true)); break;
            case 'delete':     $svc->delete($num); $out = ccx_json(array('ok' => true)); break;
            case 'disconnect': $svc->disconnect($num); $out = ccx_json(array('ok' => true)); break;
            default:           $out = ccx_json(array('error' => 'Ação desconhecida.'), 400);
        }
    } catch (Exception $e) {
        $out = ccx_json(array('error' => $e->getMessage()), 400);
    }
    ob_end_clean();
    return $out;
}
