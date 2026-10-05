<?php
/*
 * Issabel Call Center Plus - painel "ccxa" do Agent Console.
 *
 * Este arquivo é instalado em modules/agent_console/panels/ccxa/ pelo nosso install.sh.
 * Não editamos o agent_console; usamos o mecanismo oficial de painéis dele.
 *
 * O console injeta automaticamente todo .js desta pasta js/ na página. O nosso
 * painel-agente.js é a casca: ele redesenha o console por cima. Este PHP:
 *   - injeta o CSS da casca e a configuração (título, nome da agente) via <script>;
 *   - devolve um conteúdo de aba mínimo (a casca o esconde), porque a classe precisa
 *     existir e templateContent precisa retornar algo para o painel ser considerado.
 *
 * Servido pelo Apache como UTF-8, então acentos aqui saem corretos no navegador.
 */
class Panel_Ccxa
{
    /* ---------- ligações de hoje (histórico com ficha e formulário) ---------- */

    private static function history()
    {
        require_once 'modules/ccx_common/libs/bootstrap.php';
        require_once 'modules/ccx_common/libs/HistoryService.php';
        $chan = isset($_SESSION['callcenter']['agente']) ? (string) $_SESSION['callcenter']['agente'] : '';
        return new CcxHistory(ccx_pdo('cc'), $chan);
    }
    private static function out($data)
    {
        if (!headers_sent()) header('Content-Type: application/json; charset=UTF-8');
        return json_encode($data, JSON_UNESCAPED_UNICODE);
    }

    /* action=ccxa_online -> canais das agentes com o console aberto agora (para a transferência). */
    public static function handleJSON_online($module_name, $smarty, $local_templates_dir, $oPaloConsola, $estado)
    {
        try {
            require_once 'modules/ccx_common/libs/bootstrap.php';
            require_once 'modules/ccx_common/libs/sessions.php';
            $online = array();
            foreach (ccx_agent_sessions(ccx_pdo('cc')) as $chan => $s) if (!empty($s['session_start'])) $online[] = $chan;
            return self::out(array('ok' => true, 'online' => $online));
        } catch (Exception $e) {
            return self::out(array('ok' => false, 'error' => $e->getMessage()));
        }
    }

    /* action=ccxa_history */
    public static function handleJSON_history($module_name, $smarty, $local_templates_dir, $oPaloConsola, $estado)
    {
        try { return self::out(array('ok' => true, 'now' => time(), 'calls' => self::history()->today())); }
        catch (Exception $e) { return self::out(array('ok' => false, 'error' => $e->getMessage())); }
    }

    /* action=ccxa_detail&id=N */
    public static function handleJSON_detail($module_name, $smarty, $local_templates_dir, $oPaloConsola, $estado)
    {
        try { return self::out(array('ok' => true, 'call' => self::history()->detail(isset($_GET['id']) ? (int) $_GET['id'] : 0))); }
        catch (Exception $e) { return self::out(array('ok' => false, 'error' => $e->getMessage())); }
    }

    /* action=ccxa_record (POST id, data=JSON {id_form: {id_campo: valor}}) */
    public static function handleJSON_record($module_name, $smarty, $local_templates_dir, $oPaloConsola, $estado)
    {
        try {
            $tok = isset($_SERVER['HTTP_X_CCX_TOKEN']) ? (string) $_SERVER['HTTP_X_CCX_TOKEN'] : '';
            if ($_SERVER['REQUEST_METHOD'] !== 'POST' || empty($_SESSION['ccxa_csrf']) || !hash_equals($_SESSION['ccxa_csrf'], $tok)) {
                throw new Exception('Sessão expirada. Recarregue a página.');
            }
            $data = json_decode(isset($_POST['data']) ? (string) $_POST['data'] : '', true);
            if (!is_array($data)) throw new Exception('Dados inválidos.');
            self::history()->save(isset($_POST['id']) ? (int) $_POST['id'] : 0, $data, $oPaloConsola);
            return self::out(array('ok' => true));
        } catch (Exception $e) {
            return self::out(array('ok' => false, 'error' => $e->getMessage()));
        }
    }

