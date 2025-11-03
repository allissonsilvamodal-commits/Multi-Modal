ALTER TABLE public.motoristas
    ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE;

CREATE INDEX IF NOT EXISTS idx_motoristas_auth_user_id
    ON public.motoristas(auth_user_id);

