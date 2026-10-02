<?php
/*
 * Issabel Call Center Plus - campanhas de saída.
 * Camada fina sobre a classe do próprio módulo campaign_out (paloSantoCampaignCC):
 * as regras (nome único, fila livre, datas, purge só em campanha inativa...) são as dela.
 * Aqui só normalizamos entrada/saída, traduzimos as mensagens e repetimos a mesma
 * sequência transacional que a tela original faz ao gravar.
 */
if (!defined('CCX_ROOT')) exit;

class CcxCampaignService
{
    private $cfg;
    private $pDB;       // paloDB do call_center (o que a classe original espera)
    private $oCamp;     // paloSantoCampaignCC

    public function __construct($cfg, $pDB = null)
    {
        $this->cfg = $cfg;
        if (!class_exists('paloSantoCampaignCC')) {
            require_once 'modules/campaign_out/libs/paloSantoCampaignCC.class.php';
        }
        if (!$pDB) {
            $db = $cfg['cc_db'];
            $pDB = new paloDB(sprintf('mysql://%s:%s@%s/%s', $db['user'], $db['pass'], $db['host'], $db['name']));
            if (!empty($pDB->errMsg)) throw new Exception('Banco call_center indisponível: ' . $pDB->errMsg);
        }
        $this->pDB = $pDB;
        $this->oCamp = new paloSantoCampaignCC($this->pDB);
    }

    /* ---------------- leitura ---------------- */

    public function listAll()
    {
        $rows = $this->oCamp->getCampaigns(null, null, null, 'all');
        if (!is_array($rows)) throw new Exception($this->msg($this->oCamp->errMsg));
        $queues = $this->queueNames();
        $out = array();
        foreach ($rows as $r) $out[] = $this->shape($r, $queues);
        usort($out, function ($a, $b) {
            $o = array('A' => 0, 'I' => 1, 'T' => 2);
            $d = (isset($o[$a['status']]) ? $o[$a['status']] : 3) - (isset($o[$b['status']]) ? $o[$b['status']] : 3);
            return $d ? $d : $b['id'] - $a['id'];
        });
        return $out;
    }

    public function get($id)
    {
        $rows = $this->oCamp->getCampaigns(null, null, (int) $id);
        if (!is_array($rows) || !count($rows)) throw new Exception('Campanha não encontrada.');
        $c = $this->shape($rows[0], $this->queueNames());
        $forms = $this->oCamp->obtenerCampaignForm((int) $id);
        $c['forms'] = is_array($forms) ? array_map('intval', $forms) : array();
        return $c;
    }

    public function options($currentQueue = null)
    {
        // Filas: todas as do PABX, menos as usadas para ligações de entrada (a classe recusa essas).
        $entrada = array();
        foreach ((array) $this->pDB->fetchTable("SELECT queue FROM queue_call_entry WHERE estatus = 'A'") as $t) $entrada[] = (string) $t[0];
        $queues = array();
        foreach ($this->queueNames() as $num => $name) {
            if (in_array((string) $num, $entrada, true) && (string) $num !== (string) $currentQueue) continue;
            $queues[] = array('value' => (string) $num, 'label' => $name !== '' ? "$name ($num)" : "Fila $num");
        }
        usort($queues, function ($a, $b) { return strnatcmp($a['value'], $b['value']); });

        $trunks = array(array('value' => '', 'label' => 'Rotas de saída do PABX (recomendado)'));
        foreach ($this->trunkList() as $t) $trunks[] = array('value' => $t, 'label' => $t);

        $forms = array();
        foreach ((array) $this->pDB->fetchTable("SELECT id, nombre, descripcion FROM form WHERE estatus = 'A' ORDER BY nombre", true) as $f) {
            $forms[] = array('value' => (int) $f['id'], 'label' => $f['nombre'], 'description' => $f['descripcion']);
        }
        return array('queues' => $queues, 'trunks' => $trunks, 'forms' => $forms);
    }

    /* ---------------- gravação ---------------- */