    /*
     * action=ccxa_ringing&rawmode=yes -> ligação tocando no ramal desta agente (antes de atender),
     * com a ficha do contato quando for de campanha. &debug=1 inclui os canais vistos no Asterisk.
     */
    public static function handleJSON_ringing($module_name, $smarty, $local_templates_dir, $oPaloConsola, $estado)
    {
        if (!headers_sent()) header('Content-Type: application/json; charset=UTF-8');
        $out = array('ok' => true, 'ringing' => false, 'now' => time());
        try {
            require_once 'modules/ccx_common/libs/bootstrap.php';
            require_once 'modules/ccx_common/libs/RingingService.php';
            $cc = isset($_SESSION['callcenter']) ? $_SESSION['callcenter'] : array();
            // O aparelho que toca: no callback é o próprio canal da agente (ex.: PJSIP/210).
            $device = isset($cc['agente']) ? (string) $cc['agente'] : '';
            if ($device === '' || stripos($device, 'Agent/') === 0) $device = isset($cc['extension']) ? (string) $cc['extension'] : '';
            if ($device === '') return json_encode($out);
            $debug = !empty($_GET['debug']);
            $svc = new CcxRinging(ccx_config(), ccx_pdo('cc'));
            $r = $svc->forDevice($device, $debug);
            if ($r) $out = array_merge($out, $r);
            if ($debug) $out['debug'] = $svc->lastDebug;
        } catch (Exception $e) {
            $out = array('ok' => false, 'ringing' => false, 'error' => $e->getMessage());
        }
        return json_encode($out, JSON_UNESCAPED_UNICODE);
    }

    /*
     * action=ccxa_session&rawmode=yes -> início da sessão aberta e total logado hoje,
     * para a agente desta sessão do console. Roda dentro da sessão logada do motor.
     */
    public static function handleJSON_session($module_name, $smarty, $local_templates_dir, $oPaloConsola, $estado)
    {
        $out = array('ok' => false, 'now' => time(), 'session_start' => null, 'day_sec' => null);
        try {
            require_once 'modules/ccx_common/libs/bootstrap.php';
            require_once 'modules/ccx_common/libs/sessions.php';
            $chan = isset($_SESSION['callcenter']['agente']) ? (string) $_SESSION['callcenter']['agente'] : '';
            $map = ccx_agent_sessions(ccx_pdo('cc'));
            if ($chan !== '' && isset($map[$chan])) {
                $out['session_start'] = $map[$chan]['session_start'];
                $out['day_sec'] = $map[$chan]['day_sec'];
            }
            $out['ok'] = true;
        } catch (Exception $e) {
            $out['error'] = 'Sessão indisponível';
        }
        if (!headers_sent()) header('Content-Type: application/json; charset=UTF-8');
        return json_encode($out, JSON_UNESCAPED_UNICODE);
    }

    public static function templateContent($module_name, $smarty, $local_templates_dir, $oPaloConsola, $estado)
    {
        $base = 'modules/' . $module_name . '/panels/ccxa';
        $css  = $base . '/css/painel-agente.css';

        // Nome da agente, para o cabeçalho da casca. Vem do estado da sessão.
        $agentName = '';
        if (is_array($estado)) {
            foreach (array('nombre_agente', 'agentname', 'nombre', 'agente') as $k) {
                if (!empty($estado[$k]) && is_string($estado[$k])) { $agentName = $estado[$k]; break; }
            }
        }
        if ($agentName === '' && isset($_SESSION['callcenter']['agente'])) {
            $agentName = (string) $_SESSION['callcenter']['agente'];
        }

        if (empty($_SESSION['ccxa_csrf'])) $_SESSION['ccxa_csrf'] = bin2hex(random_bytes(16));
        $cfg = array(
            'token'      => $_SESSION['ccxa_csrf'],
            'title'      => 'Console do agente',
            'agent_name' => $agentName,
            // Reservado para futuras ações do painel (action=ccxa_...&rawmode=yes).
            'api'        => '?menu=' . rawurlencode($module_name) . '&rawmode=yes',
            'css'        => $css . '?v=0.1.0',
        );
        $cfgJson = json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $v = '0.1.0';

        // O CSS não é injetado pelo console (só .js), então o incluímos aqui.
        // A config precede o painel-agente.js, que o console injeta em seguida.
        // Anti-flash: esconde o console de saida imediatamente (antes do JS externo carregar),
        // com salvaguarda que revela de volta se a casca nao montar (ex.: erro de JS).
        $antiFlash =
            '<style id="ccxa-antiflash">' .
            '#issabel-callcenter-wrap,#issabel-callcenter-shift-bar,#issabel-callcenter-titulo-consola{visibility:hidden!important}' .
            '</style>' .
            '<script>(function(){' .
            'window.addEventListener("load",function(){setTimeout(function(){' .
            'if(!document.getElementById("ccxa-root")){var s=document.getElementById("ccxa-antiflash");if(s)s.parentNode.removeChild(s);}' .
            '},4000);});})();</script>';

        $inject = $antiFlash .
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;600;700&display=swap">' .
            '<link rel="stylesheet" href="' . htmlspecialchars($css) . '?v=' . $v . '">' .
            '<script>window.CCXA_CFG = ' . $cfgJson . ';</script>';

        // Conteúdo de aba mínimo: a casca o esconde. O <div> com o inject garante que
        // CSS e config entrem na página mesmo que o console não injete CSS por conta própria.
        $content = $inject . '<div class="ccxa-native-note" style="display:none">Call Center Plus ativo.</div>';

        return array('title' => 'Plus', 'content' => $content);
    }
}
