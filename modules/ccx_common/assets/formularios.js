/* Issabel Call Center Plus - Formulários. Sem dependências. Reaproveita o visual de Campanhas. */
(function () {
  'use strict';

  var root = document.getElementById('ccx-formularios');
  if (!root || root.getAttribute('data-ready')) return;
  root.setAttribute('data-ready', '1');
  document.body.classList.add('ccxc-page');

  var API = root.getAttribute('data-api').replace(/&amp;/g, '&');
  var TOKEN = root.getAttribute('data-token');
  var S = { list: null, filter: 'all', q: '', edit: null, busy: false };

  var TYPES = [
    ['TEXT', 'Texto curto', 'Uma linha.'],
    ['TEXTAREA', 'Texto longo', 'Várias linhas, até 250 caracteres.'],
    ['LIST', 'Lista de opções', 'A agente escolhe uma das opções.'],
    ['DATE', 'Data', 'Um calendário para escolher o dia.'],
    ['LABEL', 'Título ou aviso', 'Só um texto na tela. Não é preenchido.']
  ];
  var TYPE_LABEL = {}; TYPES.forEach(function (t) { TYPE_LABEL[t[0]] = t[1]; });

  function $(s, c) { return (c || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nf(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function plural(n, a, b) { return nf(n) + ' ' + (n === 1 ? a : b); }

  function api(action, params, post) {
    var url = API + '&action=' + encodeURIComponent(action);
    var opt = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (post) {
      var body = new URLSearchParams();
      Object.keys(params || {}).forEach(function (k) { if (params[k] != null) body.append(k, params[k]); });
      opt.method = 'POST';
      opt.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opt.headers['X-CCX-Token'] = TOKEN;
      opt.body = body.toString();
    } else if (params) {
      Object.keys(params).forEach(function (k) { url += '&' + k + '=' + encodeURIComponent(params[k]); });
    }
    return fetch(url, opt).then(function (r) {
      var ct = r.headers.get('Content-Type') || '';
      if (ct.indexOf('json') === -1) throw new Error('Sua sessão do Issabel expirou. Recarregue a página.');
      return r.json().then(function (j) { if (!r.ok || j.error) throw new Error(j.error || 'Erro ' + r.status); return j; });
    });
  }

  /* ---------- estrutura (mesmos componentes da tela de Campanhas) ---------- */
  root.innerHTML =
    '<header class="topbar"><div class="brand"><h1>Formulários</h1><p>O que a agente preenche durante a ligação</p></div>' +
      '<button type="button" class="btn" id="cf-new">Novo formulário</button></header>' +
    '<main><div id="cf-notice"></div>' +
      '<div class="toolbar"><div class="seg" id="cf-filter" role="group" aria-label="Filtrar por status"></div>' +
        '<div class="search"><label class="sr-only" for="cf-q">Buscar formulário</label><input type="search" id="cf-q" placeholder="Buscar formulário" autocomplete="off"></div></div>' +
      '<div class="cc-panel" id="cf-list"><div class="empty">Carregando formulários…</div></div></main>' +
    '<div class="drawer-back" id="cf-back" hidden></div>' +
    '<aside class="drawer cf-drawer" id="cf-drawer" hidden role="dialog" aria-modal="true" aria-labelledby="cf-dtitle"></aside>' +
    '<div class="cc-mback" id="cf-mback" hidden><div class="cc-modal" role="alertdialog" aria-modal="true" aria-labelledby="cf-mtitle" id="cf-modal"></div></div>' +
    '<div class="cc-toast" id="cf-toast" role="status" aria-live="polite"></div>';

  $('#cf-new').addEventListener('click', function () { openForm(null); });
  $('#cf-q').addEventListener('input', function () { S.q = this.value.trim().toLowerCase(); renderList(); });
  $('#cf-filter').addEventListener('click', function (e) { var b = e.target.closest('button[data-f]'); if (b) { S.filter = b.getAttribute('data-f'); renderList(); } });
  $('#cf-back').addEventListener('click', closeForm);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('#cf-mback').hidden) closeModal(); else if (!$('#cf-drawer').hidden) closeForm();
    closeMenus();
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.more')) closeMenus(); });
  window.addEventListener('scroll', closeMenus, true);
  window.addEventListener('resize', closeMenus);

  function toast(m) { var t = $('#cf-toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 3200); }
  function notice(m) { $('#cf-notice').innerHTML = m ? '<div class="notice error" role="alert"><p>' + esc(m) + '</p></div>' : ''; }

  /* ---------- lista ---------- */
  function load() {
    return api('list').then(function (j) { S.list = j.forms; notice(''); renderList(); })
      .catch(function (e) { notice('Não foi possível carregar os formulários: ' + e.message); if (!S.list) $('#cf-list').innerHTML = ''; });
  }
  function find(id) { return (S.list || []).filter(function (x) { return x.id === id; })[0]; }

  function renderList() {
    var list = S.list || [], c = { all: list.length, A: 0, I: 0 };
    list.forEach(function (x) { c[x.status] = (c[x.status] || 0) + 1; });
    $('#cf-filter').innerHTML = [['all', 'Todos'], ['A', 'Ativos'], ['I', 'Inativos']].map(function (f) {
      return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + '<span class="n">' + nf(c[f[0]] || 0) + '</span></button>';
    }).join('');
    if (!list.length) {
      $('#cf-list').innerHTML = '<div class="empty"><b>Nenhum formulário ainda.</b>Crie um formulário com os campos que a agente deve preencher, como o resultado da ligação e uma observação.' +
        '<div><button type="button" class="btn" data-act="new">Novo formulário</button></div></div>';
      bindList(); return;
    }
    var rows = list.filter(function (x) {
      if (S.filter !== 'all' && x.status !== S.filter) return false;
      return !S.q || (x.name + ' ' + x.description).toLowerCase().indexOf(S.q) !== -1;
    });
    if (!rows.length) { $('#cf-list').innerHTML = '<div class="empty">Nenhum formulário ' + (S.q ? 'com "' + esc(S.q) + '"' : 'neste filtro') + '.</div>'; return; }
    $('#cf-list').innerHTML = rows.map(function (x) {
      var used = x.campaigns.length
        ? 'Usado em ' + x.campaigns.map(function (k) { return esc(k.name); }).join(', ')
        : 'Não está em nenhuma campanha';
      return '<div class="cc-row" data-id="' + x.id + '">' +
        '<div class="name"><b>' + esc(x.name) + '</b><span>' + esc(x.description || plural(x.fields, 'campo', 'campos')) + '</span></div>' +
        '<div class="prog"><span><b>' + plural(x.fields, 'campo', 'campos') + '</b>, ' + plural(x.answers, 'ligação respondida', 'ligações respondidas') + '</span><span class="cf-used">' + used + '</span></div>' +
        '<div class="stat"><span class="pill ' + (x.status === 'A' ? 'st-a' : 'st-i') + '">' + (x.status === 'A' ? 'Ativo' : 'Inativo') + '</span></div>' +
        '<div class="acts"><button type="button" class="btn ghost" data-act="edit" data-id="' + x.id + '">Editar</button>' +
          '<div class="more"><button type="button" class="btn ghost icon" data-act="menu" aria-haspopup="true" aria-expanded="false" aria-label="Mais ações de ' + esc(x.name) + '">⋯</button>' +
          '<div class="menu" hidden>' +
            '<button type="button" data-act="' + (x.status === 'A' ? 'off' : 'on') + '" data-id="' + x.id + '">' + (x.status === 'A' ? 'Desativar' : 'Ativar') + '</button>' +
            '<button type="button" class="danger" data-act="delete" data-id="' + x.id + '">Excluir</button>' +
          '</div></div></div></div>';
    }).join('');
    bindList();
  }

  function closeMenus() {
    Array.prototype.forEach.call(document.querySelectorAll('#ccx-formularios .more .menu:not([hidden])'), function (m) {
      m.hidden = true; m.previousElementSibling.setAttribute('aria-expanded', 'false');
    });
  }
  function placeMenu(btn, menu) {
    var r = btn.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    var left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)), top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8 && r.top - 6 - mh >= 8) top = r.top - 6 - mh;
    menu.style.left = left + 'px'; menu.style.top = Math.max(8, top) + 'px';
  }

  function bindList() {
    $('#cf-list').onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
      var act = b.getAttribute('data-act'), id = parseInt(b.getAttribute('data-id'), 10), x = find(id);
      if (act === 'menu') {
        var m = b.nextElementSibling, open = m.hidden; closeMenus(); m.hidden = !open; b.setAttribute('aria-expanded', String(open));
        if (open) { placeMenu(b, m); var f = m.querySelector('button'); if (f) f.focus({ preventScroll: true }); }
        return;
      }
      closeMenus();
      if (act === 'new') openForm(null);
      else if (act === 'edit') openForm(id);
      else if (act === 'on' || act === 'off') run('status', { id: id, on: act === 'on' ? 1 : '' }, act === 'on' ? 'Formulário ativado.' : 'Formulário desativado.');
      else if (act === 'delete') confirmBox('Excluir o formulário?', '"' + x.name + '" será apagado. Só é possível excluir formulários que não estão em campanhas e ainda não têm respostas.',
        'Excluir formulário', function () { return run('delete', { id: id }, 'Formulário excluído.'); });
    };
  }

  function run(action, params, okMsg) {
    return api(action, params, true).then(function () { toast(okMsg); return load(); })
      .catch(function (e) { notice(e.message); window.scrollTo(0, 0); return false; });
  }

  function confirmBox(title, text, okLabel, onOk) {
    var mb = $('#cf-mback'), m = $('#cf-modal');
    m.innerHTML = '<h2 id="cf-mtitle">' + esc(title) + '</h2><p>' + esc(text) + '</p><div class="cc-mfoot">' +
      '<button type="button" class="btn ghost" data-m="cancel">Cancelar</button><button type="button" class="btn danger" data-m="ok">' + esc(okLabel) + '</button></div>';
    mb.hidden = false; m.querySelector('[data-m="cancel"]').focus();
    m.onclick = function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return;
      if (b.getAttribute('data-m') === 'cancel') return closeModal();
      b.disabled = true; onOk().then(closeModal, closeModal);
    };
  }
  function closeModal() { $('#cf-mback').hidden = true; }

  /* ---------- editor ---------- */
  function openForm(id) {
    var d = $('#cf-drawer');
    d.innerHTML = '<div class="d-body"><div class="empty">Carregando…</div></div>';
    d.hidden = false; $('#cf-back').hidden = false; document.body.classList.add('ccxc-lock');
    var p = id ? api('get', { id: id }).then(function (j) { return j.form; }) : Promise.resolve(null);
    p.then(function (f) {
      S.edit = f ? JSON.parse(JSON.stringify(f)) : { id: null, name: '', description: '', has_answers: false,
        fields: [{ label: 'Resultado', type: 'LIST', options: ['Se interessou', 'Não tem interesse', 'Pediu retorno'] }, { label: 'Observação', type: 'TEXTAREA', options: [] }] };
      renderEditor();
    }).catch(function (e) { d.innerHTML = '<div class="d-body"><div class="notice error"><p>' + esc(e.message) + '</p></div></div>'; });
  }
  function closeForm() { $('#cf-drawer').hidden = true; $('#cf-back').hidden = true; document.body.classList.remove('ccxc-lock'); S.edit = null; }

  function renderEditor() {
    var f = S.edit, d = $('#cf-drawer');
    d.innerHTML = '<form id="cf-form" novalidate>' +
      '<div class="d-head"><h2 id="cf-dtitle">' + (f.id ? 'Editar formulário' : 'Novo formulário') + '</h2>' +
        '<button type="button" class="btn ghost icon" data-close aria-label="Fechar">✕</button></div>' +
      '<div class="d-body"><div id="cf-ferr"></div>' +
        (f.has_answers ? '<div class="notice"><p>Este formulário já tem respostas gravadas. Dá para renomear, reordenar e acrescentar campos, mas não remover os que já existem.</p></div>' : '') +
        '<label class="field"><span>Nome do formulário</span><input name="fname" maxlength="40" value="' + esc(f.name) + '" placeholder="Ex.: Resultado da ligação"></label>' +
        '<label class="field"><span>Descrição <em>(opcional)</em></span><input name="fdesc" maxlength="150" value="' + esc(f.description) + '" placeholder="Para que serve este formulário"></label>' +
        '<h3>Campos</h3><div id="cf-fields"></div>' +
        '<button type="button" class="btn ghost cf-add" data-ed="add">+ Adicionar campo</button>' +
        '<h3>Como a agente vai ver</h3><div class="cf-preview" id="cf-preview"></div>' +
      '</div>' +
      '<div class="d-foot"><button type="button" class="btn ghost" data-close>Cancelar</button>' +
        '<button type="submit" class="btn" id="cf-save">' + (f.id ? 'Salvar alterações' : 'Criar formulário') + '</button></div></form>';
    renderFields();
    var form = $('#cf-form');
    Array.prototype.forEach.call(d.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', closeForm); });
    form.fname.addEventListener('input', function () { f.name = this.value; });
    form.fdesc.addEventListener('input', function () { f.description = this.value; });
    d.querySelector('[data-ed="add"]').addEventListener('click', function () {
      f.fields.push({ label: '', type: 'TEXT', options: [] }); renderFields();
      var inputs = d.querySelectorAll('.cf-field input[data-k="label"]'); if (inputs.length) inputs[inputs.length - 1].focus();
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); save(); });
    form.fname.focus();
  }

  function renderFields() {
    var f = S.edit, box = $('#cf-fields');
    box.innerHTML = f.fields.map(function (x, i) {
      var locked = f.has_answers && x.id;     // campo existente com respostas: não pode sair
      return '<div class="cf-field" data-i="' + i + '">' +
        '<div class="cf-order"><button type="button" class="btn ghost icon" data-ed="up" aria-label="Subir campo"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="btn ghost icon" data-ed="down" aria-label="Descer campo"' + (i === f.fields.length - 1 ? ' disabled' : '') + '>↓</button></div>' +
        '<div class="cf-main"><div class="cf-line">' +
          '<label class="field"><span>Nome do campo</span><input data-k="label" value="' + esc(x.label) + '" placeholder="Ex.: Resultado"></label>' +
          '<label class="field"><span>Tipo</span><select data-k="type">' + TYPES.map(function (t) {
            return '<option value="' + t[0] + '"' + (x.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></label></div>' +
          '<p class="help">' + esc((TYPES.filter(function (t) { return t[0] === x.type; })[0] || TYPES[0])[2]) + '</p>' +
          (x.type === 'LIST' ? '<label class="field"><span>Opções, uma por linha</span><textarea data-k="options" rows="4" placeholder="Se interessou&#10;Não tem interesse&#10;Pediu retorno">' + esc((x.options || []).join('\n')) + '</textarea>' +
            '<small>Uma opção não pode ter vírgula.</small></label>' : '') +
        '</div>' +
        '<button type="button" class="btn ghost icon cf-del" data-ed="del" aria-label="Remover campo"' + (locked || f.fields.length === 1 ? ' disabled title="' + (locked ? 'Este campo já tem respostas' : 'O formulário precisa de pelo menos um campo') + '"' : '') + '>✕</button>' +
      '</div>';
    }).join('');
    box.onclick = function (e) {
      var b = e.target.closest('[data-ed]'); if (!b || b.disabled) return;
      var i = parseInt(b.closest('.cf-field').getAttribute('data-i'), 10), a = b.getAttribute('data-ed'), fs = f.fields;
      if (a === 'up' && i > 0) { var t = fs[i - 1]; fs[i - 1] = fs[i]; fs[i] = t; }
      else if (a === 'down' && i < fs.length - 1) { var u = fs[i + 1]; fs[i + 1] = fs[i]; fs[i] = u; }
      else if (a === 'del') fs.splice(i, 1);
      renderFields();
    };
    box.oninput = box.onchange = function (e) {
      var el = e.target, k = el.getAttribute('data-k'); if (!k) return;
      var x = f.fields[parseInt(el.closest('.cf-field').getAttribute('data-i'), 10)];
      if (k === 'label') x.label = el.value;
      else if (k === 'options') x.options = el.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      else if (k === 'type' && e.type === 'change') { x.type = el.value; if (x.type === 'LIST' && !x.options.length) x.options = []; renderFields(); return; }
      renderPreview();
    };
    renderPreview();
  }

  // Prévia no mesmo jeito do console: rótulo em cima, campo embaixo.
  function renderPreview() {
    var p = $('#cf-preview'); if (!p) return;
    p.innerHTML = S.edit.fields.map(function (x) {
      var lbl = esc(x.label || 'Campo sem nome');
      if (x.type === 'LABEL') return '<div class="pv-label">' + lbl + '</div>';
      var ctl = x.type === 'LIST' ? '<select disabled><option>' + esc((x.options || [])[0] || 'Escolha') + '</option></select>'
        : x.type === 'TEXTAREA' ? '<textarea disabled rows="3"></textarea>'
        : x.type === 'DATE' ? '<input disabled placeholder="dd/mm/aaaa">' : '<input disabled>';
      return '<div class="pv-field"><span>' + lbl + '</span>' + ctl + '</div>';
    }).join('') + '<div class="pv-save">Salvar registro</div>';
  }

  function save() {
    if (S.busy) return;
    var f = S.edit, err = '';
    if (!String(f.name || '').trim()) err = 'Dê um nome para o formulário.';
    else if (!f.fields.length) err = 'Adicione pelo menos um campo.';
    else f.fields.some(function (x, i) {
      if (!String(x.label || '').trim()) { err = 'O campo ' + (i + 1) + ' está sem nome.'; return true; }
      if (x.type === 'LIST' && !(x.options || []).length) { err = 'O campo "' + x.label + '" é uma lista e precisa de opções.'; return true; }
      var bad = x.type === 'LIST' ? (x.options || []).filter(function (o) { return o.indexOf(',') !== -1; })[0] : null;
      if (bad) { err = 'No campo "' + x.label + '", a opção "' + bad + '" tem vírgula.'; return true; }
      return false;
    });
    if (err) { $('#cf-ferr').innerHTML = '<div class="notice error" role="alert"><p>' + esc(err) + '</p></div>'; $('#cf-drawer .d-body').scrollTop = 0; return; }
    S.busy = true; var b = $('#cf-save'); b.disabled = true; b.textContent = 'Salvando…';
    var data = { id: f.id, name: f.name, description: f.description,
      fields: f.fields.map(function (x) { return { id: x.id || null, label: x.label, type: x.type, options: x.type === 'LIST' ? x.options : [] }; }) };
    api('save', { data: JSON.stringify(data) }, true).then(function () {
      closeForm(); toast(f.id ? 'Alterações salvas.' : 'Formulário criado. Vincule-o a uma campanha em Campanhas.'); return load();
    }).catch(function (e) {
      $('#cf-ferr').innerHTML = '<div class="notice error" role="alert"><p>' + esc(e.message) + '</p></div>'; $('#cf-drawer .d-body').scrollTop = 0;
    }).then(function () { S.busy = false; var bb = $('#cf-save'); if (bb) { bb.disabled = false; bb.textContent = f.id ? 'Salvar alterações' : 'Criar formulário'; } });
  }

  load();
})();
