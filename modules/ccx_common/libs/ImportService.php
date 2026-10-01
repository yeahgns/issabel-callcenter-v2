<?php
/*
 * Issabel Call Center Plus - importação de contatos para campanhas.
 * Lê CSV como o Excel em português salva (ponto e vírgula, Windows-1252) ou UTF-8 com
 * vírgula, mostra uma prévia e grava pela classe do próprio módulo (paloContactInsert),
 * que consulta a lista de não ligar e grava telefone + colunas como o importador original.
 */
if (!defined('CCX_ROOT')) exit;

class CcxImportService
{
    const MAX_ROWS = 50000;
    const MAX_BYTES = 20971520;   // 20 MB
    private $cfg;
    private $pdo;

    public function __construct($cfg, PDO $pdo = null)
    {
        $this->cfg = $cfg;
        $this->pdo = $pdo ? $pdo : ccx_pdo('cc', $cfg);
    }

    /* ---------------- 1. envio do arquivo ---------------- */

    /** Lê o arquivo enviado e guarda uma cópia normalizada para as próximas etapas. */
    public function upload($campaignId, $tmpPath, $fileName)
    {
        $camp = $this->campaign($campaignId);
        if (!is_uploaded_file($tmpPath) && !is_file($tmpPath)) throw new Exception('O arquivo não chegou ao servidor. Tente de novo.');
        $size = filesize($tmpPath);
        if ($size === 0) throw new Exception('O arquivo está vazio.');
        if ($size > self::MAX_BYTES) throw new Exception('O arquivo passa de 20 MB. Divida a lista em partes menores.');
        $raw = file_get_contents($tmpPath);
        if (substr($raw, 0, 2) === "PK") {
            throw new Exception('Esse arquivo parece ser uma planilha do Excel (.xlsx). No Excel, use Arquivo, Salvar como, e escolha "CSV UTF-8" ou "CSV (separado por vírgulas)".');
        }

        list($text, $encoding) = $this->toUtf8($raw);
        $delimiter = $this->detectDelimiter($text);
        $rows = $this->parse($text, $delimiter);
        if (count($rows) < 2) throw new Exception('O arquivo precisa ter uma linha de cabeçalho com os nomes das colunas e pelo menos um contato.');
        if (count($rows) - 1 > self::MAX_ROWS) throw new Exception('O arquivo tem mais de ' . number_format(self::MAX_ROWS, 0, ',', '.') . ' contatos. Divida a lista em partes menores.');

        $header = array_shift($rows);                      // cada linha: array('line' => n, 'cells' => array)
        $ncols = count($header['cells']);
        foreach ($rows as $r) $ncols = max($ncols, count($r['cells']));
        $headers = array();
        for ($i = 0; $i < $ncols; $i++) {
            $h = isset($header['cells'][$i]) ? trim($header['cells'][$i]) : '';
            $headers[] = $h !== '' ? $h : 'Coluna ' . ($i + 1);
        }

        $key = bin2hex(random_bytes(12));
        $data = array('campaign' => (int) $camp['id'], 'file' => (string) $fileName, 'encoding' => $encoding,
            'delimiter' => $delimiter, 'headers' => $headers, 'rows' => $rows, 'created' => time());
        if (file_put_contents($this->tmpFile($key), json_encode($data, JSON_UNESCAPED_UNICODE)) === false) {
            throw new Exception('Não foi possível guardar o arquivo temporariamente no servidor.');
        }
        $_SESSION['ccx_import'][$key] = (int) $camp['id'];
        $this->cleanupOld();

        $sample = array();
        foreach (array_slice($rows, 0, 8) as $r) $sample[] = $this->pad($r['cells'], $ncols);
        return array(
            'key' => $key, 'file' => (string) $fileName, 'encoding' => $encoding, 'delimiter' => $delimiter,
            'headers' => $headers, 'rows' => count($rows), 'sample' => $sample,
            'phone_col' => $this->guessPhoneColumn($headers, $rows),
            'campaign' => array('id' => (int) $camp['id'], 'name' => $camp['name'], 'status' => $camp['estatus']),
            'long_limit' => $this->valueLimit(),
        );
    }

    /* ---------------- 2. prévia (mesma regra que a gravação usa) ---------------- */

    public function analyze($key, $phoneCol, array $opts)
    {
        $d = $this->load($key);
        $plan = $this->plan($d, (int) $phoneCol, $opts);
        unset($plan['insert']);
        return $plan;
    }

    /* ---------------- 3. gravação ---------------- */

