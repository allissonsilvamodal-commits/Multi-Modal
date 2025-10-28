-- Tabela de Etiquetas para Coletas
CREATE TABLE IF NOT EXISTS etiquetas_coletas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(255) NOT NULL UNIQUE,
    cor VARCHAR(7) NOT NULL DEFAULT '#667eea',
    descricao TEXT,
    ativo BOOLEAN DEFAULT true,
    criado_em TIMESTAMP DEFAULT NOW(),
    criado_por UUID REFERENCES auth.users(id),
    atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Adicionar campo de etiquetas na tabela de coletas
ALTER TABLE coletas 
ADD COLUMN IF NOT EXISTS etiquetas JSONB DEFAULT '[]'::jsonb;

-- Tabela intermediária para relacionar coletas com etiquetas (opcional, melhor que JSONB)
CREATE TABLE IF NOT EXISTS coleta_etiquetas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    coleta_id UUID REFERENCES coletas(id) ON DELETE CASCADE,
    etiqueta_id UUID REFERENCES etiquetas_coletas(id) ON DELETE CASCADE,
    criado_em TIMESTAMP DEFAULT NOW(),
    UNIQUE(coleta_id, etiqueta_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_coleta_etiquetas_coleta_id ON coleta_etiquetas(coleta_id);
CREATE INDEX IF NOT EXISTS idx_coleta_etiquetas_etiqueta_id ON coleta_etiquetas(etiqueta_id);
CREATE INDEX IF NOT EXISTS idx_etiquetas_coletas_ativo ON etiquetas_coletas(ativo);

-- RLS Policies para etiquetas
ALTER TABLE etiquetas_coletas ENABLE ROW LEVEL SECURITY;

-- Todos podem ler etiquetas ativas
CREATE POLICY "Todos podem ler etiquetas ativas"
    ON etiquetas_coletas
    FOR SELECT
    USING (ativo = true);

-- Apenas admins podem criar, atualizar e deletar etiquetas
CREATE POLICY "Apenas admins podem criar etiquetas"
    ON etiquetas_coletas
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_id = auth.uid()
            AND (is_admin = true OR role = 'admin')
        )
    );

CREATE POLICY "Apenas admins podem atualizar etiquetas"
    ON etiquetas_coletas
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_id = auth.uid()
            AND (is_admin = true OR role = 'admin')
        )
    );

CREATE POLICY "Apenas admins podem deletar etiquetas"
    ON etiquetas_coletas
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_id = auth.uid()
            AND (is_admin = true OR role = 'admin')
        )
    );

-- RLS para coleta_etiquetas
ALTER TABLE coleta_etiquetas ENABLE ROW LEVEL SECURITY;

-- Usuários podem ver etiquetas de coletas
CREATE POLICY "Todos podem ler coleta_etiquetas"
    ON coleta_etiquetas
    FOR SELECT
    USING (true);

-- Usuários podem adicionar/remover etiquetas de coletas que podem editar
CREATE POLICY "Usuários podem gerenciar etiquetas de coletas"
    ON coleta_etiquetas
    FOR ALL
    USING (
        -- Verificar se o usuário pode editar a coleta (simplificado para permitir todos por enquanto)
        true
    );

COMMENT ON TABLE etiquetas_coletas IS 'Etiquetas personalizáveis para categorizar coletas';
COMMENT ON TABLE coleta_etiquetas IS 'Relacionamento entre coletas e etiquetas';

