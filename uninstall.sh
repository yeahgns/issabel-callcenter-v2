#!/bin/bash
# Remove o Call Center Plus. Por padrão mantém os dados (tabelas ccx_*).
# Use --purge para apagar também as tabulações e tentativas registradas.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Rode como root." >&2; exit 1; }
ROOTPW=$(grep -E '^mysqlrootpwd=' /etc/issabel.conf | cut -d= -f2-)

issabel-menuremove ccx_painel || true
issabel-menuremove ccx_campanhas || true
issabel-menuremove ccx_formularios || true
rm -rf /var/www/html/modules/ccx_painel /var/www/html/modules/ccx_campanhas /var/www/html/modules/ccx_formularios /var/www/html/modules/ccx_common /usr/share/issabel/module_installer/ccx
# Casca do Console do Agente
rm -rf /var/www/html/modules/agent_console/panels/ccxa
rm -f /var/www/html/modules/agent_console/themes/default/js/ccxa-login.js /var/www/html/modules/agent_console/themes/default/css/ccxa-login.css

# Sem o add-on ninguém gerencia campanhas preview; libera a ativação delas.
MYSQL_PWD="$ROOTPW" mysql -uroot call_center -e "DROP TRIGGER IF EXISTS ccx_guard_preview"

if [ "${1:-}" = "--purge" ]; then
    MYSQL_PWD="$ROOTPW" mysql -uroot call_center -e "
        DROP TABLE IF EXISTS ccx_disposition, ccx_attempt, ccx_disposition_option, ccx_campaign;"
    rm -f /etc/issabel/ccx.conf.php
    echo "Removido, incluindo dados. A pausa 'Preview' continua cadastrada (o histórico de pausas depende dela)."
else
    echo "Removido. Dados mantidos nas tabelas ccx_* do banco call_center; use --purge para apagá-los."
fi
# A correção de segurança do campaign_monitoring/libs/api.php não é revertida.
