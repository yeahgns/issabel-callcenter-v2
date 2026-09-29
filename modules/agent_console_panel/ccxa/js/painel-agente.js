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

  // Garante o CSS da casca no <head>, independentemente de quando o conteúdo do painel
  // é escrito no corpo. Idempotente: não injeta duas vezes.
  (function injectCss() {
    if (!CFG.css || document.getElementById('ccxa-css')) return;
    var l = document.createElement('link');
    l.id = 'ccxa-css'; l.rel = 'stylesheet'; l.href = CFG.css;
    document.head.appendChild(l);
  })();

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
  var S = { key: 'idle', shownMode: null };

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

  function hasScript() {
    var s = $(ENGINE.script);
    return !!(s && s.textContent.replace(/\s+/g, '').length);
  }

  function boot() {
    for (var k in ENGINE) {
      if (!$(ENGINE[k])) return; // estrutura inesperada: não mexe em nada
    }
    if (!buildShell()) return;
    document.body.classList.add('ccxa-on');

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
        '<div class="idle-card" id="ccxa-idle" hidden></div>' +
      '</div>' +
      '<div class="session">' +
        '<span class="shift login" title="Tempo total de sessão (inclui pausa e ligações)"><span class="dot"></span><span class="lbl">Total</span> <span class="val" id="ccxa-sh-login">00:00:00</span></span>' +
        '<span class="shift break" title="Tempo total em pausa"><span class="dot"></span><span class="lbl">Pausa</span> <span class="val" id="ccxa-sh-break">00:00:00</span></span>' +
        '<span class="shift hold" title="Tempo total em espera"><span class="dot"></span><span class="lbl">Espera</span> <span class="val" id="ccxa-sh-hold">00:00:00</span></span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn-break" id="ccxa-break">Pausa</button>' +
        '<button type="button" class="btn-logout" id="ccxa-logout">Encerrar sessão</button>' +
      '</div>';
    area.appendChild(root);

    el.bar = $('#ccxa-bar'); el.label = $('#ccxa-label'); el.sub = $('#ccxa-sub');
    el.timer = $('#ccxa-timer'); el.total = $('#ccxa-total'); el.who = $('#ccxa-who');
    el.callcard = $('#ccxa-callcard'); el.idle = $('#ccxa-idle');
    el.actions = $('#ccxa-actions'); el.break = $('#ccxa-break'); el.logout = $('#ccxa-logout');
    el.shLogin = $('#ccxa-sh-login'); el.shBreak = $('#ccxa-sh-break'); el.shHold = $('#ccxa-sh-hold');

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
    el.break.addEventListener('click', function () { clickEngine(ENGINE.btnBreak); });
    el.logout.addEventListener('click', function () {
      if (confirm('Encerrar a sessão do console?')) clickEngine(ENGINE.btnLogout);
    });
    return true;
  }

  function sync() {
    var info = currentState();
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
    else barTime = loginStr;
    el.timer.textContent = barTime || callStr || '00:00:00';
    if (el.total) el.total.textContent = loginStr || '00:00:00';
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
    if (hasCall && (card.phone || card.name)) {
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

    var mode = hasCall ? 'call' : (info.key === 'break' ? 'break' : 'idle');
    if (mode !== S.shownMode) {
      S.shownMode = mode;
      if (mode === 'call') {
        el.callcard.hidden = false; el.idle.hidden = true;
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
    var iv = setInterval(function () {
      if ($(ENGINE.area) && $(ENGINE.btnHangup) && $(ENGINE.info)) { clearInterval(iv); boot(); }
      else if (++tries > 60) clearInterval(iv); // ~30s; senao desiste e deixa o console original
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
