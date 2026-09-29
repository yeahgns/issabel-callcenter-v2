<?php
/*
 * Monta o "snapshot" do painel com dados reais:
 *  - estado dos agentes, filas e ligações ativas via ECCP (paloSantoConsola);
 *  - progresso das campanhas e tabulações via banco call_center.
 * Precisa rodar dentro do Issabel (usa as libs do módulo agent_console).
 */
if (!defined('CCX_ROOT')) exit;

class CcxLiveProvider
{
    private $cfg;
    private $now;
    private $warnings = array();
    private $raw = array();

    public function __construct($cfg)
    {
        $this->cfg = $cfg;
        $this->now = time();
    }

    public function snapshot($withRaw = false)
    {
        global $arrConf;
        // paloSantoConsola lê o DSN do call_center daqui.
        $db = $this->cfg['cc_db'];
        $arrConf['cadena_dsn'] = sprintf('mysql://%s:%s@%s/%s', $db['user'], $db['pass'], $db['host'], $db['name']);

        $consola = new PaloSantoConsola();
        $names = $this->queueNames();
        $agents = array();
        $queues = array();
        $campaigns = array();

        try {
            $agents = $this->readAgents($consola);
        } catch (Exception $e) {
            $this->warn('Não foi possível ler os agentes: ' . $e->getMessage());
        }
        try {
            $queues = $this->readIncomingQueues($consola, $agents, $names);
        } catch (Exception $e) {
            $this->warn('Não foi possível ler as filas de entrada: ' . $e->getMessage());
        }
        try {
            $campaigns = $this->readCampaigns($consola, $agents, $queues, $names);
        } catch (Exception $e) {
            $this->warn('Não foi possível ler as campanhas: ' . $e->getMessage());
        }
        $consola->desconectarTodo();

        $this->attachSessions($agents);
        $this->trackSince($agents);
        foreach ($queues as $num => $q) {
            $queues[$num]['agents'] = $this->countStates($agents, $num);
        }

        $out = array(
            'source'        => 'live',
            'now'           => $this->now,
            'company'       => $this->cfg['company'],
            'service_level' => (int) $this->cfg['service_level_seconds'],
            'agents'        => array_values($agents),
            'queues'        => array_values($queues),
            'campaigns'     => $campaigns,
            'warnings'      => $this->warnings,
        );
        if ($withRaw) $out['raw'] = $this->raw;
        return $out;
    }

    /* ---------------- agentes ---------------- */

    private function readAgents($consola)
    {
        $byQueue = $consola->listarEstadoMonitoreoAgentes();
        if (!is_array($byQueue)) throw new Exception($consola->errMsg);
        $this->raw['agents_by_queue'] = $byQueue;

        $map = array('online' => 'free', 'oncall' => 'oncall', 'paused' => 'paused', 'offline' => 'offline');
        $agents = array();
        foreach ($byQueue as $queue => $list) {
            foreach ($list as $chan => $a) {
                if (!isset($agents[$chan])) {
                    $status = isset($map[$a['agentstatus']]) ? $map[$a['agentstatus']] : 'offline';
                    $number = preg_replace('/^[A-Za-z0-9]+\//', '', $chan);
                    $hint = null;
                    if ($status === 'paused') $hint = $this->ts($a['lastpausestart']);
                    elseif ($status === 'offline') $hint = $this->ts($a['lastsessionend']);
                    elseif ($status === 'free') $hint = $this->latest(array($a['lastsessionstart'], $a['lastpauseend']));
                    $agents[$chan] = array(
                        'id'         => $chan,
                        'name'       => $a['agentname'] !== '' ? $a['agentname'] : $number,
                        'number'     => $number,
                        'status'     => $status,
                        'since'      => $hint,
                        'since_exact'=> $status === 'paused',
                        'pause'      => $status === 'paused' ? $a['pausename'] : null,
                        'onhold'     => !empty($a['onhold']),
                        'call'       => null,
                        'queues'     => array(),
                        'login_sec'  => (int) $a['logintime'],
                        'today'      => array('calls' => 0, 'talk_sec' => 0),
                    );
                }
                $agents[$chan]['queues'][] = (string) $queue;
                $agents[$chan]['today']['calls'] += (int) $a['num_calls'];
                $agents[$chan]['today']['talk_sec'] += (int) $a['sec_calls'];
                if (!empty($a['linkstart']) && $agents[$chan]['status'] === 'oncall') {
                    $agents[$chan]['since'] = $this->ts($a['linkstart']);
                    $agents[$chan]['since_exact'] = true;
                }
            }
        }
        return $agents;
    }

