-- =====================================================
-- SQL ESPECÍFICO PARA TABELA COLETAS
-- Sistema de Coletas Multimodal Logística
-- =====================================================

-- 1. VERIFICAR SE A TABELA COLETAS EXISTE
SELECT 
    table_name,
    table_type
FROM information_schema.tables 
WHERE table_name = 'coletas';

-- 2. VERIFICAR ESTRUTURA DA TABELA COLETAS
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

-- 3. VERIFICAR CONSTRAINTS DA TABELA COLETAS
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

-- 4. VERIFICAR SE HÁ DADOS NA TABELA COLETAS
SELECT COUNT(*) as total_registros FROM coletas;

-- 5. VERIFICAR PRIMEIRO REGISTRO (se existir)
SELECT * FROM coletas LIMIT 1;

-- 6. VERIFICAR TODAS AS TABELAS DO SCHEMA
SELECT 
    table_name,
    table_type
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;

-- =====================================================
-- INSTRUÇÕES
-- =====================================================

-- Execute este script e me mostre os resultados das queries 1, 2 e 3
-- para identificarmos a estrutura exata da tabela coletas.
