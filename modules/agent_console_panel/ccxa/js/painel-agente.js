/* Issabel Call Center Plus - casca do Agent Console.
 *
 * Não fala com o ECCP nem grava nada. O console original (o "motor") continua rodando
 * e cuidando de login, eventos em tempo real, pausas, timeout, ficha do cliente e
 * gravação dos formulários (o botão "Save data"). Esta casca só melhora a aparência:
 *
 *   - lê o estado que o motor mantém no DOM (#issabel-callcenter-estado-agente);
 *   - MOVE os blocos nativos (ficha/Information+Script e os Forms+Save data) para dentro
 *     de um layout novo, sem recriá-los, então tudo que eles fazem continua funcionando;
 *   - reflete o estado numa barra de status e delega os cliques (Desligar/Hold/Pausa/
 *     Encerrar/Transferir) aos botões originais escondidos.
 *
 * Regra de ouro: se algo esperado não existir, a casca desiste (nunca deixa a agente sem
 * console). Ela também devolve os blocos ao lugar de origem se precisar se desligar.
 */
(function () {
  'use strict';

  var CFG = window.CCXA_CFG || {};

  // Anti-flash: este arquivo roda no <head>, antes de a página ser desenhada. Escondemos a
  // área do console até a casca montar. opacity não pode ser desfeita pelos elementos internos
  // (o layout do jQuery força visibility:visible nas molduras). Se a casca não montar em 4s,
  // a área volta a aparecer do jeito original: a agente nunca fica sem tela.
  function removeAntiFlash() {
    ['ccxa-antiflash-js', 'ccxa-antiflash'].forEach(function (id) {
      var e = document.getElementById(id);
      if (e && e.parentNode) e.parentNode.removeChild(e);
    });
  }
  (function antiFlash() {
    if (document.getElementById('ccxa-antiflash-js')) return;
    var st = document.createElement('style');
    st.id = 'ccxa-antiflash-js';
    st.textContent = '#issabel-callcenter-area-principal{opacity:0!important}';
    (document.head || document.documentElement).appendChild(st);
    setTimeout(function () { if (!document.getElementById('ccxa-root')) removeAntiFlash(); }, 4000);
  })();

  // Garante o CSS da casca no <head>, independentemente de quando o conteúdo do painel
  // é escrito no corpo. Idempotente: não injeta duas vezes.
  function injectCss() {
    if (!CFG.css || document.getElementById('ccxa-css')) return;
    var l = document.createElement('link');
    l.id = 'ccxa-css'; l.rel = 'stylesheet'; l.href = CFG.css;
    document.head.appendChild(l);
  }
  injectCss();

  // Elementos do motor de que a casca depende. Se faltar um, aborta e deixa o console como está.
  var ENGINE = {
    area:      '#issabel-callcenter-area-principal',
    state:     '#issabel-callcenter-estado-agente',
    stateText: '#issabel-callcenter-estado-agente-texto',
    timer:     '#issabel-callcenter-cronometro',
    contenido: '#issabel-callcenter-contenido',       // container antigo (fica escondido)
    info:      '#issabel-callcenter-llamada-info',     // miolo da ficha (tabela de atributos)
    script:    '#issabel-callcenter-llamada-script',   // miolo do roteiro
    form:      '#issabel-callcenter-llamada-form',     // abas de Form
    btnSave:   '#btn_guardar_formularios',
    btnHangup: '#btn_hangup',
    btnHold:   '#btn_hold',
    btnBreak:  '#btn_togglebreak',
    btnLogout: '#btn_logout'
  };

  var STATE_MAP = {
    'issabel-callcenter-class-estado-ocioso':    { key: 'idle',    label: 'Disponível', sub: 'Aguardando a próxima ligação da fila' },
    'issabel-callcenter-class-estado-esperando': { key: 'ringing', label: 'Chamando',   sub: 'A fila está entregando uma ligação' },
    'issabel-callcenter-class-estado-activo':    { key: 'oncall',  label: 'Em ligação', sub: 'Ligação em andamento' },
    'issabel-callcenter-class-estado-hold':      { key: 'hold',    label: 'Em espera',  sub: 'Ligação em espera' },
    'issabel-callcenter-class-estado-break':     { key: 'break',   label: 'Em pausa',   sub: 'A fila não entrega ligações durante a pausa' }
  };

  var el = {};                 // nós que a casca cria
  var origin = {};             // onde cada bloco movido estava, para devolver se preciso
  var S = { key: 'idle', shownMode: null, sessStart: null, offset: 0 };

  function $(s, c) { return (c || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function phoneBR(n) {
    var d = String(n || '').replace(/\D/g, '');
    if (!d) return '';
    if (/^0?800/.test(d)) { d = d.replace(/^0(?=800)/, ''); return d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7); }
    if (d.length >= 12 && d.slice(0, 2) === '55') d = d.slice(2);
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return d;
  }

  // Troca o rótulo de um botão do motor preservando o elemento e seus eventos.
  function relabel(sel, text) {
    var b = $(sel);
    if (!b) return;
    var span = b.querySelector('.ui-button-text');
    if (span) span.textContent = text; else b.textContent = text;
  }

  function clickEngine(sel) {
    var b = $(sel);
    if (b && !b.disabled) { b.click(); return true; }
    return false;
  }

  function mirror(sel, target) {
    if (!target) return;
    var node = document.querySelector(sel);
    if (node) { var v = node.textContent.trim(); if (v) target.textContent = v; }
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hms(sec) {
    sec = Math.max(0, Math.floor(sec));
    return pad2(Math.floor(sec / 3600)) + ':' + pad2(Math.floor(sec % 3600 / 60)) + ':' + pad2(sec % 60);
  }
  function sessionStr() {
    if (!S.sessStart) return '';
    return hms(Date.now() / 1000 + S.offset - S.sessStart);
  }
  /* Início da sessão aberta, lido da tabela audit pelo nosso painel (action=ccxa_session). */
  function loadSession(tries) {
    if (!CFG.api) return;
    fetch(CFG.api + '&action=ccxa_session', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error('sessao');
        S.offset = j.now - Date.now() / 1000;
        S.sessStart = j.session_start || null;
        sync();
      })
      .catch(function () { if ((tries || 0) < 3) setTimeout(function () { loadSession((tries || 0) + 1); }, 5000); });
  }
  /* Ligação tocando no ramal, antes de atender (action=ccxa_ringing). Só consulta com a agente
     disponível e a aba visível; o motor assume quando a ligação conecta. */
  function ringLoop() {
    clearTimeout(S.ringTimer);
    if (!CFG.api || document.hidden) return;
    if (S.key !== 'idle') { if (S.ring) { S.ring = null; sync(); } S.ringTimer = setTimeout(ringLoop, 1500); return; }
    fetch(CFG.api + '&action=ccxa_ringing', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var was = !!S.ring;
        S.ring = (j && j.ringing && S.key === 'idle') ? j : null;
        if (S.ring) S.ringOffset = j.now - Date.now() / 1000;
        if (was || S.ring) sync();
        S.ringTimer = setTimeout(ringLoop, 1500);
      })
      .catch(function () { S.ring = null; S.ringTimer = setTimeout(ringLoop, 5000); });
  }

  // Ficha do cliente a partir dos dados da planilha. Usada na prévia e no histórico.
  function clientHtml(r) {
    var short = [], long = [];
    (r.attributes || []).forEach(function (a) { (isLong(a.value) ? long : short).push(a); });
    var name = r.name || (r.phone ? phoneBR(r.phone) || r.phone : 'Cliente');
    var phone = r.name && r.phone ? phoneBR(r.phone) || r.phone : '';
    var facts = (r.campaign ? [{ label: 'Campanha', value: r.campaign }] : []).concat(short);
    return '<section class="panel"><div class="client-head"><div class="client-name">' + esc(name) + '</div>' +
        (phone ? '<div class="client-phone">' + esc(phone) + '</div>' : '') + '</div>' +
      '<div class="card-facts">' +
        (facts.length ? '<dl class="pv-facts">' + facts.map(function (a) { return '<div><dt>' + esc(a.label) + '</dt><dd>' + esc(a.value) + '</dd></div>'; }).join('') + '</dl>' : '') +
        long.map(function (a) { return '<div class="pv-long"><div class="lbl">' + esc(a.label) + '</div><div class="txt">' + esc(a.value) + '</div></div>'; }).join('') +
        (!facts.length && !long.length ? '<p class="pv-none">Sem dados da planilha para esta ligação.</p>' : '') +
      '</div></section>';
  }
  function wireLongs(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('.pv-long'), function (box) { addMoreToggle(box, box.querySelector('.txt')); });
  }

  function renderPreview(r) {
    el.preview.innerHTML =
      '<div class="call-grid"><div class="col">' + clientHtml(r) +
        (r.script && r.script.replace(/<[^>]*>|\s/g, '') ? '<section class="panel"><h2>Roteiro</h2><div class="script-body"><div class="pv-script">' + r.script + '</div></div></section>' : '') +
      '</div>' +
      '<section class="panel ring-note"><h2>Ligação chegando</h2>' +
        '<p class="panel-sub">Atenda o telefone para conectar. O registro da ligação aparece assim que ela conectar.</p></section>' +
      '</div>';
    wireLongs(el.preview);
  }

  /* ---------- janelas de pausa e transferência ---------- */
  function openModal(html) {
    $('#ccxa-modal').innerHTML = html;
    $('#ccxa-mback').hidden = false;
    var f = $('#ccxa-modal').querySelector('input:not([disabled]), button[data-mok]'); if (f) f.focus();
  }
  function closeModal() { $('#ccxa-mback').hidden = true; $('#ccxa-modal').innerHTML = ''; }

  // A pausa "Preview" foi criada por uma versão antiga do add-on, para um modo que não existe.
  function pauseOptions() {
    return Array.prototype.map.call($('#break_select').options, function (o) { return { id: o.value, label: o.textContent.trim() }; })
      .filter(function (o) { return o.id !== '' && !/^preview\b/i.test(o.label); });
  }

  function openPause() {
    var opts = pauseOptions();
    if (!opts.length) { openModal('<h2 id="ccxa-mtitle">Entrar em pausa</h2><p class="m-sub">Nenhum tipo de pausa cadastrado. Peça ao supervisor para cadastrar em Call Center, Breaks.</p><div class="m-foot"><button type="button" class="dr-btn ghost" data-mclose>Fechar</button></div>'); return; }
    openModal('<h2 id="ccxa-mtitle">Entrar em pausa?</h2>' +
      '<p class="m-sub">Enquanto estiver em pausa, a fila não entrega ligações para você.</p>' +
      '<div class="m-list" role="radiogroup" aria-label="Tipo de pausa">' + opts.map(function (o, i) {
        var parts = o.label.split(' - '), name = parts.shift(), desc = parts.join(' - ');
        return '<label class="m-opt"><input type="radio" name="ccxa-pause" value="' + esc(o.id) + '"' + (i === 0 ? ' checked' : '') + '>' +
          '<span><b>' + esc(name) + '</b>' + (desc ? '<em>' + esc(desc) + '</em>' : '') + '</span></label>';
      }).join('') + '</div>' +
      '<div class="m-foot"><button type="button" class="dr-btn ghost" data-mclose>Cancelar</button><button type="button" class="dr-btn" data-mok>Entrar em pausa</button></div>');
    $('#ccxa-modal [data-mok]').addEventListener('click', function () {
      var sel = $('#ccxa-modal input[name="ccxa-pause"]:checked'); if (!sel) return;
      $('#break_select').value = sel.value;
      closeModal();
      window.do_break();    // o console pausa; a tela muda quando o estado chegar
    });
  }

  function openTransfer() {
    var mine = (window.CCXA_CFG && CCXA_CFG.agent_name) || '';
    var agents = Array.prototype.map.call($('#transfer_agent').options, function (o) {
      var t = o.textContent.trim(), m = t.match(/^\s*\S+\/(\S+)\s*-\s*(.+)$/);
      return { value: o.value, number: m ? m[1] : '', name: m ? m[2] : t };
    }).filter(function (a) { return a.value && /\//.test(a.value); });
    openModal('<h2 id="ccxa-mtitle">Transferir ligação</h2>' +
      '<div class="m-seg" role="tablist"><button type="button" role="tab" data-tt="agent" aria-selected="true">Para outra agente</button>' +
        '<button type="button" role="tab" data-tt="ext" aria-selected="false">Para um ramal ou número</button></div>' +
      '<div data-tp="agent"><div class="m-list" id="ccxa-tlist"><p class="m-sub">Conferindo quem está no console…</p></div></div>' +
      '<div data-tp="ext" hidden><label class="df"><span>Ramal ou número</span><input type="text" id="ccxa-text" inputmode="tel" autocomplete="off" placeholder="Ex.: 205 ou 11999998888"></label>' +
        '<p class="m-sub">A ligação vai direto para o destino, sem você falar com ele antes.</p></div>' +
      '<p class="dr-msg err" id="ccxa-terr" role="alert"></p>' +
      '<div class="m-foot"><button type="button" class="dr-btn ghost" data-mclose>Cancelar</button><button type="button" class="dr-btn" data-mok>Transferir</button></div>');
    var mode = 'agent';
    Array.prototype.forEach.call($('#ccxa-modal').querySelectorAll('[data-tt]'), function (t) {
      t.addEventListener('click', function () {
        mode = t.getAttribute('data-tt');
        Array.prototype.forEach.call($('#ccxa-modal').querySelectorAll('[data-tt]'), function (x) { x.setAttribute('aria-selected', String(x === t)); });
        Array.prototype.forEach.call($('#ccxa-modal').querySelectorAll('[data-tp]'), function (p) { p.hidden = p.getAttribute('data-tp') !== mode; });
        $('#ccxa-terr').textContent = '';
        if (mode === 'ext') $('#ccxa-text').focus();
      });
    });
    // Quem está com o console aberto pode receber; as outras aparecem, mas não dá para escolher.
    apiGet('online').then(function (j) { return j.online || []; }, function () { return null; }).then(function (online) {
      var box = $('#ccxa-tlist'); if (!box) return;
      if (!agents.length) { box.innerHTML = '<p class="m-sub">Não há outras agentes cadastradas.</p>'; return; }
      var on = function (a) { return online === null || online.indexOf(a.value) !== -1; };
      agents.sort(function (a, b) { return (on(b) - on(a)) || a.name.localeCompare(b.name, 'pt-BR'); });
      box.innerHTML = agents.map(function (a) {
        var ok = on(a);
        return '<label class="m-opt' + (ok ? '' : ' off') + '"><input type="radio" name="ccxa-tagent" value="' + esc(a.value) + '"' + (ok ? '' : ' disabled') + '>' +
          '<span><b>' + esc(a.name) + '</b><em>' + (a.number ? 'Ramal ' + esc(a.number) + ', ' : '') + (online === null ? 'situação desconhecida' : ok ? 'no console' : 'fora do console') + '</em></span>' +
          '<i class="m-dot' + (ok ? ' on' : '') + '" aria-hidden="true"></i></label>';
      }).join('') + (online && !agents.some(on) ? '<p class="m-sub">Nenhuma outra agente está no console agora.</p>' : '');
    });
    $('#ccxa-modal [data-mok]').addEventListener('click', function () {
      var err = $('#ccxa-terr');
      if (mode === 'agent') {
        var sel = $('#ccxa-modal input[name="ccxa-tagent"]:checked');
        if (!sel) { err.textContent = 'Escolha a agente que vai receber a ligação.'; return; }
        $('#transfer_type_agent').checked = true;
        $('#transfer_agent').value = sel.value;
      } else {
        var dest = $('#ccxa-text').value.replace(/[^\d*#]/g, '');
        if (!dest) { err.textContent = 'Digite o ramal ou o número de destino.'; return; }
        $('#transfer_type_blind').checked = true;
        $('#transfer_extension').value = dest;
      }
      closeModal();
      window.do_transfer();   // o console transfere
    });
  }

  /* ---------- ligações de hoje ---------- */
  function hhmm(ts) { var d = new Date(ts * 1000); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function durTxt(s) { if (s == null) return ''; s = Math.max(0, s | 0); return s < 60 ? s + 's' : Math.floor(s / 60) + 'min' + (s % 60 ? ' ' + pad2(s % 60) + 's' : ''); }
  function apiGet(action, extra) {
    return fetch(CFG.api + '&action=ccxa_' + action + (extra || ''), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || 'Erro'); return j; });
  }

  function loadHistory() {
    clearTimeout(S.histTimer);
    if (!CFG.api) return;
    apiGet('history').then(function (j) { S.hist = j.calls; renderHistory(); })
      .catch(function () { if (!S.hist) $('#ccxa-hlist').innerHTML = '<p class="h-empty">Não foi possível carregar as ligações de hoje.</p>'; })
      .then(function () { S.histTimer = setTimeout(loadHistory, 60000); });
  }

  function renderHistory() {
    var list = S.hist || [], pend = list.filter(function (c) { return c.record === 'pending' && !c.live; }).length;
    $('#ccxa-hcount').textContent = list.length ? String(list.length) : '';
    $('#ccxa-hfilter').innerHTML = [['all', 'Todas', list.length], ['pending', 'Pendentes', pend]].map(function (f) {
      return '<button type="button" data-hf="' + f[0] + '" aria-pressed="' + (S.hf === f[0]) + '">' + f[1] + '<span class="n">' + f[2] + '</span></button>';
    }).join('');
    var rows = S.hf === 'pending' ? list.filter(function (c) { return c.record === 'pending' && !c.live; }) : list;
    if (!rows.length) {
      $('#ccxa-hlist').innerHTML = '<p class="h-empty">' + (list.length ? 'Nenhum registro pendente. Tudo em dia.' : 'Nenhuma ligação atendida hoje ainda.') + '</p>';
      return;
    }
    var BADGE = { done: ['ok', 'Registrado'], pending: ['pend', 'Registro pendente'], none: ['none', 'Sem formulário'] };
    $('#ccxa-hlist').innerHTML = rows.map(function (c) {
      var b = c.live ? ['live', 'Em andamento'] : BADGE[c.record] || BADGE.none;
      var who = c.name ? '<b>' + esc(c.name) + '</b><span>' + esc(phoneBR(c.phone) || c.phone) + '</span>' : '<b>' + esc(phoneBR(c.phone) || c.phone) + '</b>';
      return '<button type="button" class="h-row" data-hid="' + c.id + '"' + (c.live ? ' disabled title="Em andamento: use o registro da ligação acima"' : '') + '>' +
        '<span class="h-time">' + hhmm(c.start) + '</span><span class="h-who">' + who + '</span>' +
        '<span class="h-camp">' + esc(c.campaign) + '</span><span class="h-dur">' + esc(durTxt(c.duration)) + '</span>' +
        '<span class="h-badge ' + b[0] + '">' + b[1] + '</span></button>';
    }).join('');
  }

  function openDetail(id) {
    var d = $('#ccxa-drawer');
    d.innerHTML = '<div class="dr-body"><p class="h-empty">Carregando…</p></div>';
    d.hidden = false; $('#ccxa-dback').hidden = false;
    apiGet('detail', '&id=' + id).then(function (j) { renderDetail(j.call); })
      .catch(function (e) { d.innerHTML = '<div class="dr-head"><h2>Ligação</h2><button type="button" class="dr-x" data-dclose aria-label="Fechar">✕</button></div><div class="dr-body"><p class="dr-err">' + esc(e.message) + '</p></div>'; });
  }
  function closeDetail() { $('#ccxa-drawer').hidden = true; $('#ccxa-dback').hidden = true; }

  function fieldHtml(fid, f, val) {
    var v = val == null ? '' : String(val), name = 'f-' + fid + '-' + f.id;
    if (f.type === 'LABEL') return '<div class="df-label">' + esc(f.label) + '</div>';
    var ctl;
    if (f.type === 'LIST') {
      var opts = f.options.slice(); if (v && opts.indexOf(v) === -1) opts.unshift(v);
      ctl = '<select name="' + name + '"><option value="">Escolha</option>' + opts.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    } else if (f.type === 'TEXTAREA') {
      ctl = '<textarea name="' + name + '" maxlength="250" rows="4">' + esc(v) + '</textarea><small class="df-count">' + v.length + '/250</small>';
    } else if (f.type === 'DATE') {
      ctl = '<input type="date" name="' + name + '" value="' + esc(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '') + '">';
    } else {
      ctl = '<input type="text" name="' + name + '" maxlength="250" value="' + esc(v) + '">';
    }
    return '<label class="df"><span>' + esc(f.label) + '</span>' + ctl + '</label>';
  }

  function renderDetail(c) {
    var d = $('#ccxa-drawer');
    var forms = c.forms || [];
    var formsHtml = forms.length ? forms.map(function (f) {
      return (forms.length > 1 ? '<h3>' + esc(f.name) + '</h3>' : '') + f.fields.map(function (x) { return fieldHtml(f.id, x, c.values[x.id]); }).join('');
    }).join('') : '<p class="h-empty">Esta campanha não tem formulário.</p>';
    d.innerHTML =
      '<div class="dr-head"><div><h2>Ligação das ' + hhmm(c.start) + '</h2><p>' + esc(c.campaign) + (c.duration != null ? ', ' + esc(durTxt(c.duration)) : '') + '</p></div>' +
        '<button type="button" class="dr-x" data-dclose aria-label="Fechar">✕</button></div>' +
      '<form class="dr-body" id="ccxa-dform" novalidate>' + clientHtml(c) +
        (c.script && c.script.replace(/<[^>]*>|\s/g, '') ? '<details class="dr-script"><summary>Roteiro da campanha</summary><div class="pv-script">' + c.script + '</div></details>' : '') +
        '<section class="panel dr-form"><h2>Registro da ligação</h2><div class="dr-fields">' + formsHtml + '</div>' +
          '<p class="dr-msg" id="ccxa-dmsg" role="status" aria-live="polite"></p></section>' +
      '</form>' +
      (forms.length ? '<div class="dr-foot"><button type="button" class="dr-btn ghost" data-dclose>Fechar</button><button type="button" class="dr-btn" id="ccxa-dsave">Salvar registro</button></div>' : '');
    wireLongs(d);
    Array.prototype.forEach.call(d.querySelectorAll('textarea[maxlength]'), function (t) {
      t.addEventListener('input', function () { var c2 = t.parentNode.querySelector('.df-count'); if (c2) c2.textContent = t.value.length + '/250'; });
    });
    var sv = $('#ccxa-dsave');
    if (sv) sv.addEventListener('click', function () { saveDetail(c, sv); });
  }

  function saveDetail(c, btn) {
    var data = {}, f = $('#ccxa-dform');
    Array.prototype.forEach.call(f.querySelectorAll('[name^="f-"]'), function (x) {
      var m = x.name.match(/^f-(\d+)-(\d+)$/); if (!m) return;
      (data[m[1]] = data[m[1]] || {})[m[2]] = x.value;
    });
    var msg = $('#ccxa-dmsg');
    btn.disabled = true; btn.textContent = 'Salvando…'; msg.className = 'dr-msg'; msg.textContent = '';
    var body = new URLSearchParams(); body.set('id', c.id); body.set('data', JSON.stringify(data));
    fetch(CFG.api + '&action=ccxa_record', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CCX-Token': CFG.token || '', Accept: 'application/json' }, body: body.toString() })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || 'Não foi possível salvar.');
        msg.className = 'dr-msg ok'; msg.textContent = 'Registro salvo.';
        loadHistory();
        setTimeout(closeDetail, 700);
      })
      .catch(function (e) { msg.className = 'dr-msg err'; msg.textContent = e.message; })
      .then(function () { btn.disabled = false; btn.textContent = 'Salvar registro'; });
  }

  function isZero(s) { return !s || /^0?0:00:00$/.test(s.trim()); }

  function currentState() {
    var node = $(ENGINE.state);
    if (node) for (var cls in STATE_MAP) if (node.classList.contains(cls)) return STATE_MAP[cls];
    return STATE_MAP['issabel-callcenter-class-estado-ocioso'];
  }

  /* Lê o telefone e o nome da ficha nativa (Information), sem depender da ordem dos campos. */
  function readCard() {
    var c = $(ENGINE.info);
    var out = { phone: '', name: '' };
    if (!c) return out;
    var rows = c.querySelectorAll('tr');
    rows.forEach(function (tr) {
      var cells = tr.querySelectorAll('td, th');
      if (cells.length < 2) return;
      var label = cells[0].textContent.replace(/\s+/g, ' ').replace(/:$/, '').trim().toLowerCase();
      var val = cells[1].textContent.trim();
      var kind = tr.getAttribute('data-ccxa');
      if (kind === 'phone' && !out.phone) { out.phone = val; return; }
      if (kind === 'name' && !out.name) { out.name = val; return; }
      if (kind) return;
      if (/phone|tel[eé]fono|n[uú]mero/.test(label) && !out.phone) out.phone = val;
      if (/^name|nombre|nome/.test(label) && !out.name) out.name = val;
    });
    return out;
  }

  /* Marca cada linha da ficha pelo rótulo (o motor recria a tabela a cada ligação),
     para o CSS destacar nome/telefone no cabeçalho e rebaixar o ID interno. */
  function tagCardRows() {
    var c = $(ENGINE.info);
    if (!c) return;
    c.querySelectorAll('tr').forEach(function (tr) {
      var cell = tr.querySelector('td, th');
      if (!cell || tr.hasAttribute('data-ccxa')) return;
      var label = cell.textContent.replace(/\s+/g, ' ').replace(/:\s*$/, '').trim().toLowerCase();
      var kind = /call id|id de llamada|internal|id interno/.test(label) ? 'callid'
               : /campa/.test(label) ? 'campaign'
               : /phone|tel[eé]fon/.test(label) ? 'phone'
               : /^name|nombre|nome/.test(label) ? 'name'
               : 'attr';
      tr.setAttribute('data-ccxa', kind);
      if (kind === 'attr') {
        var vcell = tr.querySelector('td:last-child');
        if (vcell && vcell !== cell && isLong(vcell.textContent)) { tr.setAttribute('data-long', '1'); addMoreToggle(tr, vcell); }
      }
      var PT = { campaign: 'Campanha', callid: 'ID interno da ligação', phone: 'Telefone', name: 'Nome' };
      var lab = cell.querySelector('label') || cell;
      var txt = PT[kind] || lab.textContent.replace(/:\s*$/, '').trim();
      if (lab.textContent !== txt) lab.textContent = txt;
    });
    // rótulos do formulário sem os dois-pontos (só exibição; o motor lê os campos pelo id)
    var f = $(ENGINE.form);
    if (f) f.querySelectorAll('td > label').forEach(function (l) {
      var t = l.textContent.replace(/:\s*$/, '').trim();
      if (l.textContent !== t) l.textContent = t;
    });
  }

  /* Texto longo (ex.: uma coluna "Contexto"): sai da grade e vira um bloco de leitura. */
  function isLong(t) { t = String(t || '').trim(); return t.length > 90 || /\n/.test(t); }
  // Mostra "Mostrar tudo" só quando o texto passa das linhas visíveis.
  function addMoreToggle(holder, box) {
    requestAnimationFrame(function () {
      if (box.scrollHeight <= box.clientHeight + 2 || holder.querySelector('.ccxa-more')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ccxa-more'; b.textContent = 'Mostrar tudo';
      b.addEventListener('click', function () {
        var open = holder.classList.toggle('open');
        b.textContent = open ? 'Mostrar menos' : 'Mostrar tudo';
      });
      holder.appendChild(b);
    });
  }

  function hasScript() {
    var s = $(ENGINE.script);
    return !!(s && s.textContent.replace(/\s+/g, '').length);
  }

  function boot() {
    // Este arquivo é injetado no <head>; a configuração é escrita no corpo da página,
    // depois dele. Por isso relemos aqui, quando a página já está montada.
    CFG = window.CCXA_CFG || CFG;
    injectCss();
    for (var k in ENGINE) {
      if (!$(ENGINE[k])) return; // estrutura inesperada: não mexe em nada
    }
    if (!buildShell()) return;
    document.body.classList.add('ccxa-on');
    removeAntiFlash();

    var mo = new MutationObserver(sync);
    mo.observe($(ENGINE.state), { attributes: true, attributeFilter: ['class'] });
    mo.observe($(ENGINE.stateText), { childList: true, characterData: true, subtree: true });
    mo.observe($(ENGINE.timer), { childList: true, characterData: true, subtree: true });
    mo.observe($(ENGINE.info), { childList: true, subtree: true, characterData: true });
    mo.observe($(ENGINE.script), { childList: true, subtree: true, characterData: true });
    mo.observe($(ENGINE.form), { childList: true });
    ['#shift-stat-login', '#shift-stat-break', '#shift-stat-hold'].forEach(function (sel) {
      var node = $(sel);
      if (node) mo.observe(node, { childList: true, characterData: true, subtree: true });
    });
    sync();
    loadSession(0);
    ringLoop();
    loadHistory();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) ringLoop(); });
    setInterval(function () { if (S.sessStart || S.ring) sync(); }, 1000);
  }

  /* Move um bloco do motor para dentro de um destino nosso, lembrando de onde veio. */
  function adopt(key, engineSel, destination) {
    var node = $(engineSel);
    if (!node || !destination) return;
    origin[key] = { parent: node.parentNode, next: node.nextSibling };
    destination.appendChild(node);
  }
  function restoreAll() {
    for (var key in origin) {
      var node = $(ENGINE[key]);
      var o = origin[key];
      if (node && o && o.parent) o.parent.insertBefore(node, o.next);
    }
  }

  function buildShell() {
    var area = $(ENGINE.area);
    if (!area) return false;
    var root = document.createElement('div');
    root.className = 'ccxa';
    root.id = 'ccxa-root';
    root.innerHTML =
      '<div class="top"><h1>' + esc(CFG.title || 'Console do agente') + '</h1>' +
        '<span class="sub">' + esc(CFG.agent_name || '') + '</span></div>' +
      '<div class="bar" id="ccxa-bar">' +
        '<div class="bar-state"><b id="ccxa-label">-</b><span id="ccxa-sub"></span></div>' +
        '<div class="bar-clock">' +
          '<div class="bar-timer" id="ccxa-timer">00:00:00</div>' +
          '<div class="bar-total"><span class="bar-total-lbl">Total da sessão</span><span class="bar-total-val" id="ccxa-total">00:00:00</span></div>' +
        '</div>' +
        '<div class="bar-who" id="ccxa-who" hidden></div>' +
      '</div>' +
      '<div class="stage">' +
        '<div id="ccxa-callcard">' +
          '<div class="call-grid">' +
            '<div class="col">' +
              '<section class="panel">' +
                '<div class="client-head"><div class="client-name" id="ccxa-cname">Cliente</div>' +
                  '<div class="client-phone" id="ccxa-cphone"></div></div>' +
                '<div class="card-facts" id="ccxa-cardhost"></div>' +
              '</section>' +
              '<section class="panel" id="ccxa-scriptpanel"><h2>Roteiro</h2>' +
                '<div class="script-body" id="ccxa-scripthost"></div></section>' +
            '</div>' +
            '<section class="panel form-panel"><h2>Registro da ligação</h2>' +
              '<p class="panel-sub">Preencha e salve antes de encerrar o atendimento.</p>' +
              '<div class="form-body" id="ccxa-formslot"></div>' +
              '<div class="form-actions" id="ccxa-savehost"></div>' +
            '</section>' +
          '</div>' +
          '<div class="actions" id="ccxa-actions">' +
            '<span class="act-host danger" id="ccxa-host-hangup"></span>' +
            '<span class="act-host" id="ccxa-host-hold"></span>' +
            '<span class="act-host" id="ccxa-host-transfer"></span>' +
          '</div>' +
        '</div>' +
        '<div id="ccxa-preview" hidden></div>' +
        '<div class="idle-card" id="ccxa-idle" hidden></div>' +
      '</div>' +
      '<div class="session">' +
        '<span class="shift sess" title="Desde o último login no console"><span class="dot" style="background:var(--brand)"></span><span class="lbl">Sessão atual</span> <span class="val" id="ccxa-sh-sess">--:--:--</span></span>' +
        '<span class="shift login" title="Soma de todas as sessões de hoje (inclui pausas e ligações)"><span class="dot"></span><span class="lbl">Total do dia</span> <span class="val" id="ccxa-sh-login">00:00:00</span></span>' +
        '<span class="shift break" title="Tempo total em pausa"><span class="dot"></span><span class="lbl">Pausa</span> <span class="val" id="ccxa-sh-break">00:00:00</span></span>' +
        '<span class="shift hold" title="Tempo total em espera"><span class="dot"></span><span class="lbl">Espera</span> <span class="val" id="ccxa-sh-hold">00:00:00</span></span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn-break" id="ccxa-break">Pausa</button>' +
        '<button type="button" class="btn-logout" id="ccxa-logout">Encerrar sessão</button>' +
      '</div>' +
      '<section class="panel hist" aria-labelledby="ccxa-htitle">' +
        '<div class="h-head"><h2 id="ccxa-htitle">Ligações de hoje <span id="ccxa-hcount"></span></h2>' +
          '<div class="h-seg" id="ccxa-hfilter" role="group" aria-label="Filtrar ligações"></div></div>' +
        '<p class="panel-sub">Clique numa ligação para ver a ficha e completar o registro, mesmo depois que o cliente desligou.</p>' +
        '<div class="h-list" id="ccxa-hlist"><p class="h-empty">Carregando…</p></div>' +
      '</section>' +
      '<div class="ccxa-mback" id="ccxa-mback" hidden><div class="ccxa-modal" id="ccxa-modal" role="dialog" aria-modal="true" aria-labelledby="ccxa-mtitle"></div></div>' +
      '<div class="ccxa-dback" id="ccxa-dback" hidden></div>' +
      '<aside class="ccxa-drawer" id="ccxa-drawer" hidden role="dialog" aria-modal="true" aria-label="Ligação"></aside>';
    area.appendChild(root);
    S.hf = 'all';
    $('#ccxa-hfilter').addEventListener('click', function (e) { var b = e.target.closest('[data-hf]'); if (b) { S.hf = b.getAttribute('data-hf'); renderHistory(); } });
    $('#ccxa-hlist').addEventListener('click', function (e) { var b = e.target.closest('[data-hid]'); if (b && !b.disabled) openDetail(parseInt(b.getAttribute('data-hid'), 10)); });
    $('#ccxa-dback').addEventListener('click', closeDetail);
    $('#ccxa-drawer').addEventListener('click', function (e) { if (e.target.closest('[data-dclose]')) closeDetail(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#ccxa-drawer').hidden) closeDetail(); });

    el.bar = $('#ccxa-bar'); el.label = $('#ccxa-label'); el.sub = $('#ccxa-sub');
    el.timer = $('#ccxa-timer'); el.total = $('#ccxa-total'); el.who = $('#ccxa-who');
    el.callcard = $('#ccxa-callcard'); el.idle = $('#ccxa-idle');
    el.actions = $('#ccxa-actions'); el.break = $('#ccxa-break'); el.logout = $('#ccxa-logout');
    el.preview = $('#ccxa-preview');
    el.shSess = $('#ccxa-sh-sess'); el.shLogin = $('#ccxa-sh-login'); el.shBreak = $('#ccxa-sh-break'); el.shHold = $('#ccxa-sh-hold');

    // Move os blocos nativos para dentro do layout. Feito uma vez; o motor segue atualizando o conteudo.
    adopt('info',      ENGINE.info,      $('#ccxa-cardhost'));
    adopt('script',    ENGINE.script,    $('#ccxa-scripthost'));
    adopt('form',      ENGINE.form,      $('#ccxa-formslot'));
    adopt('btnSave',   ENGINE.btnSave,   $('#ccxa-savehost'));

    // Adota os botões reais do motor: quem a agente clica É o botão do console, então
    // o clique é o nativo (não reencaminhado). Só damos a eles a nossa aparência.
    adopt('btnHangup',   ENGINE.btnHangup, $('#ccxa-host-hangup'));
    adopt('btnHold',     ENGINE.btnHold,   $('#ccxa-host-hold'));
    adopt('btnTransfer', '#btn_transfer',  $('#ccxa-host-transfer'));
    relabel(ENGINE.btnHangup, 'Desligar');
    relabel(ENGINE.btnHold, 'Colocar em espera');
    relabel('#btn_transfer', 'Transferir');
    relabel(ENGINE.btnSave, 'Salvar registro');
    el.break.addEventListener('click', function () {
      if (S.key === 'break' || !window.do_break || !$('#break_select')) { clickEngine(ENGINE.btnBreak); return; }
      openPause();
    });
    // Transferência: intercepta o clique antes de chegar ao botão do console (fase de captura no
    // contêiner), para abrir a nossa janela em vez da antiga. Quem transfere continua sendo o console.
    var thost = $('#ccxa-host-transfer');
    if (thost) thost.addEventListener('click', function (e) {
      if (!window.do_transfer || !$('#transfer_agent')) return;   // estrutura inesperada: deixa a antiga
      e.preventDefault(); e.stopPropagation();
      var b = $('#btn_transfer'); if (b && b.disabled) return;
      openTransfer();
    }, true);
    $('#ccxa-mback').addEventListener('click', function (e) { if (e.target === this || e.target.closest('[data-mclose]')) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#ccxa-mback').hidden) closeModal(); });
    el.logout.addEventListener('click', function () {
      if (confirm('Encerrar a sessão do console?')) clickEngine(ENGINE.btnLogout);
    });
    return true;
  }

  function sync() {
    var info = currentState();
    // Ligação acabou de terminar: atualiza o histórico (o discador grava o fim logo depois).
    var wasCall = S.key === 'oncall' || S.key === 'hold' || S.key === 'ringing';
    if (wasCall && info.key !== 'oncall' && info.key !== 'hold' && info.key !== 'ringing') setTimeout(loadHistory, 2000);
    if (!wasCall && info.key === 'oncall') setTimeout(loadHistory, 2000);
    S.key = info.key;
    el.bar.className = 'bar st-' + info.key;
    el.label.textContent = info.label;
    el.sub.textContent = info.sub;
    // Espelha os medidores de jornada do motor (login/pausa/espera).
    mirror('#shift-stat-login', el.shLogin);
    mirror('#shift-stat-break', el.shBreak);
    mirror('#shift-stat-hold', el.shHold);
    if (el.shBreak) el.shBreak.parentNode.classList.toggle('zero', isZero(el.shBreak.textContent));
    if (el.shHold) el.shHold.parentNode.classList.toggle('zero', isZero(el.shHold.textContent));

    // Cronometro da barra reflete o TEMPO NO ESTADO ATUAL:
    //  - em pausa: tempo total em pausa (mesmo do medidor Pausa);
    //  - em ligacao/espera: cronometro da ligacao atual;
    //  - disponivel: tempo total de sessao (nao ha "tempo disponivel" confiavel no motor).
    var callStr = $(ENGINE.timer) ? $(ENGINE.timer).textContent.trim() : '';
    var loginStr = el.shLogin ? el.shLogin.textContent.trim() : '';
    var breakStr = el.shBreak ? el.shBreak.textContent.trim() : '';
    var barTime;
    if (info.key === 'break') barTime = breakStr;
    else if (info.key === 'oncall' || info.key === 'hold' || info.key === 'ringing') barTime = (callStr && callStr !== '00:00:00') ? callStr : loginStr;
    else barTime = sessionStr() || loginStr;
    el.timer.textContent = barTime || callStr || '00:00:00';
    var sess = sessionStr();
    if (el.shSess) el.shSess.textContent = sess || '--:--:--';
    var totalLbl = el.total ? el.total.parentNode.querySelector('.bar-total-lbl') : null;
    if (el.total) el.total.textContent = sess || loginStr || '00:00:00';
    if (totalLbl) totalLbl.textContent = sess ? 'Sessão atual' : 'Total do dia';
    // esconde o "Total" quando a barra ja esta mostrando o proprio total (estado disponivel)
    var barShowsTotal = (info.key !== 'break' && info.key !== 'oncall' && info.key !== 'hold' && info.key !== 'ringing');
    var totalBox = el.total ? el.total.parentNode : null;
    if (totalBox) totalBox.style.display = barShowsTotal ? 'none' : 'flex';

    var card = readCard();
    tagCardRows();
    var cname = $('#ccxa-cname'), cphone = $('#ccxa-cphone');
    if (cname) cname.textContent = card.name || (card.phone ? (phoneBR(card.phone) || card.phone) : 'Cliente');
    if (cphone) cphone.textContent = card.name && card.phone ? (phoneBR(card.phone) || card.phone) : '';
    var sp = $('#ccxa-scriptpanel');
    if (sp) sp.hidden = !hasScript();
    var hasCall = (info.key === 'oncall' || info.key === 'hold' || info.key === 'ringing');
    var ring = (!hasCall && info.key === 'idle') ? S.ring : null;
    if (ring) {
      el.bar.className = 'bar st-ringing';
      el.label.textContent = 'Ligação chegando';
      el.sub.textContent = ring.campaign ? 'Campanha ' + ring.campaign + '. Atenda o telefone para conectar.' : 'Atenda o telefone para conectar.';
      el.timer.textContent = hms(Date.now() / 1000 + (S.ringOffset || 0) - ring.since);
      if (totalBox) totalBox.style.display = 'flex';
    }
    if (ring) {
      el.who.hidden = false;
      el.who.innerHTML = (ring.name ? '<b>' + esc(ring.name) + '</b>' : '') + (ring.phone ? '<span>' + esc(phoneBR(ring.phone) || ring.phone) + '</span>' : '');
    } else if (hasCall && (card.phone || card.name)) {
      el.who.hidden = false;
      el.who.innerHTML = (card.name ? '<b>' + esc(card.name) + '</b>' : '') +
        (card.phone ? '<span>' + esc(phoneBR(card.phone) || card.phone) + '</span>' : '');
    } else {
      el.who.hidden = true;
    }

    var hold = $(ENGINE.btnHold);
    if (hold) {
      hold.classList.toggle('ccxa-on-hold', info.key === 'hold');
      relabel(ENGINE.btnHold, info.key === 'hold' ? 'Retomar' : 'Colocar em espera');
    }
    el.break.classList.toggle('on', info.key === 'break');
    el.break.textContent = info.key === 'break' ? 'Sair da pausa' : 'Pausa';

    var mode = hasCall ? 'call' : (ring ? 'ring' : (info.key === 'break' ? 'break' : 'idle'));
    var ringSig = ring ? (ring.call_id || '') + '|' + ring.phone : '';
    if (mode !== S.shownMode || ringSig !== S.ringSig) {
      S.shownMode = mode; S.ringSig = ringSig;
      el.preview.hidden = mode !== 'ring';
      if (mode === 'call') {
        el.callcard.hidden = false; el.idle.hidden = true;
      } else if (mode === 'ring') {
        el.callcard.hidden = true; el.idle.hidden = true;
        renderPreview(ring);
      } else {
        el.callcard.hidden = true; el.idle.hidden = false;
        el.idle.className = 'idle-card' + (mode === 'break' ? ' paused' : '');
        el.idle.innerHTML = mode === 'break'
          ? '<div class="big">Em pausa</div><p>A fila não vai entregar ligações enquanto você estiver em pausa.</p>'
          : '<div class="big">Disponível</div><p>Assim que a fila entregar uma ligação, os dados do cliente aparecem aqui.</p>';
      }
    }
  }

  /* Espera o motor estar com a sessao ativa montada (area principal + botoes existem). */
  function ready() {
    var tries = 0;
    function attempt() { return $(ENGINE.area) && $(ENGINE.btnHangup) && $(ENGINE.info); }
    if (attempt()) { boot(); return; }
    var iv = setInterval(function () {
      if (attempt()) { clearInterval(iv); boot(); }
      else if (++tries > 300) { clearInterval(iv); removeAntiFlash(); } // ~30s: desiste e mostra o original
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