    /* Preenche a ligação atual de cada agente a partir do estado de uma fila/campanha. */
    private function attachCalls(array &$agents, array $status, $queue, $campaignId, $campaignName, $type)
    {
        if (empty($status['agents'])) return;
        foreach ($status['agents'] as $chan => $st) {
            if (!isset($agents[$chan]) || empty($st['callinfo'])) continue;
            $ci = $st['callinfo'];
            if (isset($ci['queuenumber']) && $ci['queuenumber'] !== null && (string) $ci['queuenumber'] !== (string) $queue) continue;
            $since = $this->ts($ci['linkstart']);
            $agents[$chan]['call'] = array(
                'phone'         => $ci['callnumber'],
                'queue'         => (string) $queue,
                'type'          => $type,
                'campaign_id'   => $campaignId,
                'campaign_name' => $campaignName,
                'since'         => $since,
            );
            if ($agents[$chan]['status'] === 'oncall' && $since) {
                $agents[$chan]['since'] = $since;
                $agents[$chan]['since_exact'] = true;
            }
        }
    }

    /* ---------------- filas de entrada ---------------- */

    private function readIncomingQueues($consola, array &$agents, array $names)
    {
        $list = $consola->leerListaColasEntrantes();
        if (!is_array($list)) throw new Exception($consola->errMsg);
        $this->raw['incoming_queues'] = $list;

        $queues = array();
        foreach ($list as $id => $q) {
            if ($q['status'] !== 'A') continue;
            $num = (string) $q['queue'];
            $queues[$num] = $this->emptyQueue($num, $names, 'incoming');
            $st = $consola->leerEstadoCampania('incomingqueue', $id, date('Y-m-d', $this->now));
            if (!is_array($st)) {
                $this->warn("Fila $num: " . $consola->errMsg);
                continue;
            }
            $this->raw['incoming_status'][$num] = $st;
            $queues[$num]['waiting'] = $this->waitingCalls($st);
            $sc = isset($st['statuscount']) ? $st['statuscount'] : array();
            $queues[$num]['today'] = array(
                'answered'  => isset($sc['success']) ? (int) $sc['success'] : 0,
                'abandoned' => isset($sc['abandoned']) ? (int) $sc['abandoned'] : 0,
            );
            $this->attachCalls($agents, $st, $num, null, null, 'incoming');
        }
        return $queues;
    }

    /* ---------------- campanhas de saída ---------------- */