    public function commit($key, $phoneCol, array $cols, array $opts)
    {
        $d = $this->load($key);
        $camp = $this->campaign($d['campaign']);
        $plan = $this->plan($d, (int) $phoneCol, $opts);
        if (!$plan['will_import']) throw new Exception('Nenhum contato válido para importar.');
        if ($plan['long_values'] && $plan['long_limit']) {
            throw new Exception($plan['long_values'] . ' contato(s) têm textos com mais de ' . $plan['long_limit'] .
                ' caracteres, e o banco ainda não aceita textos longos. Rode "bash install.sh" no servidor e importe de novo.');
        }

        // Colunas extras que viram dados da ficha (tudo menos o telefone e o que foi desmarcado).
        $keep = array();
        foreach ($d['headers'] as $i => $h) {
            if ($i === (int) $phoneCol) continue;
            if ($cols && !in_array($i, array_map('intval', $cols), true)) continue;
            $keep[$i] = $this->label($h);
        }

        if (!class_exists('paloContactInsert')) require_once 'modules/campaign_out/libs/paloContactInsert.class.php';
        @set_time_limit(0);
        $this->pdo->beginTransaction();
        try {
            $ins = new paloContactInsert($this->pdo, (int) $camp['id']);
            if (!$ins->beforeBatchInsert()) throw new Exception($ins->errMsg);
            $n = 0;
            foreach ($plan['insert'] as $row) {
                $attrs = array(); $num = 1;
                foreach ($keep as $i => $label) {
                    $attrs[$num++] = array($label, isset($row['cells'][$i]) ? trim($row['cells'][$i]) : '');
                }
                if (is_null($ins->insertOneContact($row['phone'], $attrs))) {
                    throw new Exception('Falha ao gravar a linha ' . $row['line'] . ': ' . $ins->errMsg);
                }
                $n++;
            }
            // Campanha finalizada que ganhou contatos volta a ficar inativa: quem ativa é você.
            if ($camp['estatus'] === 'T') {
                $st = $this->pdo->prepare("UPDATE campaign SET estatus = 'I' WHERE id = ? AND estatus = 'T'");
                $st->execute(array((int) $camp['id']));
            }
            $this->pdo->commit();
        } catch (Exception $e) {
            $this->pdo->rollBack();
            throw $e;
        }
        @unlink($this->tmpFile($key));
        unset($_SESSION['ccx_import'][$key]);
        unset($plan['insert']);
        $plan['imported'] = $n;
        $plan['reopened'] = $camp['estatus'] === 'T';
        return $plan;
    }

    /* ---------------- regras ---------------- */

