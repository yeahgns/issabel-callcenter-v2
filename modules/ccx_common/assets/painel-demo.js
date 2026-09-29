/* Dados fictícios no mesmo formato do snapshot real. Estados mudam com o tempo. */
(function () {
  'use strict';

  function rng(seed) {
    var x = seed >>> 0 || 1;
    return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function phoneBR(r) {
    var ddd = pick(r, ['11', '11', '11', '19', '21', '31', '41', '47', '51', '61', '71', '81']);
    var n = '9' + String(10000000 + Math.floor(r() * 89999999));
    return ddd + n;
  }

  var AGENTS = [
    ['Ana Beatriz Souza', '1001'], ['Bruno Carvalho', '1002'], ['Camila Rocha', '1003'], ['Diego Martins', '1004'],
    ['Eduarda Lima', '1005'], ['Felipe Andrade', '1006'], ['Gabriela Nunes', '1007'], ['Henrique Alves', '1008'],
    ['Isabela Ferreira', '1009'], ['João Pedro Costa', '1010'], ['Larissa Mendes', '1011'], ['Marcos Ribeiro', '1012'],
    ['Natália Pires', '1013'], ['Otávio Barbosa', '1014']
  ];
  var QUEUES = [
    { number: '620', name: 'Vendas', kind: 'campaign' },
    { number: '621', name: 'Suporte', kind: 'incoming' },
    { number: '622', name: 'Financeiro', kind: 'incoming' }
  ];
  var MEMBERS = { '1001': ['620'], '1002': ['620'], '1003': ['620'], '1004': ['620', '621'], '1005': ['621'],
    '1006': ['621'], '1007': ['621'], '1008': ['621', '622'], '1009': ['622'], '1010': ['622'], '1011': ['620'],
    '1012': ['621'], '1013': ['622'], '1014': ['620'] };
  var PAUSES = ['Almoço', 'Café', 'Treinamento', 'Feedback'];
  var OFFLINE = { '1013': true, '1014': true };

  function snapshot() {
    var now = Math.floor(Date.now() / 1000);
    var day = new Date(); day.setHours(8, 0, 0, 0);
    var sinceOpen = Math.max(1800, now - Math.floor(day.getTime() / 1000));
    var hoursOpen = sinceOpen / 3600;

    var agents = AGENTS.map(function (a, i) {
      var span = 70 + i * 13;                       // cada agente muda de estado num ritmo próprio
      var bucket = Math.floor((now + i * 37) / span);
      var start = bucket * span - i * 37;
      var r = rng(bucket * 131 + i * 7919);
      var roll = r();
      var status = OFFLINE[a[1]] ? 'offline' : roll < 0.52 ? 'oncall' : roll < 0.82 ? 'free' : 'paused';
      if (a[1] === '1003') status = 'paused';           // sempre existe uma pausa longa para mostrar o alerta
      var queues = MEMBERS[a[1]];
      var q = pick(r, queues);
      var out = {
        id: 'PJSIP/' + a[1], name: a[0], number: a[1], status: status,
        since: status === 'offline' ? now - 3600 * (2 + i % 3) : start,
        since_exact: true, pause: null, onhold: false, call: null, queues: queues,
        login_sec: status === 'offline' ? 0 : Math.floor(sinceOpen * 0.9),
        session_start: status === 'offline' ? null : now - Math.floor(sinceOpen * (0.3 + (i % 4) * 0.15)),
        day_login_sec: status === 'offline' ? 3600 * (2 + i % 3) : Math.floor(sinceOpen * 0.9),
        today: status === 'offline' ? { calls: 4 + i % 3, talk_sec: 1500 + i * 60 }
          : { calls: Math.floor(hoursOpen * (3 + (i % 4))), talk_sec: Math.floor(hoursOpen * (700 + (i % 5) * 180)) }
      };
      if (status === 'paused') {
        out.pause = pick(r, PAUSES);
        if (a[1] === '1003') { out.pause = 'Almoço'; out.since = Math.floor(now / 3600) * 3600 - 600; }
      }
      if (status === 'oncall') {
        var outgoing = q === '620';
        out.onhold = r() < 0.1;
        out.call = {
          phone: phoneBR(r), queue: q, type: outgoing ? 'outgoing' : 'incoming',
          campaign_id: outgoing ? 1 : null, campaign_name: outgoing ? 'Renovação de contratos' : null, since: start
        };
      }
      return out;
    });

    var queues = QUEUES.map(function (q, qi) {
      var bucket = Math.floor(now / 25);
      var r = rng(bucket * 17 + qi * 101);
      var n = qi === 1 ? 1 + Math.floor(r() * 3) : Math.floor(r() * 2.4);   // Suporte sempre com gente esperando
      var waiting = [];
      for (var k = 0; k < n; k++) {
        var w = { phone: phoneBR(r), since: now - Math.floor(3 + r() * (qi === 1 ? 55 : 15)) };
        if (q.kind === 'campaign') w.campaign = 'Renovação de contratos';
        waiting.push(w);
      }
      var c = { free: 0, oncall: 0, paused: 0, offline: 0 };
      agents.forEach(function (a) { if (a.queues.indexOf(q.number) !== -1) c[a.status]++; });
      return {
        number: q.number, name: q.name, kind: q.kind, waiting: waiting, agents: c,
        today: q.kind === 'incoming' ? {
          answered: Math.floor(hoursOpen * (qi === 1 ? 26 : 11)),
          abandoned: Math.floor(hoursOpen * (qi === 1 ? 1.6 : 0.4))
        } : null
      };
    });

    var m = hoursOpen;
    var contacted = Math.min(980, Math.floor(118 + m * 34));
    var exhausted = Math.floor(22 + m * 6);
    var preview = Math.min(160, Math.floor(18 + m * 7));

    return {
      source: 'demo', now: now, company: 'Empresa Demonstração', service_level: 20,
      agents: agents, queues: queues, warnings: [],
      campaigns: [
        {
          id: 1, name: 'Renovação de contratos', mode: 'auto', status: 'A', queue: '620', queue_name: 'Vendas',
          window: { from_date: '', to_date: '', from_time: '08:00', to_time: '18:00' },
          totals: { total: 1500, contacted: contacted, active: 3, pending: 1500 - contacted - 3 - exhausted - 31,
            exhausted: exhausted, dnc: 31 },
          active_now: 3,
          dispositions: [
            { label: 'Se interessou', outcome: 'positive', count: Math.floor(contacted * 0.21) },
            { label: 'Pediu retorno', outcome: 'callback', count: Math.floor(contacted * 0.14) },
            { label: 'Não tem interesse', outcome: 'negative', count: Math.floor(contacted * 0.47) },
            { label: 'Número errado', outcome: 'neutral', count: Math.floor(contacted * 0.06) }
          ]
        },
        {
          id: 2, name: 'Leads do site (setembro)', mode: 'preview', status: 'I', queue: '620', queue_name: 'Vendas',
          window: { from_date: '', to_date: '', from_time: '09:00', to_time: '17:30' },
          totals: { total: 240, contacted: preview, active: 1, pending: 240 - preview - 1 - 9, exhausted: 9, dnc: 0 },
          active_now: 1,
          dispositions: [
            { label: 'Agendou visita', outcome: 'positive', count: Math.floor(preview * 0.3) },
            { label: 'Pediu retorno', outcome: 'callback', count: Math.floor(preview * 0.25) },
            { label: 'Sem interesse', outcome: 'negative', count: Math.floor(preview * 0.35) }
          ]
        }
      ]
    };
  }

  window.CCX_DEMO = { snapshot: snapshot };
})();
