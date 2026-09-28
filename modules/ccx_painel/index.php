<?php
/*
 * Issabel Call Center Plus - Painel do call center.
 * O Issabel só chama _moduleContent() para usuários com permissão neste menu,
 * inclusive nas requisições rawmode=yes do snapshot. Não há endpoint sem login.
 */
function _moduleContent(&$smarty, $module_name)
{
    require_once 'modules/ccx_common/libs/bootstrap.php';
    require_once 'modules/ccx_common/libs/view.php';
    $cfg = ccx_config();
    $action = isset($_REQUEST['action']) ? (string) $_REQUEST['action'] : '';

    if ($action === 'snapshot' || $action === 'debug') {
        if (!empty($cfg['demo'])) {
            return ccx_json(array('source' => 'demo'));
        }
        require_once 'modules/agent_console/libs/issabel2.lib.php';
        require_once 'modules/agent_console/libs/JSON.php';
        require_once 'modules/agent_console/libs/paloSantoConsola.class.php';
        require_once 'modules/ccx_common/libs/LiveProvider.php';
        try {
            $p = new CcxLiveProvider($cfg);
            return ccx_json($p->snapshot($action === 'debug'));
        } catch (Exception $e) {
            return ccx_json(array('error' => 'Falha ao montar o painel: ' . $e->getMessage()), 500);
        }
    }

    return ccx_painel_html(array(
        'api'     => '?menu=' . rawurlencode($module_name) . '&action=snapshot&rawmode=yes',
        'assets'  => 'modules/ccx_common/assets',
        'demo'    => !empty($cfg['demo']),
        'poll'    => (int) $cfg['poll_seconds'],
        'company' => $cfg['company'],
    ));
}
