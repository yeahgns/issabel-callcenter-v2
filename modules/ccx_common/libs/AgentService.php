<?php
/*
 * Issabel Call Center Plus - agentes (callback extensions): o login que a agente usa no console.
 * Camada fina sobre a classe do próprio cb_extensions (Agentes). Diferenças da tela original:
 *   - a senha nunca vai para o navegador; em branco na edição = manter a atual;
 *   - "conectada" = sessão aberta no console (tabela audit), não "membro de alguma fila";
 *   - desconectar = logout de verdade pelo discador (o mesmo do "Encerrar sessão" do console),
 *     e não só tirar o ramal das filas;
 *   - a senha interna do ECCP é gerada pela própria classe, sem aparecer na tela.
 */
if (!defined('CCX_ROOT')) exit;

class CcxAgentService
{
    private $cfg;
    private $pDB;
    private $oAg;

    public function __construct($cfg, $pDB = null)
    {
        $this->cfg = $cfg;
        if (!class_exists('Agentes')) require_once 'modules/cb_extensions/libs/Agentes.class.php';
        if (!$pDB) {
            $db = $cfg['cc_db'];
            $pDB = new paloDB(sprintf('mysql://%s:%s@%s/%s', $db['user'], $db['pass'], $db['host'], $db['name']));
            if (!empty($pDB->errMsg)) throw new Exception('Banco call_center indisponível: ' . $pDB->errMsg);
        }
        $this->pDB = $pDB;
        $this->oAg = new Agentes($pDB);
    }

    public function listAll()
    {
        $rows = $this->oAg->getAgents();
        if (!is_array($rows)) throw new Exception($this->oAg->errMsg);
        $sessions = array();
        try {
            require_once dirname(__FILE__) . '/sessions.php';
            $sessions = ccx_agent_sessions(ccx_pdo('cc', $this->cfg));
        } catch (Exception $e) { /* sem tempos de sessão: lista mesmo assim */ }
        $out = array();
        foreach ($rows as $r) {
            $chan = $r['type'] . '/' . $r['number'];
            $s = isset($sessions[$chan]) ? $sessions[$chan] : null;
            $out[] = array('number' => $r['number'], 'type' => $r['type'], 'channel' => $chan, 'name' => $r['name'],
                'session_start' => $s ? $s['session_start'] : null, 'day_sec' => $s ? $s['day_sec'] : 0);
        }
        return $out;
    }

    /** Ramais do PABX que ainda não têm login de agente, com o nome cadastrado no PABX. */
    public function freeExtensions()
    {
        $used = array();
        foreach ((array) $this->oAg->getAgents() as $a) $used[$a['type'] . '/' . $a['number']] = true;
        // Agentes do tipo Agent (não callback) também ocupam o número.
        foreach ((array) $this->pDB->fetchTable("SELECT number FROM agent WHERE estatus = 'A'") as $t) $used['#' . $t[0]] = true;
        $pbx = ccx_pdo('pbx', $this->cfg);
        $names = array();
        foreach ($pbx->query('SELECT extension, name FROM users') as $u) $names[(string) $u['extension']] = (string) $u['name'];
        $out = array();
        foreach ($pbx->query("SELECT data FROM sip WHERE keyword = 'Dial' UNION SELECT data FROM iax WHERE keyword = 'Dial'") as $r) {
            $chan = (string) $r['data'];
            if (!preg_match('#^(SIP|PJSIP|IAX2)/(\d+)$#', $chan, $m) || isset($used[$chan]) || isset($used['#' . $m[2]])) continue;
            $nm = isset($names[$m[2]]) ? $names[$m[2]] : '';
            $out[] = array('value' => $chan, 'number' => $m[2], 'name' => $nm, 'label' => $m[2] . ($nm !== '' ? ' - ' . $nm : '') . ' (' . $m[1] . ')');
        }
        usort($out, function ($a, $b) { return strnatcmp($a['number'], $b['number']); });
        return $out;
    }

