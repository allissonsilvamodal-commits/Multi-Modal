-- =====================================================
-- TABELA PARA SOLICITAÇÕES DE ATUALIZAÇÃO DE DOCUMENTOS
-- Permite que GR solicite atualização de documentos específicos
-- =====================================================

CREATE TABLE IF NOT EXISTS solicitacoes_documentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coleta_id UUID NOT NULL REFERENCES coletas(id) ON DELETE CASCADE,
    motorista_id UUID NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
    categoria TEXT NOT NULL CHECK (categoria IN ('proprietario', 'veiculo', 'motorista', 'outro')),
    motivo TEXT NOT NULL,
    solicitado_por TEXT NOT NULL,
    solicitado_em TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'atendida', 'cancelada')),
    atendido_em TIMESTAMPTZ,
    observacoes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_motorista ON solicitacoes_documentos(motorista_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_coleta ON solicitacoes_documentos(coleta_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_status ON solicitacoes_documentos(status);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_pendentes ON solicitacoes_documentos(motorista_id, status) WHERE status = 'pendente';

-- Comentários nas colunas
COMMENT ON TABLE solicitacoes_documentos IS 'Solicitações do GR para atualização de documentos do motorista';
COMMENT ON COLUMN solicitacoes_documentos.categoria IS 'Categoria do documento que precisa ser atualizado';
COMMENT ON COLUMN solicitacoes_documentos.motivo IS 'Motivo da solicitação de atualização';
COMMENT ON COLUMN solicitacoes_documentos.status IS 'Status da solicitação: pendente, atendida, cancelada';

