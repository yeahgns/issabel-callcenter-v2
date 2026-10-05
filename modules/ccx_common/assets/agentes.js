/* Issabel Call Center Plus - Agentes (login do console). Sem dependências. Visual de Campanhas. */
(function () {
  'use strict';

  var root = document.getElementById('ccx-agentes');
  if (!root || root.getAttribute('data-ready')) return;
  root.setAttribute('data-ready', '1');
  document.body.classList.add('ccxc-page');

  var API = root.getAttribute('data-api').replace(/&amp;/g, '&');
  var TOKEN = root.getAttribute('data-token');
  var S = { list: null, filter: 'all', q: '', offset: 0, busy: false, timer: null };

  function $(s, c) { return (c || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nf(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // Hora, com a data quando não for de hoje (ex.: sessão que ficou aberta de outro dia).
  function hm(ts) {
    var d = new Date(ts * 1000), t = new Date(), h = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return d.toDateString() === t.toDateString() ? h : pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' às ' + h;
  }
  function dur(s) { s = Math.max(0, Math.round(s || 0)); if (s < 60) return s + 's'; var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + 'h ' + pad(m) + 'min' : m + 'min'; }
  function now() { return Date.now() / 1000 + S.offset; }

  function api(action, params, post) {
    var url = API + '&action=' + encodeURIComponent(action);
    var opt = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (post) {
      var body = new URLSearchParams();
      Object.keys(params || {}).forEach(function (k) { if (params[k] != null) body.append(k, params[k]); });
      opt.method = 'POST'; opt.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opt.headers['X-CCX-Token'] = TOKEN;
      opt.body = body.toString();
      if (params && params.number) url += '&number=' + encodeURIComponent(params.number);
    }
    return fetch(url, opt).then(function (r) {
      var ct = r.headers.get('Content-Type') || '';
      if (ct.indexOf('json') === -1) throw new Error('Sua sessão do Issabel expirou. Recarregue a página.');
      return r.json().then(function (j) { if (!r.ok || j.error) throw new Error(j.error || 'Erro ' + r.status); return j; });
    });
  }

  root.innerHTML =
    '<header class="topbar"><div class="brand"><h1>Agentes</h1><p>Logins que as agentes usam no console</p></div>' +
      '<button type="button" class="btn" id="ca-new">Nova agente</button></header>' +
    '<main><div id="ca-notice"></div>' +
      '<div class="toolbar"><div class="seg" id="ca-filter" role="group" aria-label="Filtrar agentes"></div>' +
        '<div class="search"><label class="sr-only" for="ca-q">Buscar agente</label><input type="search" id="ca-q" placeholder="Nome ou ramal" autocomplete="off"></div></div>' +
      '<div class="cc-panel" id="ca-list"><div class="empty">Carregando agentes…</div></div></main>' +
    '<div class="drawer-back" id="ca-back" hidden></div>' +
    '<aside class="drawer" id="ca-drawer" hidden role="dialog" aria-modal="true" aria-labelledby="ca-dtitle"></aside>' +
    '<div class="cc-mback" id="ca-mback" hidden><div class="cc-modal" role="alertdialog" aria-modal="true" aria-labelledby="ca-mtitle" id="ca-modal"></div></div>' +
    '<div class="cc-toast" id="ca-toast" role="status" aria-live="polite"></div>';

  $('#ca-new').addEventListener('click', function () { openForm(null); });
  $('#ca-q').addEventListener('input', function () { S.q = this.value.trim().toLowerCase(); renderList(); });
  $('#ca-filter').addEventListener('click', function (e) { var b = e.target.closest('button[data-f]'); if (b) { S.filter = b.getAttribute('data-f'); renderList(); } });
  $('#ca-back').addEventListener('click', closeForm);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('#ca-mback').hidden) closeModal(); else if (!$('#ca-drawer').hidden) closeForm();
    closeMenus();
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.more')) closeMenus(); });
  window.addEventListener('scroll', closeMenus, true);
  window.addEventListener('resize', closeMenus);

  function toast(m) { var t = $('#ca-toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 3200); }
  function notice(m) { $('#ca-notice').innerHTML = m ? '<div class="notice error" role="alert"><p>' + esc(m) + '</p></div>' : ''; }

  /* ---------- lista ---------- */
  function load() {
    clearTimeout(S.timer);
    return api('list').then(function (j) { S.list = j.agents; S.offset = j.now - Date.now() / 1000; notice(''); renderList(); })
      .catch(function (e) { notice('Não foi possível carregar as agentes: ' + e.message); if (!S.list) $('#ca-list').innerHTML = ''; })
      .then(function () { S.timer = setTimeout(function () { if (!document.hidden && $('#ca-drawer').hidden) load(); else S.timer = setTimeout(load, 15000); }, 15000); });
  }
  function find(n) { return (S.list || []).filter(function (x) { return x.number === n; })[0]; }
  function on(x) { return !!x.session_start; }

  function renderList() {
    var list = S.list || [], c = { all: list.length, on: 0, off: 0 };
    list.forEach(function (x) { c[on(x) ? 'on' : 'off']++; });
    $('#ca-filter').innerHTML = [['all', 'Todas'], ['on', 'Conectadas'], ['off', 'Desconectadas']].map(function (f) {
      return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + '<span class="n">' + nf(c[f[0]]) + '</span></button>';
    }).join('');
    if (!list.length) {
      $('#ca-list').innerHTML = '<div class="empty"><b>Nenhuma agente cadastrada.</b>Crie o login de uma agente a partir de um ramal do PABX. É com ele que ela entra no console.' +
        '<div><button type="button" class="btn" data-act="new">Nova agente</button></div></div>';
      bindList(); return;
    }
    var rows = list.filter(function (x) {
      if (S.filter === 'on' && !on(x)) return false;
      if (S.filter === 'off' && on(x)) return false;
      return !S.q || (x.name + ' ' + x.number).toLowerCase().indexOf(S.q) !== -1;
    }).sort(function (a, b) { return (on(b) - on(a)) || a.name.localeCompare(b.name, 'pt-BR'); });
    if (!rows.length) { $('#ca-list').innerHTML = '<div class="empty">Nenhuma agente ' + (S.q ? 'com "' + esc(S.q) + '"' : 'neste filtro') + '.</div>'; return; }
    $('#ca-list').innerHTML = rows.map(function (x) {
      var st = on(x)
        ? '<span><b>No console desde ' + hm(x.session_start) + '</b> (' + dur(now() - x.session_start) + ')</span>'
        : '<span>Fora do console</span>';
      return '<div class="cc-row">' +
        '<div class="name"><b>' + esc(x.name) + '</b><span>Ramal ' + esc(x.number) + ' (' + esc(x.type) + ')</span></div>' +
        '<div class="prog ca-st">' + st + '<span class="ca-day">' + (x.day_sec ? dur(x.day_sec) + ' logada hoje' : 'Não entrou hoje') + '</span></div>' +
        '<div class="stat"><span class="pill ' + (on(x) ? 'st-a' : 'st-i') + '">' + (on(x) ? 'Conectada' : 'Desconectada') + '</span></div>' +
        '<div class="acts"><button type="button" class="btn ghost" data-act="edit" data-n="' + esc(x.number) + '">Editar</button>' +
          '<div class="more"><button type="button" class="btn ghost icon" data-act="menu" aria-haspopup="true" aria-expanded="false" aria-label="Mais ações de ' + esc(x.name) + '">⋯</button>' +
          '<div class="menu" hidden>' +
            '<button type="button" data-act="disconnect" data-n="' + esc(x.number) + '"' + (on(x) ? '' : ' disabled') + '>Desconectar do console</button>' +
            '<button type="button" class="danger" data-act="delete" data-n="' + esc(x.number) + '">Excluir</button>' +
          '</div></div></div></div>';
    }).join('');
    bindList();
  }

  function closeMenus() {
    Array.prototype.forEach.call(document.querySelectorAll('#ccx-agentes .more .menu:not([hidden])'), function (m) {
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
    $('#ca-list').onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
      var act = b.getAttribute('data-act'), n = b.getAttribute('data-n'), x = find(n);
      if (act === 'menu') {
        var m = b.nextElementSibling, open = m.hidden; closeMenus(); m.hidden = !open; b.setAttribute('aria-expanded', String(open));
        if (open) { placeMenu(b, m); var f = m.querySelector('button:not([disabled])'); if (f) f.focus({ preventScroll: true }); }
        return;
      }
      closeMenus();
      if (act === 'new') openForm(null);
      else if (act === 'edit') openForm(x);
      else if (act === 'disconnect') confirmBox('Desconectar ' + x.name + ' do console?',
        'A sessão dela no console será encerrada, e ela deixa de receber ligações da fila até entrar de novo. Se estiver numa ligação agora, espere terminar.',
        'Desconectar', false, function () { return run('disconnect', { number: n }, x.name + ' foi desconectada do console.'); });
      else if (act === 'delete') confirmBox('Excluir o login de ' + x.name + '?',
        'Ela não vai mais conseguir entrar no console com o ramal ' + x.number + '. O histórico de ligações e pausas dela continua nos relatórios.',
        'Excluir login', true, function () { return run('delete', { number: n }, 'Login excluído.'); });
    };
  }

  function run(action, params, okMsg) {
    return api(action, params, true).then(function () { toast(okMsg); return load(); })
      .catch(function (e) { notice(e.message); window.scrollTo(0, 0); return false; });
  }

  function confirmBox(title, text, okLabel, danger, onOk) {
    var mb = $('#ca-mback'), m = $('#ca-modal');
    m.innerHTML = '<h2 id="ca-mtitle">' + esc(title) + '</h2><p>' + esc(text) + '</p><div class="cc-mfoot">' +
      '<button type="button" class="btn ghost" data-m="cancel">Cancelar</button><button type="button" class="btn' + (danger ? ' danger' : '') + '" data-m="ok">' + esc(okLabel) + '</button></div>';
    mb.hidden = false; m.querySelector('[data-m="cancel"]').focus();
    m.onclick = function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return;
      if (b.getAttribute('data-m') === 'cancel') return closeModal();
      b.disabled = true; onOk().then(closeModal, closeModal);
    };
  }
  function closeModal() { $('#ca-mback').hidden = true; }

  /* ---------- formulário ---------- */
  function openForm(x) {
    var d = $('#ca-drawer');
    d.innerHTML = '<div class="d-body"><div class="empty">Carregando…</div></div>';
    d.hidden = false; $('#ca-back').hidden = false; document.body.classList.add('ccxc-lock');
    var p = x ? Promise.resolve(null) : api('free').then(function (j) { return j.extensions; });
    p.then(function (exts) { renderForm(x, exts); })
      .catch(function (e) { d.innerHTML = '<div class="d-body"><div class="notice error"><p>' + esc(e.message) + '</p></div></div>'; });
  }
  function closeForm() { $('#ca-drawer').hidden = true; $('#ca-back').hidden = true; document.body.classList.remove('ccxc-lock'); }

  function renderForm(x, exts) {
    var d = $('#ca-drawer'), isNew = !x;
    var ramal = isNew
      ? (exts.length
          ? '<label class="field"><span>Ramal</span><select name="channel"><option value="">Escolha o ramal</option>' +
              exts.map(function (e) { return '<option value="' + esc(e.value) + '" data-name="' + esc(e.name) + '">' + esc(e.label) + '</option>'; }).join('') +
            '</select><small>É o ramal do PABX que vai tocar quando a fila entregar uma ligação para ela.</small></label>'
          : '<div class="notice error"><p>Todos os ramais do PABX já têm login de agente. Crie um ramal no PABX antes.</p></div>')
      : '<div class="field"><span>Ramal</span><p class="ca-fixed">' + esc(x.number) + ' (' + esc(x.type) + ')</p></div>';
    d.innerHTML = '<form id="ca-form" novalidate autocomplete="off">' +
      '<div class="d-head"><h2 id="ca-dtitle">' + (isNew ? 'Nova agente' : 'Editar agente') + '</h2>' +
        '<button type="button" class="btn ghost icon" data-close aria-label="Fechar">✕</button></div>' +
      '<div class="d-body"><div id="ca-ferr"></div>' + ramal +
        '<label class="field"><span>Nome</span><input name="aname" maxlength="60" value="' + esc(x ? x.name : '') + '" placeholder="Nome da agente"></label>' +
        '<h3>Senha do console</h3>' +
        (isNew ? '' : '<p class="help">Deixe em branco para manter a senha atual.</p>') +
        '<div class="two"><label class="field"><span>' + (isNew ? 'Senha' : 'Nova senha') + '</span><input type="password" name="pw1" autocomplete="new-password"></label>' +
          '<label class="field"><span>Repita a senha</span><input type="password" name="pw2" autocomplete="new-password"></label></div>' +
        '<p class="help">É a senha que a agente digita ao entrar no console. Pelo menos 4 caracteres.</p>' +
      '</div>' +
      '<div class="d-foot"><button type="button" class="btn ghost" data-close>Cancelar</button>' +
        '<button type="submit" class="btn" id="ca-save"' + (isNew && !exts.length ? ' disabled' : '') + '>' + (isNew ? 'Criar login' : 'Salvar alterações') + '</button></div></form>';
    var f = $('#ca-form');
    Array.prototype.forEach.call(d.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', closeForm); });
    // Sugere o nome cadastrado no PABX para o ramal escolhido, sem apagar o que já foi digitado.
    var suggested = '';
    if (f.channel) f.channel.addEventListener('change', function () {
      var nm = this.options[this.selectedIndex].getAttribute('data-name') || '';
      if (!f.aname.value.trim() || f.aname.value === suggested) f.aname.value = nm;
      suggested = nm;
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (S.busy) return;
      var err = isNew && !(f.channel && f.channel.value) ? 'Escolha o ramal.'
        : !f.aname.value.trim() ? 'Dê um nome para a agente.'
        : (isNew || f.pw1.value || f.pw2.value) && f.pw1.value.length < 4 ? 'A senha precisa ter pelo menos 4 caracteres.'
        : f.pw1.value !== f.pw2.value ? 'As duas senhas não são iguais.' : '';
      if (err) { $('#ca-ferr').innerHTML = '<div class="notice error" role="alert"><p>' + esc(err) + '</p></div>'; return; }
      S.busy = true; var b = $('#ca-save'); b.disabled = true; b.textContent = 'Salvando…';
      var data = { name: f.aname.value, password: f.pw1.value, password2: f.pw2.value };
      if (isNew) data.channel = f.channel.value; else data.number = x.number;
      api(isNew ? 'create' : 'update', data, true).then(function () {
        closeForm(); toast(isNew ? 'Login criado. A agente já pode entrar no console com o ramal e a senha.' : 'Alterações salvas.'); return load();
      }).catch(function (e2) {
        $('#ca-ferr').innerHTML = '<div class="notice error" role="alert"><p>' + esc(e2.message) + '</p></div>';
      }).then(function () { S.busy = false; var bb = $('#ca-save'); if (bb) { bb.disabled = false; bb.textContent = isNew ? 'Criar login' : 'Salvar alterações'; } });
    });
    (f.channel || f.aname).focus();
  }

  load();
})();