    private function readCampaigns($consola, array &$agents, array &$queues, array $names)
    {
        $pdo = ccx_pdo('cc', $this->cfg);
        $hasCcx = ccx_table_exists($pdo, 'ccx_campaign');
        $modeSql = $hasCcx ? 'COALESCE(x.mode, \'auto\')' : '\'auto\'';
        $joinSql = $hasCcx ? 'LEFT JOIN ccx_campaign x ON x.id_campaign = c.id' : '';
        $whereSql = $hasCcx ? "c.estatus = 'A' OR (x.mode = 'preview' AND c.estatus <> 'T')" : "c.estatus = 'A'";

        $sql = "
            SELECT c.id, c.name, c.queue, c.estatus, c.retries AS max_retries,
                   c.datetime_init, c.datetime_end, c.daytime_init, c.daytime_end,
                   $modeSql AS mode,
                   COUNT(k.id) AS total,
                   COALESCE(SUM(k.status = 'Success'), 0) AS contacted,
                   COALESCE(SUM(k.status IN ('Placing','Dialing','Ringing','OnQueue','OnHold')), 0) AS active,
                   COALESCE(SUM(k.dnc = 1), 0) AS dnc,
                   COALESCE(SUM(k.dnc = 0 AND (k.status IS NULL OR k.status NOT IN
                       ('Success','Placing','Dialing','Ringing','OnQueue','OnHold')) AND k.retries < c.retries), 0) AS pending,
                   COALESCE(SUM(k.dnc = 0 AND k.status IS NOT NULL AND k.status NOT IN
                       ('Success','Placing','Dialing','Ringing','OnQueue','OnHold') AND k.retries >= c.retries), 0) AS exhausted
            FROM campaign c
            $joinSql
            LEFT JOIN calls k ON k.id_campaign = c.id
            WHERE $whereSql
            GROUP BY c.id
            ORDER BY c.name";
        $rows = $pdo->query($sql)->fetchAll();

        $dispositions = array();
        if ($hasCcx && $rows) {
            $ids = implode(',', array_map('intval', array_column($rows, 'id')));
            // Só a tabulação mais recente de cada ligação conta.
            $dsql = "
                SELECT o.id_campaign, o.label, o.outcome, o.sort_order, COUNT(d.id) AS n
                FROM ccx_disposition_option o
                LEFT JOIN ccx_disposition d ON d.id_option = o.id AND d.id = (
                    SELECT d2.id FROM ccx_disposition d2 WHERE d2.id_call = d.id_call
                    ORDER BY d2.created_at DESC, d2.id DESC LIMIT 1)
                WHERE o.id_campaign IN ($ids) AND o.active = 1
                GROUP BY o.id
                ORDER BY o.id_campaign, o.sort_order, o.id";
            foreach ($pdo->query($dsql) as $d) {
                $dispositions[$d['id_campaign']][] = array(
                    'label' => $d['label'], 'outcome' => $d['outcome'], 'count' => (int) $d['n'],
                );
            }
        }

        $out = array();
        foreach ($rows as $r) {
            $id = (int) $r['id'];
            $num = (string) $r['queue'];
            $activeNow = 0;
            if ($r['estatus'] === 'A') {
                $st = $consola->leerEstadoCampania('outgoing', $id, date('Y-m-d', $this->now));
                if (is_array($st)) {
                    $this->raw['campaign_status'][$id] = $st;
                    $activeNow = isset($st['activecalls']) ? count($st['activecalls']) : 0;
                    if (!isset($queues[$num])) $queues[$num] = $this->emptyQueue($num, $names, 'campaign');
                    // Cliente atendeu e está esperando agente: é o momento com mais risco de abandono.
                    foreach ($this->waitingCalls($st) as $w) {
                        $w['campaign'] = $r['name'];
                        $queues[$num]['waiting'][] = $w;
                    }
                    $this->attachCalls($agents, $st, $num, $id, $r['name'], 'outgoing');
                } else {
                    $this->warn('Campanha ' . $r['name'] . ': ' . $consola->errMsg);
                }
            }
            $out[] = array(
                'id'     => $id,
                'name'   => $r['name'],
                'mode'   => $r['mode'],
                'status' => $r['estatus'],
                'queue'  => $num,
                'queue_name' => isset($names[$num]) ? $names[$num] : null,
                'window' => array(
                    'from_date' => $r['datetime_init'], 'to_date' => $r['datetime_end'],
                    'from_time' => substr($r['daytime_init'], 0, 5), 'to_time' => substr($r['daytime_end'], 0, 5),
                ),
                'totals' => array(
                    'total'     => (int) $r['total'],
                    'contacted' => (int) $r['contacted'],
                    'active'    => (int) $r['active'],
                    'pending'   => (int) $r['pending'],
                    'exhausted' => (int) $r['exhausted'],
                    'dnc'       => (int) $r['dnc'],
                ),
                'active_now'   => $activeNow,
                'dispositions' => isset($dispositions[$id]) ? $dispositions[$id] : array(),
            );
        }
        return $out;
    }

