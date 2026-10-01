<?php
/*
 * Issabel Call Center Plus - Formulários (o que a agente preenche durante a ligação).
 * Regras de negócio da classe original do form_designer (paloSantoDataForm), via CcxFormService.
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
            . '<link rel="stylesheet" href="' . $a . '/formularios.css?v=' . $v . '">'
            . '<div class="ccxc" id="ccx-formularios" data-api="?menu=' . $h(rawurlencode($module_name)) . '&amp;rawmode=yes"'
            . ' data-token="' . $h($_SESSION['ccx_csrf']) . '"></div>'
            . '<script src="' . $a . '/formularios.js?v=' . $v . '"></script>';
    }

    require_once 'modules/ccx_common/libs/FormService.php';
    if (in_array($action, array('save', 'status', 'delete'), true)) {
        $tok = isset($_SERVER['HTTP_X_CCX_TOKEN']) ? (string) $_SERVER['HTTP_X_CCX_TOKEN'] : '';
        if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !hash_equals($_SESSION['ccx_csrf'], $tok)) {
            return ccx_json(array('error' => 'Sessão expirada. Recarregue a página.'), 403);
        }
    }
    $id = isset($_REQUEST['id']) && ctype_digit((string) $_REQUEST['id']) ? (int) $_REQUEST['id'] : 0;
    try {
        $svc = new CcxFormService($cfg);
        switch ($action) {
            case 'list':   return ccx_json(array('forms' => $svc->listAll()));
            case 'get':    return ccx_json(array('form' => $svc->get($id)));
            case 'save':
                $data = json_decode(isset($_POST['data']) ? (string) $_POST['data'] : '', true);
                if (!is_array($data)) return ccx_json(array('error' => 'Dados inválidos.'), 400);
                $svc->save($data);
                return ccx_json(array('ok' => true));
            case 'status':
                $svc->setActive($id, !empty($_POST['on']));
                return ccx_json(array('ok' => true));
            case 'delete':
                $svc->delete($id);
                return ccx_json(array('ok' => true));
        }
        return ccx_json(array('error' => 'Ação desconhecida.'), 400);
    } catch (Exception $e) {
        return ccx_json(array('error' => $e->getMessage()), 400);
    }
}
