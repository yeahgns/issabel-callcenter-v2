/* Issabel Call Center Plus - Campanhas de saída. Sem dependências. */
(function () {
  'use strict';

  var root = document.getElementById('ccx-campanhas');
  if (!root || root.getAttribute('data-ready')) return;
  root.setAttribute('data-ready', '1');
  document.body.classList.add('ccxc-page');

  var API = root.getAttribute('data-api').replace(/&amp;/g, '&');
  var TOKEN = root.getAttribute('data-token');
  var LEGACY = root.getAttribute('data-legacy');
  var S = { list: null, filter: 'all', q: '', options: null, editing: null, busy: false, timer: null };

  var STATUS = {
    A: { label: 'Ativa', cls: 'st-a' },
    I: { label: 'Inativa', cls: 'st-i' },
    T: { label: 'Finalizada', cls: 'st-t' }
  };

  /* ---------- utilidades ---------- */
  function $(s, c) { return (c || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nf(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function br(d) { var p = String(d || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d; }
  function plural(n, a, b) { return nf(n) + ' ' + (n === 1 ? a : b); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function plusDays(n) { var d = new Date(Date.now() + n * 86400000); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  // O roteiro é guardado como HTML (o console o exibe assim); na tela editamos texto simples.
  function htmlToText(h) {
    var t = String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n');
    var el = document.createElement('div'); el.innerHTML = t;
    return (el.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }
  function textToHtml(t) { return esc(String(t || '').trim()).replace(/\n/g, '<br>'); }

  function api(action, params, post) {
    var url = API + '&action=' + encodeURIComponent(action);
    var opt = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (post) {
      var body = new URLSearchParams();
      Object.keys(params || {}).forEach(function (k) {
        var v = params[k];
        if (Array.isArray(v)) v.forEach(function (x) { body.append(k + '[]', x); });
        else if (v != null) body.append(k, v);
      });
      opt.method = 'POST';
      opt.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opt.headers['X-CCX-Token'] = TOKEN;
      opt.body = body.toString();
    } else if (params) {
      Object.keys(params).forEach(function (k) { if (params[k] != null) url += '&' + k + '=' + encodeURIComponent(params[k]); });
    }
    return fetch(url, opt).then(function (r) {
      var ct = r.headers.get('Content-Type') || '';
      if (ct.indexOf('json') === -1) throw new Error('Sua sessão do Issabel expirou. Recarregue a página.');
      return r.json().then(function (j) { if (!r.ok || j.error) throw new Error(j.error || 'Erro ' + r.status); return j; });
    });
  }

  /* ---------- estrutura ---------- */
  root.innerHTML =
    '<header class="topbar"><div class="brand"><h1>Campanhas</h1><p>Campanhas de saída do discador</p></div>' +
      '<button type="button" class="btn" id="cc-new">Nova campanha</button></header>' +
    '<main>' +
      '<div id="cc-notice"></div>' +
      '<div class="toolbar"><div class="seg" id="cc-filter" role="group" aria-label="Filtrar por status"></div>' +
        '<div class="search"><label class="sr-only" for="cc-q">Buscar campanha</label><input type="search" id="cc-q" placeholder="Buscar campanha" autocomplete="off"></div></div>' +
      '<div class="cc-panel" id="cc-list"><div class="empty">Carregando campanhas…</div></div>' +
    '</main>' +
    '<div class="drawer-back" id="cc-back" hidden></div>' +
    '<aside class="drawer" id="cc-drawer" hidden aria-labelledby="cc-dtitle" role="dialog" aria-modal="true"></aside>' +
    '<div class="cc-mback" id="cc-mback" hidden><div class="cc-modal" role="alertdialog" aria-modal="true" aria-labelledby="cc-mtitle" id="cc-modal"></div></div>' +
    '<div class="cc-toast" id="cc-toast" role="status" aria-live="polite"></div>';

  $('#cc-new').addEventListener('click', function () { openForm(null); });
  $('#cc-q').addEventListener('input', function () { S.q = this.value.trim().toLowerCase(); renderList(); });
  $('#cc-filter').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]'); if (!b) return;
    S.filter = b.getAttribute('data-f'); renderList();
  });
  $('#cc-back').addEventListener('click', closeForm);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('#cc-mback').hidden) closeModal(); else if (!$('#cc-drawer').hidden) closeForm();
    closeMenus();
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.more')) closeMenus(); });

  function toast(msg) {
    var t = $('#cc-toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }
  function notice(msg, kind) {
    $('#cc-notice').innerHTML = msg ? '<div class="notice ' + (kind || 'error') + '" role="alert"><p>' + esc(msg) + '</p></div>' : '';
  }

  /* ---------- lista ---------- */
  function load() {
    return api('list').then(function (j) { S.list = j.campaigns; notice(''); renderList(); })
      .catch(function (e) { notice('Não foi possível carregar as campanhas: ' + e.message); if (!S.list) $('#cc-list').innerHTML = ''; });
  }
  function schedule() {
    clearTimeout(S.timer);
    S.timer = setTimeout(function () { if (!document.hidden && $('#cc-drawer').hidden) load().then(schedule); else schedule(); }, 15000);
  }

  function renderList() {
    var list = S.list || [];
    var c = { all: list.length, A: 0, I: 0, T: 0 };
    list.forEach(function (x) { c[x.status] = (c[x.status] || 0) + 1; });
    $('#cc-filter').innerHTML = [['all', 'Todas'], ['A', 'Ativas'], ['I', 'Inativas'], ['T', 'Finalizadas']].map(function (f) {
      return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + '<span class="n">' + nf(c[f[0]] || 0) + '</span></button>';
    }).join('');

    if (!list.length) {
      $('#cc-list').innerHTML = '<div class="empty"><b>Nenhuma campanha ainda.</b>Crie a primeira campanha e depois carregue a lista de contatos.' +
        '<div><button type="button" class="btn" data-act="new">Nova campanha</button></div></div>';
      bindRow($('#cc-list'));
      return;
    }
    var rows = list.filter(function (x) {
      if (S.filter !== 'all' && x.status !== S.filter) return false;
      if (S.q && (x.name + ' ' + (x.queue_name || '') + ' ' + x.queue).toLowerCase().indexOf(S.q) === -1) return false;
      return true;
    });
    if (!rows.length) { $('#cc-list').innerHTML = '<div class="empty">Nenhuma campanha ' + (S.q ? 'com "' + esc(S.q) + '"' : 'neste filtro') + '.</div>'; return; }

    $('#cc-list').innerHTML = rows.map(function (x) {
      var st = STATUS[x.status] || { label: x.status, cls: 'st-i' };
      var t = x.totals, done = t.total - t.pending;
      var pct = t.total ? Math.round(done / t.total * 100) : 0;
      var fila = x.queue_name ? x.queue_name + ' (' + x.queue + ')' : 'Fila ' + x.queue;
      var primary = x.status === 'A'
        ? '<button type="button" class="btn ghost" data-act="off" data-id="' + x.id + '">Desativar</button>'
        : '<button type="button" class="btn ghost" data-act="on" data-id="' + x.id + '">Ativar</button>';
      var progress = t.total
        ? '<div class="prog"><div class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' +
          '<span><b>' + nf(done) + '</b> de ' + nf(t.total) + ' trabalhados, ' + plural(t.pending, 'pendente', 'pendentes') + '</span></div>'
        : '<div class="prog none"><span>Sem contatos</span><a href="' + esc(LEGACY + '&action=load_contacts&id_campaign=' + x.id) + '">Carregar lista</a></div>';
      return '<div class="cc-row" data-id="' + x.id + '">' +
        '<div class="name"><b>' + esc(x.name) + '</b><span>' + esc(fila) + ', ' + br(x.date_from) + ' a ' + br(x.date_to) +
          ', das ' + esc(x.time_from) + ' às ' + esc(x.time_to) + '</span></div>' +
        progress +
        '<div class="stat"><span class="pill ' + st.cls + '">' + st.label + '</span></div>' +
        '<div class="acts">' + primary +
          '<div class="more"><button type="button" class="btn ghost icon" data-act="menu" aria-haspopup="true" aria-expanded="false" aria-label="Mais ações de ' + esc(x.name) + '">⋯</button>' +
          '<div class="menu" hidden>' +
            '<button type="button" data-act="edit" data-id="' + x.id + '">Editar</button>' +
            '<a href="' + esc(LEGACY + '&action=load_contacts&id_campaign=' + x.id) + '">Carregar contatos</a>' +
            '<a href="' + esc(LEGACY + '&action=csv_data&id_campaign=' + x.id + '&rawmode=yes') + '">Baixar resultados</a>' +
            '<button type="button" data-act="purge" data-id="' + x.id + '"' + (t.pending ? '' : ' disabled') + '>Limpar pendentes</button>' +
            '<button type="button" class="danger" data-act="delete" data-id="' + x.id + '">Excluir</button>' +
          '</div></div></div>' +
      '</div>';
    }).join('');
    bindRow($('#cc-list'));
  }

  function closeMenus() {
    Array.prototype.forEach.call(document.querySelectorAll('.ccxc .more .menu:not([hidden])'), function (m) {
      m.hidden = true; m.previousElementSibling.setAttribute('aria-expanded', 'false');
    });
  }
  function find(id) { return (S.list || []).filter(function (x) { return x.id === id; })[0]; }

  function bindRow(scope) {
    scope.onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
      var act = b.getAttribute('data-act'), id = parseInt(b.getAttribute('data-id'), 10), c = find(id);
      if (act === 'menu') {
        var m = b.nextElementSibling, open = m.hidden; closeMenus(); m.hidden = !open; b.setAttribute('aria-expanded', String(open));
        if (open) { var f = m.querySelector('button:not([disabled]), a'); if (f) f.focus(); }
        return;
      }
      closeMenus();
      if (act === 'new') openForm(null);
      else if (act === 'edit') openForm(id);
      else if (act === 'on') run('status', { id: id, status: 'A' }, 'Campanha ativada. O discador começa dentro do horário configurado.');
      else if (act === 'off') run('status', { id: id, status: 'I' }, 'Campanha desativada.');
      else if (act === 'purge') confirmBox('Limpar números pendentes?',
        'Os ' + plural(c.totals.pending, 'número que ainda não foi discado', 'números que ainda não foram discados') + ' em "' + c.name +
        '" serão removidos. Os já trabalhados e seus resultados continuam.', 'Limpar pendentes', false,
        function () { return run('purge', { id: id }, 'Pendentes removidos.'); });
      else if (act === 'delete') confirmBox('Excluir a campanha?',
        '"' + c.name + '" e todos os seus contatos e resultados serão apagados. Essa ação não pode ser desfeita. Se quiser guardar os resultados, baixe-os antes.',
        'Excluir campanha', true, function () { return run('delete', { id: id }, 'Campanha excluída.'); });
    };
  }

  function run(action, params, okMsg) {
    return api(action, params, true).then(function () { toast(okMsg); return load(); })
      .catch(function (e) { notice(e.message); window.scrollTo(0, 0); return false; });
  }

  /* ---------- confirmação ---------- */
  function confirmBox(title, text, okLabel, danger, onOk) {
    var mb = $('#cc-mback'), m = $('#cc-modal');
    m.innerHTML = '<h2 id="cc-mtitle">' + esc(title) + '</h2><p>' + esc(text) + '</p>' +
      '<div class="cc-mfoot"><button type="button" class="btn ghost" data-m="cancel">Cancelar</button>' +
      '<button type="button" class="btn' + (danger ? ' danger' : '') + '" data-m="ok">' + esc(okLabel) + '</button></div>';
    mb.hidden = false; m.querySelector('[data-m="cancel"]').focus();
    m.onclick = function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return;
      if (b.getAttribute('data-m') === 'cancel') return closeModal();
      b.disabled = true; onOk().then(closeModal, closeModal);
    };
  }
  function closeModal() { $('#cc-mback').hidden = true; }

  /* ---------- formulário ---------- */
  function loadOptions(queue) { return api('options', queue ? { queue: queue } : null); }

  function openForm(id) {
    var d = $('#cc-drawer');
    d.innerHTML = '<div class="d-body"><div class="empty">Carregando…</div></div>';
    d.hidden = false; $('#cc-back').hidden = false; document.body.classList.add('ccxc-lock');
    var pc = id ? api('get', { id: id }).then(function (j) { return j.campaign; }) : Promise.resolve(null);
    pc.then(function (c) {
      return loadOptions(c ? c.queue : null).then(function (o) { S.options = o; S.editing = c; renderForm(c, o); });
    }).catch(function (e) { d.innerHTML = '<div class="d-body"><div class="notice error"><p>' + esc(e.message) + '</p></div></div>'; });
  }
  function closeForm() {
    $('#cc-drawer').hidden = true; $('#cc-back').hidden = true; document.body.classList.remove('ccxc-lock'); S.editing = null;
  }

  function opt(list, sel) {
    return list.map(function (o) { return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(sel) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
  }

  function renderForm(c, o) {
    var v = c || { name: '', queue: '', trunk: '', retries: 3, channels: 0, date_from: today(), date_to: plusDays(30), time_from: '08:00', time_to: '18:00', script: '', forms: [] };
    var noQueues = !o.queues.length;
    var d = $('#cc-drawer');
    d.innerHTML =
      '<form id="cc-form" novalidate>' +
      '<div class="d-head"><h2 id="cc-dtitle">' + (c ? 'Editar campanha' : 'Nova campanha') + '</h2>' +
        '<button type="button" class="btn ghost icon" data-close aria-label="Fechar">✕</button></div>' +
      '<div class="d-body">' +
        '<div id="cc-ferr"></div>' +
        (c && c.status === 'A' ? '<div class="notice"><p>Esta campanha está ativa. As mudanças valem para as próximas ligações do discador.</p></div>' : '') +
        '<label class="field"><span>Nome da campanha</span><input name="cname" maxlength="64" required value="' + esc(v.name) + '" placeholder="Ex.: Renovação de contratos"></label>' +

        '<h3>Quando discar</h3>' +
        '<div class="two"><label class="field"><span>Início</span><input type="date" name="date_from" required value="' + esc(v.date_from) + '"></label>' +
          '<label class="field"><span>Fim</span><input type="date" name="date_to" required value="' + esc(v.date_to) + '"></label></div>' +
        '<div class="two"><label class="field"><span>Discar a partir de</span><input type="time" name="time_from" required value="' + esc(v.time_from) + '"></label>' +
          '<label class="field"><span>Até</span><input type="time" name="time_to" required value="' + esc(v.time_to) + '"></label></div>' +
        '<p class="help">O discador só liga dentro deste horário, todos os dias do período.</p>' +

        '<h3>Como discar</h3>' +
        '<label class="field"><span>Fila que recebe as ligações atendidas</span>' +
          (noQueues ? '<div class="notice error"><p>Nenhuma fila disponível. Crie uma fila no PABX; filas usadas para ligações de entrada não podem ser usadas em campanhas.</p></div>'
                    : '<select name="queue" required><option value="">Escolha a fila</option>' + opt(o.queues, v.queue) + '</select>') +
          '<small>Quando o cliente atende, a ligação vai para as agentes desta fila.</small></label>' +
        '<div class="two"><label class="field"><span>Tentativas por número</span><input type="number" name="retries" min="1" max="20" value="' + esc(v.retries) + '"></label>' +
          '<label class="field"><span>Ligações simultâneas</span><input type="number" name="channels" min="0" value="' + esc(v.channels) + '"><small>0 = sem limite</small></label></div>' +
        '<label class="field"><span>Saída</span><select name="trunk">' + opt(o.trunks, v.trunk) + '</select>' +
          '<small>Use as rotas de saída, a menos que esta campanha precise de um tronco específico.</small></label>' +

        '<h3>Durante a ligação</h3>' +
        '<div class="field"><span>Formulário que a agente preenche</span>' +
          (o.forms.length ? '<div class="checks">' + o.forms.map(function (f) {
            return '<label class="check"><input type="checkbox" name="forms" value="' + f.value + '"' + (v.forms.indexOf(f.value) !== -1 ? ' checked' : '') + '>' +
              '<span><b>' + esc(f.label) + '</b>' + (f.description ? '<em>' + esc(f.description) + '</em>' : '') + '</span></label>';
          }).join('') + '</div>' : '<p class="help">Nenhum formulário cadastrado. Crie um em Call Center, Forms, Form Designer.</p>') +
        '</div>' +
        '<label class="field"><span>Roteiro <em>(opcional)</em></span><textarea name="script" rows="5" placeholder="O que a agente deve falar ou confirmar nesta campanha">' + esc(htmlToText(v.script)) + '</textarea></label>' +
      '</div>' +
      '<div class="d-foot"><button type="button" class="btn ghost" data-close>Cancelar</button>' +
        '<button type="submit" class="btn" id="cc-save">' + (c ? 'Salvar alterações' : 'Criar campanha') + '</button></div>' +
      '</form>';

    var f = $('#cc-form');
    Array.prototype.forEach.call(d.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', closeForm); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (S.busy) return;
      var data = {
        name: f.cname.value, date_from: f.date_from.value, date_to: f.date_to.value, time_from: f.time_from.value, time_to: f.time_to.value,
        queue: f.queue ? f.queue.value : '', retries: f.retries.value, channels: f.channels.value, trunk: f.trunk.value,
        script: textToHtml(f.script.value),
        forms: Array.prototype.map.call(f.querySelectorAll('input[name="forms"]:checked'), function (x) { return x.value; })
      };
      if (c) data.id = c.id;
      var err = !data.name.trim() ? 'Dê um nome para a campanha.' : !data.queue ? 'Escolha a fila que vai receber as ligações atendidas.' : '';
      if (err) { $('#cc-ferr').innerHTML = '<div class="notice error" role="alert"><p>' + esc(err) + '</p></div>'; return; }
      S.busy = true; $('#cc-save').disabled = true; $('#cc-save').textContent = 'Salvando…';
      api('save', data, true).then(function () {
        closeForm();
        toast(c ? 'Alterações salvas.' : 'Campanha criada. Agora carregue a lista de contatos para poder ativá-la.');
        return load();
      }).catch(function (e2) {
        $('#cc-ferr').innerHTML = '<div class="notice error" role="alert"><p>' + esc(e2.message) + '</p></div>';
        $('#cc-drawer .d-body').scrollTop = 0;
      }).then(function () {
        S.busy = false;
        var b = $('#cc-save'); if (b) { b.disabled = false; b.textContent = c ? 'Salvar alterações' : 'Criar campanha'; }
      });
    });
    f.cname.focus();
  }

  load().then(schedule);
})();
