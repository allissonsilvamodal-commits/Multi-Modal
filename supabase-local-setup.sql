-- =====================================================
-- SCRIPT SUPABASE LOCAL - CONFIGURAÇÃO COMPLETA
-- Multimodal Logística - Usando Extensão Supabase
-- =====================================================

-- 1. CRIAR EXTENSÕES NECESSÁRIAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. CRIAR TABELA MOTORISTAS
CREATE TABLE IF NOT EXISTS motoristas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(255) NOT NULL,
    cpf VARCHAR(14) UNIQUE NOT NULL,
    cnh VARCHAR(20) UNIQUE NOT NULL,
    telefone VARCHAR(20),
    email VARCHAR(255),
    endereco TEXT,
    categoria_cnh VARCHAR(10) CHECK (categoria_cnh IN ('A', 'B', 'C', 'D', 'E')),
    status VARCHAR(20) DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo', 'suspenso')),
    data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. CRIAR TABELA COLETAS COM CONSTRAINTS CORRETAS
CREATE TABLE IF NOT EXISTS coletas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente VARCHAR(255) NOT NULL,
    origem VARCHAR(255) NOT NULL,
    destino VARCHAR(255) NOT NULL,
    valor DECIMAL(10,2) NOT NULL,
    km INTEGER NOT NULL,
    veiculo VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente', 'em_andamento', 'concluida', 'cancelada')),
    etapa_atual VARCHAR(50) DEFAULT 'comercial' CHECK (etapa_atual IN (
        'comercial', 'price', 'cs', 'contratacao', 'gr', 
        'documentacao', 'controladoria', 'contas_pagar', 
        'contas_receber', 'monitoramento'
    )),
    etapas_concluidas JSONB DEFAULT '[]'::jsonb,
    motorista_id UUID REFERENCES motoristas(id),
    gr_aprovado BOOLEAN DEFAULT FALSE,
    gr_aprovado_por VARCHAR(255),
    gr_data_aprovacao TIMESTAMP,
    gr_reprovado_por VARCHAR(255),
    gr_motivo_reprovacao TEXT,
    gr_data_reprovacao TIMESTAMP,
    data_recebimento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    observacoes TEXT,
    prioridade VARCHAR(20) DEFAULT 'normal' CHECK (prioridade IN ('baixa', 'normal', 'alta', 'urgente')),
    filial VARCHAR(100) DEFAULT 'principal',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    updated_by VARCHAR(255)
);

-- 4. CRIAR TABELA ANEXOS
CREATE TABLE IF NOT EXISTS anexos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    coleta_id UUID NOT NULL REFERENCES coletas(id) ON DELETE CASCADE,
    nome_arquivo VARCHAR(255) NOT NULL,
    tipo_arquivo VARCHAR(100),
    tamanho_arquivo BIGINT,
    caminho_arquivo TEXT NOT NULL,
    descricao TEXT,
    uploaded_by VARCHAR(255),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. CRIAR TABELA CHAT MENSAGENS
CREATE TABLE IF NOT EXISTS chat_mensagens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    coleta_id UUID NOT NULL REFERENCES coletas(id) ON DELETE CASCADE,
    usuario VARCHAR(255) NOT NULL,
    mensagem TEXT NOT NULL,
    data_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tipo_mensagem VARCHAR(20) DEFAULT 'texto' CHECK (tipo_mensagem IN ('texto', 'sistema', 'anexo'))
);

-- 6. CRIAR TABELA HISTÓRICO COLETAS
CREATE TABLE IF NOT EXISTS historico_coletas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    coleta_id UUID NOT NULL REFERENCES coletas(id) ON DELETE CASCADE,
    etapa_anterior VARCHAR(50),
    etapa_atual VARCHAR(50) NOT NULL,
    acao VARCHAR(100) NOT NULL,
    usuario VARCHAR(255) NOT NULL,
    observacoes TEXT,
    data_movimentacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. CRIAR TABELA USUÁRIOS
CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    nome VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'gr', 'operador')),
    instance_name VARCHAR(100) DEFAULT 'default_instance',
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- 8. CRIAR TABELA PERMISSÕES PORTAL
CREATE TABLE IF NOT EXISTS permissoes_portal (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id VARCHAR(255) NOT NULL,
    modulo VARCHAR(100) NOT NULL,
    permissao VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. CRIAR TABELA PERMISSÕES COLETAS
CREATE TABLE IF NOT EXISTS permissoes_coletas (
    id SERIAL PRIMARY KEY,
    usuario_id VARCHAR(255) NOT NULL,
    etapa_id VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 10. CRIAR TABELA CONFIGURAÇÕES SISTEMA
CREATE TABLE IF NOT EXISTS configuracoes_sistema (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chave VARCHAR(100) UNIQUE NOT NULL,
    valor TEXT NOT NULL,
    descricao TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. CRIAR TABELA EVOLUTION CONFIG
CREATE TABLE IF NOT EXISTS evolution_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instance_name VARCHAR(100) UNIQUE NOT NULL,
    api_key VARCHAR(255) NOT NULL,
    webhook_url TEXT,
    status VARCHAR(20) DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo', 'erro')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. CRIAR TABELA PROFILES
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL,
    nome VARCHAR(255),
    avatar_url TEXT,
    telefone VARCHAR(20),
    departamento VARCHAR(100),
    cargo VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 13. CRIAR ÍNDICES PARA PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_coletas_etapa_atual ON coletas(etapa_atual);
CREATE INDEX IF NOT EXISTS idx_coletas_status ON coletas(status);
CREATE INDEX IF NOT EXISTS idx_coletas_motorista_id ON coletas(motorista_id);
CREATE INDEX IF NOT EXISTS idx_coletas_data_recebimento ON coletas(data_recebimento);
CREATE INDEX IF NOT EXISTS idx_coletas_cliente ON coletas(cliente);
CREATE INDEX IF NOT EXISTS idx_motoristas_cpf ON motoristas(cpf);
CREATE INDEX IF NOT EXISTS idx_motoristas_cnh ON motoristas(cnh);
CREATE INDEX IF NOT EXISTS idx_anexos_coleta_id ON anexos(coleta_id);
CREATE INDEX IF NOT EXISTS idx_chat_coleta_id ON chat_mensagens(coleta_id);
CREATE INDEX IF NOT EXISTS idx_historico_coleta_id ON historico_coletas(coleta_id);

-- 14. CRIAR TRIGGERS PARA UPDATED_AT
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Aplicar triggers
CREATE TRIGGER update_motoristas_updated_at BEFORE UPDATE ON motoristas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_coletas_updated_at BEFORE UPDATE ON coletas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_usuarios_updated_at BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_configuracoes_updated_at BEFORE UPDATE ON configuracoes_sistema FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_evolution_updated_at BEFORE UPDATE ON evolution_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 15. INSERIR DADOS DE EXEMPLO
INSERT INTO motoristas (nome, cpf, cnh, telefone, email, categoria_cnh) VALUES
('João Silva', '123.456.789-00', '12345678901', '(11) 99999-9999', 'joao@email.com', 'C'),
('Maria Santos', '987.654.321-00', '98765432109', '(11) 88888-8888', 'maria@email.com', 'C'),
('Pedro Oliveira', '456.789.123-00', '45678912345', '(11) 77777-7777', 'pedro@email.com', 'D')
ON CONFLICT (cpf) DO NOTHING;

INSERT INTO usuarios (email, username, nome, role, is_admin) VALUES
('allisson.silva.modal@gmail.com', 'allisson.silva.modal', 'Allisson Silva', 'admin', TRUE),
('admin@multimodal.com', 'admin', 'Administrador', 'admin', TRUE),
('operador@multimodal.com', 'operador', 'Operador', 'operador', FALSE)
ON CONFLICT (email) DO NOTHING;

INSERT INTO coletas (cliente, origem, destino, valor, km, veiculo, etapa_atual, motorista_id, observacoes) VALUES
('Cliente Teste', 'São Paulo/SP', 'Rio de Janeiro/RJ', 1500.00, 450, 'Caminhão Truck', 'comercial', 
 (SELECT id FROM motoristas WHERE cpf = '123.456.789-00'), 'Primeira coleta de teste'),
('Empresa ABC', 'Belo Horizonte/MG', 'Salvador/BA', 2200.00, 650, 'Caminhão Baú', 'price', 
 (SELECT id FROM motoristas WHERE cpf = '987.654.321-00'), 'Coleta de produtos eletrônicos')
ON CONFLICT DO NOTHING;

-- 16. CONFIGURAÇÕES INICIAIS
INSERT INTO configuracoes_sistema (chave, valor, descricao) VALUES
('sistema_nome', 'Multimodal Logística', 'Nome do sistema'),
('sistema_versao', '1.0.0', 'Versão atual do sistema'),
('max_coletas_por_usuario', '100', 'Máximo de coletas por usuário'),
('etapas_obrigatorias', 'comercial,price,cs,contratacao,gr,documentacao,controladoria,contas_pagar,contas_receber,monitoramento', 'Etapas obrigatórias do sistema')
ON CONFLICT (chave) DO NOTHING;

-- 17. VERIFICAÇÃO FINAL
SELECT '✅ SCHEMA CRIADO COM SUCESSO!' as resultado;
SELECT COUNT(*) as total_motoristas FROM motoristas;
SELECT COUNT(*) as total_coletas FROM coletas;
SELECT COUNT(*) as total_usuarios FROM usuarios;
