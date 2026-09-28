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
/bin/cp -rf modules/ccx_common modules/ccx_painel "$WEB/"
chown -R asterisk:asterisk "$WEB/ccx_common" "$WEB/ccx_painel"

say "Aplicando migração do banco (tabelas ccx_*, pausa Preview, proteção de campanhas preview)"
MYSQL_PWD="$ROOTPW" mysql -uroot --default-character-set=utf8mb4 call_center < setup/ccx_schema.sql

say "Registrando o menu Call Center > Painel"
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

say "Conferindo a correção de segurança do campaign_monitoring/libs/api.php"
if [ -f "$WEB/campaign_monitoring/libs/api.php" ]; then
    php setup/fix-campaign-monitoring-api.php || echo "   Aviso: o arquivo mudou no upstream e a correção automática não se aplica. Revise-o manualmente."
fi

say "Pronto. Abra o Issabel em Call Center > Painel."
echo "   Usuários que não são admin precisam de permissão no menu em System > User Management > Group Permission."
