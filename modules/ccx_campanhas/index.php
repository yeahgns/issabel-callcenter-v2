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
    require_once 'modules/ccx_common/libs/ImportService.php';
    $mutating = in_array($action, array('save', 'status', 'delete', 'purge', 'import_upload', 'import_analyze', 'import_commit'), true);
    if ($mutating) {
        $tok = isset($_SERVER['HTTP_X_CCX_TOKEN']) ? (string) $_SERVER['HTTP_X_CCX_TOKEN'] : '';
        if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !hash_equals($_SESSION['ccx_csrf'], $tok)) {
            return ccx_json(array('error' => 'Sessão expirada. Recarregue a página.'), 403);
        }
    }
    $id = isset($_REQUEST['id']) && ctype_digit((string) $_REQUEST['id']) ? (int) $_REQUEST['id'] : 0;

    // Resultados da campanha em CSV (abre direto no Excel em português).
    if ($action === 'export') {
        require_once 'modules/ccx_common/libs/ExportService.php';
        try {
            list($fname, $csv) = (new CcxExport(ccx_pdo('cc', $cfg)))->campaignCsv($id);
        } catch (Exception $e) {
            return ccx_json(array('error' => $e->getMessage()), 404);
        }
        if (!headers_sent()) {
            header('Content-Type: text/csv; charset=UTF-8');
            header("Content-Disposition: attachment; filename=\"" . str_replace('"', '', $fname) . "\"; filename*=UTF-8''" . rawurlencode($fname));
            header('Cache-Control: no-store');
        }
        return $csv;
    }

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
            case 'import_upload':
                if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                    $err = isset($_FILES['file']['error']) ? (int) $_FILES['file']['error'] : UPLOAD_ERR_NO_FILE;
                    $msg = in_array($err, array(UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE), true)
                        ? 'O arquivo é maior que o limite de envio do servidor (upload_max_filesize do PHP).'
                        : 'O arquivo não chegou ao servidor. Tente de novo.';
                    return ccx_json(array('error' => $msg), 400);
                }
                $imp = new CcxImportService($cfg);
                return ccx_json($imp->upload($id, $_FILES['file']['tmp_name'], basename($_FILES['file']['name'])));
            case 'import_analyze':
            case 'import_commit':
                $imp = new CcxImportService($cfg);
                $key = isset($_POST['key']) ? (string) $_POST['key'] : '';
                $pc = isset($_POST['phone_col']) ? (int) $_POST['phone_col'] : -1;
                $opts = array('skip_dup_file' => !empty($_POST['skip_dup_file']), 'skip_dup_campaign' => !empty($_POST['skip_dup_campaign']));
                if ($action === 'import_analyze') return ccx_json($imp->analyze($key, $pc, $opts));
                $cols = isset($_POST['cols']) ? (array) $_POST['cols'] : array();
                return ccx_json($imp->commit($key, $pc, $cols, $opts));
        }
        return ccx_json(array('error' => 'Ação desconhecida.'), 400);
    } catch (Exception $e) {
        return ccx_json(array('error' => $e->getMessage()), 400);
    }
}
