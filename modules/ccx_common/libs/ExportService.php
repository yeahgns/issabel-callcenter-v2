<?php
/*
 * Issabel Call Center Plus - resultados da campanha em CSV, para abrir direto no Excel em português.
 * Mesmos contatos que a exportação original (só os que já chegaram a um resultado), mas:
 *   - separado por ponto e vírgula, UTF-8 com BOM, uma linha de cabeçalho só;
 *   - tudo em português: resultado, motivo, data/hora e duração no formato brasileiro;
 *   - sem colunas técnicas (Uniqueid, código numérico da operadora);
 *   - ordem: telefone, colunas da planilha, resultado da ligação, formulário da agente.
 */
if (!defined('CCX_ROOT')) exit;

class CcxExport
{
    const STATUS = array(
        'Success'   => 'Atendida',
        'NoAnswer'  => 'Não atendeu',
        'ShortCall' => 'Atendida, mas caiu logo em seguida',
        'Abandoned' => 'Cliente desligou antes de falar com a agente',
        'Failure'   => 'Falha na discagem',
    );
    // Causas Q.850 mais comuns. 16/31 = encerramento normal, não acrescentam informação.
    const CAUSE = array(
        1 => 'Número inexistente', 3 => 'Sem rota para o número', 17 => 'Ocupado', 18 => 'Aparelho não respondeu',
        19 => 'Tocou e ninguém atendeu', 20 => 'Celular desligado ou fora de área', 21 => 'Ligação recusada',
        22 => 'Número mudou', 27 => 'Destino fora de serviço', 28 => 'Número incompleto ou inválido',
        34 => 'Sem linha disponível', 38 => 'Rede da operadora fora de serviço', 41 => 'Falha temporária na operadora',
        42 => 'Operadora congestionada', 102 => 'Tempo esgotado', 127 => 'Erro na operadora',
    );

    private $pdo;
    public function __construct(PDO $pdo) { $this->pdo = $pdo; }

