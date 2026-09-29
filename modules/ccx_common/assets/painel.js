/* Issabel Call Center Plus - painel do call center. Sem dependências. */
(function () {
  'use strict';

  var root = document.getElementById('ccx-painel');
  if (!root || root.getAttribute('data-ready')) return;
  root.setAttribute('data-ready', '1');

  var API = root.getAttribute('data-api');
  var POLL_MS = Math.max(3, parseInt(root.getAttribute('data-poll'), 10) || 5) * 1000;
  var DEMO = root.getAttribute('data-demo') === '1';
  var LONG_PAUSE = 15 * 60;

  var S = {
    data: null, offset: 0, lastOk: 0, error: null,
    filter: 'all', q: '', live: true, timer: null, busy: false
  };

  var STATE = {
    free:    { label: 'Disponível', order: 1 },
    oncall:  { label: 'Em ligação', order: 0 },
    paused:  { label: 'Em pausa',   order: 2 },
    offline: { label: 'Offline',    order: 3 }
  };

  /* ---------- utilidades (mesmas regras do relatório de ligações) ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nf(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function phone(n) {
    var d = String(n || '').replace(/\D/g, '');
    if (!d) return 'Número oculto';
    if (/^0?800/.test(d)) { d = d.replace(/^0(?=800)/, ''); return d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7); }
    if (d.length >= 12 && d.slice(0, 2) === '55') d = d.slice(2);
    if (d.length === 13 && d[0] === '0') d = d.slice(3);
    else if ((d.length === 12 || d.length === 11) && d[0] === '0') d = d.slice(1);
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    if (d.length === 9) return d.slice(0, 5) + '-' + d.slice(5);
    if (d.length === 8) return d.slice(0, 4) + '-' + d.slice(4);
    return d;
  }
  function clock(s) {
    s = Math.max(0, Math.floor(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? h + ':' + pad(m) + ':' + pad(r) : m + ':' + pad(r);
  }
  function dur(s) {
    s = Math.max(0, Math.round(s || 0));
    if (s < 60) return s + 's';
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + 'h ' + pad(m) + 'min' : m + 'min';
  }
  function hm(ts) { var d = new Date(ts * 1000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function nowSrv() { return Date.now() / 1000 + S.offset; }
  function pct(a, b) { return b > 0 ? Math.round((a / b) * 1000) / 10 : 0; }
  function pctTxt(v) { return String(v).replace('.', ',') + '%'; }
  function plural(n, one, many) { return nf(n) + ' ' + (n === 1 ? one : many); }
  /* Cronômetro que o tick() atualiza a cada segundo. */
  function since(ts, cls) {
    if (!ts) return '';
    return '<span class="' + (cls || 't') + '" data-since="' + ts + '">' + clock(nowSrv() - ts) + '</span>';
  }

  /* ---------- estrutura fixa (não é redesenhada a cada ciclo) ---------- */
  root.innerHTML =
    '<header class="topbar">' +
      '<div class="brand"><h1>Painel do call center</h1><p id="ccx-sub">Carregando…</p></div>' +
      '<div class="top-actions">' +
        '<label class="live" title="Atualiza a cada ' + (POLL_MS / 1000) + ' segundos">' +
          '<input type="checkbox" id="ccx-live" checked><span class="live-dot" aria-hidden="true"></span><span>Ao vivo</span></label>' +
        '<button type="button" class="btn ghost" id="ccx-full">Tela cheia</button>' +
      '</div>' +
    '</header>' +
    '<main>' +
      '<div id="ccx-notices"></div>' +
      '<section class="overview" id="ccx-overview" aria-label="Resumo agora"><div class="loading">Lendo o estado do call center…</div></section>' +
      '<div class="board">' +
        '<section aria-labelledby="ccx-h-agents">' +
          '<div class="section-head">' +
            '<h2 id="ccx-h-agents">Agentes<span id="ccx-agent-count"></span></h2>' +
            '<div class="seg" id="ccx-filter" role="group" aria-label="Filtrar agentes"></div>' +
            '<div class="search"><label class="sr-only" for="ccx-q">Buscar agente</label>' +
              '<input type="search" id="ccx-q" placeholder="Nome ou ramal" autocomplete="off"></div>' +
          '</div>' +
          '<div class="panel" id="ccx-agents"></div>' +
        '</section>' +
        '<section aria-labelledby="ccx-h-queues">' +
          '<div class="section-head"><h2 id="ccx-h-queues">Filas</h2></div>' +
          '<div class="queues" id="ccx-queues"></div>' +
        '</section>' +
      '</div>' +
      '<section class="campaigns" aria-labelledby="ccx-h-camp">' +
        '<div class="section-head"><h2 id="ccx-h-camp">Campanhas de saída</h2></div>' +
        '<div class="panel" id="ccx-campaigns"></div>' +
      '</section>' +
    '</main>';

  var $ = function (id) { return document.getElementById(id); };

  $('ccx-q').addEventListener('input', function () { S.q = this.value.trim().toLowerCase(); renderAgents(); });
  $('ccx-filter').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]');
    if (!b) return;
    S.filter = b.getAttribute('data-f');
    renderAgents();
  });
  $('ccx-live').addEventListener('change', function () {
    S.live = this.checked;
    if (S.live) poll(); else clearTimeout(S.timer);
    renderSub();
  });
  $('ccx-full').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (root.requestFullscreen) root.requestFullscreen();
  });
  document.addEventListener('fullscreenchange', function () {
    $('ccx-full').textContent = document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia';
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && S.live) poll();
  });
  root.addEventListener('click', function (e) {
    if (e.target.closest('[data-retry]')) poll();
  });

  /* ---------- dados ---------- */
  function fetchSnapshot() {
    if (DEMO && window.CCX_DEMO) return Promise.resolve(window.CCX_DEMO.snapshot());
    return fetch(API, { credentials: 'same-origin', cache: 'no-store', headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        var ct = r.headers.get('Content-Type') || '';
        if (ct.indexOf('json') === -1) {
          // O Issabel devolve a tela de login quando a sessão expira.
          throw new Error('session');
        }
        return r.json().then(function (j) {
          if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
          return j;
        });
      });
  }

  function poll() {
    clearTimeout(S.timer);
    if (S.busy) return;
    S.busy = true;
    fetchSnapshot().then(function (d) {
      S.data = d;
      S.offset = d.now - Date.now() / 1000;
      S.lastOk = Date.now();
      S.error = null;
      render();
    }).catch(function (e) {
      S.error = e && e.message === 'session' ? 'session' : (e && e.message) || 'erro';
      renderNotices();
      renderSub();
    }).then(function () {
      S.busy = false;
      if (S.live && !document.hidden && S.error !== 'session') S.timer = setTimeout(poll, POLL_MS);
    });
  }

  /* ---------- desenho ---------- */
  function render() {
    renderSub();
    renderNotices();
    renderOverview();
    renderAgents();
    renderQueues();
    renderCampaigns();
  }

  function renderSub() {
    var d = S.data, parts = [];
    var company = root.getAttribute('data-company') || (d && d.company) || '';
    if (company) parts.push(esc(company));
    if (!S.lastOk) { $('ccx-sub').innerHTML = parts.concat(['Carregando…']).join(', '); return; }
    var age = Math.round((Date.now() - S.lastOk) / 1000);
    var stale = age > POLL_MS / 1000 * 3;
    var txt = !S.live ? 'atualização pausada' : (age < 3 ? 'atualizado agora' : 'atualizado há ' + dur(age));
    parts.push(stale && S.live ? '<span class="stale">' + txt + '</span>' : txt);
    $('ccx-sub').innerHTML = parts.join(', ');
  }

  function renderNotices() {
    var h = '', d = S.data;
    if (S.error === 'session') {
      h += '<div class="notice error" role="alert"><p>Sua sessão do Issabel expirou. Recarregue a página para entrar de novo.</p></div>';
    } else if (S.error) {
      h += '<div class="notice error" role="alert"><p>Não foi possível atualizar o painel: ' + esc(S.error) +
        (S.lastOk ? '. Os números abaixo são da última leitura.' : '.') + '</p>' +
        '<button type="button" class="btn" data-retry>Tentar de novo</button></div>';
    }
    if (d && d.source === 'demo') {
      h += '<div class="notice demo"><p>Modo demonstração: agentes, filas e campanhas são fictícios.</p></div>';
    }
    if (d && d.warnings && d.warnings.length) {
      h += '<div class="notice"><div class="grow"><p>Parte do painel não carregou:</p><ul>' +
        d.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div></div>';
    }
    $('ccx-notices').innerHTML = h;
  }

  function counts(agents) {
    var c = { free: 0, oncall: 0, paused: 0, offline: 0 };
    agents.forEach(function (a) { c[a.status] = (c[a.status] || 0) + 1; });
    return c;
  }

  function renderOverview() {
    var d = S.data, c = counts(d.agents), online = c.free + c.oncall + c.paused;
    var waiting = [], answered = 0, abandoned = 0, hasToday = false;
    d.queues.forEach(function (q) {
      q.waiting.forEach(function (w) { waiting.push(w); });
      if (q.today) { hasToday = true; answered += q.today.answered; abandoned += q.today.abandoned; }
    });
    var oldest = waiting.reduce(function (m, w) { return w.since && (!m || w.since < m) ? w.since : m; }, null);
    var late = oldest && nowSrv() - oldest > d.service_level;
    var total = c.free + c.oncall + c.paused + c.offline;

    var h = '<dl class="metrics">' +
      '<div class="metric"><dt>Disponíveis</dt><dd>' + nf(c.free) + '<small>de ' + nf(online) + ' online</small></dd></div>' +
      '<div class="metric"><dt>Em ligação</dt><dd>' + nf(c.oncall) + '</dd></div>' +
      '<div class="metric"><dt>Em pausa</dt><dd>' + nf(c.paused) + '</dd></div>' +
      '<div class="metric' + (late ? ' alert' : '') + '"><dt>Esperando agora</dt><dd>' + nf(waiting.length) + '</dd>' +
        (oldest ? '<span class="note">maior espera ' + since(oldest, 'x') + '</span>' : '<span class="note">ninguém na fila</span>') + '</div>' +
      '<div class="metric"><dt>Atendidas hoje</dt><dd>' + (hasToday ? nf(answered) : '—') + '</dd>' +
        (hasToday ? '<span class="note">' + plural(abandoned, 'abandonada', 'abandonadas') +
          (answered + abandoned ? ' (' + pctTxt(pct(abandoned, answered + abandoned)) + ')' : '') + '</span>'
          : '<span class="note">sem filas de entrada</span>') + '</div>' +
    '</dl>';
    if (total) {
      h += '<div class="dist" aria-hidden="true">' +
        ['oncall', 'free', 'paused', 'offline'].map(function (k) {
          return '<span class="s-' + k + '" style="width:' + (c[k] / total * 100) + '%"></span>';
        }).join('') + '</div>' +
        '<p class="legend">' + ['oncall', 'free', 'paused', 'offline'].map(function (k) {
          return '<span><i class="sw s-' + k + '"></i>' + STATE[k].label + ' <b>' + nf(c[k]) + '</b></span>';
        }).join('') + '</p>';
    }
    $('ccx-overview').innerHTML = h;
  }

  function agentState(a) {
    var st = STATE[a.status];
    var elapsed = a.since ? nowSrv() - a.since : 0;
    var timed = a.since && (a.status === 'oncall' || a.status === 'paused' || (a.status === 'free' && a.since_exact));
    var h = '<b>' + st.label + (timed ? ' há' : '') + '</b>';
    if (a.status === 'oncall') {
      h += since(a.since);
      if (a.onhold) h += '<span class="tag">em espera</span>';
      if (a.call) {
        var where = a.call.campaign_name || queueLabel(a.call.queue);
        h += '<span class="sub">' + (a.call.type === 'outgoing' ? 'Para ' : 'De ') + esc(phone(a.call.phone)) +
          (where ? ', ' + esc(where) : '') + '</span>';
      }
    } else if (a.status === 'paused') {
      h += since(a.since, elapsed > LONG_PAUSE ? 't long' : 't');
      h += '<span class="sub">' + esc(a.pause || 'Pausa') + '</span>';
    } else if (a.status === 'free') {
      if (a.since_exact) h += since(a.since);
      else if (a.since) h += '<span class="sub">desde ' + hm(a.since) + '</span>';
    } else if (a.since) {
      h += '<span class="sub">saiu às ' + hm(a.since) + '</span>';
    }
    return h;
  }

  function renderAgents() {
    var d = S.data;
    if (!d) return;
    var c = counts(d.agents);
    var filters = [['all', 'Todos', d.agents.length], ['free', 'Disponíveis', c.free], ['oncall', 'Em ligação', c.oncall],
      ['paused', 'Em pausa', c.paused], ['offline', 'Offline', c.offline]];
    $('ccx-filter').innerHTML = filters.map(function (f) {
      return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' +
        f[1] + '<span class="n">' + nf(f[2]) + '</span></button>';
    }).join('');

    var list = d.agents.filter(function (a) {
      if (S.filter !== 'all' && a.status !== S.filter) return false;
      if (S.q && (a.name + ' ' + a.number).toLowerCase().indexOf(S.q) === -1) return false;
      return true;
    }).sort(function (x, y) {
      var o = STATE[x.status].order - STATE[y.status].order;
      if (o) return o;
      return (x.since || Infinity) - (y.since || Infinity) || x.name.localeCompare(y.name, 'pt-BR');
    });
    $('ccx-agent-count').textContent = d.agents.length ? nf(d.agents.length) : '';

    if (!d.agents.length) {
      $('ccx-agents').innerHTML = '<div class="empty"><b>Nenhuma agente nas filas do call center.</b>' +
        'Cadastre agentes em Call Center, Agent Options, e coloque-as como membros das filas.</div>';
      return;
    }
    if (!list.length) {
      $('ccx-agents').innerHTML = '<div class="empty">Nenhuma agente ' +
        (S.q ? 'com "' + esc(S.q) + '"' : 'neste filtro') + ' agora.</div>';
      return;
    }
    $('ccx-agents').innerHTML = list.map(function (a) {
      return '<div class="agent ' + a.status + ' st-' + a.status + '">' +
        '<div class="who"><i class="dot s-' + a.status + '" aria-hidden="true"></i><div><b>' + esc(a.name) + '</b>' +
          '<span>Ramal ' + esc(a.number) + (a.session_start ? ', sessão ' + since(a.session_start, 'x') : '') + '</span></div></div>' +
        '<div class="state">' + agentState(a) + '</div>' +
        '<div class="today"><b>' + plural(a.today.calls, 'ligação', 'ligações') + '</b>' +
          '<span>' + (a.today.talk_sec ? dur(a.today.talk_sec) + ' falando' : 'hoje') + '</span>' +
          (a.day_login_sec ? '<span>' + dur(a.day_login_sec) + ' logado hoje</span>' : '') + '</div>' +
      '</div>';
    }).join('');
  }

  function queueLabel(num) {
    var q = (S.data.queues || []).filter(function (x) { return x.number === String(num); })[0];
    return q && q.name ? q.name : (num ? 'Fila ' + num : '');
  }

  function renderQueues() {
    var d = S.data, sl = d.service_level;
    if (!d.queues.length) {
      $('ccx-queues').innerHTML = '<div class="panel"><div class="empty"><b>Nenhuma fila no call center.</b>' +
        'Filas de entrada aparecem aqui quando cadastradas em Ingoing Calls, Queues; filas de campanhas ativas também.</div></div>';
      return;
    }
    var qs = d.queues.slice().sort(function (a, b) {
      return b.waiting.length - a.waiting.length || String(a.name || a.number).localeCompare(String(b.name || b.number), 'pt-BR');
    });
    $('ccx-queues').innerHTML = qs.map(function (q) {
      var w = q.waiting.slice().sort(function (a, b) { return (a.since || 0) - (b.since || 0); });
      var oldest = w.length && w[0].since ? w[0].since : null;
      var late = oldest && nowSrv() - oldest > sl;
      var cls = !w.length ? '' : (late ? ' q-late' : ' q-ok');
      var h = '<article class="queue' + cls + '" data-sl="' + sl + '"' + (oldest ? ' data-oldest="' + oldest + '"' : '') + '>' +
        '<div class="q-top"><div class="q-name"><b>' + esc(q.name || 'Fila ' + q.number) + '</b>' +
          '<span>Fila ' + esc(q.number) + (q.kind === 'campaign' ? ', campanha de saída' : '') + '</span></div>' +
          '<div class="q-wait"><strong>' + nf(w.length) + '</strong><span>esperando</span></div></div>';
      if (oldest) h += '<p class="q-longest">Maior espera <b>' + since(oldest, 'x') + '</b></p>';
      if (w.length) {
        h += '<ul class="callers">' + w.slice(0, 5).map(function (c) {
          var lateC = c.since && nowSrv() - c.since > sl;
          return '<li><span>' + esc(phone(c.phone)) + (c.campaign ? ' <span class="camp">' + esc(c.campaign) + '</span>' : '') + '</span>' +
            (c.since ? since(c.since, lateC ? 'late' : '') : '') + '</li>';
        }).join('') + (w.length > 5 ? '<li class="more">e mais ' + nf(w.length - 5) + '</li>' : '') + '</ul>';
      }
      var ag = q.agents, parts = [];
      if (ag.free) parts.push(plural(ag.free, 'disponível', 'disponíveis'));
      if (ag.oncall) parts.push(nf(ag.oncall) + ' em ligação');
      if (ag.paused) parts.push(nf(ag.paused) + ' em pausa');
      h += '<div class="q-foot"><span>' + (parts.length ? '<b>Agentes:</b> ' + parts.join(', ') : 'Nenhuma agente online nesta fila') + '</span>';
      if (q.today) {
        var tot = q.today.answered + q.today.abandoned;
        h += '<span><b>Hoje:</b> ' + plural(q.today.answered, 'atendida', 'atendidas') + ', ' +
          '<span class="' + (q.today.abandoned ? 'bad' : '') + '">' + plural(q.today.abandoned, 'abandonada', 'abandonadas') +
          (tot ? ' (' + pctTxt(pct(q.today.abandoned, tot)) + ')' : '') + '</span></span>';
      }
      return h + '</div></article>';
    }).join('');
  }

  function renderCampaigns() {
    var d = S.data;
    if (!d.campaigns.length) {
      $('ccx-campaigns').innerHTML = '<div class="empty"><b>Nenhuma campanha de saída ativa.</b>' +
        'Ative uma campanha em Outgoing Calls, Campaigns para acompanhar o progresso aqui.</div>';
      return;
    }
    $('ccx-campaigns').innerHTML = d.campaigns.map(function (c) {
      var t = c.totals, total = t.total || 0;
      var modeTxt = c.mode === 'preview' ? 'Preview' : 'Automático';
      var h = '<div class="camp-row"><div class="camp-head"><b>' + esc(c.name) + '</b>' +
        '<span class="mode' + (c.mode === 'preview' ? ' preview' : '') + '">' + modeTxt + '</span>' +
        (c.mode !== 'preview' && c.status !== 'A' ? '<span class="mode off">Parada</span>' : '') +
        '<span class="meta">' + esc(c.queue_name || 'Fila ' + c.queue) + ', das ' + esc(c.window.from_time) + ' às ' + esc(c.window.to_time) + '</span>' +
        (c.active_now ? '<span class="now">' + plural(c.active_now, 'ligação agora', 'ligações agora') + '</span>' : '') +
        '</div>';
      if (!total) {
        return h + '<p class="empty" style="padding:8px 0 0">Nenhum contato carregado nesta campanha.</p></div>';
      }
      var seg = [['contacted', t.contacted], ['active', t.active], ['exhausted', t.exhausted], ['dnc', t.dnc]];
      h += '<div class="progress" role="img" aria-label="' + pct(t.contacted, total) + '% contatados">' +
        seg.map(function (s) { return s[1] ? '<span class="p-' + s[0] + '" style="width:' + (s[1] / total * 100) + '%"></span>' : ''; }).join('') +
        '</div><p class="legend">' +
        '<span><i class="sw p-contacted"></i><b>' + nf(t.contacted) + '</b> de ' + nf(total) + ' contatados (' + pctTxt(pct(t.contacted, total)) + ')</span>' +
        (t.active ? '<span><i class="sw p-active"></i><b>' + nf(t.active) + '</b> em andamento</span>' : '') +
        '<span><b>' + nf(t.pending) + '</b> a ligar</span>' +
        (t.exhausted ? '<span><i class="sw p-exhausted"></i><b>' + nf(t.exhausted) + '</b> sem contato após as tentativas</span>' : '') +
        (t.dnc ? '<span><i class="sw p-dnc"></i><b>' + nf(t.dnc) + '</b> na lista de não ligar</span>' : '') +
        '</p>';
      if (c.dispositions && c.dispositions.length) {
        h += '<div class="dispos" aria-label="Resultados das ligações">' + c.dispositions.map(function (x) {
          return '<span class="dispo ' + esc(x.outcome) + '">' + esc(x.label) + ' <b>' + nf(x.count) + '</b></span>';
        }).join('') + '</div>';
      }
      return h + '</div>';
    }).join('');
  }

  /* ---------- cronômetros ---------- */
  function tick() {
    if (!S.data) return;
    var now = nowSrv();
    var els = root.querySelectorAll('[data-since]');
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = clock(now - parseFloat(els[i].getAttribute('data-since')));
    }
    // Fila que passa do nível de serviço fica vermelha sem esperar o próximo ciclo.
    var qs = root.querySelectorAll('.queue[data-oldest]');
    for (var j = 0; j < qs.length; j++) {
      var late = now - parseFloat(qs[j].getAttribute('data-oldest')) > parseFloat(qs[j].getAttribute('data-sl'));
      qs[j].classList.toggle('q-late', late);
      qs[j].classList.toggle('q-ok', !late);
    }
    renderSub();
  }

  setInterval(tick, 1000);
  poll();
})();
