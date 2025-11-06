-- ============================================
-- SISTEMA DE PROJETOS/ANÁLISES DE QUALIDADE
-- ============================================

-- Tabela de projetos/análises (agrupa todas as ferramentas de um problema)
CREATE TABLE IF NOT EXISTS projetos_qualidade (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo TEXT NOT NULL,
  descricao TEXT,
  problema TEXT, -- Descrição do problema inicial
  status TEXT DEFAULT 'em_andamento', -- 'em_andamento', 'concluido', 'pausado', 'cancelado'
  criado_por UUID NOT NULL REFERENCES auth.users(id),
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW(),
  concluido_em TIMESTAMP,
  tags TEXT[] DEFAULT '{}',
  observacoes TEXT
);

-- Adicionar coluna projeto_id na tabela ferramentas_qualidade (se não existir)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ferramentas_qualidade' 
    AND column_name = 'projeto_id'
  ) THEN
    ALTER TABLE ferramentas_qualidade 
    ADD COLUMN projeto_id UUID REFERENCES projetos_qualidade(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_projetos_qualidade_criado_por ON projetos_qualidade(criado_por);
CREATE INDEX IF NOT EXISTS idx_projetos_qualidade_status ON projetos_qualidade(status);
CREATE INDEX IF NOT EXISTS idx_projetos_qualidade_criado_em ON projetos_qualidade(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_ferramentas_qualidade_projeto ON ferramentas_qualidade(projeto_id);

-- RLS (Row Level Security)
ALTER TABLE projetos_qualidade ENABLE ROW LEVEL SECURITY;

-- Política: usuários podem ver seus próprios projetos
CREATE POLICY IF NOT EXISTS "Usuários podem ver seus próprios projetos"
  ON projetos_qualidade
  FOR SELECT
  USING (auth.uid() = criado_por);

-- Política: usuários podem criar seus próprios projetos
CREATE POLICY IF NOT EXISTS "Usuários podem criar seus próprios projetos"
  ON projetos_qualidade
  FOR INSERT
  WITH CHECK (auth.uid() = criado_por);

-- Política: usuários podem atualizar seus próprios projetos
CREATE POLICY IF NOT EXISTS "Usuários podem atualizar seus próprios projetos"
  ON projetos_qualidade
  FOR UPDATE
  USING (auth.uid() = criado_por);

-- Política: usuários podem deletar seus próprios projetos
CREATE POLICY IF NOT EXISTS "Usuários podem deletar seus próprios projetos"
  ON projetos_qualidade
  FOR DELETE
  USING (auth.uid() = criado_por);

-- Comentários
COMMENT ON TABLE projetos_qualidade IS 'Agrupa ferramentas de qualidade relacionadas a um mesmo problema/análise';
COMMENT ON COLUMN projetos_qualidade.status IS 'Status do projeto: em_andamento, concluido, pausado, cancelado';
COMMENT ON COLUMN ferramentas_qualidade.projeto_id IS 'ID do projeto/análise ao qual esta ferramenta pertence';

