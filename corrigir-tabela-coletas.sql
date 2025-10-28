-- =====================================================
-- SQL DE CORREÇÃO PARA TABELA COLETAS
-- Sistema de Coletas Multimodal Logística
-- =====================================================

-- 1. ATUALIZAR CONSTRAINT DE ETAPAS PARA VALORES CORRETOS
-- Primeiro, vamos remover constraints antigas se existirem
DO $$ 
BEGIN
    -- Tentar remover constraint antiga se existir
    BEGIN
        ALTER TABLE coletas DROP CONSTRAINT IF EXISTS coletas_etapa_atual_check;
    EXCEPTION
        WHEN OTHERS THEN NULL;
    END;
END $$;

-- 2. ADICIONAR CONSTRAINT COM ETAPAS CORRETAS
ALTER TABLE coletas 
ADD CONSTRAINT coletas_etapa_atual_check 
CHECK (etapa_atual IN (
    'comercial',
    'price', 
    'cs',
    'contratacao',
    'gr',
    'documentacao',
    'controladoria',
    'contas_pagar',
    'contas_receber',
    'monitoramento'
));

-- 3. ATUALIZAR CONSTRAINT DE STATUS
DO $$ 
BEGIN
    -- Tentar remover constraint antiga se existir
    BEGIN
        ALTER TABLE coletas DROP CONSTRAINT IF EXISTS coletas_status_check;
    EXCEPTION
        WHEN OTHERS THEN NULL;
    END;
END $$;

ALTER TABLE coletas 
ADD CONSTRAINT coletas_status_check 
CHECK (status IN ('pendente', 'em_andamento', 'concluida', 'cancelada'));

-- 4. ATUALIZAR CONSTRAINT DE PRIORIDADE
DO $$ 
BEGIN
    -- Tentar remover constraint antiga se existir
    BEGIN
        ALTER TABLE coletas DROP CONSTRAINT IF EXISTS coletas_prioridade_check;
    EXCEPTION
        WHEN OTHERS THEN NULL;
    END;
END $$;

ALTER TABLE coletas 
ADD CONSTRAINT coletas_prioridade_check 
CHECK (prioridade IN ('baixa', 'normal', 'alta', 'urgente'));

-- 5. ATUALIZAR DADOS EXISTENTES COM ETAPA CORRETA
-- Mudar 'recebimento' para 'comercial' (primeira etapa)
UPDATE coletas 
SET etapa_atual = 'comercial' 
WHERE etapa_atual = 'recebimento';

-- 6. VERIFICAR SE EXISTEM OUTRAS ETAPAS INVÁLIDAS
SELECT DISTINCT etapa_atual, COUNT(*) as quantidade
FROM coletas 
GROUP BY etapa_atual
ORDER BY etapa_atual;

-- 7. CRIAR ÍNDICES PARA PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_coletas_etapa_atual ON coletas(etapa_atual);
CREATE INDEX IF NOT EXISTS idx_coletas_status ON coletas(status);
CREATE INDEX IF NOT EXISTS idx_coletas_motorista_id ON coletas(motorista_id);
CREATE INDEX IF NOT EXISTS idx_coletas_data_recebimento ON coletas(data_recebimento);

-- 8. VERIFICAR ESTRUTURA FINAL
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'coletas'
ORDER BY ordinal_position;

-- =====================================================
-- RESUMO DAS CORREÇÕES APLICADAS
-- =====================================================

-- ✅ 1. Atualizada constraint de etapas com valores corretos
-- ✅ 2. Adicionada constraint de status
-- ✅ 3. Adicionada constraint de prioridade  
-- ✅ 4. Atualizados dados existentes ('recebimento' → 'comercial')
-- ✅ 5. Criados índices para performance
-- ✅ 6. Verificação da estrutura final

-- =====================================================
-- ETAPAS CORRETAS DO SISTEMA:
-- =====================================================
-- 1. comercial
-- 2. price
-- 3. cs
-- 4. contratacao
-- 5. gr
-- 6. documentacao
-- 7. controladoria
-- 8. contas_pagar
-- 9. contas_receber
-- 10. monitoramento
