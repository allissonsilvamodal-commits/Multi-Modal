-- Tabela para armazenar avaliações NineBox
CREATE TABLE IF NOT EXISTS ninebox_avaliacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_colaborador VARCHAR(255) NOT NULL,
    cargo VARCHAR(255) NOT NULL,
    departamento VARCHAR(255) NOT NULL,
    potencial VARCHAR(50) NOT NULL CHECK (potencial IN ('Abaixo da Expectativa', 'Dentro da Expectativa', 'Acima da Expectativa')),
    desempenho VARCHAR(50) NOT NULL CHECK (desempenho IN ('Abaixo da Expectativa', 'Dentro da Expectativa', 'Acima da Expectativa')),
    avaliado_por UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para melhorar performance
CREATE INDEX IF NOT EXISTS idx_ninebox_departamento ON ninebox_avaliacoes(departamento);
CREATE INDEX IF NOT EXISTS idx_ninebox_cargo ON ninebox_avaliacoes(cargo);
CREATE INDEX IF NOT EXISTS idx_ninebox_potencial ON ninebox_avaliacoes(potencial);
CREATE INDEX IF NOT EXISTS idx_ninebox_desempenho ON ninebox_avaliacoes(desempenho);
CREATE INDEX IF NOT EXISTS idx_ninebox_created_at ON ninebox_avaliacoes(created_at);

-- Comentários nas colunas
COMMENT ON TABLE ninebox_avaliacoes IS 'Armazena avaliações de potencial x desempenho (NineBox)';
COMMENT ON COLUMN ninebox_avaliacoes.nome_colaborador IS 'Nome completo do colaborador avaliado';
COMMENT ON COLUMN ninebox_avaliacoes.cargo IS 'Cargo/função do colaborador';
COMMENT ON COLUMN ninebox_avaliacoes.departamento IS 'Departamento do colaborador';
COMMENT ON COLUMN ninebox_avaliacoes.potencial IS 'Avaliação de potencial: Abaixo/Dentro/Acima da Expectativa';
COMMENT ON COLUMN ninebox_avaliacoes.desempenho IS 'Avaliação de desempenho: Abaixo/Dentro/Acima da Expectativa';
COMMENT ON COLUMN ninebox_avaliacoes.avaliado_por IS 'ID do usuário que realizou a avaliação';

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_ninebox_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ninebox_updated_at
    BEFORE UPDATE ON ninebox_avaliacoes
    FOR EACH ROW
    EXECUTE FUNCTION update_ninebox_updated_at();