    /** Cria (sem id) ou atualiza. Retorna o id. Mesma sequência da tela original. */
    public function save(array $in)
    {
        $d = $this->validate($in);
        $isNew = empty($in['id']);
        $id = $isNew ? null : (int) $in['id'];
        // Campos que a tela nova não expõe: mantidos do registro atual (ou padrão ao criar).
        $context = 'from-internal';
        $urls = array(null, null, null);
        if (!$isNew) {
            $cur = $this->oCamp->getCampaigns(null, null, $id);
            if (!is_array($cur) || !count($cur)) throw new Exception('Campanha não encontrada.');
            $cur = $cur[0];
            if ($cur['context'] !== '') $context = $cur['context'];
            $urls = array($cur['id_url'], $cur['id_url2'], $cur['id_url3']);
            foreach ($urls as $k => $u) $urls[$k] = ($u === '' || $u === null) ? null : (int) $u;
        }

        // "Detectar caixa postal": a ligação atendida passa pelo contexto ccx-amd (AMD) antes da fila.
        // Só troca entre os dois contextos conhecidos; um contexto próprio de outra configuração fica.
        if (isset($in['amd'])) {
            $wantAmd = !empty($in['amd']) && $in['amd'] !== '0';
            if ($wantAmd) $context = 'ccx-amd';
            elseif ($context === 'ccx-amd') $context = 'from-internal';
        }

        $this->pDB->beginTransaction();
        $ok = true;
        if ($isNew) {
            $id = $this->oCamp->createEmptyCampaign($d['name'], $d['channels'], $d['retries'], $d['trunk'], $context,
                $d['queue'], $d['date_from'], $d['date_to'], $d['time_from'], $d['time_to'], $d['script'], $urls[0], $urls[1], $urls[2]);
            if (is_null($id)) $ok = false;
        } else {
            $ok = $this->oCamp->updateCampaign($id, $d['name'], $d['channels'], $d['retries'], $d['trunk'], $context,
                $d['queue'], $d['date_from'], $d['date_to'], $d['time_from'], $d['time_to'], $d['script'], $urls[0], $urls[1], $urls[2]);
        }
        if ($ok) {
            $ok = $isNew ? $this->oCamp->addCampaignForm($id, $d['forms']) : $this->oCamp->updateCampaignForm($id, $d['forms']);
        }
        // Campanha nova nasce inativa, para dar tempo de carregar os contatos (igual à tela original).
        if ($ok && $isNew) $ok = $this->oCamp->activar_campaign($id, 'I');

        if (!$ok) {
            $err = $this->oCamp->errMsg;
            $this->pDB->rollBack();
            throw new Exception($this->msg($err));
        }
        $this->pDB->commit();
        return (int) $id;
    }

    public function setStatus($id, $status)
    {
        $c = $this->get($id);
        if ($status === 'A') {
            if ($c['totals']['total'] == 0) throw new Exception('Esta campanha ainda não tem contatos. Carregue a lista antes de ativar.');
            if ($c['totals']['pending'] == 0) throw new Exception('Não há números pendentes para discar nesta campanha.');
            if ($c['date_to'] < date('Y-m-d')) throw new Exception('O período da campanha já terminou. Edite as datas antes de ativar.');
        } elseif ($status !== 'I') {
            throw new Exception('Status inválido.');
        }
        if (!$this->oCamp->activar_campaign((int) $id, $status)) throw new Exception($this->msg($this->oCamp->errMsg));
        return true;
    }

    public function delete($id)
    {
        if (!$this->oCamp->delete_campaign((int) $id)) throw new Exception($this->msg($this->oCamp->errMsg));
        return true;
    }

    public function purge($id)
    {
        if (!$this->oCamp->purge_pending_calls((int) $id)) throw new Exception($this->msg($this->oCamp->errMsg));
        return true;
    }

    /* ---------------- auxiliares ---------------- */

