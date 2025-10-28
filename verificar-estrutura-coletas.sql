-- =====================================================
-- SQL PARA VERIFICAR ESTRUTURA DA TABELA COLETAS
-- Sistema de Coletas Multimodal Logística
-- =====================================================

-- 1. VERIFICAR SE A TABELA EXISTE
SELECT 
    table_name,
    table_type
FROM information_schema.tables 
WHERE table_name = 'coletas';

-- 2. VERIFICAR ESTRUTURA COMPLETA DA TABELA COLETAS
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length,
    numeric_precision,
    numeric_scale
FROM information_schema.columns 
WHERE table_name = 'coletas'
ORDER BY ordinal_position;

-- 3. VERIFICAR CONSTRAINTS (CHECK, UNIQUE, FOREIGN KEY)
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

-- 4. VERIFICAR ÍNDICES
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'coletas';

-- 5. VERIFICAR DADOS DE EXEMPLO (se existir)
SELECT 
    id,
    cliente,
    origem,
    destino,
    valor,
    km,
    veiculo,
    status,
    etapa_atual,
    etapas_concluidas,
    motorista_id,
    gr_aprovado,
    gr_aprovado_por,
    gr_data_aprovacao,
    gr_reprovado_por,
    gr_motivo_reprovacao,
    gr_data_reprovacao,
    data_recebimento,
    data_atualizacao,
    observacoes,
    prioridade,
    filial,
    created_at,
    updated_at,
    created_by,
    updated_by
FROM coletas 
LIMIT 5;

-- 6. VERIFICAR VALORES ÚNICOS NA COLUNA etapa_atual
SELECT DISTINCT etapa_atual, COUNT(*) as quantidade
FROM coletas 
GROUP BY etapa_atual
ORDER BY etapa_atual;

-- 7. VERIFICAR VALORES ÚNICOS NA COLUNA status
SELECT DISTINCT status, COUNT(*) as quantidade
FROM coletas 
GROUP BY status
ORDER BY status;

-- 8. VERIFICAR SE EXISTEM OUTRAS TABELAS RELACIONADAS
SELECT 
    table_name,
    table_type
FROM information_schema.tables 
WHERE table_name IN ('motoristas', 'anexos', 'chat_mensagens', 'historico_coletas')
ORDER BY table_name;

-- 9. VERIFICAR POLÍTICAS RLS (Row Level Security)
SELECT 
    schemaname,
    tablename,
    rowsecurity,
    forcerowsecurity
FROM pg_tables 
WHERE tablename = 'coletas';

-- 10. VERIFICAR POLÍTICAS DE SEGURANÇA
SELECT 
    pol.polname as policy_name,
    pol.polcmd as policy_command,
    pol.polpermissive as policy_permissive,
    pol.polroles as policy_roles,
    pol.polqual as policy_qualification,
    pol.polwithcheck as policy_with_check
FROM pg_policy pol
JOIN pg_class pc ON pol.polrelid = pc.oid
WHERE pc.relname = 'coletas';

-- =====================================================
-- RESUMO EXECUTIVO
-- =====================================================

-- Este script irá mostrar:
-- 1. Se a tabela 'coletas' existe
-- 2. Estrutura completa com todos os campos e tipos
-- 3. Constraints aplicados (validações)
-- 4. Índices existentes
-- 5. Dados de exemplo (se houver)
-- 6. Valores únicos nas colunas etapa_atual e status
-- 7. Outras tabelas relacionadas
-- 8. Configurações de segurança (RLS)
-- 9. Políticas de acesso

-- Execute este script no SQL Editor do Supabase para verificar
-- a estrutura atual antes de fazer qualquer alteração.
