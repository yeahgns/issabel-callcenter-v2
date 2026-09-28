-- Issabel Call Center Plus: tabelas próprias (prefixo ccx_) no banco call_center.
-- Idempotente: pode rodar de novo a cada atualização do add-on.
-- Não altera nenhuma tabela do callcenter original; só lê delas e cria um trigger
-- em `campaign` que impede ativar no discador uma campanha marcada como preview.

-- Modo de cada campanha de saída. Campanha sem linha aqui = automática (padrão do Issabel).
CREATE TABLE IF NOT EXISTS ccx_campaign (
    id_campaign  int(10) unsigned NOT NULL,
    mode         enum('auto','preview') NOT NULL DEFAULT 'auto',
    created_at   datetime NOT NULL,
    created_by   varchar(64) DEFAULT NULL,
    PRIMARY KEY (id_campaign),
    CONSTRAINT ccx_campaign_fk FOREIGN KEY (id_campaign) REFERENCES campaign (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Opções de tabulação ("Se interessou", "Não quer mais"...) configuráveis por campanha.
-- outcome agrupa as opções para os indicadores do painel.
CREATE TABLE IF NOT EXISTS ccx_disposition_option (
    id           int(10) unsigned NOT NULL AUTO_INCREMENT,
    id_campaign  int(10) unsigned NOT NULL,
    label        varchar(64) NOT NULL,
    outcome      enum('positive','negative','neutral','callback') NOT NULL DEFAULT 'neutral',
    sort_order   smallint unsigned NOT NULL DEFAULT 0,
    active       tinyint(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (id),
    KEY ccx_dispopt_campaign (id_campaign, active, sort_order),
    CONSTRAINT ccx_dispopt_fk FOREIGN KEY (id_campaign) REFERENCES campaign (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Tabulações registradas. Uma ligação pode ser tabulada mais de uma vez (histórico);
-- a mais recente é a que vale.
CREATE TABLE IF NOT EXISTS ccx_disposition (
    id           int(10) unsigned NOT NULL AUTO_INCREMENT,
    id_call      int(10) unsigned NOT NULL,
    id_option    int(10) unsigned NOT NULL,
    id_agent     int(10) unsigned DEFAULT NULL,
    note         text,
    created_at   datetime NOT NULL,
    PRIMARY KEY (id),
    KEY ccx_disp_call (id_call, created_at),
    KEY ccx_disp_option (id_option),
    CONSTRAINT ccx_disp_call_fk   FOREIGN KEY (id_call)   REFERENCES calls (id) ON DELETE CASCADE,
    CONSTRAINT ccx_disp_option_fk FOREIGN KEY (id_option) REFERENCES ccx_disposition_option (id),
    CONSTRAINT ccx_disp_agent_fk  FOREIGN KEY (id_agent)  REFERENCES agent (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Tentativas do modo preview (o discador nativo não registra essas).
-- linkedid liga a tentativa ao CDR.
CREATE TABLE IF NOT EXISTS ccx_attempt (
    id           int(10) unsigned NOT NULL AUTO_INCREMENT,
    id_call      int(10) unsigned NOT NULL,
    id_agent     int(10) unsigned DEFAULT NULL,
    started_at   datetime NOT NULL,
    answered_at  datetime DEFAULT NULL,
    ended_at     datetime DEFAULT NULL,
    result       varchar(20) DEFAULT NULL,
    uniqueid     varchar(32) DEFAULT NULL,
    linkedid     varchar(32) DEFAULT NULL,
    PRIMARY KEY (id),
    KEY ccx_attempt_call (id_call, started_at),
    KEY ccx_attempt_linkedid (linkedid),
    CONSTRAINT ccx_attempt_call_fk  FOREIGN KEY (id_call)  REFERENCES calls (id) ON DELETE CASCADE,
    CONSTRAINT ccx_attempt_agent_fk FOREIGN KEY (id_agent) REFERENCES agent (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Pausa usada enquanto a agente trabalha uma lista preview, para a fila não
-- entregar ligações automáticas para ela nesse meio tempo.
INSERT INTO `break` (name, description, status, tipo)
SELECT 'Preview', 'Trabalhando lista preview (Call Center Plus)', 'A', 'B'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `break` WHERE name = 'Preview');

-- Proteção: campanha preview não pode ser ativada (estatus = 'A'), senão o
-- discador automático começaria a discar a lista inteira sozinho.
DROP TRIGGER IF EXISTS ccx_guard_preview;
DELIMITER //
CREATE TRIGGER ccx_guard_preview BEFORE UPDATE ON campaign
FOR EACH ROW
BEGIN
    IF NEW.estatus = 'A' AND OLD.estatus <> 'A'
       AND EXISTS (SELECT 1 FROM ccx_campaign WHERE id_campaign = NEW.id AND mode = 'preview') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Campanha em modo preview: ative pelo Call Center Plus, nao pelo discador automatico';
    END IF;
END//
DELIMITER ;
