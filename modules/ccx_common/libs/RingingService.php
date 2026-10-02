<?php
/*
 * Issabel Call Center Plus - ligação tocando no ramal, antes de a agente atender.
 *
 * O discador recebe o AgentCalled do Asterisk mas não repassa nada ao console (no código
 * dele: "TODO: what can be done here?"), então o console só recebe a ficha quando a
 * ligação conecta. Aqui consultamos o Asterisk (AMI CoreShowChannels) para achar o canal
 * do ramal que está tocando e casamos com a ligação da campanha que está na fila (OnQueue).
 *
 * Casamento, do mais seguro ao menos seguro:
 *   1. Linkedid: o canal que toca e o canal do cliente pertencem à mesma cadeia da ligação;
 *   2. número do cliente (ConnectedLineNum do canal que toca);
 *   3. se houver uma única ligação esperando na fila, ela.
 */
if (!defined('CCX_ROOT')) exit;

class CcxRinging
{
    private $cfg;
    private $pdo;
    public $lastDebug = null;

    public function __construct($cfg, PDO $pdo)
    {
        $this->cfg = $cfg;
        $this->pdo = $pdo;
    }

    /** $device: "PJSIP/210". Retorna null se não está tocando. */
    public function forDevice($device, $debug = false)
    {
        $channels = $this->channels();
        $this->lastDebug = $debug ? array('device' => $device, 'channels' => $channels) : null;
        $member = null;
        foreach ($channels as $c) {
            if (strpos($c['Channel'], $device . '-') !== 0) continue;
            $st = isset($c['ChannelStateDesc']) ? $c['ChannelStateDesc'] : '';
            if ($st === 'Ringing' || $st === 'Ring') { $member = $c; break; }
        }
        if (!$member) return null;

        $linked = isset($member['Linkedid']) ? $member['Linkedid'] : '';
        $remote = $this->digits(isset($member['ConnectedLineNum']) ? $member['ConnectedLineNum'] : '');
        $linkOf = array();
        foreach ($channels as $c) if (!empty($c['Uniqueid'])) $linkOf[$c['Uniqueid']] = isset($c['Linkedid']) ? $c['Linkedid'] : $c['Uniqueid'];

        $cands = $this->pdo->query("SELECT c.id, c.id_campaign, c.phone, c.uniqueid, k.name AS campaign, k.script
            FROM calls c INNER JOIN campaign k ON k.id = c.id_campaign
            WHERE c.status = 'OnQueue' AND k.estatus = 'A'
            ORDER BY c.datetime_entry_queue DESC LIMIT 100")->fetchAll(PDO::FETCH_ASSOC);

        $found = null; $how = null;
        if ($linked !== '') foreach ($cands as $k) {
            $u = (string) $k['uniqueid'];
            if ($u !== '' && (isset($linkOf[$u]) ? $linkOf[$u] : $u) === $linked) { $found = $k; $how = 'linkedid'; break; }
        }
        if (!$found && strlen($remote) >= 8) foreach ($cands as $k) {
            $p = $this->digits($k['phone']);
            if ($p !== '' && ($p === $remote || substr($p, -10) === substr($remote, -10))) { $found = $k; $how = 'phone'; break; }
        }
        if (!$found && count($cands) === 1) { $found = $cands[0]; $how = 'single'; }

        $out = array(
            'ringing' => true,
            'since' => time() - (isset($member['Duration']) ? $this->seconds($member['Duration']) : 0),
            'phone' => $found ? $found['phone'] : ($remote !== '' ? $remote : $this->digits(isset($member['CallerIDNum']) ? $member['CallerIDNum'] : '')),
            'name' => null, 'campaign' => null, 'call_id' => null, 'script' => '', 'attributes' => array(), 'match' => $how,
        );
        if ($found) {
            $out['campaign'] = $found['campaign'];
            $out['call_id'] = (int) $found['id'];
            $out['script'] = (string) $found['script'];
            $st = $this->pdo->prepare('SELECT columna, value FROM call_attribute WHERE id_call = ? ORDER BY column_number');
            $st->execute(array((int) $found['id']));
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $a) {
                $label = (string) $a['columna'];
                if ($out['name'] === null && preg_match('/^(nome|name|nombre|cliente|contato)$/iu', trim($label))) { $out['name'] = (string) $a['value']; continue; }
                $out['attributes'][] = array('label' => $label, 'value' => (string) $a['value']);
            }
        }
        return $out;
    }

    /* ---------------- Asterisk (AMI) ---------------- */

