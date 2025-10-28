-- Tabela para armazenar histórico de movimentações das coletas
CREATE TABLE IF NOT EXISTS historico_movimentacoes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    coleta_id UUID REFERENCES coletas(id) ON DELETE CASCADE,
    acao VARCHAR(255) NOT NULL,
    detalhes TEXT,
    usuario_id UUID,
    usuario_nome VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice para performance
CREATE INDEX IF NOT EXISTS idx_historico_movimentacoes_coleta_id ON historico_movimentacoes(coleta_id);
CREATE INDEX IF NOT EXISTS idx_historico_movimentacoes_created_at ON historico_movimentacoes(created_at);

-- RLS Policies
ALTER TABLE historico_movimentacoes ENABLE ROW LEVEL SECURITY;

-- Todos podem ler histórico de movimentações
CREATE POLICY "Todos podem ler historico_movimentacoes"
    ON historico_movimentacoes
    FOR SELECT
    USING (true);

-- Usuários autenticados podem criar histórico de movimentações
CREATE POLICY "Usuários podem criar historico_movimentacoes"
    ON historico_movimentacoes
    FOR INSERT
    WITH CHECK (true);

COMMENT ON TABLE historico_movimentacoes IS 'Registra todas as movimentações e ações executadas nas coletas';