    /** Devolve array(nome_do_arquivo, conteúdo_csv). */
    public function campaignCsv($campaignId)
    {
        $st = $this->pdo->prepare('SELECT id, name FROM campaign WHERE id = ?');
        $st->execute(array((int) $campaignId));
        $camp = $st->fetch(PDO::FETCH_ASSOC);
        if (!$camp) throw new Exception('Campanha não encontrada.');
        $id = (int) $camp['id'];

        $st = $this->pdo->prepare("SELECT c.id, c.phone, c.status, c.retries, c.duration, c.failure_cause, c.failure_cause_txt,
                COALESCE(c.start_time, c.datetime_originate) AS quando, a.name AS agent_name, a.number AS agent_number
            FROM calls c LEFT JOIN agent a ON a.id = c.id_agent
            WHERE c.id_campaign = ? AND c.status IN ('Success','Failure','ShortCall','NoAnswer','Abandoned')
            ORDER BY c.id");
        $st->execute(array($id));
        $calls = $st->fetchAll(PDO::FETCH_ASSOC);

        // Colunas da planilha, na ordem em que foram importadas.
        $attrCols = array(); $attrs = array();
        if ($calls) {
            $in = implode(',', array_map('intval', array_column($calls, 'id')));
            foreach ($this->pdo->query("SELECT id_call, columna, value, column_number FROM call_attribute WHERE id_call IN ($in) ORDER BY column_number") as $r) {
                $label = trim($r['columna']);
                if (!isset($attrCols[$label])) $attrCols[$label] = (int) $r['column_number'];
                $attrs[(int) $r['id_call']][$label] = $r['value'];
            }
            asort($attrCols);
        }
        $attrLabels = array_keys($attrCols);

        // Campos dos formulários da campanha (títulos/avisos não têm resposta).
        $st = $this->pdo->prepare("SELECT f.id AS form_id, f.nombre, ff.id, ff.etiqueta FROM campaign_form cf
            INNER JOIN form f ON f.id = cf.id_form INNER JOIN form_field ff ON ff.id_form = f.id
            WHERE cf.id_campaign = ? AND ff.tipo <> 'LABEL' ORDER BY f.id, ff.orden");
        $st->execute(array($id));
        $fields = $st->fetchAll(PDO::FETCH_ASSOC);
        $manyForms = count(array_unique(array_column($fields, 'form_id'))) > 1;
        $answers = array();
        if ($calls && $fields) {
            $in = implode(',', array_map('intval', array_column($calls, 'id')));
            foreach ($this->pdo->query("SELECT id_calls, id_form_field, value FROM form_data_recolected WHERE id_calls IN ($in)") as $r) {
                $answers[(int) $r['id_calls']][(int) $r['id_form_field']] = $r['value'];
            }
        }

        $fixed = array('Resultado', 'Motivo', 'Tentativas', 'Data e hora', 'Duração', 'Agente');
        $taken = array_flip(array_merge(array('Telefone'), $attrLabels, $fixed));
        $header = array_merge(array('Telefone'), $attrLabels, $fixed);
        foreach ($fields as &$f) {
            $label = $manyForms ? $f['nombre'] . ': ' . $f['etiqueta'] : $f['etiqueta'];
            if (isset($taken[$label])) $label .= ' (formulário)';   // não confundir com coluna da planilha
            $taken[$label] = true;
            $f['col'] = $label;
            $header[] = $label;
        }
        unset($f);

        $lines = array($this->row($header));
        foreach ($calls as $c) {
            $cid = (int) $c['id'];
            $row = array($this->phone($c['phone']));
            foreach ($attrLabels as $l) $row[] = isset($attrs[$cid][$l]) ? $attrs[$cid][$l] : '';
            $row[] = isset(self::STATUS[$c['status']]) ? self::STATUS[$c['status']] : $c['status'];
            $row[] = $this->reason($c);
            $row[] = (string) (int) $c['retries'];
            $row[] = $c['quando'] ? date('d/m/Y H:i', strtotime($c['quando'])) : '';
            $row[] = $c['status'] === 'Success' || $c['status'] === 'ShortCall' ? $this->hms((int) $c['duration']) : '';
            $row[] = $c['agent_number'] !== null ? trim(($c['agent_name'] !== '' ? $c['agent_name'] . ' ' : '') . '(' . $c['agent_number'] . ')') : '';
            foreach ($fields as $f) $row[] = isset($answers[$cid][(int) $f['id']]) ? $answers[$cid][(int) $f['id']] : '';
            $lines[] = $this->row($row);
        }

        $safe = trim(preg_replace('/[^\p{L}\p{N} _.-]+/u', '', $camp['name']));
        $name = 'Resultados - ' . ($safe !== '' ? $safe : 'campanha ' . $id) . ' - ' . date('Y-m-d') . '.csv';
        return array($name, "\xEF\xBB\xBF" . implode("\r\n", $lines) . "\r\n");
    }

    private function reason(array $c)
    {
        if ($c['status'] === 'Success') return '';
        $n = $c['failure_cause'] !== null ? (int) $c['failure_cause'] : null;
        if ($n !== null && isset(self::CAUSE[$n])) return self::CAUSE[$n];
        if ($n === null || $n === 0 || $n === 16 || $n === 31) return '';
        return trim((string) $c['failure_cause_txt']) !== '' ? 'Código da operadora ' . $n . ' (' . $c['failure_cause_txt'] . ')' : 'Código da operadora ' . $n;
    }

    /* Formatado o Excel trata como texto (só dígitos ele converte para 2,00E+10).
       O importador do Call Center Plus aceita este formato de volta. */
    private function phone($p)
    {
        $d = preg_replace('/\D/', '', (string) $p);
        if (strlen($d) >= 12 && substr($d, 0, 2) === '55') $d = substr($d, 2);
        if (strlen($d) === 11) return '(' . substr($d, 0, 2) . ') ' . substr($d, 2, 5) . '-' . substr($d, 7);
        if (strlen($d) === 10) return '(' . substr($d, 0, 2) . ') ' . substr($d, 2, 4) . '-' . substr($d, 6);
        return $d !== '' ? (string) $p : '';
    }

    private function hms($s)
    {
        $s = max(0, $s);
        return sprintf('%d:%02d:%02d', intdiv($s, 3600), intdiv($s % 3600, 60), $s % 60);
    }

    private function row(array $cells)
    {
        $out = array();
        foreach ($cells as $v) {
            $v = str_replace(array("\r\n", "\r"), "\n", (string) $v);
            // Proteção contra fórmula: texto vindo da planilha ou da agente que comece com = + - @ não vira fórmula no Excel.
            if ($v !== '' && strpos('=+-@', $v[0]) !== false && !preg_match('/^-?\d+([.,]\d+)?$/', $v)) $v = "'" . $v;
            $out[] = '"' . str_replace('"', '""', $v) . '"';
        }
        return implode(';', $out);
    }
}
