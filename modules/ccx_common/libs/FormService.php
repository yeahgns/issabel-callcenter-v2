<?php
/*
 * Issabel Call Center Plus - formulários que a agente preenche durante a ligação.
 * Camada fina sobre a classe do próprio form_designer (paloSantoDataForm): ela preserva os
 * ids dos campos ao editar (as respostas já gravadas continuam ligadas a eles), recusa
 * remover campos de formulário que já tem respostas e recusa excluir formulário em uso.
 */
if (!defined('CCX_ROOT')) exit;

class CcxFormService
{
    const TYPES = array('TEXT', 'LIST', 'DATE', 'TEXTAREA', 'LABEL');
    private $pDB;
    private $oForm;

    public function __construct($cfg, $pDB = null)
    {
        if (!class_exists('paloSantoDataForm')) require_once 'modules/form_designer/libs/paloSantoDataForm.class.php';
        if (!$pDB) {
            $db = $cfg['cc_db'];
            $pDB = new paloDB(sprintf('mysql://%s:%s@%s/%s', $db['user'], $db['pass'], $db['host'], $db['name']));
            if (!empty($pDB->errMsg)) throw new Exception('Banco call_center indisponível: ' . $pDB->errMsg);
        }
        $this->pDB = $pDB;
        $this->oForm = new paloSantoDataForm($pDB);
    }

    public function listAll()
    {
        $rows = $this->oForm->listarFormularios('all');
        if (!is_array($rows)) throw new Exception($this->msg($this->oForm->errMsg));
        $fields = $this->countBy('SELECT id_form AS k, COUNT(*) AS n FROM form_field GROUP BY id_form');
        $answers = $this->countBy('SELECT ff.id_form AS k, COUNT(DISTINCT fd.id_calls) AS n FROM form_field ff INNER JOIN form_data_recolected fd ON fd.id_form_field = ff.id GROUP BY ff.id_form');
        $camps = array();
        foreach ((array) $this->pDB->fetchTable('SELECT cf.id_form, c.name, c.estatus FROM campaign_form cf INNER JOIN campaign c ON c.id = cf.id_campaign ORDER BY c.name', true) as $r) {
            $camps[(int) $r['id_form']][] = array('name' => $r['name'], 'status' => $r['estatus']);
        }
        $out = array();
        foreach ($rows as $r) {
            $id = (int) $r['id'];
            $out[] = array('id' => $id, 'name' => $r['nombre'], 'description' => $r['descripcion'], 'status' => $r['estatus'],
                'fields' => isset($fields[$id]) ? $fields[$id] : 0, 'answers' => isset($answers[$id]) ? $answers[$id] : 0,
                'campaigns' => isset($camps[$id]) ? $camps[$id] : array());
        }
        usort($out, function ($a, $b) { return strcmp($a['status'], $b['status']) ?: strcasecmp($a['name'], $b['name']); });
        return $out;
    }

    public function get($id)
    {
        $f = $this->oForm->leerFormulario((int) $id);
        if (!is_array($f) || !$f) throw new Exception('Formulário não encontrado.');
        $fields = $this->oForm->leerCamposFormulario((int) $id);
        if (!is_array($fields)) throw new Exception($this->msg($this->oForm->errMsg));
        $answers = $this->countBy('SELECT fd.id_form_field AS k, COUNT(*) AS n FROM form_data_recolected fd INNER JOIN form_field ff ON ff.id = fd.id_form_field WHERE ff.id_form = ' . (int) $id . ' GROUP BY fd.id_form_field');
        $total = 0;
        foreach ($answers as $n) $total += $n;
        $out = array('id' => (int) $f['id'], 'name' => $f['nombre'], 'description' => $f['descripcion'], 'status' => $f['estatus'],
            'has_answers' => $total > 0, 'fields' => array());
        foreach ($fields as $c) {
            $out['fields'][] = array('id' => (int) $c['id'], 'label' => $c['etiqueta'], 'type' => $c['tipo'],
                'options' => isset($c['value']) && is_array($c['value']) ? $c['value'] : array(),
                'answers' => isset($answers[(int) $c['id']]) ? $answers[(int) $c['id']] : 0);
        }
        return $out;
    }

