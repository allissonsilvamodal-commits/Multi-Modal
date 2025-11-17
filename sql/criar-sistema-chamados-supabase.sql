-- ============================================
-- SISTEMA DE CHAMADOS DE ÚLTIMA GERAÇÃO
-- Multimodal - Sistema Intranet
-- Executar no Supabase SQL Editor
-- ============================================

-- Tabela principal de chamados
CREATE TABLE IF NOT EXISTS chamados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_sequencial SERIAL UNIQUE,
    titulo VARCHAR(255) NOT NULL,
    descricao TEXT NOT NULL,
    categoria VARCHAR(50) NOT NULL,
    subcategoria VARCHAR(100),
    prioridade VARCHAR(20) NOT NULL DEFAULT 'media',
    status VARCHAR(30) NOT NULL DEFAULT 'aberto',
    
    -- Usuário que criou
    usuario_id VARCHAR(255) NOT NULL,
    usuario_nome VARCHAR(255) NOT NULL,
    usuario_email VARCHAR(255),
    usuario_departamento VARCHAR(100),
    
    -- Atribuição ao time de projetos
    atribuido_para VARCHAR(255),
    atribuido_nome VARCHAR(255),
    atribuido_em TIMESTAMP,
    time_responsavel VARCHAR(100) DEFAULT 'projetos',
    
    -- SLA e prazos
    prazo_resposta TIMESTAMP,
    prazo_resolucao TIMESTAMP,
    tempo_resposta_minutos INTEGER,
    tempo_resolucao_minutos INTEGER,
    
    -- Anexos e mídia
    imagem_url TEXT,
    anexos JSONB DEFAULT '[]'::jsonb,
    
    -- Tags e metadados
    tags TEXT[] DEFAULT '{}',
    ambiente VARCHAR(50),
    versao_sistema VARCHAR(50),
    
    -- Resolução
    resposta TEXT,
    resposta_data TIMESTAMP,
    resolvido_por VARCHAR(255),
    
    -- Feedback
    satisfacao INTEGER CHECK (satisfacao >= 1 AND satisfacao <= 5),
    feedback TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fechado_em TIMESTAMP
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_chamados_status ON chamados(status);
CREATE INDEX IF NOT EXISTS idx_chamados_prioridade ON chamados(prioridade);
CREATE INDEX IF NOT EXISTS idx_chamados_categoria ON chamados(categoria);
CREATE INDEX IF NOT EXISTS idx_chamados_usuario_id ON chamados(usuario_id);
CREATE INDEX IF NOT EXISTS idx_chamados_atribuido_para ON chamados(atribuido_para);
CREATE INDEX IF NOT EXISTS idx_chamados_time_responsavel ON chamados(time_responsavel);
CREATE INDEX IF NOT EXISTS idx_chamados_created_at ON chamados(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chamados_numero_sequencial ON chamados(numero_sequencial);

-- Tabela de comentários/interações
CREATE TABLE IF NOT EXISTS chamados_comentarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chamado_id UUID NOT NULL,
    usuario_id VARCHAR(255) NOT NULL,
    usuario_nome VARCHAR(255) NOT NULL,
    comentario TEXT NOT NULL,
    tipo VARCHAR(20) DEFAULT 'comentario',
    anexos JSONB DEFAULT '[]'::jsonb,
    interno BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT fk_chamado FOREIGN KEY (chamado_id) REFERENCES chamados(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comentarios_chamado ON chamados_comentarios(chamado_id);
CREATE INDEX IF NOT EXISTS idx_comentarios_created_at ON chamados_comentarios(created_at DESC);

-- Tabela de histórico de mudanças
CREATE TABLE IF NOT EXISTS chamados_historico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chamado_id UUID NOT NULL,
    campo_alterado VARCHAR(50),
    valor_anterior TEXT,
    valor_novo TEXT,
    usuario_id VARCHAR(255) NOT NULL,
    usuario_nome VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT fk_chamado_hist FOREIGN KEY (chamado_id) REFERENCES chamados(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_historico_chamado ON chamados_historico(chamado_id);

-- Tabela de notificações
CREATE TABLE IF NOT EXISTS chamados_notificacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chamado_id UUID NOT NULL,
    usuario_id VARCHAR(255) NOT NULL,
    tipo VARCHAR(50) NOT NULL,
    titulo VARCHAR(255) NOT NULL,
    mensagem TEXT,
    lida BOOLEAN DEFAULT false,
    lida_em TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT fk_chamado_notif FOREIGN KEY (chamado_id) REFERENCES chamados(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON chamados_notificacoes(usuario_id, lida);
CREATE INDEX IF NOT EXISTS idx_notificacoes_chamado ON chamados_notificacoes(chamado_id);

-- Tabela de templates de resposta
CREATE TABLE IF NOT EXISTS chamados_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome VARCHAR(255) NOT NULL,
    categoria VARCHAR(50),
    conteudo TEXT NOT NULL,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de configurações de SLA
CREATE TABLE IF NOT EXISTS chamados_sla (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    categoria VARCHAR(50) NOT NULL,
    prioridade VARCHAR(20) NOT NULL,
    tempo_resposta_horas INTEGER NOT NULL,
    tempo_resolucao_horas INTEGER NOT NULL,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(categoria, prioridade)
);

-- Inserir SLAs padrão
INSERT INTO chamados_sla (categoria, prioridade, tempo_resposta_horas, tempo_resolucao_horas) VALUES
('bug', 'urgente', 1, 4),
('bug', 'alta', 2, 8),
('bug', 'media', 4, 24),
('bug', 'baixa', 8, 48),
('melhoria', 'urgente', 2, 8),
('melhoria', 'alta', 4, 24),
('melhoria', 'media', 8, 72),
('melhoria', 'baixa', 24, 168),
('duvida', 'urgente', 1, 2),
('duvida', 'alta', 2, 4),
('duvida', 'media', 4, 8),
('duvida', 'baixa', 8, 24),
('sugestao', 'urgente', 4, 24),
('sugestao', 'alta', 8, 72),
('sugestao', 'media', 24, 168),
('sugestao', 'baixa', 48, 336),
('outro', 'urgente', 2, 8),
('outro', 'alta', 4, 24),
('outro', 'media', 8, 72),
('outro', 'baixa', 24, 168)
ON CONFLICT (categoria, prioridade) DO NOTHING;

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_chamados_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar updated_at
DROP TRIGGER IF EXISTS trigger_update_chamados_updated_at ON chamados;
CREATE TRIGGER trigger_update_chamados_updated_at
    BEFORE UPDATE ON chamados
    FOR EACH ROW
    EXECUTE FUNCTION update_chamados_updated_at();

-- Função para registrar histórico automaticamente
CREATE OR REPLACE FUNCTION registrar_historico_chamado()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO chamados_historico (chamado_id, campo_alterado, valor_anterior, valor_novo, usuario_id, usuario_nome)
        VALUES (NEW.id, 'status', OLD.status, NEW.status, COALESCE(NEW.atribuido_para, NEW.usuario_id), COALESCE(NEW.atribuido_nome, NEW.usuario_nome));
    END IF;
    
    IF OLD.prioridade IS DISTINCT FROM NEW.prioridade THEN
        INSERT INTO chamados_historico (chamado_id, campo_alterado, valor_anterior, valor_novo, usuario_id, usuario_nome)
        VALUES (NEW.id, 'prioridade', OLD.prioridade, NEW.prioridade, COALESCE(NEW.atribuido_para, NEW.usuario_id), COALESCE(NEW.atribuido_nome, NEW.usuario_nome));
    END IF;
    
    IF OLD.atribuido_para IS DISTINCT FROM NEW.atribuido_para THEN
        INSERT INTO chamados_historico (chamado_id, campo_alterado, valor_anterior, valor_novo, usuario_id, usuario_nome)
        VALUES (NEW.id, 'atribuido_para', COALESCE(OLD.atribuido_nome, 'Não atribuído'), COALESCE(NEW.atribuido_nome, 'Não atribuído'), COALESCE(NEW.atribuido_para, NEW.usuario_id), COALESCE(NEW.atribuido_nome, NEW.usuario_nome));
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para histórico
DROP TRIGGER IF EXISTS trigger_registrar_historico_chamado ON chamados;
CREATE TRIGGER trigger_registrar_historico_chamado
    AFTER UPDATE ON chamados
    FOR EACH ROW
    EXECUTE FUNCTION registrar_historico_chamado();

-- View para estatísticas
CREATE OR REPLACE VIEW vw_chamados_estatisticas AS
SELECT 
    COUNT(*) FILTER (WHERE status = 'aberto') as total_abertos,
    COUNT(*) FILTER (WHERE status = 'em_andamento') as total_em_andamento,
    COUNT(*) FILTER (WHERE status = 'aguardando') as total_aguardando,
    COUNT(*) FILTER (WHERE status = 'resolvido') as total_resolvidos,
    COUNT(*) FILTER (WHERE status = 'fechado') as total_fechados,
    COUNT(*) FILTER (WHERE prioridade = 'urgente') as total_urgentes,
    COUNT(*) FILTER (WHERE prioridade = 'alta') as total_alta,
    COUNT(*) FILTER (WHERE prioridade = 'media') as total_media,
    COUNT(*) FILTER (WHERE prioridade = 'baixa') as total_baixa,
    COUNT(*) as total_chamados,
    AVG(tempo_resolucao_minutos) FILTER (WHERE status IN ('resolvido', 'fechado')) as tempo_medio_resolucao,
    COUNT(*) FILTER (WHERE prazo_resolucao < NOW() AND status NOT IN ('resolvido', 'fechado')) as chamados_atrasados
FROM chamados;

-- Habilitar RLS
ALTER TABLE chamados ENABLE ROW LEVEL SECURITY;
ALTER TABLE chamados_comentarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE chamados_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE chamados_notificacoes ENABLE ROW LEVEL SECURITY;

-- Remover políticas antigas se existirem
DROP POLICY IF EXISTS "Usuários podem ver seus chamados" ON chamados;
DROP POLICY IF EXISTS "Usuários podem criar chamados" ON chamados;
DROP POLICY IF EXISTS "Time de projetos pode ver todos" ON chamados;
DROP POLICY IF EXISTS "Time pode atualizar chamados" ON chamados;
DROP POLICY IF EXISTS "Usuários podem ver comentários" ON chamados_comentarios;
DROP POLICY IF EXISTS "Usuários podem criar comentários" ON chamados_comentarios;
DROP POLICY IF EXISTS "Usuários podem ver notificações" ON chamados_notificacoes;

-- Políticas RLS para chamados
CREATE POLICY "Usuários podem ver seus chamados" ON chamados
    FOR SELECT
    USING (
        auth.uid()::text = usuario_id OR 
        auth.uid()::text = atribuido_para OR
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE id = auth.uid() 
            AND (
                (raw_user_meta_data->>'departamento')::text = 'projetos' OR 
                (raw_user_meta_data->>'perfil')::text = 'admin'
            )
        )
    );

CREATE POLICY "Usuários podem criar chamados" ON chamados
    FOR INSERT
    WITH CHECK (auth.uid()::text = usuario_id);

CREATE POLICY "Time de projetos pode ver todos" ON chamados
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE id = auth.uid() 
            AND (
                (raw_user_meta_data->>'departamento')::text = 'projetos' OR 
                (raw_user_meta_data->>'perfil')::text = 'admin'
            )
        )
    );

CREATE POLICY "Time pode atualizar chamados" ON chamados
    FOR UPDATE
    USING (
        auth.uid()::text = atribuido_para OR
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE id = auth.uid() 
            AND (
                (raw_user_meta_data->>'departamento')::text = 'projetos' OR 
                (raw_user_meta_data->>'perfil')::text = 'admin'
            )
        )
    );

-- Políticas para comentários
CREATE POLICY "Usuários podem ver comentários" ON chamados_comentarios
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM chamados 
            WHERE chamados.id = chamados_comentarios.chamado_id 
            AND (
                chamados.usuario_id = auth.uid()::text OR 
                chamados.atribuido_para = auth.uid()::text
            )
        ) OR
        NOT interno
    );

CREATE POLICY "Usuários podem criar comentários" ON chamados_comentarios
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM chamados 
            WHERE chamados.id = chamados_comentarios.chamado_id 
            AND (
                chamados.usuario_id = auth.uid()::text OR
                chamados.atribuido_para = auth.uid()::text
            )
        )
    );

-- Políticas para notificações
CREATE POLICY "Usuários podem ver notificações" ON chamados_notificacoes
    FOR SELECT
    USING (auth.uid()::text = usuario_id);

-- Comentários nas tabelas
COMMENT ON TABLE chamados IS 'Sistema de chamados de última geração - Multimodal';
COMMENT ON TABLE chamados_comentarios IS 'Comentários e interações nos chamados';
COMMENT ON TABLE chamados_historico IS 'Histórico completo de mudanças nos chamados';
COMMENT ON TABLE chamados_notificacoes IS 'Sistema de notificações de chamados';

