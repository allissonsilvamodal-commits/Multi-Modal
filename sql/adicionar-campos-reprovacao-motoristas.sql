-- =====================================================
-- ADICIONAR CAMPOS DE REPROVAÇÃO NA TABELA MOTORISTAS
-- =====================================================

-- Adicionar campos de reprovação na tabela motoristas
ALTER TABLE motoristas 
ADD COLUMN IF NOT EXISTS reprovado BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS motivo_reprovacao TEXT,
ADD COLUMN IF NOT EXISTS reprovado_por TEXT,
ADD COLUMN IF NOT EXISTS data_reprovacao TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS coleta_id_reprovacao TEXT;

-- Criar índice para melhorar performance nas consultas de motoristas reprovados
CREATE INDEX IF NOT EXISTS idx_motoristas_reprovado ON motoristas(reprovado) WHERE reprovado = TRUE;

-- Comentários nas colunas
COMMENT ON COLUMN motoristas.reprovado IS 'Indica se o motorista foi reprovado em alguma coleta';
COMMENT ON COLUMN motoristas.motivo_reprovacao IS 'Motivo da reprovação do motorista';
COMMENT ON COLUMN motoristas.reprovado_por IS 'Usuário que reprovou o motorista';
COMMENT ON COLUMN motoristas.data_reprovacao IS 'Data/hora da reprovação';
COMMENT ON COLUMN motoristas.coleta_id_reprovacao IS 'ID da coleta onde o motorista foi reprovado';

