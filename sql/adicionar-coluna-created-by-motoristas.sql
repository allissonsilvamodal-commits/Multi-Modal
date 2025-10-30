-- Adiciona coluna created_by para rastrear quem cadastrou o motorista
ALTER TABLE public.motoristas
ADD COLUMN IF NOT EXISTS created_by UUID NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- Índice para consultas por criador
CREATE INDEX IF NOT EXISTS idx_motoristas_created_by ON public.motoristas(created_by);

-- Habilitar RLS (caso ainda não esteja)
ALTER TABLE public.motoristas ENABLE ROW LEVEL SECURITY;

-- Políticas (ajuste conforme sua estratégia de acesso)
-- Admins podem ver todos os registros
DROP POLICY IF EXISTS "Admins podem ver motoristas" ON public.motoristas;
CREATE POLICY "Admins podem ver motoristas"
ON public.motoristas
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

-- Usuário pode ver registros que ele cadastrou
DROP POLICY IF EXISTS "Usuarios veem motoristas que cadastraram" ON public.motoristas;
CREATE POLICY "Usuarios veem motoristas que cadastraram"
ON public.motoristas
FOR SELECT
TO authenticated
USING (created_by = auth.uid());

-- Inserir: permitir ao usuário inserir com created_by = auth.uid()
DROP POLICY IF EXISTS "Usuarios podem inserir motoristas" ON public.motoristas;
CREATE POLICY "Usuarios podem inserir motoristas"
ON public.motoristas
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

-- Atualizar: permitir atualizar somente registros que cadastrou (ou ajustar conforme necessidade)
DROP POLICY IF EXISTS "Usuarios podem atualizar motoristas que cadastraram" ON public.motoristas;
CREATE POLICY "Usuarios podem atualizar motoristas que cadastraram"
ON public.motoristas
FOR UPDATE
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());
