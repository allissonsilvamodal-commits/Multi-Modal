-- =====================================================
-- SCRIPT DE VERIFICAÇÃO E CORREÇÃO DO SCHEMA
-- Para envio de documentos do motorista
-- =====================================================

-- 1. VERIFICAR ESTRUTURA DA TABELA anexos
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'anexos' 
ORDER BY ordinal_position;

-- 2. VERIFICAR SE EXISTE A TABELA motorista_documentos
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'motorista_documentos'
) AS tabela_existe;

-- 3. SE A TABELA motorista_documentos NÃO EXISTIR, CRIAR
CREATE TABLE IF NOT EXISTS motorista_documentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    motorista_id UUID NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
    categoria TEXT NOT NULL CHECK (categoria IN ('proprietario', 'veiculo', 'motorista', 'outro')),
    nome_arquivo TEXT NOT NULL,
    tipo_arquivo TEXT,
    tamanho BIGINT,
    url TEXT NOT NULL,
    status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'reprovado')),
    validade DATE,
    observacoes TEXT,
    uploaded_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. VERIFICAR E CORRIGIR COLUNAS DA TABELA anexos
-- Se a tabela usar 'tamanho_arquivo' em vez de 'tamanho', adicionar coluna 'tamanho'
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'anexos' AND column_name = 'tamanho'
    ) THEN
        -- Se existir 'tamanho_arquivo', renomear para 'tamanho'
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'anexos' AND column_name = 'tamanho_arquivo'
        ) THEN
            ALTER TABLE anexos RENAME COLUMN tamanho_arquivo TO tamanho;
        ELSE
            -- Adicionar coluna 'tamanho' se não existir nenhuma das duas
            ALTER TABLE anexos ADD COLUMN tamanho BIGINT;
        END IF;
    END IF;
END $$;

-- Se a tabela usar 'caminho_arquivo' em vez de 'url', adicionar coluna 'url'
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'anexos' AND column_name = 'url'
    ) THEN
        -- Se existir 'caminho_arquivo', adicionar 'url' e copiar dados
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'anexos' AND column_name = 'caminho_arquivo'
        ) THEN
            ALTER TABLE anexos ADD COLUMN url TEXT;
            UPDATE anexos SET url = caminho_arquivo WHERE url IS NULL;
            ALTER TABLE anexos ALTER COLUMN url SET NOT NULL;
        ELSE
            -- Adicionar coluna 'url' se não existir nenhuma das duas
            ALTER TABLE anexos ADD COLUMN url TEXT NOT NULL;
        END IF;
    END IF;
END $$;

-- Garantir que 'uploaded_by' existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'anexos' AND column_name = 'uploaded_by'
    ) THEN
        ALTER TABLE anexos ADD COLUMN uploaded_by TEXT;
    END IF;
END $$;

-- 5. VERIFICAR ESTRUTURA FINAL DA TABELA anexos
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'anexos' 
ORDER BY ordinal_position;

-- 6. VERIFICAR ESTRUTURA FINAL DA TABELA motorista_documentos
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'motorista_documentos' 
ORDER BY ordinal_position;

-- 7. VERIFICAR ESTRUTURA DA TABELA chat_mensagens
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'chat_mensagens' 
ORDER BY ordinal_position;