    /* Sessão atual e total logado hoje, pela tabela audit (mesma conta do console). */
    private function attachSessions(array &$agents)
    {
        if (!$agents) return;
        try {
            require_once dirname(__FILE__) . '/sessions.php';
            $map = ccx_agent_sessions(ccx_pdo('cc', $this->cfg), $this->now);
        } catch (Exception $e) {
            $this->warn('Tempos de sessão indisponíveis: ' . $e->getMessage());
            return;
        }
        foreach ($agents as $chan => &$a) {
            $m = isset($map[$chan]) ? $map[$chan] : null;
            $a['session_start'] = ($m && $a['status'] !== 'offline') ? $m['session_start'] : null;
            $a['day_login_sec'] = $m ? $m['day_sec'] : 0;
        }
        unset($a);
    }

    /* ---------------- auxiliares ---------------- */

    private function waitingCalls(array $status)
    {
        $out = array();
        if (empty($status['activecalls'])) return $out;
        foreach ($status['activecalls'] as $c) {
            if (strtolower($c['callstatus']) !== 'onqueue') continue;
            $out[] = array('phone' => $c['callnumber'], 'since' => $this->ts($c['queuestart']));
        }
        return $out;
    }

    private function emptyQueue($num, array $names, $kind)
    {
        return array(
            'number'  => $num,
            'name'    => isset($names[$num]) ? $names[$num] : null,
            'kind'    => $kind,
            'waiting' => array(),
            'agents'  => array('free' => 0, 'oncall' => 0, 'paused' => 0, 'offline' => 0),
            'today'   => null,
        );
    }

    private function countStates(array $agents, $queue)
    {
        $c = array('free' => 0, 'oncall' => 0, 'paused' => 0, 'offline' => 0);
        foreach ($agents as $a) {
            if (in_array((string) $queue, $a['queues'], true)) $c[$a['status']]++;
        }
        return $c;
    }

    private function queueNames()
    {
        $names = array();
        try {
            foreach (ccx_pdo('pbx', $this->cfg)->query('SELECT extension, descr FROM queues_config') as $r) {
                if ($r['descr'] !== '') $names[(string) $r['extension']] = $r['descr'];
            }
        } catch (Exception $e) {
            $this->warn('Nomes das filas indisponíveis (banco asterisk): ' . $e->getMessage());
        }
        foreach ($this->cfg['queue_labels'] as $k => $v) $names[(string) $k] = $v;
        return $names;
    }

    /*
     * O ECCP não informa desde quando uma agente está livre. Guardamos a
     * última mudança de estado observada num arquivo pequeno; depois do
     * primeiro ciclo o "desde" fica exato.
     */
    private function trackSince(array &$agents)
    {
        $file = sys_get_temp_dir() . '/ccx_agent_state.json';
        $fh = @fopen($file, 'c+');
        if (!$fh) return;
        flock($fh, LOCK_EX);
        $prev = json_decode(stream_get_contents($fh), true);
        if (!is_array($prev)) $prev = array();
        $next = array();
        foreach ($agents as $chan => &$a) {
            $key = $a['status'] . '|' . ($a['pause'] !== null ? $a['pause'] : '');
            if (isset($prev[$chan]) && $prev[$chan]['k'] === $key) {
                if (!$a['since_exact']) {
                    $a['since'] = $prev[$chan]['t'];
                    $a['since_exact'] = !empty($prev[$chan]['x']);
                }
            } elseif (isset($prev[$chan]) && !$a['since_exact']) {
                // Mudou de estado desde o último ciclo: sabemos o momento com precisão de um ciclo.
                $a['since'] = $this->now;
                $a['since_exact'] = true;
            }
            $next[$chan] = array('k' => $key, 't' => $a['since'], 'x' => $a['since_exact']);
        }
        unset($a);
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($next));
        flock($fh, LOCK_UN);
        fclose($fh);
    }

    private function ts($s)
    {
        if ($s === null || $s === '') return null;
        if (preg_match('/^\d{1,2}:\d{2}:\d{2}$/', $s)) $s = date('Y-m-d ', $this->now) . $s;
        $t = strtotime($s);
        return $t ? $t : null;
    }

    private function latest(array $list)
    {
        $best = null;
        foreach ($list as $s) {
            $t = $this->ts($s);
            if ($t && ($best === null || $t > $best)) $best = $t;
        }
        return $best;
    }

    private function warn($msg)
    {
        $this->warnings[] = $msg;
    }
}
