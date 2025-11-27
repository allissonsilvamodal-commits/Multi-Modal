-- ============================================
-- TABELA DE LANÇAMENTO DE DADOS - GESTÃO
-- Multimodal - Sistema Intranet
-- Executar no Supabase SQL Editor
-- ============================================

-- Tabela principal de lançamentos
CREATE TABLE IF NOT EXISTS gestao_dados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Dados do lançamento
    data DATE NOT NULL,
    oc VARCHAR(50) NOT NULL,
    operacao VARCHAR(100) NOT NULL,
    tipo_erro VARCHAR(100) NOT NULL,
    motivo_devolucao TEXT NOT NULL,
    hora_envio TIME NOT NULL,
    hora_retorno TIME NOT NULL,
    responsavel VARCHAR(100) NOT NULL,
    
    -- Controle de usuário
    usuario_id VARCHAR(255) NOT NULL,
    usuario_nome VARCHAR(255) NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_gestao_dados_data ON gestao_dados(data DESC);
CREATE INDEX IF NOT EXISTS idx_gestao_dados_oc ON gestao_dados(oc);
CREATE INDEX IF NOT EXISTS idx_gestao_dados_tipo_erro ON gestao_dados(tipo_erro);
CREATE INDEX IF NOT EXISTS idx_gestao_dados_responsavel ON gestao_dados(responsavel);
CREATE INDEX IF NOT EXISTS idx_gestao_dados_usuario ON gestao_dados(usuario_id);

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_gestao_dados_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar updated_at
CREATE TRIGGER trigger_update_gestao_dados_updated_at
    BEFORE UPDATE ON gestao_dados
    FOR EACH ROW
    EXECUTE FUNCTION update_gestao_dados_updated_at();

-- RLS (Row Level Security) - Permitir que usuários vejam todos os registros
ALTER TABLE gestao_dados ENABLE ROW LEVEL SECURITY;

-- Política: Usuários autenticados podem ver todos os registros
CREATE POLICY "Usuários podem ver todos os registros"
    ON gestao_dados
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Política: Usuários autenticados podem inserir registros
CREATE POLICY "Usuários podem inserir registros"
    ON gestao_dados
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- Política: Usuários podem atualizar apenas seus próprios registros
CREATE POLICY "Usuários podem atualizar seus registros"
    ON gestao_dados
    FOR UPDATE
    USING (auth.uid()::text = usuario_id)
    WITH CHECK (auth.uid()::text = usuario_id);

-- Política: Usuários podem excluir apenas seus próprios registros
CREATE POLICY "Usuários podem excluir seus registros"
    ON gestao_dados
    FOR DELETE
    USING (auth.uid()::text = usuario_id);

-- Comentários nas colunas
COMMENT ON TABLE gestao_dados IS 'Tabela para armazenar lançamentos de dados de gestão';
COMMENT ON COLUMN gestao_dados.data IS 'Data do lançamento';
COMMENT ON COLUMN gestao_dados.oc IS 'Ordem de Coleta';
COMMENT ON COLUMN gestao_dados.operacao IS 'Tipo de operação realizada';
COMMENT ON COLUMN gestao_dados.tipo_erro IS 'Tipo de erro identificado';
COMMENT ON COLUMN gestao_dados.motivo_devolucao IS 'Motivo da devolução';
COMMENT ON COLUMN gestao_dados.hora_envio IS 'Hora que enviou a demanda';
COMMENT ON COLUMN gestao_dados.hora_retorno IS 'Hora que retornou a demanda';
COMMENT ON COLUMN gestao_dados.responsavel IS 'Nome do responsável';

