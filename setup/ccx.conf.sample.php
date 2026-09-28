<?php
/* Configuração do Issabel Call Center Plus. Copiado para /etc/issabel/ccx.conf.php
   na primeira instalação; atualizações não sobrescrevem. Tudo é opcional. */
return array(
    'company'               => '',     // aparece no topo do painel
    'demo'                  => false,  // true = dados fictícios, para ver a interface sem agentes
    'poll_seconds'          => 5,      // intervalo de atualização do painel
    'service_level_seconds' => 20,     // espera acima disso deixa a fila vermelha

    // Nome amigável por fila, sobrescreve a descrição cadastrada no IssabelPBX.
    'queue_labels' => array(
        // '620' => 'Vendas',
    ),
);
