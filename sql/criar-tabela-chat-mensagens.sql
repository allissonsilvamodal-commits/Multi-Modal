-- ============================================
-- TABELA DE MENSAGENS DO CHAT INTERNO
-- Multimodal - Sistema Intranet
-- Executar no Supabase SQL Editor
-- ============================================

-- Tabela principal de mensagens
CREATE TABLE IF NOT EXISTS chat_mensagens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Remetente
    remetente_id VARCHAR(255) NOT NULL,
    remetente_nome VARCHAR(255) NOT NULL,
    
    -- Destinatário
    destinatario_id VARCHAR(255) NOT NULL,
    destinatario_nome VARCHAR(255) NOT NULL,
    
    -- Mensagem
    mensagem TEXT NOT NULL,
    
    -- Status
    lida BOOLEAN DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_chat_remetente ON chat_mensagens(remetente_id);
CREATE INDEX IF NOT EXISTS idx_chat_destinatario ON chat_mensagens(destinatario_id);
CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat_mensagens(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_lida ON chat_mensagens(lida) WHERE lida = false;
CREATE INDEX IF NOT EXISTS idx_chat_conversa ON chat_mensagens(remetente_id, destinatario_id, created_at DESC);

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_chat_mensagens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar updated_at
CREATE TRIGGER trigger_update_chat_mensagens_updated_at
    BEFORE UPDATE ON chat_mensagens
    FOR EACH ROW
    EXECUTE FUNCTION update_chat_mensagens_updated_at();

-- RLS (Row Level Security) - Permitir que usuários vejam apenas suas próprias mensagens
ALTER TABLE chat_mensagens ENABLE ROW LEVEL SECURITY;

-- Política: Usuários podem ver mensagens onde são remetente ou destinatário
CREATE POLICY "Usuários podem ver suas próprias mensagens"
    ON chat_mensagens
    FOR SELECT
    USING (
        auth.uid()::text = remetente_id OR 
        auth.uid()::text = destinatario_id
    );

-- Política: Usuários podem inserir mensagens onde são remetente
CREATE POLICY "Usuários podem enviar mensagens"
    ON chat_mensagens
    FOR INSERT
    WITH CHECK (
        auth.uid()::text = remetente_id
    );

-- Política: Usuários podem atualizar apenas mensagens onde são destinatário (marcar como lida)
CREATE POLICY "Usuários podem marcar mensagens como lidas"
    ON chat_mensagens
    FOR UPDATE
    USING (
        auth.uid()::text = destinatario_id
    )
    WITH CHECK (
        auth.uid()::text = destinatario_id
    );

-- Comentários nas colunas
COMMENT ON TABLE chat_mensagens IS 'Tabela para armazenar mensagens do chat interno entre usuários';
COMMENT ON COLUMN chat_mensagens.remetente_id IS 'ID do usuário que enviou a mensagem';
COMMENT ON COLUMN chat_mensagens.destinatario_id IS 'ID do usuário que recebeu a mensagem';
COMMENT ON COLUMN chat_mensagens.mensagem IS 'Conteúdo da mensagem';
COMMENT ON COLUMN chat_mensagens.lida IS 'Indica se a mensagem foi lida pelo destinatário';

