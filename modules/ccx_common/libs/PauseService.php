<?php
/*
 * Issabel Call Center Plus - tipos de pausa que a agente escolhe no console.
 * Camada fina sobre a classe do próprio break_administrator (PaloSantoBreaks). Não há excluir:
 * o histórico de pausas das agentes aponta para a pausa (tabela audit), então ela só é desativada.
 * A pausa "Hold" (tipo H) é do sistema e não aparece, como na tela original.
 */
if (!defined('CCX_ROOT')) exit;

class CcxPauseService
{
    private $cfg;
    private $pDB;
    private $oBrk;

    public function __construct($cfg, $pDB = null)
    {
        $this->cfg = $cfg;
        if (!class_exists('PaloSantoBreaks')) require_once 'modules/break_administrator/libs/PaloSantoBreaks.class.php';
        if (!$pDB) {
            $db = $cfg['cc_db'];
            $pDB = new paloDB(sprintf('mysql://%s:%s@%s/%s', $db['user'], $db['pass'], $db['host'], $db['name']));
            if (!empty($pDB->errMsg)) throw new Exception('Banco call_center indisponível: ' . $pDB->errMsg);
        }
        $this->pDB = $pDB;
        $this->oBrk = new PaloSantoBreaks($pDB);
    }

    public function listAll()
    {
        $rows = $this->oBrk->getBreaks(null, 'all');
        if (!is_array($rows)) throw new Exception($this->oBrk->errMsg);
        // Uso de hoje e quem está na pausa agora, pela tabela audit.
        $usage = array();
        $start = date('Y-m-d 00:00:00'); $now = date('Y-m-d H:i:s');
        foreach ((array) $this->pDB->fetchTable("SELECT id_break, COUNT(*) AS n,
                SUM(UNIX_TIMESTAMP(COALESCE(datetime_end, ?)) - UNIX_TIMESTAMP(GREATEST(datetime_init, ?))) AS sec,
                SUM(datetime_end IS NULL) AS agora
            FROM audit WHERE id_break IS NOT NULL AND (datetime_end IS NULL OR datetime_end >= ?) AND datetime_init <= ?
            GROUP BY id_break", true, array($now, $start, $start, $now)) as $u) {
            $usage[(int) $u['id_break']] = $u;
        }
        $out = array();
        foreach ($rows as $r) {
            if ($r['name'] === 'Preview' && strpos((string) $r['description'], 'Call Center Plus') !== false) continue;
            $u = isset($usage[(int) $r['id']]) ? $usage[(int) $r['id']] : null;
            $out[] = array('id' => (int) $r['id'], 'name' => $r['name'], 'description' => (string) $r['description'], 'status' => $r['status'],
                'today_count' => $u ? (int) $u['n'] : 0, 'today_sec' => $u ? max(0, (int) $u['sec']) : 0, 'now' => $u ? (int) $u['agora'] : 0);
        }
        usort($out, function ($a, $b) { return strcmp($a['status'], $b['status']) ?: strcasecmp($a['name'], $b['name']); });
        return $out;
    }

    public function save($id, $name, $description)
    {
        $name = trim((string) $name); $description = trim((string) $description);
        if ($name === '') throw new Exception('Dê um nome para a pausa.');
        if ($this->len($name) > 40) throw new Exception('O nome pode ter no máximo 40 caracteres.');
        if ($this->len($description) > 120) throw new Exception('A descrição pode ter no máximo 120 caracteres.');
        // O console mostra "Nome - Descrição"; um " - " no nome confundiria essa leitura.
        if (strpos($name, ' - ') !== false) throw new Exception('Use outro separador no nome: o " - " é usado para mostrar a descrição.');
        // A classe original só confere nome repetido ao criar; conferimos nos dois casos.
        $dup = $this->pDB->getFirstRowQuery("SELECT id FROM break WHERE name = ? AND tipo = 'B' AND id <> ?", true, array($name, (int) $id));
        if (is_array($dup) && !empty($dup['id'])) throw new Exception('Já existe uma pausa com esse nome.');
        $ok = $id ? $this->oBrk->updateBreak((int) $id, $name, $description) : $this->oBrk->createBreak($name, $description);
        if (!$ok) throw new Exception($this->msg($this->oBrk->errMsg));
        return true;
    }

    public function setActive($id, $on)
    {
        $b = $this->oBrk->getBreaks((int) $id);
        if (!is_array($b) || !$b) throw new Exception('Pausa não encontrada.');
        if (!$this->oBrk->activateBreak((int) $id, $on ? 'A' : 'I')) throw new Exception($this->msg($this->oBrk->errMsg));
        return true;
    }

    private function len($s) { return preg_match_all('/./us', (string) $s); }

    private function msg($m)
    {
        if (stripos((string) $m, 'already exists') !== false) return 'Já existe uma pausa com esse nome.';
        if (stripos((string) $m, "can't be empty") !== false) return 'Dê um nome para a pausa.';
        return $m !== '' ? $m : 'Não foi possível concluir a operação.';
    }
}