    /** Decide o destino de cada linha. Usado pela prévia e pela gravação. */
    private function plan(array $d, $phoneCol, array $opts)
    {
        if ($phoneCol < 0 || $phoneCol >= count($d['headers'])) throw new Exception('Escolha a coluna do telefone.');
        $skipDupFile = !empty($opts['skip_dup_file']);
        $skipDupCamp = !empty($opts['skip_dup_campaign']);

        $existing = array();
        if ($skipDupCamp) {
            $st = $this->pdo->prepare('SELECT phone FROM calls WHERE id_campaign = ?');
            $st->execute(array($d['campaign']));
            foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $p) $existing[$this->clean($p)] = true;
        }
        $limit = $this->valueLimit();
        $out = array('total' => count($d['rows']), 'will_import' => 0, 'invalid' => 0, 'invalid_lines' => array(),
            'dup_file' => 0, 'dup_campaign' => 0, 'dnc' => 0, 'long_values' => 0, 'long_limit' => $limit, 'insert' => array());
        $seen = array();
        $phones = array();
        foreach ($d['rows'] as $r) {
            $raw = isset($r['cells'][$phoneCol]) ? $r['cells'][$phoneCol] : '';
            $p = $this->clean($raw);
            if (!preg_match('/^\d{8,15}$/', $p)) {
                $out['invalid']++;
                if (count($out['invalid_lines']) < 50) $out['invalid_lines'][] = array('line' => $r['line'], 'value' => trim($raw));
                continue;
            }
            if (isset($seen[$p])) { if ($skipDupFile) { $out['dup_file']++; continue; } }
            $seen[$p] = true;
            if ($skipDupCamp && isset($existing[$p])) { $out['dup_campaign']++; continue; }
            if ($limit) {
                foreach ($r['cells'] as $i => $c) if ($i !== $phoneCol && $this->len($c) > $limit) { $out['long_values']++; break; }
            }
            $out['insert'][] = array('line' => $r['line'], 'phone' => $p, 'cells' => $r['cells']);
            $phones[] = $p;
        }
        $out['will_import'] = count($out['insert']);
        // Quantos vão entrar marcados como "não ligar" (a classe original faz essa marcação ao gravar).
        if ($phones) {
            foreach (array_chunk(array_values(array_unique($phones)), 500) as $chunk) {
                $st = $this->pdo->prepare('SELECT COUNT(*) FROM dont_call WHERE status = ? AND caller_id IN (' . implode(',', array_fill(0, count($chunk), '?')) . ')');
                $st->execute(array_merge(array('A'), $chunk));
                $out['dnc'] += (int) $st->fetchColumn();
            }
        }
        return $out;
    }

    private function clean($s)
    {
        // Só tira formatação; o número é discado como veio (DDD/país não são alterados).
        return preg_replace('/[\s().\-\/+]/u', '', trim((string) $s));
    }

    private function guessPhoneColumn(array $headers, array $rows)
    {
        foreach ($headers as $i => $h) {
            if (preg_match('/tel|fone|celular|n[uú]mero|phone|whats|contato/iu', $h)) return $i;
        }
        $best = 0; $bestScore = -1;
        $sample = array_slice($rows, 0, 50);
        foreach ($headers as $i => $h) {
            $score = 0;
            foreach ($sample as $r) if (isset($r['cells'][$i]) && preg_match('/^\d{8,15}$/', $this->clean($r['cells'][$i]))) $score++;
            if ($score > $bestScore) { $best = $i; $bestScore = $score; }
        }
        return $best;
    }

    private function label($h)
    {
        // call_attribute.columna guarda até 30 caracteres.
        return $this->len($h) > 30 ? $this->cut($h, 30) : $h;
    }

    /** Limite de caracteres de cada célula no banco (0 = sem limite prático, após a migração). */
    private function valueLimit()
    {
        static $lim = null;
        if ($lim !== null) return $lim;
        $st = $this->pdo->query("SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'call_attribute' AND COLUMN_NAME = 'value'");
        $r = $st ? $st->fetch(PDO::FETCH_ASSOC) : null;
        $lim = ($r && $r['DATA_TYPE'] === 'varchar') ? (int) $r['CHARACTER_MAXIMUM_LENGTH'] : 0;
        return $lim;
    }

    /* ---------------- leitura do arquivo ---------------- */

    private function toUtf8($raw)
    {
        if (substr($raw, 0, 3) === "\xEF\xBB\xBF") return array(substr($raw, 3), 'UTF-8');
        if (preg_match('//u', $raw)) return array($raw, 'UTF-8');
        // Não é UTF-8 válido: é o padrão do Excel no Windows (Windows-1252).
        $conv = function_exists('iconv') ? @iconv('Windows-1252', 'UTF-8//IGNORE', $raw) : false;
        if ($conv === false && function_exists('mb_convert_encoding')) $conv = mb_convert_encoding($raw, 'UTF-8', 'Windows-1252');
        if ($conv === false) $conv = utf8_encode($raw);
        return array($conv, 'Windows-1252');
    }

    private function detectDelimiter($text)
    {
        $first = strtok(str_replace("\r", '', $text), "\n");
        $first = preg_replace('/"[^"]*"/', '', (string) $first);   // ignora o que está entre aspas
        $best = ','; $max = 0;
        foreach (array(';', ',', "\t") as $d) {
            $n = substr_count($first, $d);
            if ($n > $max) { $max = $n; $best = $d; }
        }
        return $best;
    }

    private function parse($text, $delimiter)
    {
        $h = fopen('php://temp', 'r+');
        fwrite($h, $text); rewind($h);
        $rows = array(); $line = 0;
        while (($cells = fgetcsv($h, 0, $delimiter, '"', '')) !== false) {
            $line++;
            if ($cells === array(null)) continue;                  // linha em branco
            $blank = true;
            foreach ($cells as $c) if (trim((string) $c) !== '') { $blank = false; break; }
            if ($blank) continue;
            $rows[] = array('line' => $line, 'cells' => array_map(function ($c) { return (string) $c; }, $cells));
        }
        fclose($h);
        return $rows;
    }

    /* ---------------- auxiliares ---------------- */

    private function campaign($id)
    {
        $st = $this->pdo->prepare('SELECT id, name, estatus FROM campaign WHERE id = ?');
        $st->execute(array((int) $id));
        $c = $st->fetch(PDO::FETCH_ASSOC);
        if (!$c) throw new Exception('Campanha não encontrada.');
        return $c;
    }

    private function load($key)
    {
        if (!preg_match('/^[a-f0-9]{24}$/', (string) $key) || empty($_SESSION['ccx_import'][$key])) {
            throw new Exception('A prévia expirou. Envie o arquivo de novo.');
        }
        $raw = @file_get_contents($this->tmpFile($key));
        $d = $raw ? json_decode($raw, true) : null;
        if (!$d || (int) $d['campaign'] !== (int) $_SESSION['ccx_import'][$key]) throw new Exception('A prévia expirou. Envie o arquivo de novo.');
        return $d;
    }

    private function tmpFile($key) { return sys_get_temp_dir() . '/ccx_import_' . $key . '.json'; }

    private function cleanupOld()
    {
        foreach ((array) glob(sys_get_temp_dir() . '/ccx_import_*.json') as $f) {
            if (is_file($f) && filemtime($f) < time() - 6 * 3600) @unlink($f);
        }
    }

    private function pad(array $cells, $n) { return array_pad(array_slice($cells, 0, $n), $n, ''); }
    private function len($s) { return preg_match_all('/./us', (string) $s); }
    private function cut($s, $n) { preg_match('/^.{0,' . (int) $n . '}/us', (string) $s, $m); return $m ? $m[0] : ''; }
}
