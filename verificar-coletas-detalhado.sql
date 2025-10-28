-- =====================================================
-- SQL DETALHADO PARA VERIFICAR TABELA COLETAS
-- Sistema de Coletas Multimodal Logística
-- =====================================================

-- 1. VERIFICAR ESTRUTURA DETALHADA DA TABELA COLETAS
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

-- 2. VERIFICAR CONSTRAINT CHECK NA COLUNA etapa_atual
SELECT 
    tc.constraint_name,
    tc.constraint_type,
    cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc 
    ON tc.constraint_name = cc.constraint_name
WHERE tc.table_name = 'coletas' 
    AND cc.check_clause LIKE '%etapa_atual%';

-- 3. VERIFICAR CONSTRAINT CHECK NA COLUNA status
SELECT 
    tc.constraint_name,
    tc.constraint_type,
    cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc 
    ON tc.constraint_name = cc.constraint_name
WHERE tc.table_name = 'coletas' 
    AND cc.check_clause LIKE '%status%';

-- 4. VERIFICAR CONSTRAINT CHECK NA COLUNA prioridade
SELECT 
    tc.constraint_name,
    tc.constraint_type,
    cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc 
    ON tc.constraint_name = cc.constraint_name
WHERE tc.table_name = 'coletas' 
    AND cc.check_clause LIKE '%prioridade%';

-- 5. VERIFICAR TODOS OS CONSTRAINTS DA TABELA
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

-- 6. VERIFICAR SE EXISTEM DADOS NA TABELA
SELECT COUNT(*) as total_registros FROM coletas;

-- 7. VERIFICAR VALORES DISTINTOS EM etapa_atual (se houver dados)
SELECT DISTINCT etapa_atual, COUNT(*) as quantidade
FROM coletas 
GROUP BY etapa_atual
ORDER BY etapa_atual;

-- 8. VERIFICAR VALORES DISTINTOS EM status (se houver dados)
SELECT DISTINCT status, COUNT(*) as quantidade
FROM coletas 
GROUP BY status
ORDER BY status;

-- 9. VERIFICAR SE EXISTEM CAMPOS DE GR
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'coletas' 
    AND column_name LIKE 'gr_%'
ORDER BY ordinal_position;

-- 10. VERIFICAR SE EXISTEM CAMPOS DE MOTORISTA
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'coletas' 
    AND column_name LIKE '%motorista%'
ORDER BY ordinal_position;

-- 11. VERIFICAR CAMPOS DE DATA
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'coletas' 
    AND (column_name LIKE '%data%' OR column_name LIKE '%created%' OR column_name LIKE '%updated%')
ORDER BY ordinal_position;

-- 12. VERIFICAR SE EXISTEM OUTRAS TABELAS RELACIONADAS
SELECT 
    table_name,
    table_type
FROM information_schema.tables 
WHERE table_name IN ('motoristas', 'anexos', 'chat_mensagens', 'historico_coletas', 'permissoes_coletas')
ORDER BY table_name;

-- 13. VERIFICAR ESTRUTURA DA TABELA permissoes_coletas (se existir)
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'permissoes_coletas'
ORDER BY ordinal_position;

-- =====================================================
-- ANÁLISE DOS RESULTADOS
-- =====================================================

-- Com base nos resultados deste script, poderemos:
-- 1. Ver exatamente quais campos existem na tabela coletas
-- 2. Verificar se os campos de GR estão presentes
-- 3. Verificar se os campos de motorista estão presentes
-- 4. Verificar quais constraints estão aplicados
-- 5. Verificar se as etapas estão definidas corretamente
-- 6. Identificar quais campos precisam ser adicionados/modificados

-- Execute este script e compartilhe os resultados para
-- criarmos o SQL de correção adequado.
