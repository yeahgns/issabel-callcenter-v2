<?php
/*
 * Issabel Call Center Plus - base compartilhada pelos módulos ccx_*.
 * Compatível com PHP 7.4 (Issabel 5 / Rocky 8).
 */
if (defined('CCX_ROOT')) return;
define('CCX_ROOT', dirname(dirname(__FILE__)));
define('CCX_VERSION', '0.1.0');

function ccx_defaults()
{
    return array(
        'company'               => '',
        'demo'                  => false,
        'poll_seconds'          => 5,
        'service_level_seconds' => 20,
        // Mesmo usuário que os módulos do callcenter usam (criado pelo installer.php dele).
        'cc_db'  => array('host' => 'localhost', 'name' => 'call_center', 'user' => 'asterisk', 'pass' => 'asterisk'),
        // Credenciais do banco asterisk: vazio = ler /etc/amportal.conf.
        'pbx_db' => array('host' => 'localhost', 'name' => 'asterisk', 'user' => '', 'pass' => ''),
        'queue_labels' => array(),
    );
}

/* Configuração opcional em /etc/issabel/ccx.conf.php (fora do webroot). */
function ccx_config()
{
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $user = array();
    $file = '/etc/issabel/ccx.conf.php';
    if (is_file($file) && is_readable($file)) {
        $loaded = include $file;
        if (is_array($loaded)) $user = $loaded;
    }
    $cfg = array_replace_recursive(ccx_defaults(), $user);
    if (isset($user['queue_labels'])) $cfg['queue_labels'] = $user['queue_labels'];
    return $cfg;
}

function ccx_read_kv_file($path)
{
    $out = array();
    if (!@is_readable($path)) return $out;
    foreach (file($path) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || $line[0] === ';') continue;
        $pos = strpos($line, '=');
        if ($pos === false) continue;
        $out[trim(substr($line, 0, $pos))] = trim(trim(substr($line, $pos + 1)), "\"'");
    }
    return $out;
}

/* PDO para 'cc' (call_center) ou 'pbx' (asterisk). */
function ccx_pdo($which, $cfg = null)
{
    static $pool = array();
    if ($cfg === null) $cfg = ccx_config();
    $key = $which . '|' . md5(serialize($which === 'pbx' ? $cfg['pbx_db'] : $cfg['cc_db']));
    if (isset($pool[$key])) return $pool[$key];
    $db = $which === 'pbx' ? $cfg['pbx_db'] : $cfg['cc_db'];
    if ($which === 'pbx' && $db['user'] === '') {
        $amp = ccx_read_kv_file('/etc/amportal.conf');
        $db['user'] = isset($amp['AMPDBUSER']) ? $amp['AMPDBUSER'] : 'asteriskuser';
        $db['pass'] = isset($amp['AMPDBPASS']) ? $amp['AMPDBPASS'] : '';
        if (!empty($amp['AMPDBHOST'])) $db['host'] = $amp['AMPDBHOST'];
    }
    $pdo = new PDO(
        'mysql:host=' . $db['host'] . ';dbname=' . $db['name'] . ';charset=utf8mb4',
        $db['user'], $db['pass'],
        array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC)
    );
    $pool[$key] = $pdo;
    return $pdo;
}

function ccx_table_exists(PDO $pdo, $table)
{
    $st = $pdo->prepare('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?');
    $st->execute(array($table));
    return (bool) $st->fetchColumn();
}

function ccx_json($data, $code = 200)
{
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: application/json; charset=UTF-8');
        header('Cache-Control: no-store');
    }
    return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
}
