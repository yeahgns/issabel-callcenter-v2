<?php
/*
 * Sessões das agentes a partir da tabela audit do call center.
 * Cada linha com id_break NULL é uma sessão (login -> logout); datetime_end NULL = aberta.
 * É a mesma fonte que o "Total" do console original usa, então os números batem.
 */
if (!defined('CCX_ROOT')) exit;

/**
 * Retorna, por canal (ex.: "PJSIP/210"):
 *   session_start: epoch do início da sessão aberta agora, ou null;
 *   day_sec:       segundos logados hoje (00:00 a 23:59), somando todas as sessões.
 */
function ccx_agent_sessions(PDO $pdo, $now = null)
{
    $now = $now ? (int) $now : time();
    $start = date('Y-m-d 00:00:00', $now);
    $end = date('Y-m-d 23:59:59', $now);
    $sNow = date('Y-m-d H:i:s', $now);

    $sql = "SELECT CONCAT(ag.type, '/', ag.number) AS chan,
                   MAX(CASE WHEN au.datetime_end IS NULL THEN au.datetime_init END) AS open_start,
                   SUM(UNIX_TIMESTAMP(LEAST(COALESCE(au.datetime_end, :now), :end1))
                       - UNIX_TIMESTAMP(GREATEST(au.datetime_init, :start1))) AS day_sec
            FROM audit au
            INNER JOIN agent ag ON ag.id = au.id_agent
            WHERE au.id_break IS NULL
              AND au.datetime_init <= :end2
              AND (au.datetime_end IS NULL OR au.datetime_end >= :start2)
            GROUP BY ag.id";
    $st = $pdo->prepare($sql);
    $st->execute(array(':now' => $sNow, ':end1' => $end, ':start1' => $start, ':end2' => $end, ':start2' => $start));

    $out = array();
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[$r['chan']] = array(
            'session_start' => $r['open_start'] ? strtotime($r['open_start']) : null,
            'day_sec'       => max(0, (int) $r['day_sec']),
        );
    }
    return $out;
}
