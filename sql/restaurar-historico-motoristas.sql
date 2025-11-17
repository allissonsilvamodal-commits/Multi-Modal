-- ============================================
-- SOLUÇÃO PARA RESTAURAR HISTÓRICO DE CADASTRO DE MOTORISTAS
-- ============================================
-- 
-- PROBLEMA: Após atualização em massa, todos os motoristas ficaram
-- vinculados ao usuário que fez a atualização, perdendo o histórico original.
--
-- SOLUÇÃO: Este script cria uma tabela de backup do histórico e
-- fornece queries para restaurar baseado em diferentes critérios.
--

-- ============================================
-- PASSO 1: Criar tabela de backup do histórico
-- ============================================
CREATE TABLE IF NOT EXISTS motoristas_historico_backup (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    motorista_id UUID NOT NULL,
    created_by_original UUID,
    created_by_departamento_original TEXT,
    usuario_id_original TEXT,
    data_cadastro_original TIMESTAMP WITH TIME ZONE,
    data_backup TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    motivo_backup TEXT,
    
    -- Dados do motorista no momento do backup
    nome TEXT,
    telefone1 TEXT,
    cnh TEXT,
    
    CONSTRAINT fk_motorista FOREIGN KEY (motorista_id) REFERENCES motoristas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_motoristas_historico_motorista_id 
ON motoristas_historico_backup(motorista_id);

CREATE INDEX IF NOT EXISTS idx_motoristas_historico_created_by 
ON motoristas_historico_backup(created_by_original);

-- ============================================
-- PASSO 2: Fazer backup do estado atual ANTES de restaurar
-- ============================================
-- IMPORTANTE: Execute este INSERT primeiro para salvar o estado atual
INSERT INTO motoristas_historico_backup (
    motorista_id,
    created_by_original,
    created_by_departamento_original,
    usuario_id_original,
    data_cadastro_original,
    nome,
    telefone1,
    cnh,
    motivo_backup
)
SELECT 
    id,
    created_by,
    created_by_departamento,
    usuario_id,
    data_cadastro,
    nome,
    telefone1,
    cnh,
    'Backup antes de tentativa de restauração - ' || NOW()::text
FROM motoristas
WHERE id NOT IN (SELECT motorista_id FROM motoristas_historico_backup);

-- ============================================
-- PASSO 3: Verificar se há dados históricos disponíveis
-- ============================================
-- Esta query mostra a distribuição atual de created_by
SELECT 
    created_by,
    created_by_departamento,
    COUNT(*) as quantidade,
    MIN(data_cadastro) as primeiro_cadastro,
    MAX(data_cadastro) as ultimo_cadastro
FROM motoristas
GROUP BY created_by, created_by_departamento
ORDER BY quantidade DESC;

-- ============================================
-- PASSO 4: OPÇÕES DE RESTAURAÇÃO
-- ============================================

-- OPÇÃO A: Se você tem um backup anterior da tabela motoristas
-- Substitua 'motoristas_backup' pelo nome da sua tabela de backup
/*
UPDATE motoristas m
SET 
    created_by = b.created_by,
    created_by_departamento = b.created_by_departamento,
    usuario_id = b.usuario_id
FROM motoristas_backup b
WHERE m.id = b.id
  AND m.created_by != b.created_by; -- Só atualiza se for diferente
*/

-- OPÇÃO B: Restaurar baseado em data de cadastro e padrão de distribuição
-- Se você sabe que antes da atualização havia uma distribuição mais uniforme
-- e pode identificar padrões por data, use esta query:
/*
-- Exemplo: Se motoristas cadastrados antes de uma data específica
-- pertencem a usuários diferentes, você pode fazer:
UPDATE motoristas
SET 
    created_by = CASE 
        WHEN data_cadastro < '2024-01-01' THEN 'uuid-usuario-1'
        WHEN data_cadastro < '2024-06-01' THEN 'uuid-usuario-2'
        ELSE created_by
    END,
    created_by_departamento = CASE 
        WHEN data_cadastro < '2024-01-01' THEN 'departamento-1'
        WHEN data_cadastro < '2024-06-01' THEN 'departamento-2'
        ELSE created_by_departamento
    END
WHERE data_cadastro < '2024-11-01'; -- Data antes da atualização em massa
*/

-- OPÇÃO C: Se você tem uma lista de motoristas e seus criadores originais
-- Crie uma tabela temporária com o mapeamento:
/*
CREATE TEMP TABLE motoristas_mapeamento (
    motorista_id UUID,
    created_by_correto UUID,
    created_by_departamento_correto TEXT,
    usuario_id_correto TEXT
);

-- Insira os dados de mapeamento aqui
-- INSERT INTO motoristas_mapeamento VALUES (...);

-- Depois execute:
UPDATE motoristas m
SET 
    created_by = mm.created_by_correto,
    created_by_departamento = mm.created_by_departamento_correto,
    usuario_id = mm.usuario_id_correto
FROM motoristas_mapeamento mm
WHERE m.id = mm.motorista_id;
*/

-- ============================================
-- PASSO 5: Criar trigger para preservar histórico futuro
-- ============================================
-- Este trigger salva o created_by original antes de qualquer UPDATE
CREATE OR REPLACE FUNCTION preservar_historico_motorista()
RETURNS TRIGGER AS $$
BEGIN
    -- Se o created_by está sendo alterado, salvar o valor original
    IF OLD.created_by IS DISTINCT FROM NEW.created_by THEN
        INSERT INTO motoristas_historico_backup (
            motorista_id,
            created_by_original,
            created_by_departamento_original,
            usuario_id_original,
            data_cadastro_original,
            nome,
            telefone1,
            cnh,
            motivo_backup
        ) VALUES (
            OLD.id,
            OLD.created_by,
            OLD.created_by_departamento,
            OLD.usuario_id,
            OLD.data_cadastro,
            OLD.nome,
            OLD.telefone1,
            OLD.cnh,
            'Alteração de created_by detectada - ' || NOW()::text
        )
        ON CONFLICT DO NOTHING;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_preservar_historico_motorista ON motoristas;
CREATE TRIGGER trigger_preservar_historico_motorista
    BEFORE UPDATE ON motoristas
    FOR EACH ROW
    EXECUTE FUNCTION preservar_historico_motorista();

-- ============================================
-- PASSO 6: Query para verificar histórico salvo
-- ============================================
SELECT 
    m.id,
    m.nome,
    m.created_by as created_by_atual,
    m.created_by_departamento as dept_atual,
    h.created_by_original,
    h.created_by_departamento_original as dept_original,
    h.data_backup,
    h.motivo_backup
FROM motoristas m
LEFT JOIN motoristas_historico_backup h ON m.id = h.motorista_id
WHERE m.created_by != COALESCE(h.created_by_original, m.created_by)
ORDER BY h.data_backup DESC
LIMIT 100;

-- ============================================
-- PASSO 7: Restaurar do histórico de backup (se disponível)
-- ============================================
-- Se você tem histórico salvo, pode restaurar assim:
/*
UPDATE motoristas m
SET 
    created_by = h.created_by_original,
    created_by_departamento = h.created_by_departamento_original,
    usuario_id = h.usuario_id_original
FROM motoristas_historico_backup h
WHERE m.id = h.motorista_id
  AND h.created_by_original IS NOT NULL
  AND m.created_by != h.created_by_original;
*/

-- ============================================
-- NOTAS IMPORTANTES:
-- ============================================
-- 1. SEMPRE faça backup completo da tabela motoristas antes de executar UPDATEs
-- 2. Teste as queries em um ambiente de desenvolvimento primeiro
-- 3. Se você tem acesso a backups do banco de dados, use-os para restaurar
-- 4. O trigger criado vai preservar o histórico em atualizações futuras
-- 5. Se você souber quais motoristas foram cadastrados por quais usuários,
--    crie uma tabela de mapeamento e use a OPÇÃO C

