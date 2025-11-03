CREATE TABLE IF NOT EXISTS public.motoristas_auth (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    telefone TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_motoristas_auth_telefone
    ON public.motoristas_auth(telefone);

ALTER TABLE public.motoristas_auth ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "motoristas_auth_service_role" ON public.motoristas_auth;

CREATE POLICY "motoristas_auth_service_role"
ON public.motoristas_auth
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

