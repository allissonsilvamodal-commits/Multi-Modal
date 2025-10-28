-- =====================================================
-- SQL ATUALIZADO para Tabela COLETAS - Supabase
-- Sistema de Coletas Multimodal Logística
-- Etapas: Comercial, Price, CS, Contratação, GR, Documentação, Controladoria, Contas a Pagar, Contas a Receber, Monitoramento
-- =====================================================

-- 1. CRIAR TABELA COLETAS
CREATE TABLE IF NOT EXISTS coletas (
    id TEXT PRIMARY KEY,
    cliente TEXT NOT NULL,
    origem TEXT NOT NULL,
    destino TEXT NOT NULL,
    valor DECIMAL(10,2) DEFAULT 0,
    km INTEGER DEFAULT 0,
    veiculo TEXT,
    status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'andamento', 'concluida', 'cancelada')),
    etapa_atual TEXT DEFAULT 'comercial' CHECK (etapa_atual IN ('comercial', 'price', 'cs', 'contratacao', 'gr', 'documentacao', 'controladoria', 'contas-pagar', 'contas-receber', 'monitoramento')),
    etapas_concluidas TEXT[] DEFAULT '{}',
    
    -- Campos de Motorista
    motorista_id TEXT,
    
    -- Campos de GR (Gestão de Riscos)
    gr_aprovado BOOLEAN,
    gr_aprovado_por TEXT,
    gr_data_aprovacao TIMESTAMPTZ,
    gr_reprovado_por TEXT,
    gr_motivo_reprovacao TEXT,
    gr_data_reprovacao TIMESTAMPTZ,
    
    -- Campos de Controle
    data_recebimento TIMESTAMPTZ DEFAULT NOW(),
    data_atualizacao TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Campos Adicionais
    observacoes TEXT,
    prioridade TEXT DEFAULT 'normal' CHECK (prioridade IN ('baixa', 'normal', 'alta', 'urgente')),
    filial TEXT DEFAULT 'principal',
    
    -- Metadados
    created_by TEXT,
    updated_by TEXT
);

-- 2. CRIAR TABELA MOTORISTAS
CREATE TABLE IF NOT EXISTS motoristas (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    cpf TEXT UNIQUE NOT NULL,
    telefone TEXT NOT NULL,
    cnh TEXT UNIQUE NOT NULL,
    categoria TEXT NOT NULL CHECK (categoria IN ('A', 'B', 'C', 'D', 'E')),
    validade_cnh DATE NOT NULL,
    endereco TEXT,
    status TEXT DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo', 'suspenso')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CRIAR TABELA ANEXOS
CREATE TABLE IF NOT EXISTS anexos (
    id TEXT PRIMARY KEY,
    coleta_id TEXT NOT NULL REFERENCES coletas(id) ON DELETE CASCADE,
    nome_arquivo TEXT NOT NULL,
    tipo_arquivo TEXT NOT NULL,
    tamanho BIGINT NOT NULL,
    url TEXT NOT NULL,
    data_upload TIMESTAMPTZ DEFAULT NOW(),
    uploaded_by TEXT
);

-- 4. CRIAR TABELA CHAT_MENSAGENS
CREATE TABLE IF NOT EXISTS chat_mensagens (
    id TEXT PRIMARY KEY,
    coleta_id TEXT NOT NULL REFERENCES coletas(id) ON DELETE CASCADE,
    usuario TEXT NOT NULL,
    mensagem TEXT NOT NULL,
    tipo TEXT DEFAULT 'user' CHECK (tipo IN ('user', 'system', 'bot')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CRIAR TABELA HISTORICO_COLETAS
CREATE TABLE IF NOT EXISTS historico_coletas (
    id TEXT PRIMARY KEY,
    coleta_id TEXT NOT NULL REFERENCES coletas(id) ON DELETE CASCADE,
    usuario TEXT NOT NULL,
    acao TEXT NOT NULL,
    detalhes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- POLÍTICAS RLS (Row Level Security)
-- =====================================================

-- Habilitar RLS nas tabelas
ALTER TABLE coletas ENABLE ROW LEVEL SECURITY;
ALTER TABLE motoristas ENABLE ROW LEVEL SECURITY;
ALTER TABLE anexos ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE historico_coletas ENABLE ROW LEVEL SECURITY;

-- Políticas para coletas (permitir todas as operações para usuários autenticados)
CREATE POLICY "Usuários autenticados podem ver coletas" ON coletas
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem inserir coletas" ON coletas
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem atualizar coletas" ON coletas
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem deletar coletas" ON coletas
    FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para motoristas
CREATE POLICY "Usuários autenticados podem ver motoristas" ON motoristas
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem inserir motoristas" ON motoristas
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem atualizar motoristas" ON motoristas
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem deletar motoristas" ON motoristas
    FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para anexos
CREATE POLICY "Usuários autenticados podem ver anexos" ON anexos
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem inserir anexos" ON anexos
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem atualizar anexos" ON anexos
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem deletar anexos" ON anexos
    FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para chat_mensagens
CREATE POLICY "Usuários autenticados podem ver mensagens" ON chat_mensagens
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem inserir mensagens" ON chat_mensagens
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem atualizar mensagens" ON chat_mensagens
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem deletar mensagens" ON chat_mensagens
    FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para historico_coletas
CREATE POLICY "Usuários autenticados podem ver histórico" ON historico_coletas
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem inserir histórico" ON historico_coletas
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem atualizar histórico" ON historico_coletas
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados podem deletar histórico" ON historico_coletas
    FOR DELETE USING (auth.role() = 'authenticated');

-- =====================================================
-- DADOS DE EXEMPLO
-- =====================================================

-- Inserir alguns motoristas de exemplo
INSERT INTO motoristas (id, nome, cpf, telefone, cnh, categoria, validade_cnh, endereco, status) VALUES
('MOT001', 'João Silva Santos', '12345678901', '(11) 99999-9999', '12345678901', 'C', '2025-12-31', 'Rua das Flores, 123 - São Paulo/SP', 'ativo'),
('MOT002', 'Maria Oliveira Costa', '98765432109', '(11) 88888-8888', '98765432109', 'D', '2026-06-30', 'Av. Paulista, 456 - São Paulo/SP', 'ativo'),
('MOT003', 'Pedro Santos Lima', '11122233344', '(11) 77777-7777', '11122233344', 'E', '2025-09-15', 'Rua Augusta, 789 - São Paulo/SP', 'ativo')
ON CONFLICT (id) DO NOTHING;

-- Inserir uma coleta de exemplo
INSERT INTO coletas (
    id, cliente, origem, destino, valor, km, veiculo, status, etapa_atual, 
    etapas_concluidas, motorista_id, data_recebimento, observacoes, prioridade, filial
) VALUES (
    'COL001', 'Empresa ABC Ltda', 'São Paulo/SP', 'Rio de Janeiro/RJ', 2500.00, 450, 
    'Caminhão Mercedes-Benz', 'andamento', 'contratacao', 
    ARRAY['comercial', 'price', 'cs'], 'MOT001', NOW(), 'Coleta urgente para cliente VIP', 'alta', 'principal'
) ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- VERIFICAÇÃO FINAL
-- =====================================================

-- Verificar se as tabelas foram criadas corretamente
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name IN ('coletas', 'motoristas', 'anexos', 'chat_mensagens', 'historico_coletas')
ORDER BY table_name, ordinal_position;