    /** $in: id?, name, description, fields[] = {id?, label, type, options[]} */
    public function save(array $in)
    {
        $id = !empty($in['id']) ? (int) $in['id'] : null;
        $name = trim(isset($in['name']) ? (string) $in['name'] : '');
        $desc = trim(isset($in['description']) ? (string) $in['description'] : '');
        if ($name === '') throw new Exception('Dê um nome para o formulário.');
        if ($this->len($name) > 40) throw new Exception('O nome pode ter no máximo 40 caracteres.');
        if ($this->len($desc) > 150) throw new Exception('A descrição pode ter no máximo 150 caracteres.');
        $fields = isset($in['fields']) && is_array($in['fields']) ? $in['fields'] : array();
        if (!$fields) throw new Exception('Adicione pelo menos um campo.');

        $ff = array();
        foreach (array_values($fields) as $i => $f) {
            $n = $i + 1;
            $label = trim(isset($f['label']) ? (string) $f['label'] : '');
            $type = isset($f['type']) ? strtoupper((string) $f['type']) : 'TEXT';
            if ($label === '') throw new Exception("O campo $n está sem nome.");
            if (!in_array($type, self::TYPES, true)) throw new Exception("Tipo inválido no campo $n.");
            $row = array('etiqueta' => $label, 'tipo' => $type);
            if (!empty($f['id']) && ctype_digit((string) $f['id'])) $row['id'] = (int) $f['id'];
            if ($type === 'LIST') {
                $opts = array();
                foreach ((array) (isset($f['options']) ? $f['options'] : array()) as $o) {
                    $o = trim((string) $o);
                    if ($o === '') continue;
                    // As opções são guardadas separadas por vírgula pelo callcenter original.
                    if (strpos($o, ',') !== false) throw new Exception("No campo \"$label\", a opção \"$o\" tem vírgula. Use outro sinal, como ponto e vírgula ou barra.");
                    if (!in_array($o, $opts, true)) $opts[] = $o;
                }
                if (!$opts) throw new Exception("O campo \"$label\" é uma lista e precisa de pelo menos uma opção.");
                $row['value'] = $opts;
            }
            $ff[] = $row;
        }
        if (!$this->oForm->guardarFormulario($id, $name, $desc, $ff)) throw new Exception($this->msg($this->oForm->errMsg));
        return true;
    }

    public function setActive($id, $on)
    {
        if (!$on) {
            $n = $this->pDB->getFirstRowQuery("SELECT COUNT(*) AS n FROM campaign_form cf INNER JOIN campaign c ON c.id = cf.id_campaign WHERE cf.id_form = ? AND c.estatus = 'A'", true, array((int) $id));
            if (is_array($n) && (int) $n['n'] > 0) throw new Exception('Este formulário está em uma campanha ativa. Desative a campanha ou troque o formulário dela antes.');
        }
        if (!$this->oForm->activacionFormulario((int) $id, (bool) $on)) throw new Exception($this->msg($this->oForm->errMsg));
        return true;
    }

    public function delete($id)
    {
        if (!$this->oForm->eliminarFormulario((int) $id)) throw new Exception($this->msg($this->oForm->errMsg));
        return true;
    }

    private function countBy($sql)
    {
        $out = array();
        foreach ((array) $this->pDB->fetchTable($sql, true) as $r) $out[(int) $r['k']] = (int) $r['n'];
        return $out;
    }

    private function len($s) { return preg_match_all('/./us', (string) $s); }

    private function msg($m)
    {
        $map = array(
            'This form is been used by any campaign' => 'Este formulário já tem respostas ou está vinculado a uma campanha. Dá para renomear e acrescentar campos, mas não remover campos nem excluí-lo.',
            'Error Form Name is empty' => 'Dê um nome para o formulário.',
            'Error List is empty' => 'Adicione pelo menos um campo, e opções nos campos de lista.',
            'Error Field Name is empty' => 'Há um campo sem nome.',
            'Invalid field type' => 'Tipo de campo inválido.',
            'Invalid field ID' => 'O formulário mudou enquanto você editava. Recarregue a página.',
        );
        foreach ($map as $en => $pt) if (stripos((string) $m, $en) !== false) return $pt;
        return $m !== '' ? $m : 'Não foi possível concluir a operação.';
    }
}
