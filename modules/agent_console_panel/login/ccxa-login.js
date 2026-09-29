/* Issabel Call Center Plus - tela de login do Agent Console.
 *
 * Instalado em modules/agent_console/themes/default/js/, pasta que o framework do Issabel
 * carrega sozinho em todas as páginas do módulo (inclusive o login, onde os painéis ainda
 * não existem). Não edita nenhum arquivo do console.
 *
 * O formulário original continua na página, escondido, e é ele que faz o login: esta tela
 * preenche os campos de callback do formulário original e chama o do_login() do motor.
 * Sempre entra em modo callback (a opção Agent não aparece).
 *
 * Se algo esperado não existir, a tela original volta a aparecer.
 */
(function () {
  'use strict';

  var FORM_SEL = 'form[onsubmit*="do_login"]';

  // Anti-flash: este arquivo roda no <head>. Esconde o formulário antigo antes de ele ser desenhado.
  var af = document.createElement('style');
  af.id = 'ccxl-antiflash';
  af.textContent = FORM_SEL + '{display:none!important}';
  (document.head || document.documentElement).appendChild(af);
  function showOriginal() { if (af.parentNode) af.parentNode.removeChild(af); }
  setTimeout(function () { if (!document.getElementById('ccxl-root')) showOriginal(); }, 4000);

  function $(s, c) { return (c || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Mensagens do motor (em inglês) traduzidas para a agente.
  var MSG = [
    [/Logging agent in\. Please wait\.*/i, 'Entrando, aguarde…'],
    [/Invalid agent password/i, 'Senha incorreta.'],
    [/Extension is not registered/i, 'O telefone deste ramal não está registrado no PABX. Ligue o telefone ou o softphone e tente de novo.'],
    [/Extension is already in use by another agent/i, 'Este ramal já está em uso por outra agente.'],
    [/Invalid extension number/i, 'Ramal inválido.'],
    [/Invalid agent number/i, 'Agente inválido.'],
    [/Agent log-in terminated\.?/i, 'O login foi encerrado.'],
    [/Agent login process not started/i, 'O login não chegou a começar. Tente de novo.'],
    [/Cannot start agent login/i, 'Não foi possível iniciar o login.'],
    [/Failed to connect to server[^!]*!?/i, 'Não foi possível falar com o servidor.'],
    [/Agent log-in failed!?\s*-?\s*/i, '']
  ];
  function tr(msg) {
    var out = String(msg || '').trim();
    MSG.forEach(function (m) { out = out.replace(m[0], m[1]); });
    out = out.replace(/^\s*-\s*/, '').trim();
    return out || (msg ? 'Não foi possível entrar.' : '');
  }

  function parseOption(text) {
    var m = String(text).match(/^\s*[A-Za-z0-9]+\/(\S+)\s*-\s*(.+?)\s*$/);
    return m ? { ext: m[1], name: m[2] } : { ext: '', name: String(text).trim() };
  }

  function build() {
    var form = $(FORM_SEL);
    if (!form) { showOriginal(); return; }                  // não é a tela de login
    var sel = $('#input_extension_callback'), pw = $('#input_password_callback'), cb = $('#input_callback');
    if (!sel || !pw || !cb || typeof window.do_login !== 'function') { showOriginal(); return; }

    if (!document.getElementById('ccxl-font')) {
      var f = document.createElement('link');
      f.id = 'ccxl-font'; f.rel = 'stylesheet';
      f.href = 'https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;600;700&display=swap';
      document.head.appendChild(f);
    }

    var opts = Array.prototype.map.call(sel.options, function (o) {
      var p = parseOption(o.text);
      return { value: o.value, name: p.name, ext: p.ext, selected: o.selected };
    });

    var root = document.createElement('div');
    root.id = 'ccxl-root';
    root.className = 'ccxl';

    if (!opts.length) {
      root.innerHTML =
        '<div class="card"><h1>Console do agente</h1>' +
        '<p class="lead">Nenhum ramal de callback está cadastrado.</p>' +
        '<p class="hint">Peça ao administrador para cadastrar o seu ramal em Call Center, Agent Options, Callback Extensions.</p></div>';
      form.parentNode.insertBefore(root, form);
      return;
    }

    var optionsHtml = opts.map(function (o) {
      var label = o.ext ? o.name + ' (ramal ' + o.ext + ')' : o.name;
      return '<option value="' + esc(o.value) + '"' + (o.selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');

    root.innerHTML =
      '<form class="card" id="ccxl-form" autocomplete="off" novalidate>' +
        '<h1>Console do agente</h1>' +
        '<p class="lead">Entre com o seu ramal para começar a receber ligações da fila.</p>' +
        '<label class="field"><span>Ramal</span>' +
          '<select id="ccxl-ext">' + optionsHtml + '</select></label>' +
        '<label class="field"><span>Senha</span>' +
          '<input type="password" id="ccxl-pass" autocomplete="current-password"></label>' +
        '<div class="status" id="ccxl-status" role="status" aria-live="polite" hidden></div>' +
        '<button type="submit" class="ccxl-btn" id="ccxl-go">Entrar</button>'
      '</form>';
    form.parentNode.insertBefore(root, form);

    var myExt = $('#ccxl-ext'), myPass = $('#ccxl-pass'), status = $('#ccxl-status'), go = $('#ccxl-go');
    var busy = false;

    function setStatus(kind, text) {
      if (!text) { status.hidden = true; status.className = 'status'; status.textContent = ''; return; }
      status.hidden = false;
      status.className = 'status ' + kind;
      status.innerHTML = (kind === 'wait' ? '<i class="spin" aria-hidden="true"></i>' : '') + esc(text);
    }
    function setBusy(b) {
      busy = b;
      go.disabled = b; myExt.disabled = b; myPass.disabled = b;
      go.textContent = b ? 'Entrando…' : 'Entrar';
    }

    // Reflete as mensagens que o motor escreve no formulário original.
    var espera = $('#login_msg_espera'), erro = $('#login_msg_error');
    function mirror() {
      var e = erro ? erro.textContent.trim() : '';
      var w = espera ? espera.textContent.trim() : '';
      var row = $('#login_fila_estado');
      var rowVisible = row && !/visibility:\s*hidden|display:\s*none/i.test(row.getAttribute('style') || '');
      if (e) { setStatus('error', tr(e)); setBusy(false); myPass.focus(); myPass.select(); }
      else if (w && rowVisible && busy) setStatus('wait', tr(w));
    }
    var mo = new MutationObserver(mirror);
    if (espera) mo.observe(espera, { childList: true, characterData: true, subtree: true });
    if (erro) mo.observe(erro, { childList: true, characterData: true, subtree: true });

    // Página recarregada durante um login em andamento: o motor já retoma sozinho.
    var row0 = $('#login_fila_estado');
    if (row0 && espera && espera.textContent.trim() && !/visibility:\s*hidden|display:\s*none/i.test(row0.getAttribute('style') || '')
        && document.body.innerHTML.indexOf('do_checklogin()') !== -1) {
      setBusy(true); setStatus('wait', tr(espera.textContent));
    }

    $('#ccxl-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (busy) return;
      if (!myPass.value) { setStatus('error', 'Digite a senha do seu ramal.'); myPass.focus(); return; }
      // Preenche o formulário original em modo callback e deixa o motor fazer o login.
      cb.checked = true;
      sel.value = myExt.value;
      pw.value = myPass.value;
      if (erro) erro.textContent = '';
      setBusy(true);
      setStatus('wait', 'Entrando, aguarde…');
      try { window.do_login(); }
      catch (e) { setBusy(false); setStatus('error', 'Não foi possível entrar. Recarregue a página e tente de novo.'); }
    });

    myPass.focus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