    public function create($channel, $name, $password, $password2)
    {
        $channel = (string) $channel;
        $ok = false;
        foreach ($this->freeExtensions() as $e) if ($e['value'] === $channel) { $ok = true; break; }
        if (!$ok) throw new Exception('Escolha um ramal da lista. Ele pode já ter um login de agente.');
        $name = $this->checkName($name);
        $this->checkPassword($password, $password2, true);
        // 4º item vazio: a classe gera a senha interna do ECCP.
        if (!$this->oAg->addAgent(array($channel, (string) $password, $name, ''))) throw new Exception($this->msg($this->oAg->errMsg));
        return true;
    }

    public function update($number, $name, $password, $password2)
    {
        $cur = $this->current($number);
        $name = $this->checkName($name);
        $keep = ((string) $password === '' && (string) $password2 === '');
        if (!$keep) $this->checkPassword($password, $password2, false);
        // A classe sempre grava a senha: em branco, repassamos a atual (lida aqui, nunca enviada à tela).
        $args = array($cur['type'] . '/' . $cur['number'], $keep ? $cur['password'] : (string) $password, $name, null);
        if (!$this->oAg->editAgent($args)) throw new Exception($this->msg($this->oAg->errMsg));
        return true;
    }

    public function delete($number)
    {
        $cur = $this->current($number);
        if ($this->isConnected($cur)) throw new Exception('Esta agente está conectada no console. Desconecte antes de excluir.');
        if (!$this->oAg->deleteAgent($cur['number'])) throw new Exception($this->msg($this->oAg->errMsg));
        return true;
    }

    /** Logout de verdade pelo discador, o mesmo do botão "Encerrar sessão" do console. */
    public function disconnect($number)
    {
        global $arrConf;
        $cur = $this->current($number);
        if (!class_exists('PaloSantoConsola')) {
            require_once 'modules/agent_console/libs/issabel2.lib.php';
            require_once 'modules/agent_console/libs/paloSantoConsola.class.php';
        }
        $db = $this->cfg['cc_db'];
        $arrConf['cadena_dsn'] = sprintf('mysql://%s:%s@%s/%s', $db['user'], $db['pass'], $db['host'], $db['name']);
        $c = new PaloSantoConsola($cur['type'] . '/' . $cur['number']);
        $ok = $c->logoutAgente();
        $err = $c->errMsg;
        $c->desconectarTodo();
        if (!$ok) {
            if (stripos($err, 'not logged') !== false || stripos($err, 'no est') !== false) throw new Exception('Esta agente já não estava conectada.');
            throw new Exception('O discador não aceitou o logout: ' . $err);
        }
        return true;
    }

    /* ---------------- auxiliares ---------------- */

    private function current($number)
    {
        if (!preg_match('/^\d+$/', (string) $number)) throw new Exception('Agente inválida.');
        $cur = $this->oAg->getAgents((string) $number);
        if (!is_array($cur) || !$cur || empty($cur['number'])) throw new Exception('Agente não encontrada.');
        return $cur;
    }

    private function isConnected(array $cur)
    {
        try {
            require_once dirname(__FILE__) . '/sessions.php';
            $s = ccx_agent_sessions(ccx_pdo('cc', $this->cfg));
            $k = $cur['type'] . '/' . $cur['number'];
            return !empty($s[$k]['session_start']);
        } catch (Exception $e) { return false; }
    }

    private function checkName($name)
    {
        $name = trim((string) $name);
        if ($name === '') throw new Exception('Dê um nome para a agente.');
        if (preg_match_all('/./us', $name) > 60) throw new Exception('O nome pode ter no máximo 60 caracteres.');
        return $name;
    }

    private function checkPassword($p1, $p2, $required)
    {
        $p1 = (string) $p1;
        if ($p1 === '' && $required) throw new Exception('Defina uma senha para o login no console.');
        if (strlen($p1) < 4) throw new Exception('A senha precisa ter pelo menos 4 caracteres.');
        if ($p1 !== (string) $p2) throw new Exception('As duas senhas não são iguais.');
    }

    private function msg($m)
    {
        if (stripos((string) $m, 'already exists') !== false) return 'Este ramal já tem um login de agente.';
        if (stripos((string) $m, 'not found') !== false) return 'Agente não encontrada.';
        return $m !== '' ? $m : 'Não foi possível concluir a operação.';
    }
}
