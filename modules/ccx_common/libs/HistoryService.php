<?php
/*
 * Issabel Call Center Plus - ligações de hoje da agente, com ficha e formulário.
 * O discador aceita gravar o formulário de uma ligação que já terminou, desde que ela
 * seja da agente que está gravando (ECCP saveformdata confere isso). O console original
 * só não deixa porque sempre grava na última ligação da sessão. Aqui a agente escolhe.
 */
if (!defined('CCX_ROOT')) exit;

class CcxHistory
{
    private $pdo;
    private $agentId;

    /** $agentChannel: canal do console, ex.: "PJSIP/210" ou "Agent/101". */
    public function __construct(PDO $pdo, $agentChannel)
    {
        $this->pdo = $pdo;
        $st = $pdo->prepare("SELECT id FROM agent WHERE CONCAT(type, '/', number) = ? ORDER BY estatus = 'A' DESC, id DESC LIMIT 1");
        $st->execute(array((string) $agentChannel));
        $this->agentId = (int) $st->fetchColumn();
        if (!$this->agentId) throw new Exception('Agente não encontrada.');
    }

    public function today()
    {
        $st = $this->pdo->prepare("SELECT c.id, c.phone, c.start_time, c.end_time, c.duration, c.id_campaign, k.name AS campaign
            FROM calls c INNER JOIN campaign k ON k.id = c.id_campaign
            WHERE c.id_agent = ? AND c.start_time >= ? ORDER BY c.start_time DESC LIMIT 200");
        $st->execute(array($this->agentId, date('Y-m-d 00:00:00')));
        $calls = $st->fetchAll(PDO::FETCH_ASSOC);
        if (!$calls) return array();
        $ids = array_map('intval', array_column($calls, 'id'));
        $in = implode(',', $ids);

        $names = array();
        foreach ($this->pdo->query("SELECT id_call, columna, value FROM call_attribute WHERE id_call IN ($in) ORDER BY column_number") as $a) {
            if (!isset($names[$a['id_call']]) && preg_match('/^(nome|name|nombre|cliente|contato)$/iu', trim($a['columna']))) $names[$a['id_call']] = $a['value'];
        }
        $camps = implode(',', array_unique(array_map('intval', array_column($calls, 'id_campaign'))));
        $hasForm = array();
        foreach ($this->pdo->query("SELECT cf.id_campaign, COUNT(ff.id) AS n FROM campaign_form cf INNER JOIN form_field ff ON ff.id_form = cf.id_form AND ff.tipo <> 'LABEL' WHERE cf.id_campaign IN ($camps) GROUP BY cf.id_campaign") as $r) {
            $hasForm[(int) $r['id_campaign']] = (int) $r['n'] > 0;
        }
        $answered = array();
        foreach ($this->pdo->query("SELECT id_calls, COUNT(*) AS n FROM form_data_recolected WHERE id_calls IN ($in) AND value <> '' GROUP BY id_calls") as $r) {
            $answered[(int) $r['id_calls']] = (int) $r['n'];
        }
        $out = array();
        foreach ($calls as $c) {
            $id = (int) $c['id'];
            $live = $c['end_time'] === null;
            $out[] = array(
                'id' => $id, 'phone' => $c['phone'], 'name' => isset($names[$id]) ? $names[$id] : null,
                'campaign' => $c['campaign'], 'start' => strtotime($c['start_time']),
                'duration' => $live ? null : (int) $c['duration'], 'live' => $live,
                'record' => empty($hasForm[(int) $c['id_campaign']]) ? 'none' : (!empty($answered[$id]) ? 'done' : 'pending'),
            );
        }
        return $out;
    }

    public function detail($callId)
    {
        $c = $this->own($callId);
        $attrs = array(); $name = null;
        $st = $this->pdo->prepare('SELECT columna, value FROM call_attribute WHERE id_call = ? ORDER BY column_number');
        $st->execute(array($c['id']));
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $a) {
            if ($name === null && preg_match('/^(nome|name|nombre|cliente|contato)$/iu', trim($a['columna']))) { $name = $a['value']; continue; }
            $attrs[] = array('label' => $a['columna'], 'value' => $a['value']);
        }
        $values = array();
        $st = $this->pdo->prepare('SELECT id_form_field, value FROM form_data_recolected WHERE id_calls = ?');
        $st->execute(array($c['id']));
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $v) $values[(int) $v['id_form_field']] = $v['value'];
        return array(
            'id' => (int) $c['id'], 'phone' => $c['phone'], 'name' => $name, 'campaign' => $c['campaign'],
            'script' => (string) $c['script'], 'start' => strtotime($c['start_time']),
            'duration' => $c['end_time'] === null ? null : (int) $c['duration'], 'live' => $c['end_time'] === null,
            'attributes' => $attrs, 'forms' => $this->forms((int) $c['id_campaign']), 'values' => $values,
        );
    }

    /** $data: [id_form => [id_field => valor]]. Grava pelo console (ECCP saveformdata). */
    public function save($callId, array $data, $oPaloConsola)
    {
        $c = $this->own($callId);
        if ($c['end_time'] === null) throw new Exception('Esta ligação ainda está em andamento. Use o registro da ligação ao lado.');
        $allowed = array();
        foreach ($this->forms((int) $c['id_campaign']) as $f) foreach ($f['fields'] as $fd) if ($fd['type'] !== 'LABEL') $allowed[$f['id']][$fd['id']] = $fd;
        $clean = array();
        foreach ($data as $idForm => $fields) {
            if (!isset($allowed[(int) $idForm]) || !is_array($fields)) continue;
            foreach ($fields as $idField => $v) {
                if (!isset($allowed[(int) $idForm][(int) $idField])) continue;
                $v = trim((string) $v);
                if (strlen($v) > 250) throw new Exception('O campo "' . $allowed[(int) $idForm][(int) $idField]['label'] . '" passa de 250 caracteres.');
                $clean[(int) $idForm][(int) $idField] = $v;
            }
        }
        if (!$clean) throw new Exception('Nada para salvar.');
        if (!$oPaloConsola->guardarDatosFormularios('outgoing', (int) $c['id'], $clean)) {
            $m = (string) $oPaloConsola->errMsg;
            if (stripos($m, 'Unauthorized') !== false) throw new Exception('Esta ligação não é sua, então o registro não pode ser alterado.');
            throw new Exception('Não foi possível salvar o registro: ' . $m);
        }
        return true;
    }

    private function own($callId)
    {
        $st = $this->pdo->prepare('SELECT c.id, c.phone, c.start_time, c.end_time, c.duration, c.id_campaign, k.name AS campaign, k.script
            FROM calls c INNER JOIN campaign k ON k.id = c.id_campaign WHERE c.id = ? AND c.id_agent = ?');
        $st->execute(array((int) $callId, $this->agentId));
        $c = $st->fetch(PDO::FETCH_ASSOC);
        if (!$c) throw new Exception('Ligação não encontrada entre as suas.');
        return $c;
    }

    private function forms($campaignId)
    {
        $st = $this->pdo->prepare("SELECT f.id, f.nombre FROM campaign_form cf INNER JOIN form f ON f.id = cf.id_form WHERE cf.id_campaign = ? ORDER BY f.id");
        $st->execute(array($campaignId));
        $forms = array();
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $f) {
            $fs = $this->pdo->prepare('SELECT id, etiqueta, value, tipo FROM form_field WHERE id_form = ? ORDER BY orden');
            $fs->execute(array((int) $f['id']));
            $fields = array();
            foreach ($fs->fetchAll(PDO::FETCH_ASSOC) as $x) {
                $opts = $x['tipo'] === 'LIST' ? array_values(array_filter(explode(',', $x['value']), 'strlen')) : array();
                $fields[] = array('id' => (int) $x['id'], 'label' => $x['etiqueta'], 'type' => $x['tipo'], 'options' => $opts);
            }
            $forms[] = array('id' => (int) $f['id'], 'name' => $f['nombre'], 'fields' => $fields);
        }
        return $forms;
    }
}
