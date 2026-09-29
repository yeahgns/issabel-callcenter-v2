<?php
/*
 * Issabel Call Center Plus - Campanhas de saída.
 * O Issabel só chama _moduleContent() para usuários com permissão neste menu, inclusive
 * nas requisições rawmode=yes. As regras de negócio são as da classe original do
 * campaign_out (paloSantoCampaignCC), via CcxCampaignService.
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
            . '<div class="ccxc" id="ccx-campanhas" data-api="?menu=' . $h(rawurlencode($module_name)) . '&amp;rawmode=yes"'
            . ' data-token="' . $h($_SESSION['ccx_csrf']) . '" data-legacy="?menu=campaign_out"></div>'
            . '<script src="' . $a . '/campanhas.js?v=' . $v . '"></script>';
    }

    require_once 'modules/ccx_common/libs/CampaignService.php';
    $mutating = in_array($action, array('save', 'status', 'delete', 'purge'), true);
    if ($mutating) {
        $tok = isset($_SERVER['HTTP_X_CCX_TOKEN']) ? (string) $_SERVER['HTTP_X_CCX_TOKEN'] : '';
        if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !hash_equals($_SESSION['ccx_csrf'], $tok)) {
            return ccx_json(array('error' => 'Sessão expirada. Recarregue a página.'), 403);
        }
    }
    $id = isset($_REQUEST['id']) && ctype_digit((string) $_REQUEST['id']) ? (int) $_REQUEST['id'] : 0;

    try {
        $svc = new CcxCampaignService($cfg);
        switch ($action) {
            case 'list':
                return ccx_json(array('now' => time(), 'campaigns' => $svc->listAll()));
            case 'get':
                return ccx_json(array('campaign' => $svc->get($id)));
            case 'options':
                return ccx_json($svc->options(isset($_GET['queue']) ? (string) $_GET['queue'] : null));
            case 'save':
                $in = $_POST;
                $in['forms'] = isset($_POST['forms']) ? (array) $_POST['forms'] : array();
                $newId = $svc->save($in);
                return ccx_json(array('ok' => true, 'id' => $newId));
            case 'status':
                $svc->setStatus($id, isset($_POST['status']) ? (string) $_POST['status'] : '');
                return ccx_json(array('ok' => true));
            case 'delete':
                $svc->delete($id);
                return ccx_json(array('ok' => true));
            case 'purge':
                $svc->purge($id);
                return ccx_json(array('ok' => true));
        }
        return ccx_json(array('error' => 'Ação desconhecida.'), 400);
    } catch (Exception $e) {
        return ccx_json(array('error' => $e->getMessage()), 400);
    }
}
