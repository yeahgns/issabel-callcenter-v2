# Issabel Call Center Plus

Add-on para o [callcenter-issabel5](https://github.com/ISSABELPBX/callcenter-issabel5) com uma interface feita para o dia a dia da operação. Não altera os módulos originais: instala módulos novos no menu Call Center e tabelas próprias (prefixo `ccx_`) no banco `call_center`.

Testado para Issabel 5, Asterisk 18, Rocky Linux 8, PHP 7.4.

## O que tem nesta versão (0.1.0)

**Call Center > Painel**, atualizado a cada 5 segundos:

- Agentes: quem está disponível, em ligação (com número e fila ou campanha), em pausa (com o motivo) ou offline, e há quanto tempo. Pausas acima de 15 minutos ficam em vermelho.
- Filas: quantas pessoas esperando agora e a maior espera. A fila fica vermelha quando alguém passa do nível de serviço (20s por padrão). Inclui clientes de campanha de saída que atenderam e aguardam agente.
- Campanhas de saída: contatados, em andamento, a ligar, sem contato após as tentativas e lista de não ligar, com o resultado das tabulações.
- Tela cheia para deixar numa TV da operação.

O acesso segue as permissões do Issabel: só quem tem o menu Painel liberado vê os dados, inclusive no endpoint JSON.

## Instalação

```bash
cd /usr/src
git clone https://github.com/SEU_USUARIO/issabel-callcenter-plus.git
cd issabel-callcenter-plus
bash install.sh
```

Pode rodar `install.sh` de novo para atualizar. A configuração em `/etc/issabel/ccx.conf.php` é criada na primeira vez e nunca sobrescrita.

Para remover: `bash uninstall.sh` (mantém os dados) ou `bash uninstall.sh --purge`.

### Modo demonstração

Com `'demo' => true` em `/etc/issabel/ccx.conf.php` o painel mostra agentes, filas e campanhas fictícios. Serve para ver a interface antes de cadastrar agentes. Para gerar uma página HTML única com a demo, fora do Issabel:

```bash
php build/build-demo.php > painel-demo.html
```

### Diagnóstico

`index.php?menu=ccx_painel&action=debug&rawmode=yes` devolve o snapshot junto com os dados crus que vieram do ECCP. Use quando algum número do painel não bater com o que a operação vê.

## O que o instalador faz no sistema

- Copia `modules/ccx_common` e `modules/ccx_painel` para `/var/www/html/modules/`.
- Cria as tabelas `ccx_campaign`, `ccx_disposition_option`, `ccx_disposition` e `ccx_attempt`, e a pausa "Preview".
- Cria o trigger `ccx_guard_preview` em `campaign`: impede ativar no discador automático uma campanha marcada como preview. É o único objeto criado numa tabela do callcenter original; `uninstall.sh` remove.
- Registra o menu com `issabel-menumerge`.
- Corrige a injeção de comando em `modules/campaign_monitoring/libs/api.php` do callcenter original (o parâmetro `queue` ia direto para `shell_exec`, sem login). O original fica em `/root/api.php.bak-*`. Reinstalar o callcenter desfaz a correção; rodar `install.sh` de novo a reaplica.

## Estrutura

```
modules/ccx_common/libs/bootstrap.php     configuração e conexões
modules/ccx_common/libs/LiveProvider.php  estado real via ECCP + banco
modules/ccx_common/libs/view.php          HTML do painel
modules/ccx_common/assets/                painel.css, painel.js, painel-demo.js
modules/ccx_painel/index.php              ponte com o Issabel (_moduleContent)
setup/ccx_schema.sql                      migração idempotente
```

## Próximas fases

1. Importador de planilhas (Nome, Número, Empresa, Assunto) com normalização de número, remoção de duplicados e checagem da lista de não ligar, e cadastro das opções de tabulação por campanha.
2. Tela da agente: ficha do cliente e tabulação na hora da ligação, nos modos automático e preview.
3. Relatórios de resultado das campanhas.

## Licença

GPLv2 ou posterior, a mesma do callcenter-issabel5, do qual este add-on reutiliza bibliotecas.
