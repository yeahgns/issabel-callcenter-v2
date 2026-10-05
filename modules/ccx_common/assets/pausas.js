/* Issabel Call Center Plus - Pausas. Sem dependências. Visual de Campanhas. */
(function () {
  'use strict';

  var root = document.getElementById('ccx-pausas');
  if (!root || root.getAttribute('data-ready')) return;
  root.setAttribute('data-ready', '1');
  document.body.classList.add('ccxc-page');

  var API = root.getAttribute('data-api').replace(/&amp;/g, '&');
  var TOKEN = root.getAttribute('data-token');
  var S = { list: null, filter: 'all', busy: false };

  function $(s, c) { return (c || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nf(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function plural(n, a, b) { return nf(n) + ' ' + (n === 1 ? a : b); }
  function dur(s) { s = Math.max(0, Math.round(s || 0)); if (s < 60) return s + 's'; var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + 'h ' + (m < 10 ? '0' : '') + m + 'min' : m + 'min'; }

  function api(action, params, post) {
    var url = API + '&action=' + encodeURIComponent(action);
    var opt = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (post) {
      var body = new URLSearchParams();
      Object.keys(params || {}).forEach(function (k) { if (params[k] != null) body.append(k, params[k]); });
      opt.method = 'POST'; opt.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opt.headers['X-CCX-Token'] = TOKEN;
      opt.body = body.toString();
      if (params && params.id) url += '&id=' + encodeURIComponent(params.id);
    }
    return fetch(url, opt).then(function (r) {
      var ct = r.headers.get('Content-Type') || '';
      if (ct.indexOf('json') === -1) throw new Error('Sua sessão do Issabel expirou. Recarregue a página.');
      return r.json().then(function (j) { if (!r.ok || j.error) throw new Error(j.error || 'Erro ' + r.status); return j; });
    });
  }

  root.innerHTML =
    '<header class="topbar"><div class="brand"><h1>Pausas</h1><p>Tipos de pausa que a agente escolhe no console</p></div>' +
      '<button type="button" class="btn" id="cp-new">Nova pausa</button></header>' +
    '<main><div id="cp-notice"></div>' +
      '<div class="toolbar"><div class="seg" id="cp-filter" role="group" aria-label="Filtrar pausas"></div></div>' +
      '<div class="cc-panel" id="cp-list"><div class="empty">Carregando pausas…</div></div></main>' +
    '<div class="drawer-back" id="cp-back" hidden></div>' +
    '<aside class="drawer" id="cp-drawer" hidden role="dialog" aria-modal="true" aria-labelledby="cp-dtitle"></aside>' +
    '<div class="cc-mback" id="cp-mback" hidden><div class="cc-modal" role="alertdialog" aria-modal="true" aria-labelledby="cp-mtitle" id="cp-modal"></div></div>' +
    '<div class="cc-toast" id="cp-toast" role="status" aria-live="polite"></div>';

  $('#cp-new').addEventListener('click', function () { openForm(null); });
  $('#cp-filter').addEventListener('click', function (e) { var b = e.target.closest('button[data-f]'); if (b) { S.filter = b.getAttribute('data-f'); renderList(); } });
  $('#cp-back').addEventListener('click', closeForm);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('#cp-mback').hidden) closeModal(); else if (!$('#cp-drawer').hidden) closeForm();
  });

  function toast(m) { var t = $('#cp-toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 3200); }
  function notice(m) { $('#cp-notice').innerHTML = m ? '<div class="notice error" role="alert"><p>' + esc(m) + '</p></div>' : ''; }

  function load() {
    return api('list').then(function (j) { S.list = j.pauses; notice(''); renderList(); })
      .catch(function (e) { notice('Não foi possível carregar as pausas: ' + e.message); if (!S.list) $('#cp-list').innerHTML = ''; });
  }
  function find(id) { return (S.list || []).filter(function (x) { return x.id === id; })[0]; }

  function renderList() {
    var list = S.list || [], c = { all: list.length, A: 0, I: 0 };
    list.forEach(function (x) { c[x.status] = (c[x.status] || 0) + 1; });
    $('#cp-filter').innerHTML = [['all', 'Todas'], ['A', 'Ativas'], ['I', 'Inativas']].map(function (f) {
      return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + '<span class="n">' + nf(c[f[0]] || 0) + '</span></button>';
    }).join('');
    if (!c.A) notice(list.length ? 'Nenhuma pausa ativa: as agentes não conseguem entrar em pausa no console.' : '');
    if (!list.length) {
      $('#cp-list').innerHTML = '<div class="empty"><b>Nenhuma pausa cadastrada.</b>Sem pausas, as agentes não conseguem entrar em pausa no console.' +
        '<div class="cp-sug"><p>Comece pelas mais comuns:</p>' + SUGGESTED.map(function (x) { return '<span class="cp-chip">' + esc(x[0]) + '</span>'; }).join('') + '</div>' +
        '<div><button type="button" class="btn" data-act="suggest">Criar estas pausas</button> ' +
        '<button type="button" class="btn ghost" data-act="new">Criar outra</button></div></div>';
      bind(); return;
    }
    var rows = list.filter(function (x) { return S.filter === 'all' || x.status === S.filter; });
    if (!rows.length) { $('#cp-list').innerHTML = '<div class="empty">Nenhuma pausa neste filtro.</div>'; return; }
    $('#cp-list').innerHTML = rows.map(function (x) {
      var use = x.today_count ? 'Usada ' + plural(x.today_count, 'vez', 'vezes') + ' hoje, ' + dur(x.today_sec) + ' no total' : 'Não usada hoje';
      return '<div class="cc-row">' +
        '<div class="name"><b>' + esc(x.name) + '</b><span>' + esc(x.description || 'Sem descrição') + '</span></div>' +
        '<div class="prog cp-use"><span>' + use + '</span>' + (x.now ? '<span class="cp-now">' + plural(x.now, 'agente nesta pausa agora', 'agentes nesta pausa agora') + '</span>' : '') + '</div>' +
        '<div class="stat"><span class="pill ' + (x.status === 'A' ? 'st-a' : 'st-i') + '">' + (x.status === 'A' ? 'Ativa' : 'Inativa') + '</span></div>' +
        '<div class="acts"><button type="button" class="btn ghost" data-act="edit" data-id="' + x.id + '">Editar</button>' +
          '<button type="button" class="btn ghost" data-act="' + (x.status === 'A' ? 'off' : 'on') + '" data-id="' + x.id + '">' + (x.status === 'A' ? 'Desativar' : 'Ativar') + '</button></div>' +
      '</div>';
    }).join('');
    bind();
  }

  function bind() {
    $('#cp-list').onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act'), id = parseInt(b.getAttribute('data-id'), 10), x = find(id);
      if (act === 'new') openForm(null);
      else if (act === 'suggest') createSuggested(b);
      else if (act === 'edit') openForm(x);
      else if (act === 'on') run('status', { id: id, on: 1 }, 'Pausa ativada. Ela já aparece no console das agentes.');
      else if (act === 'off') confirmBox('Desativar a pausa "' + x.name + '"?',
        'Ela some da lista de pausas do console. ' + (x.now ? 'Quem está nela agora continua em pausa normalmente. ' : '') + 'O histórico dela continua nos relatórios.',
        'Desativar', function () { return run('status', { id: id, on: '' }, 'Pausa desativada.'); });
    };
  }

  // Pausas comuns, criadas com um clique quando a lista está vazia.
  var SUGGESTED = [['Almoço', 'Intervalo de almoço'], ['Café', 'Pausa rápida'], ['Banheiro', ''], ['Treinamento', 'Treinamento ou reunião com o supervisor']];
  function createSuggested(btn) {
    btn.disabled = true; btn.textContent = 'Criando…';
    var p = Promise.resolve(), made = 0;
    SUGGESTED.forEach(function (x) {
      p = p.then(function () { return api('save', { name: x[0], description: x[1] }, true).then(function () { made++; }, function () { /* já existia: segue */ }); });
    });
    p.then(function () { toast(made === 1 ? '1 pausa criada.' : made + ' pausas criadas. Elas já aparecem no console das agentes.'); return load(); });
  }

  function run(action, params, okMsg) {
    return api(action, params, true).then(function () { toast(okMsg); return load(); })
      .catch(function (e) { notice(e.message); window.scrollTo(0, 0); return false; });
  }

  function confirmBox(title, text, okLabel, onOk) {
    var mb = $('#cp-mback'), m = $('#cp-modal');
    m.innerHTML = '<h2 id="cp-mtitle">' + esc(title) + '</h2><p>' + esc(text) + '</p><div class="cc-mfoot">' +
      '<button type="button" class="btn ghost" data-m="cancel">Cancelar</button><button type="button" class="btn" data-m="ok">' + esc(okLabel) + '</button></div>';
    mb.hidden = false; m.querySelector('[data-m="cancel"]').focus();
    m.onclick = function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return;
      if (b.getAttribute('data-m') === 'cancel') return closeModal();
      b.disabled = true; onOk().then(closeModal, closeModal);
    };
  }
  function closeModal() { $('#cp-mback').hidden = true; }

  function openForm(x) {
    var d = $('#cp-drawer'), isNew = !x;
    d.innerHTML = '<form id="cp-form" novalidate>' +
      '<div class="d-head"><h2 id="cp-dtitle">' + (isNew ? 'Nova pausa' : 'Editar pausa') + '</h2>' +
        '<button type="button" class="btn ghost icon" data-close aria-label="Fechar">✕</button></div>' +
      '<div class="d-body"><div id="cp-ferr"></div>' +
        '<label class="field"><span>Nome</span><input name="pname" maxlength="40" value="' + esc(x ? x.name : '') + '" placeholder="Ex.: Almoço"></label>' +
        '<label class="field"><span>Descrição <em>(opcional)</em></span><input name="pdesc" maxlength="120" value="' + esc(x ? x.description : '') + '" placeholder="Ex.: Intervalo de almoço"></label>' +
        '<h3>Como a agente vai ver</h3><div class="cp-prev"><span class="cp-radio"></span><span><b id="cp-pv-name"></b><em id="cp-pv-desc"></em></span></div>' +
        '<p class="help">A agente escolhe a pausa numa lista ao clicar em "Pausa" no console.</p>' +
      '</div>' +
      '<div class="d-foot"><button type="button" class="btn ghost" data-close>Cancelar</button>' +
        '<button type="submit" class="btn" id="cp-save">' + (isNew ? 'Criar pausa' : 'Salvar alterações') + '</button></div></form>';
    d.hidden = false; $('#cp-back').hidden = false; document.body.classList.add('ccxc-lock');
    var f = $('#cp-form');
    var prev = function () { $('#cp-pv-name').textContent = f.pname.value.trim() || 'Nome da pausa'; $('#cp-pv-desc').textContent = f.pdesc.value.trim(); };
    f.pname.addEventListener('input', prev); f.pdesc.addEventListener('input', prev); prev();
    Array.prototype.forEach.call(d.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', closeForm); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (S.busy) return;
      if (!f.pname.value.trim()) { $('#cp-ferr').innerHTML = '<div class="notice error" role="alert"><p>Dê um nome para a pausa.</p></div>'; return; }
      S.busy = true; var b = $('#cp-save'); b.disabled = true; b.textContent = 'Salvando…';
      api('save', { id: x ? x.id : null, name: f.pname.value, description: f.pdesc.value }, true).then(function () {
        S.busy = false;
        closeForm(); toast(isNew ? 'Pausa criada. Ela já aparece no console das agentes.' : 'Alterações salvas.'); return load();
      }).catch(function (e2) {
        $('#cp-ferr').innerHTML = '<div class="notice error" role="alert"><p>' + esc(e2.message) + '</p></div>';
      }).then(function () { S.busy = false; var bb = $('#cp-save'); if (bb) { bb.disabled = false; bb.textContent = isNew ? 'Criar pausa' : 'Salvar alterações'; } });
    });
    f.pname.focus();
  }
  function closeForm() { $('#cp-drawer').hidden = true; $('#cp-back').hidden = true; document.body.classList.remove('ccxc-lock'); }

  load();
})();
