-- ========== SISTEMA DE GERENCIAMENTO DE USUÁRIOS E AUTENTICAÇÃO ==========

-- ========== 1. TABELA DE PERFIS DE USUÁRIO ==========
-- Esta tabela armazena informações de perfil associadas ao auth.users do Supabase
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'manager', 'operator')),
    nome TEXT,
    departamento TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    active BOOLEAN DEFAULT TRUE,
    
    -- Metadata adicional
    telefone TEXT,
    cargo TEXT,
    observacoes TEXT
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_active ON public.user_profiles(active);
CREATE INDEX IF NOT EXISTS idx_user_profiles_departamento ON public.user_profiles(departamento);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_user_profiles_updated_at();

-- ========== 2. TABELA DE CREDENCIAIS DA EVOLUTION API POR USUÁRIO ==========
CREATE TABLE IF NOT EXISTS public.user_evolution_apis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    
    -- Credenciais da Evolution API
    api_key TEXT NOT NULL,
    api_url TEXT NOT NULL,
    instance_name TEXT NOT NULL,
    
    -- Configurações adicionais
    active BOOLEAN DEFAULT TRUE,
    max_connections INTEGER DEFAULT 10,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used TIMESTAMP WITH TIME ZONE,
    
    -- Validação das credenciais
    last_validated TIMESTAMP WITH TIME ZONE,
    is_valid BOOLEAN DEFAULT FALSE,
    validation_message TEXT,
    
    -- Constraints
    UNIQUE(user_id, instance_name)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_user_evolution_apis_user_id ON public.user_evolution_apis(user_id);
CREATE INDEX IF NOT EXISTS idx_user_evolution_apis_active ON public.user_evolution_apis(active);

-- Trigger para updated_at
CREATE TRIGGER trigger_user_evolution_apis_updated_at
    BEFORE UPDATE ON public.user_evolution_apis
    FOR EACH ROW
    EXECUTE FUNCTION update_user_profiles_updated_at();

-- ========== 3. ROW LEVEL SECURITY (RLS) ==========

-- Habilitar RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_evolution_apis ENABLE ROW LEVEL SECURITY;

-- ========== 4. POLÍTICAS RLS PARA USER_PROFILES ==========

-- Permitir que usuários vejam apenas seus próprios perfis
CREATE POLICY "Users can view own profile"
    ON public.user_profiles
    FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

-- Permitir que usuários atualizem apenas seus próprios perfis
CREATE POLICY "Users can update own profile"
    ON public.user_profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id);

-- Permitir que admins vejam todos os perfis
CREATE POLICY "Admins can view all profiles"
    ON public.user_profiles
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Permitir que admins gerenciem todos os perfis
CREATE POLICY "Admins can manage all profiles"
    ON public.user_profiles
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- ========== 5. POLÍTICAS RLS PARA USER_EVOLUTION_APIS ==========

-- Permitir que usuários vejam apenas suas próprias credenciais
CREATE POLICY "Users can view own API credentials"
    ON public.user_evolution_apis
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Permitir que usuários insiram suas próprias credenciais
CREATE POLICY "Users can insert own API credentials"
    ON public.user_evolution_apis
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Permitir que usuários atualizem suas próprias credenciais
CREATE POLICY "Users can update own API credentials"
    ON public.user_evolution_apis
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid());

-- Permitir que usuários deletem suas próprias credenciais
CREATE POLICY "Users can delete own API credentials"
    ON public.user_evolution_apis
    FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

-- Permitir que admins vejam todas as credenciais
CREATE POLICY "Admins can view all API credentials"
    ON public.user_evolution_apis
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Permitir que admins gerenciem todas as credenciais
CREATE POLICY "Admins can manage all API credentials"
    ON public.user_evolution_apis
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- ========== 6. FUNÇÃO PARA CRIAR PERFIL AUTOMATICAMENTE ==========
-- Esta função cria um perfil quando um novo usuário é criado no auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, role, nome, active)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'role', 'user'),
        COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
        TRUE
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para criar perfil automaticamente
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ========== 7. FUNÇÃO PARA ATUALIZAR LAST_LOGIN ==========
CREATE OR REPLACE FUNCTION public.update_last_login()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.user_profiles
    SET last_login = NOW()
    WHERE id = auth.uid();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========== 8. FUNÇÃO PARA VALIDAR CREDENCIAIS DA EVOLUTION API ==========
CREATE OR REPLACE FUNCTION public.validate_evolution_api(
    p_user_id UUID,
    p_api_key TEXT,
    p_api_url TEXT,
    p_instance_name TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
    v_response JSONB;
BEGIN
    -- Aqui você implementaria a lógica de validação real
    -- Por enquanto, vamos apenas retornar sucesso
    
    v_result := jsonb_build_object(
        'valid', true,
        'message', 'Credenciais válidas'
    );
    
    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'valid', false,
            'message', SQLERRM
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========== 9. DADOS DE EXEMPLO ==========
-- Não vamos inserir dados de exemplo aqui, pois os perfis são criados automaticamente
-- quando novos usuários são registrados no auth.users

-- ========== 10. COMMENTS ==========
COMMENT ON TABLE public.user_profiles IS 'Armazena perfis de usuário associados ao auth.users do Supabase';
COMMENT ON TABLE public.user_evolution_apis IS 'Armazena credenciais da Evolution API por usuário';
COMMENT ON FUNCTION public.handle_new_user() IS 'Cria perfil automaticamente quando um novo usuário é criado';
COMMENT ON FUNCTION public.validate_evolution_api() IS 'Valida credenciais da Evolution API';

-- ========== FIM DO SCHEMA ==========
