-- =====================================================
-- CORREÇÃO DE DADOS ANTES DE APLICAR CONSTRAINTS
-- Sistema de Coletas Multimodal Logística
-- =====================================================

-- 1. VERIFICAR QUAIS ETAPAS EXISTEM ATUALMENTE
SELECT DISTINCT etapa_atual, COUNT(*) as quantidade
FROM coletas 
GROUP BY etapa_atual
ORDER BY etapa_atual;

-- 2. VERIFICAR QUAIS STATUS EXISTEM ATUALMENTE
SELECT DISTINCT status, COUNT(*) as quantidade
FROM coletas 
GROUP BY status
ORDER BY status;

-- 3. VERIFICAR QUAIS PRIORIDADES EXISTEM ATUALMENTE
SELECT DISTINCT prioridade, COUNT(*) as quantidade
FROM coletas 
GROUP BY prioridade
ORDER BY prioridade;

-- 4. CORRIGIR ETAPAS INVÁLIDAS PARA ETAPAS VÁLIDAS
-- Mapear etapas antigas para novas etapas corretas
UPDATE coletas 
SET etapa_atual = CASE 
    WHEN etapa_atual = 'recebimento' THEN 'comercial'
    WHEN etapa_atual = 'comercial' THEN 'comercial'
    WHEN etapa_atual = 'price' THEN 'price'
    WHEN etapa_atual = 'cs' THEN 'cs'
    WHEN etapa_atual = 'contratacao' THEN 'contratacao'
    WHEN etapa_atual = 'gr' THEN 'gr'
    WHEN etapa_atual = 'documentacao' THEN 'documentacao'
    WHEN etapa_atual = 'controladoria' THEN 'controladoria'
    WHEN etapa_atual = 'contas_pagar' THEN 'contas_pagar'
    WHEN etapa_atual = 'contas_receber' THEN 'contas_receber'
    WHEN etapa_atual = 'monitoramento' THEN 'monitoramento'
    ELSE 'comercial' -- Valor padrão para etapas desconhecidas
END;

-- 5. CORRIGIR STATUS INVÁLIDOS
UPDATE coletas 
SET status = CASE 
    WHEN status = 'pendente' THEN 'pendente'
    WHEN status = 'em_andamento' THEN 'em_andamento'
    WHEN status = 'concluida' THEN 'concluida'
    WHEN status = 'cancelada' THEN 'cancelada'
    WHEN status = 'concluído' THEN 'concluida'
    WHEN status = 'em andamento' THEN 'em_andamento'
    ELSE 'pendente' -- Valor padrão para status desconhecidos
END;

-- 6. CORRIGIR PRIORIDADES INVÁLIDAS
UPDATE coletas 
SET prioridade = CASE 
    WHEN prioridade = 'baixa' THEN 'baixa'
    WHEN prioridade = 'normal' THEN 'normal'
    WHEN prioridade = 'alta' THEN 'alta'
    WHEN prioridade = 'urgente' THEN 'urgente'
    WHEN prioridade = 'média' THEN 'normal'
    WHEN prioridade = 'baixo' THEN 'baixa'
    WHEN prioridade = 'alto' THEN 'alta'
    ELSE 'normal' -- Valor padrão para prioridades desconhecidas
END;

-- 7. VERIFICAR DADOS APÓS CORREÇÃO
SELECT DISTINCT etapa_atual, COUNT(*) as quantidade
FROM coletas 
GROUP BY etapa_atual
ORDER BY etapa_atual;

SELECT DISTINCT status, COUNT(*) as quantidade
FROM coletas 
GROUP BY status
ORDER BY status;

SELECT DISTINCT prioridade, COUNT(*) as quantidade
FROM coletas 
GROUP BY prioridade
ORDER BY prioridade;

-- 8. AGORA APLICAR AS CONSTRAINTS (após correção dos dados)
DO $$ 
BEGIN
    -- Tentar remover constraints antigas se existirem
    BEGIN
        ALTER TABLE coletas DROP CONSTRAINT IF EXISTS coletas_etapa_atual_check;
    EXCEPTION
        WHEN OTHERS THEN NULL;
    END;
    
    BEGIN
        ALTER TABLE coletas DROP CONSTRAINT IF EXISTS coletas_status_check;
    EXCEPTION
        WHEN OTHERS THEN NULL;
    END;
    
    BEGIN
        ALTER TABLE coletas DROP CONSTRAINT IF EXISTS coletas_prioridade_check;
    EXCEPTION
        WHEN OTHERS THEN NULL;
    END;
END $$;

-- 9. ADICIONAR CONSTRAINTS COM VALORES CORRETOS
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

ALTER TABLE coletas 
ADD CONSTRAINT coletas_status_check 
CHECK (status IN ('pendente', 'em_andamento', 'concluida', 'cancelada'));

ALTER TABLE coletas 
ADD CONSTRAINT coletas_prioridade_check 
CHECK (prioridade IN ('baixa', 'normal', 'alta', 'urgente'));

-- 10. CRIAR ÍNDICES PARA PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_coletas_etapa_atual ON coletas(etapa_atual);
CREATE INDEX IF NOT EXISTS idx_coletas_status ON coletas(status);
CREATE INDEX IF NOT EXISTS idx_coletas_motorista_id ON coletas(motorista_id);
CREATE INDEX IF NOT EXISTS idx_coletas_data_recebimento ON coletas(data_recebimento);

-- 11. VERIFICAÇÃO FINAL
SELECT '✅ Constraints aplicadas com sucesso!' as resultado;

-- =====================================================
-- RESUMO DAS CORREÇÕES
-- =====================================================
-- ✅ 1. Verificados dados existentes
-- ✅ 2. Corrigidos valores inválidos
-- ✅ 3. Aplicadas constraints após correção
-- ✅ 4. Criados índices para performance
-- ✅ 5. Verificação final realizada
