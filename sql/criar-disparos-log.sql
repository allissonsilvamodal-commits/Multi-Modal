-- Tabela de logs de disparos (envio de mensagens)
CREATE TABLE IF NOT EXISTS public.disparos_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    departamento TEXT NULL,
    numero TEXT NOT NULL,
    mensagem_tamanho INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'success',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_disparos_log_created_at ON public.disparos_log(created_at);
CREATE INDEX IF NOT EXISTS idx_disparos_log_user_id ON public.disparos_log(user_id);
CREATE INDEX IF NOT EXISTS idx_disparos_log_departamento ON public.disparos_log(departamento);

-- Políticas RLS (opcional): admins vêem todos, usuários vêem seus próprios
ALTER TABLE public.disparos_log ENABLE ROW LEVEL SECURITY;

-- Admins podem ver todos
CREATE POLICY IF NOT EXISTS "Admins can view all disparos" ON public.disparos_log
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role = 'admin'));

-- Usuários podem ver somente seus
CREATE POLICY IF NOT EXISTS "Users can view own disparos" ON public.disparos_log
FOR SELECT TO authenticated
USING (user_id = auth.uid());


