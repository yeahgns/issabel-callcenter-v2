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

        $cfg = array(
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
