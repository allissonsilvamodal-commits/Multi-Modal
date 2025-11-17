-- Script para corrigir políticas RLS do sistema de chamados
-- Execute este script no Supabase SQL Editor

-- ============================================
-- CORRIGIR POLÍTICAS DE ATUALIZAÇÃO DE CHAMADOS
-- ============================================

-- Remover política restritiva atual
DROP POLICY IF EXISTS "Time pode atualizar chamados" ON chamados;

-- Criar política mais permissiva para admins e time de projetos
CREATE POLICY "Time pode atualizar chamados" ON chamados
    FOR UPDATE
    USING (
        -- Permite se for o criador do chamado
        auth.uid()::text = usuario_id OR
        -- Permite se for atribuído para o usuário
        auth.uid()::text = atribuido_para OR
        -- Permite se for admin ou time de projetos (verificação mais flexível)
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE id = auth.uid() 
            AND (
                (raw_user_meta_data->>'role')::text IN ('admin', 'projetos') OR
                (raw_user_meta_data->>'departamento')::text = 'projetos' OR
                (raw_user_meta_data->>'perfil')::text = 'admin' OR
                email LIKE '%admin%' OR
                email LIKE '%multimodal%'
            )
        )
    );

-- ============================================
-- CRIAR POLÍTICAS PARA HISTÓRICO
-- ============================================

-- Política para SELECT no histórico
DROP POLICY IF EXISTS "Usuários podem ver histórico" ON chamados_historico;
CREATE POLICY "Usuários podem ver histórico" ON chamados_historico
    FOR SELECT
    USING (
        -- Permite ver histórico de chamados que o usuário criou
        EXISTS (
            SELECT 1 FROM chamados 
            WHERE chamados.id = chamados_historico.chamado_id 
            AND chamados.usuario_id = auth.uid()::text
        ) OR
        -- Permite ver histórico de chamados atribuídos ao usuário
        EXISTS (
            SELECT 1 FROM chamados 
            WHERE chamados.id = chamados_historico.chamado_id 
            AND chamados.atribuido_para = auth.uid()::text
        ) OR
        -- Permite se for admin ou time de projetos
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE id = auth.uid() 
            AND (
                (raw_user_meta_data->>'role')::text IN ('admin', 'projetos') OR
                (raw_user_meta_data->>'departamento')::text = 'projetos' OR
                (raw_user_meta_data->>'perfil')::text = 'admin'
            )
        )
    );

-- Política para INSERT no histórico
DROP POLICY IF EXISTS "Sistema pode criar histórico" ON chamados_historico;
CREATE POLICY "Sistema pode criar histórico" ON chamados_historico
    FOR INSERT
    WITH CHECK (
        -- Permite criar histórico se o usuário criou o chamado
        EXISTS (
            SELECT 1 FROM chamados 
            WHERE chamados.id = chamados_historico.chamado_id 
            AND chamados.usuario_id = auth.uid()::text
        ) OR
        -- Permite criar histórico se o chamado está atribuído ao usuário
        EXISTS (
            SELECT 1 FROM chamados 
            WHERE chamados.id = chamados_historico.chamado_id 
            AND chamados.atribuido_para = auth.uid()::text
        ) OR
        -- Permite se for admin ou time de projetos
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE id = auth.uid() 
            AND (
                (raw_user_meta_data->>'role')::text IN ('admin', 'projetos') OR
                (raw_user_meta_data->>'departamento')::text = 'projetos' OR
                (raw_user_meta_data->>'perfil')::text = 'admin' OR
                email LIKE '%admin%' OR
                email LIKE '%multimodal%'
            )
        ) OR
        -- Permite se o usuario_id do histórico corresponde ao usuário autenticado
        auth.uid()::text = usuario_id
    );

-- ============================================
-- POLÍTICA ALTERNATIVA MAIS PERMISSIVA (SE A ANTERIOR NÃO FUNCIONAR)
-- ============================================

-- Se ainda houver problemas, descomente estas linhas para políticas mais permissivas:
/*
-- Política muito permissiva para UPDATE (apenas para desenvolvimento/testes)
DROP POLICY IF EXISTS "Time pode atualizar chamados" ON chamados;
CREATE POLICY "Time pode atualizar chamados" ON chamados
    FOR UPDATE
    USING (true);  -- Permite qualquer atualização (CUIDADO: use apenas em desenvolvimento)

-- Política muito permissiva para histórico (apenas para desenvolvimento/testes)
DROP POLICY IF EXISTS "Sistema pode criar histórico" ON chamados_historico;
CREATE POLICY "Sistema pode criar histórico" ON chamados_historico
    FOR INSERT
    WITH CHECK (true);  -- Permite qualquer inserção (CUIDADO: use apenas em desenvolvimento)
*/

