-- ============================================
-- TABELAS DE FERRAMENTAS DE QUALIDADE
-- ============================================

-- Tabela principal de ferramentas de qualidade
CREATE TABLE IF NOT EXISTS ferramentas_qualidade (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo_ferramenta TEXT NOT NULL, -- '5w2h', 'ishikawa', 'plano_acao', 'pdca', 'brainstorming'
  titulo TEXT NOT NULL,
  dados JSONB NOT NULL DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  observacoes TEXT,
  criado_por UUID NOT NULL REFERENCES auth.users(id),
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP,
  arquivado BOOLEAN DEFAULT FALSE,
  tem_prazos BOOLEAN DEFAULT FALSE,
  proximo_vencimento DATE
);

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_ferramentas_qualidade_criado_por ON ferramentas_qualidade(criado_por);
CREATE INDEX IF NOT EXISTS idx_ferramentas_qualidade_tipo ON ferramentas_qualidade(tipo_ferramenta);
CREATE INDEX IF NOT EXISTS idx_ferramentas_qualidade_arquivado ON ferramentas_qualidade(arquivado);
CREATE INDEX IF NOT EXISTS idx_ferramentas_qualidade_criado_em ON ferramentas_qualidade(criado_em DESC);

-- Tabela de alertas para planos de ação
CREATE TABLE IF NOT EXISTS ferramentas_qualidade_alertas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ferramenta_id UUID NOT NULL REFERENCES ferramentas_qualidade(id) ON DELETE CASCADE,
  acao_id TEXT NOT NULL, -- ID da ação dentro do plano
  responsavel_id UUID NOT NULL REFERENCES auth.users(id),
  superior_id UUID REFERENCES auth.users(id), -- Gestor imediato
  prazo DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente', -- 'pendente', 'em_alerta', 'vencido'
  alertado_responsavel BOOLEAN DEFAULT FALSE,
  alertado_superior BOOLEAN DEFAULT FALSE,
  data_alert_responsavel TIMESTAMP,
  data_alert_superior TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_alertas_responsavel ON ferramentas_qualidade_alertas(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_alertas_superior ON ferramentas_qualidade_alertas(superior_id);
CREATE INDEX IF NOT EXISTS idx_alertas_ferramenta ON ferramentas_qualidade_alertas(ferramenta_id);
CREATE INDEX IF NOT EXISTS idx_alertas_prazo ON ferramentas_qualidade_alertas(prazo);
CREATE INDEX IF NOT EXISTS idx_alertas_status ON ferramentas_qualidade_alertas(status);

-- RLS (Row Level Security) - Permitir que usuários vejam apenas suas próprias ferramentas
ALTER TABLE ferramentas_qualidade ENABLE ROW LEVEL SECURITY;
ALTER TABLE ferramentas_qualidade_alertas ENABLE ROW LEVEL SECURITY;

-- Política: usuários podem ver apenas suas próprias ferramentas
CREATE POLICY IF NOT EXISTS "Usuários podem ver suas próprias ferramentas"
  ON ferramentas_qualidade
  FOR SELECT
  USING (auth.uid() = criado_por);

-- Política: usuários podem criar suas próprias ferramentas
CREATE POLICY IF NOT EXISTS "Usuários podem criar suas próprias ferramentas"
  ON ferramentas_qualidade
  FOR INSERT
  WITH CHECK (auth.uid() = criado_por);

-- Política: usuários podem atualizar suas próprias ferramentas
CREATE POLICY IF NOT EXISTS "Usuários podem atualizar suas próprias ferramentas"
  ON ferramentas_qualidade
  FOR UPDATE
  USING (auth.uid() = criado_por);

-- Política: usuários podem ver alertas relacionados a eles
CREATE POLICY IF NOT EXISTS "Usuários podem ver seus alertas"
  ON ferramentas_qualidade_alertas
  FOR SELECT
  USING (auth.uid() = responsavel_id OR auth.uid() = superior_id);

-- Política: sistema pode criar alertas (via service role)
CREATE POLICY IF NOT EXISTS "Sistema pode criar alertas"
  ON ferramentas_qualidade_alertas
  FOR INSERT
  WITH CHECK (true);

-- Política: sistema pode atualizar alertas (via service role)
CREATE POLICY IF NOT EXISTS "Sistema pode atualizar alertas"
  ON ferramentas_qualidade_alertas
  FOR UPDATE
  USING (true);

-- Comentários nas tabelas
COMMENT ON TABLE ferramentas_qualidade IS 'Armazena ferramentas de qualidade criadas pelos usuários';
COMMENT ON TABLE ferramentas_qualidade_alertas IS 'Armazena alertas de ações que estão próximas de vencer ou vencidas';

COMMENT ON COLUMN ferramentas_qualidade.tipo_ferramenta IS 'Tipo da ferramenta: 5w2h, ishikawa, plano_acao, pdca, brainstorming';
COMMENT ON COLUMN ferramentas_qualidade.dados IS 'Dados específicos da ferramenta em formato JSON';
COMMENT ON COLUMN ferramentas_qualidade_alertas.status IS 'Status do alerta: pendente, em_alerta (≤3 dias), vencido';

