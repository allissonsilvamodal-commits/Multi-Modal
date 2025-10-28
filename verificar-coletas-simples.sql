-- =====================================================
-- VERIFICAÇÃO ESPECÍFICA DA TABELA COLETAS
-- =====================================================

-- 1. ESTRUTURA COMPLETA DA TABELA COLETAS
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length,
    numeric_precision,
    numeric_scale,
    ordinal_position
FROM information_schema.columns 
WHERE table_name = 'coletas'
ORDER BY ordinal_position;

-- 2. VERIFICAR CONSTRAINTS DA TABELA COLETAS
SELECT 
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
LEFT JOIN information_schema.check_constraints cc 
    ON tc.constraint_name = cc.constraint_name
WHERE tc.table_name = 'coletas'
ORDER BY tc.constraint_type, kcu.ordinal_position;

-- 3. VERIFICAR DADOS DE EXEMPLO (se existir)
SELECT * FROM coletas LIMIT 3;
