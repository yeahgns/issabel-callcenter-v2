<?php
/*
 * Issabel Call Center Plus - Pausas (tipos de pausa que a agente escolhe no console).
 * Regras da classe original do break_administrator (PaloSantoBreaks), via CcxPauseService.
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
            . '<div class="ccxc" id="ccx-pausas" data-api="?menu=' . $h(rawurlencode($module_name)) . '&amp;rawmode=yes"'
            . ' data-token="' . $h($_SESSION['ccx_csrf']) . '"></div>'
            . '<script src="' . $a . '/pausas.js?v=' . $v . '"></script>';
    }

    require_once 'modules/ccx_common/libs/PauseService.php';
    if (in_array($action, array('save', 'status'), true)) {
        $tok = isset($_SERVER['HTTP_X_CCX_TOKEN']) ? (string) $_SERVER['HTTP_X_CCX_TOKEN'] : '';
        if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !hash_equals($_SESSION['ccx_csrf'], $tok)) {
            return ccx_json(array('error' => 'Sessão expirada. Recarregue a página.'), 403);
        }
    }
    $id = isset($_REQUEST['id']) && ctype_digit((string) $_REQUEST['id']) ? (int) $_REQUEST['id'] : 0;
    ob_start();   // descarta avisos do PHP vindos da classe original
    try {
        $svc = new CcxPauseService($cfg);
        switch ($action) {
            case 'list':   $out = ccx_json(array('pauses' => $svc->listAll())); break;
            case 'save':   $svc->save($id, isset($_POST['name']) ? $_POST['name'] : '', isset($_POST['description']) ? $_POST['description'] : ''); $out = ccx_json(array('ok' => true)); break;
            case 'status': $svc->setActive($id, !empty($_POST['on'])); $out = ccx_json(array('ok' => true)); break;
            default:       $out = ccx_json(array('error' => 'Ação desconhecida.'), 400);
        }
    } catch (Exception $e) {
        $out = ccx_json(array('error' => $e->getMessage()), 400);
    }
    ob_end_clean();
    return $out;
}
