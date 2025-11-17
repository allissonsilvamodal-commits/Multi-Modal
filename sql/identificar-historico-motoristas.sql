-- ============================================
-- QUERY PARA IDENTIFICAR PADRÕES E RESTAURAR HISTÓRICO
-- ============================================
-- Execute estas queries para entender melhor a situação atual
-- e identificar possíveis padrões para restauração

-- 1. Ver distribuição atual por usuário
SELECT 
    created_by,
    created_by_departamento,
    COUNT(*) as total_motoristas,
    MIN(data_cadastro) as primeiro_cadastro,
    MAX(data_cadastro) as ultimo_cadastro,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM motoristas), 2) as percentual
FROM motoristas
GROUP BY created_by, created_by_departamento
ORDER BY total_motoristas DESC;

-- 2. Ver distribuição por data de cadastro (pode indicar períodos de diferentes usuários)
SELECT 
    DATE_TRUNC('month', data_cadastro) as mes,
    COUNT(*) as total,
    COUNT(DISTINCT created_by) as usuarios_diferentes,
    STRING_AGG(DISTINCT created_by::text, ', ') as usuarios
FROM motoristas
GROUP BY DATE_TRUNC('month', data_cadastro)
ORDER BY mes DESC;

-- 3. Ver se há padrão por departamento
SELECT 
    created_by_departamento,
    COUNT(*) as total,
    COUNT(DISTINCT created_by) as usuarios
FROM motoristas
WHERE created_by_departamento IS NOT NULL
GROUP BY created_by_departamento
ORDER BY total DESC;

-- 4. Verificar se há registros com data_atualizacao diferente de data_cadastro
-- (indicando que foram atualizados)
SELECT 
    COUNT(*) as total_atualizados,
    COUNT(DISTINCT created_by) as usuarios_que_atualizaram
FROM motoristas
WHERE data_atualizacao IS NOT NULL 
  AND data_atualizacao != data_cadastro;

-- 5. Ver os usuários que realmente cadastraram (não atualizaram)
-- Se você souber qual é o seu user_id, substitua 'SEU_USER_ID_AQUI'
SELECT 
    created_by,
    COUNT(*) as quantidade
FROM motoristas
WHERE created_by != 'SEU_USER_ID_AQUI'::uuid  -- Substitua pelo seu ID
GROUP BY created_by
ORDER BY quantidade DESC;

-- 6. Verificar se há algum padrão por telefone ou CNH
-- (motoristas cadastrados pelo mesmo usuário podem ter padrões similares)
SELECT 
    created_by,
    COUNT(DISTINCT LEFT(telefone1, 2)) as ddd_diferentes,
    COUNT(DISTINCT estado) as estados_diferentes,
    COUNT(*) as total
FROM motoristas
WHERE telefone1 IS NOT NULL
GROUP BY created_by
ORDER BY total DESC;

-- ============================================
-- SOLUÇÃO PRÁTICA: Se você souber quais usuários
-- cadastraram em quais períodos, use esta query:
-- ============================================
/*
-- Exemplo: Restaurar baseado em períodos conhecidos
-- Ajuste as datas e user_ids conforme sua realidade

UPDATE motoristas
SET 
    created_by = CASE 
        -- Motoristas cadastrados em outubro/2024 foram do usuário X
        WHEN data_cadastro >= '2024-10-01' AND data_cadastro < '2024-11-01' 
            THEN 'uuid-usuario-outubro'::uuid
        
        -- Motoristas cadastrados em setembro/2024 foram do usuário Y
        WHEN data_cadastro >= '2024-09-01' AND data_cadastro < '2024-10-01' 
            THEN 'uuid-usuario-setembro'::uuid
        
        -- Motoristas cadastrados antes foram do usuário Z
        WHEN data_cadastro < '2024-09-01' 
            THEN 'uuid-usuario-anterior'::uuid
        
        -- Manter os que foram realmente cadastrados por você
        ELSE created_by
    END,
    created_by_departamento = CASE 
        WHEN data_cadastro >= '2024-10-01' AND data_cadastro < '2024-11-01' 
            THEN 'departamento-outubro'
        WHEN data_cadastro >= '2024-09-01' AND data_cadastro < '2024-10-01' 
            THEN 'departamento-setembro'
        WHEN data_cadastro < '2024-09-01' 
            THEN 'departamento-anterior'
        ELSE created_by_departamento
    END
WHERE created_by = 'SEU_USER_ID_AQUI'::uuid  -- Só atualiza os que estão com seu ID
  AND data_cadastro < '2024-11-14';  -- Data antes da sua atualização em massa
*/

-- ============================================
-- ALTERNATIVA: Se você tem uma lista CSV/Excel
-- com motorista_id e created_by correto:
-- ============================================
/*
-- 1. Crie uma tabela temporária com o mapeamento
CREATE TEMP TABLE mapeamento_restauracao (
    motorista_id UUID,
    created_by_correto UUID,
    created_by_departamento_correto TEXT,
    usuario_id_correto TEXT
);

-- 2. Importe seus dados (exemplo com alguns registros)
-- INSERT INTO mapeamento_restauracao VALUES
--     ('uuid-motorista-1', 'uuid-usuario-original-1', 'departamento-1', 'usuario-1'),
--     ('uuid-motorista-2', 'uuid-usuario-original-2', 'departamento-2', 'usuario-2'),
--     ... (seus dados aqui)

-- 3. Execute a restauração
UPDATE motoristas m
SET 
    created_by = mm.created_by_correto,
    created_by_departamento = mm.created_by_departamento_correto,
    usuario_id = mm.usuario_id_correto
FROM mapeamento_restauracao mm
WHERE m.id = mm.motorista_id
  AND m.created_by != mm.created_by_correto;  -- Só atualiza se for diferente
*/

