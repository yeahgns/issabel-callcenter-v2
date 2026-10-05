#!/bin/bash
# Issabel Call Center Plus - instalação / atualização (pode rodar de novo a qualquer momento).
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(cat VERSION)
WEB=/var/www/html/modules
SHARE=/usr/share/issabel/module_installer/ccx

say()  { echo -e "\033[1;34m==>\033[0m $*"; }
fail() { echo -e "\033[1;31mErro:\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "rode como root."
[ -f "$WEB/agent_console/libs/paloSantoConsola.class.php" ] || fail "módulo Call Center do Issabel não encontrado em $WEB. Instale o callcenter-issabel5 antes."
command -v issabel-menumerge >/dev/null || fail "issabel-menumerge não encontrado; isto não parece um Issabel 5."
ROOTPW=$(grep -E '^mysqlrootpwd=' /etc/issabel.conf 2>/dev/null | cut -d= -f2- || true)
[ -n "$ROOTPW" ] || fail "não achei mysqlrootpwd em /etc/issabel.conf."

say "Instalando Call Center Plus $VERSION"

say "Copiando módulos para $WEB"
/bin/cp -rf modules/ccx_common modules/ccx_painel modules/ccx_campanhas modules/ccx_formularios modules/ccx_agentes "$WEB/"
chown -R asterisk:asterisk "$WEB/ccx_common" "$WEB/ccx_painel" "$WEB/ccx_campanhas" "$WEB/ccx_formularios" "$WEB/ccx_agentes"

say "Instalando a casca do Console do Agente (painel ccxa)"
# O agent_console injeta automaticamente todo .js de panels/*/js/ e chama a classe
# Panel_Ccxa. Não editamos nenhum arquivo do console; só adicionamos este painel.
CONSOLE_PANELS="$WEB/agent_console/panels"
if [ -d "$WEB/agent_console" ]; then
    mkdir -p "$CONSOLE_PANELS"
    /bin/cp -rf modules/agent_console_panel/ccxa "$CONSOLE_PANELS/"
    chown -R asterisk:asterisk "$CONSOLE_PANELS/ccxa"
    # Tela de login: o framework carrega sozinho todo .js/.css destas pastas (inclusive no login,
    # onde os painéis ainda não existem). Só adicionamos arquivos nossos, sem editar os do console.
    THEME="$WEB/agent_console/themes/default"
    mkdir -p "$THEME/js" "$THEME/css"
    /bin/cp -f modules/agent_console_panel/login/ccxa-login.js "$THEME/js/"
    /bin/cp -f modules/agent_console_panel/login/ccxa-login.css "$THEME/css/"
    chown asterisk:asterisk "$THEME/js/ccxa-login.js" "$THEME/css/ccxa-login.css"
else
    echo "   Aviso: agent_console não encontrado; a casca do console não foi instalada."
fi

say "Aplicando migração do banco (tabelas ccx_*, pausa Preview, proteção de campanhas preview)"
MYSQL_PWD="$ROOTPW" mysql -uroot --default-character-set=utf8mb4 call_center < setup/ccx_schema.sql

# Cada célula da planilha vai para call_attribute.value, que no callcenter original é
# varchar(128): textos longos (ex.: uma coluna "Contexto") seriam cortados. Só amplia.
VT=$(MYSQL_PWD="$ROOTPW" mysql -N -uroot call_center -e "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='call_center' AND TABLE_NAME='call_attribute' AND COLUMN_NAME='value'")
if [ "$VT" = "varchar" ]; then
    say "Ampliando call_attribute.value para aceitar textos longos"
    MYSQL_PWD="$ROOTPW" mysql -uroot call_center -e "ALTER TABLE call_attribute MODIFY value TEXT NOT NULL"
fi

say "Registrando os menus Call Center > Painel, Campanhas, Formulários e Agentes"
mkdir -p "$SHARE"
/bin/cp -f menu.xml VERSION "$SHARE/"
issabel-menumerge "$SHARE/menu.xml"

if [ ! -f /etc/issabel/ccx.conf.php ]; then
    say "Criando /etc/issabel/ccx.conf.php"
    mkdir -p /etc/issabel
    /bin/cp setup/ccx.conf.sample.php /etc/issabel/ccx.conf.php
    chown root:asterisk /etc/issabel/ccx.conf.php
    chmod 640 /etc/issabel/ccx.conf.php
fi

say "Instalando a detecção de caixa postal (contexto ccx-amd) no dialplan"
# A campanha manda a ligação atendida para Context/Exten (Exten = fila). Com "Detectar caixa
# postal" ligado, o Context é ccx-amd: o Asterisk escuta os primeiros segundos com AMD() e, se
# for gravação (caixa postal, recado da operadora), desliga antes da fila. O discador marca
# como NoAnswer e o número volta para as tentativas. Pessoa ou dúvida seguem para a fila.
CUSTOM=/etc/asterisk/extensions_custom.conf
touch "$CUSTOM"
sed -i '/^; >>> ccx-amd (Call Center Plus)/,/^; <<< ccx-amd (Call Center Plus)/d' "$CUSTOM"
cat >> "$CUSTOM" <<'DIALPLAN'
; >>> ccx-amd (Call Center Plus) - gerado pelo install.sh, não edite entre estas marcas
[ccx-amd]
exten => _X.,1,NoOp(CCX: verificando caixa postal antes da fila ${EXTEN})
; AMD(silêncio inicial, saudação, silêncio após saudação, análise total, palavra mínima,
;     silêncio entre palavras, máximo de palavras, limiar de silêncio, palavra máxima) em ms.
; Calibrado para o Brasil: até 5 palavras e 2,5 s de fala ("Alô, quem fala?" é pessoa).
; O recado da operadora é uma frase longa e continua passando desses limites.
 same => n,AMD(2500,2500,800,5000,100,50,5,256,5000)
 same => n,NoOp(CCX AMD: ${AMDSTATUS} ${AMDCAUSE})
; Só desliga quando o AMD ouviu fala de gravação (LONGGREETING, MAXWORDS...). Silêncio no começo
; (INITIALSILENCE) é ambíguo, costuma ser gente que atendeu calada: segue para a fila.
 same => n,GotoIf($[ "${AMDSTATUS}" = "MACHINE" & "${AMDCAUSE:0:14}" != "INITIALSILENCE" ]?gravacao)
 same => n,Goto(from-internal,${EXTEN},1)
 same => n(gravacao),Hangup(16)
; <<< ccx-amd (Call Center Plus)
DIALPLAN
chown asterisk:asterisk "$CUSTOM" 2>/dev/null || true
# Sem pipes com grep -q aqui: com "set -o pipefail", o grep -q fecha a saída cedo e o pipe
# inteiro parece falho mesmo quando o texto foi encontrado. Guardamos a saída numa variável.
if command -v asterisk >/dev/null && asterisk -rx "core show version" >/dev/null 2>&1; then
    AMDMOD=$(asterisk -rx "module show like app_amd" 2>/dev/null || true)
    case "$AMDMOD" in
        *app_amd*) ;;
        *) asterisk -rx "module load app_amd.so" >/dev/null 2>&1 || true
           AMDMOD=$(asterisk -rx "module show like app_amd" 2>/dev/null || true) ;;
    esac
    asterisk -rx "dialplan reload" >/dev/null 2>&1 || true
    CTX=$(asterisk -rx "dialplan show ccx-amd" 2>/dev/null || true)
    case "$CTX" in
        *"AMD("*) echo "   Detecção de caixa postal carregada no Asterisk." ;;
        *) echo "   ERRO: o Asterisk não carregou o contexto ccx-amd. Campanhas com \"Detectar caixa postal\" não vão discar."
           echo "         Confira: asterisk -rx \"dialplan show ccx-amd\"" ;;
    esac
    case "$AMDMOD" in
        *app_amd*) ;;
        *) echo "   Aviso: o módulo app_amd não está carregado no Asterisk; a detecção de caixa postal não vai funcionar." ;;
    esac
else
    echo "   Aviso: Asterisk não está rodando; rode depois: asterisk -rx \"dialplan reload\""
fi

say "Conferindo a correção de segurança do campaign_monitoring/libs/api.php"
if [ -f "$WEB/campaign_monitoring/libs/api.php" ]; then
    php setup/fix-campaign-monitoring-api.php || echo "   Aviso: o arquivo mudou no upstream e a correção automática não se aplica. Revise-o manualmente."
fi

say "Pronto. Abra o Issabel em Call Center > Painel."
echo "   Usuários que não são admin precisam de permissão no menu em System > User Management > Group Permission."
