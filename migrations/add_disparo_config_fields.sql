-- Novos campos em user_disparo_configs para painel de disparo e controle admin
-- Executar no Supabase (SQL Editor) após criar a tabela base se necessário.

-- Campos usados pelo painel (delay, simular digitação, random IA)
ALTER TABLE user_disparo_configs ADD COLUMN IF NOT EXISTS delay_min INTEGER NOT NULL DEFAULT 10;
ALTER TABLE user_disparo_configs ADD COLUMN IF NOT EXISTS delay_max INTEGER NOT NULL DEFAULT 30;
ALTER TABLE user_disparo_configs ADD COLUMN IF NOT EXISTS simulate_typing BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE user_disparo_configs ADD COLUMN IF NOT EXISTS random_message_ai BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE user_disparo_configs ADD COLUMN IF NOT EXISTS allow_user_edit BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN user_disparo_configs.delay_min IS 'Delay mínimo entre disparos (segundos)';
COMMENT ON COLUMN user_disparo_configs.delay_max IS 'Delay máximo entre disparos (segundos)';
COMMENT ON COLUMN user_disparo_configs.simulate_typing IS 'Simular digitação antes de cada envio';
COMMENT ON COLUMN user_disparo_configs.random_message_ai IS 'Randomização de mensagens com IA';
COMMENT ON COLUMN user_disparo_configs.allow_user_edit IS 'Se false, usuário não pode alterar configurações (admin gerencia)';