    /** Canais ativos, com cache de 1s compartilhado entre as agentes. */
    private function channels()
    {
        $file = sys_get_temp_dir() . '/ccx_channels.json';
        $fh = @fopen($file, 'c+');
        if (!$fh) return $this->amiChannels();
        flock($fh, LOCK_EX);
        $cache = json_decode(stream_get_contents($fh), true);
        if (is_array($cache) && isset($cache['t']) && microtime(true) - $cache['t'] < 1.0) {
            flock($fh, LOCK_UN); fclose($fh);
            return $cache['c'];
        }
        $list = $this->amiChannels();
        ftruncate($fh, 0); rewind($fh);
        fwrite($fh, json_encode(array('t' => microtime(true), 'c' => $list)));
        flock($fh, LOCK_UN); fclose($fh);
        return $list;
    }

    private function amiChannels()
    {
        $c = $this->amiCredentials();
        $s = @fsockopen($c['host'], $c['port'], $errno, $errstr, 2);
        if (!$s) throw new Exception('Asterisk (AMI) indisponível: ' . $errstr);
        stream_set_timeout($s, 3);
        fgets($s);                                                     // banner
        fwrite($s, "Action: Login\r\nUsername: {$c['user']}\r\nSecret: {$c['pass']}\r\nEvents: off\r\n\r\n");
        $login = $this->readBlock($s);
        if (stripos(isset($login['Response']) ? $login['Response'] : '', 'Success') === false) {
            fclose($s);
            throw new Exception('Login na AMI recusado.');
        }
        fwrite($s, "Action: CoreShowChannels\r\nActionID: ccx\r\n\r\n");
        $list = array();
        for ($i = 0; $i < 5000; $i++) {
            $b = $this->readBlock($s);
            if (!$b) break;
            if (isset($b['Event']) && $b['Event'] === 'CoreShowChannel') $list[] = $b;
            if (isset($b['Event']) && $b['Event'] === 'CoreShowChannelsComplete') break;
            if (isset($b['Response']) && stripos($b['Response'], 'Error') !== false) break;
        }
        fwrite($s, "Action: Logoff\r\n\r\n");
        fclose($s);
        return $list;
    }

    /** Executa um comando do CLI do Asterisk pela AMI e devolve a saída em texto. */
    public function command($cmd)
    {
        $c = $this->amiCredentials();
        $s = @fsockopen($c['host'], $c['port'], $errno, $errstr, 2);
        if (!$s) throw new Exception('Asterisk (AMI) indisponível: ' . $errstr);
        stream_set_timeout($s, 3);
        fgets($s);
        fwrite($s, "Action: Login\r\nUsername: {$c['user']}\r\nSecret: {$c['pass']}\r\nEvents: off\r\n\r\n");
        $login = $this->readBlock($s);
        if (stripos(isset($login['Response']) ? $login['Response'] : '', 'Success') === false) { fclose($s); throw new Exception('Login na AMI recusado.'); }
        fwrite($s, "Action: Command\r\nCommand: " . str_replace(array("\r", "\n"), ' ', $cmd) . "\r\n\r\n");
        $out = array();
        while (($line = fgets($s)) !== false) {
            $line = rtrim($line, "\r\n");
            if ($line === '' && $out) break;
            if (strpos($line, 'Output: ') === 0) $out[] = substr($line, 8);
            elseif (strpos($line, 'Response:') !== 0 && strpos($line, 'Message:') !== 0 && strpos($line, 'ActionID:') !== 0 && $line !== '' && strpos($line, '--END COMMAND--') === false) $out[] = $line;
        }
        fwrite($s, "Action: Logoff\r\n\r\n");
        fclose($s);
        return implode("\n", $out);
    }

    private function readBlock($s)
    {
        $b = array();
        while (($line = fgets($s)) !== false) {
            $line = rtrim($line, "\r\n");
            if ($line === '') { if ($b) break; continue; }
            $p = strpos($line, ':');
            if ($p !== false) $b[trim(substr($line, 0, $p))] = trim(substr($line, $p + 1));
        }
        return $b;
    }

    private function amiCredentials()
    {
        $c = isset($this->cfg['ami']) && is_array($this->cfg['ami']) ? $this->cfg['ami'] : array();
        $amp = ccx_read_kv_file('/etc/amportal.conf');
        return array(
            'host' => !empty($c['host']) ? $c['host'] : '127.0.0.1',
            'port' => !empty($c['port']) ? (int) $c['port'] : 5038,
            'user' => !empty($c['user']) ? $c['user'] : (isset($amp['AMPMGRUSER']) ? $amp['AMPMGRUSER'] : 'admin'),
            'pass' => !empty($c['pass']) ? $c['pass'] : (isset($amp['AMPMGRPASS']) ? $amp['AMPMGRPASS'] : ''),
        );
    }

    private function digits($s) { return preg_replace('/\D/', '', (string) $s); }

    private function seconds($d)
    {
        if (ctype_digit((string) $d)) return (int) $d;
        $p = array_map('intval', explode(':', (string) $d));     // "00:00:07"
        return count($p) === 3 ? $p[0] * 3600 + $p[1] * 60 + $p[2] : 0;
    }
}