    private function validate(array $in)
    {
        $s = function ($k) use ($in) { return isset($in[$k]) ? trim((string) $in[$k]) : ''; };
        $d = array(
            'name' => $s('name'), 'queue' => $s('queue'), 'trunk' => $s('trunk'), 'script' => isset($in['script']) ? (string) $in['script'] : '',
            'date_from' => $s('date_from'), 'date_to' => $s('date_to'), 'time_from' => substr($s('time_from'), 0, 5), 'time_to' => substr($s('time_to'), 0, 5),
            'retries' => $s('retries'), 'channels' => $s('channels'), 'forms' => array(),
        );
        if ($d['name'] === '') throw new Exception('Dê um nome para a campanha.');
        if (preg_match_all('/./us', $d['name']) > 64) throw new Exception('O nome pode ter no máximo 64 caracteres.');
        if ($d['queue'] === '') throw new Exception('Escolha a fila que vai receber as ligações atendidas.');
        foreach (array('date_from' => 'início', 'date_to' => 'fim') as $k => $lbl) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d[$k]) || !strtotime($d[$k])) throw new Exception("Data de $lbl inválida.");
        }
        if ($d['date_from'] > $d['date_to']) throw new Exception('A data de início precisa ser anterior à data de fim.');
        foreach (array('time_from' => 'início', 'time_to' => 'fim') as $k => $lbl) {
            if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $d[$k])) throw new Exception("Horário de $lbl inválido.");
        }
        if ($d['time_from'] >= $d['time_to']) throw new Exception('O horário de início precisa ser anterior ao de fim.');
        if (!ctype_digit($d['retries']) || (int) $d['retries'] < 1 || (int) $d['retries'] > 20) throw new Exception('Tentativas deve ser um número entre 1 e 20.');
        if ($d['channels'] === '') $d['channels'] = '0';
        if (!ctype_digit($d['channels'])) throw new Exception('Ligações simultâneas deve ser um número (0 = sem limite).');
        if (!empty($in['forms'])) {
            foreach ((array) $in['forms'] as $f) if (ctype_digit((string) $f)) $d['forms'][] = (int) $f;
        }
        return $d;
    }

    private function shape(array $r, array $queues)
    {
        $q = (string) $r['queue'];
        return array(
            'id' => (int) $r['id'], 'name' => $r['name'], 'status' => $r['estatus'],
            'queue' => $q, 'queue_name' => isset($queues[$q]) && $queues[$q] !== '' ? $queues[$q] : null,
            'trunk' => (string) $r['trunk'], 'retries' => (int) $r['retries'], 'channels' => (int) $r['max_canales'],
            'date_from' => $r['datetime_init'], 'date_to' => $r['datetime_end'],
            'time_from' => substr($r['daytime_init'], 0, 5), 'time_to' => substr($r['daytime_end'], 0, 5),
            'script' => (string) $r['script'],
            'amd' => $r['context'] === 'ccx-amd',
            'context' => (string) $r['context'],
            'avg_sec' => $r['promedio'] !== null ? (int) $r['promedio'] : null,
            'totals' => array(
                'total' => (int) $r['total_calls'], 'pending' => (int) $r['pending_calls'], 'completed' => (int) $r['num_completadas'],
            ),
        );
    }

    private function queueNames()
    {
        $out = array();
        try {
            foreach (ccx_pdo('pbx', $this->cfg)->query('SELECT extension, descr FROM queues_config') as $r) $out[(string) $r['extension']] = (string) $r['descr'];
        } catch (Exception $e) {
            // sem acesso ao banco asterisk: cai para as filas já usadas por campanhas
            foreach ((array) $this->pDB->fetchTable('SELECT DISTINCT queue FROM campaign') as $t) $out[(string) $t[0]] = '';
        }
        return $out;
    }

    private function trunkList()
    {
        // Mesma origem da tela original (libs/paloSantoTrunk.class.php do Issabel): TECH/channelid.
        $list = array();
        try {
            foreach (ccx_pdo('pbx', $this->cfg)->query("SELECT tech, channelid FROM trunks WHERE disabled <> 'on' OR disabled IS NULL") as $r) {
                if ($r['channelid'] === '' || $r['tech'] === '') continue;
                $list[] = strtoupper($r['tech']) . '/' . $r['channelid'];
            }
        } catch (Exception $e) { /* sem troncos listados: sobra "rotas de saída" */ }
        return array_values(array_unique($list));
    }

    /** Traduz as mensagens (em inglês) da classe original. */
    private function msg($m)
    {
        $map = array(
            "Name Campaign can't be empty" => 'Dê um nome para a campanha.',
            'Name Campaign already exists' => 'Já existe uma campanha com esse nome.',
            "Queue can't be empty" => 'Escolha a fila que vai receber as ligações atendidas.',
            'Queue must be numeric' => 'Fila inválida.',
            'Queue is being used, choose other one' => 'Essa fila é usada para ligações de entrada. Escolha outra.',
            'Retries must be numeric' => 'Tentativas deve ser um número.',
            'Invalid Start Date' => 'Data de início inválida.', 'Invalid End Date' => 'Data de fim inválida.',
            'Start Date must be greater than End Date' => 'A data de início precisa ser anterior à data de fim.',
            'Invalid Start Time' => 'Horário de início inválido.', 'Invalid End Time' => 'Horário de fim inválido.',
            'Start Time must be greater than End Time' => 'O horário de início precisa ser anterior ao de fim.',
            'Campaign not found' => 'Campanha não encontrada.',
            'Campaign must be inactive or finished to delete it' => 'Desative a campanha antes de excluir.',
        );
        foreach ($map as $en => $pt) if (stripos((string) $m, $en) !== false) return $pt;
        if (stripos((string) $m, 'preview') !== false) return 'Esta campanha está em modo preview e não pode ser ativada no discador automático.';
        if (stripos((string) $m, 'inactive') !== false && stripos((string) $m, 'purge') !== false) return 'Desative a campanha antes de limpar os pendentes.';
        return $m !== '' ? $m : 'Não foi possível concluir a operação.';
    }
}
