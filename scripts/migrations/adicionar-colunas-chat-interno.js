/**
 * Script para adicionar colunas necessárias para chat interno na tabela chat_mensagens
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Erro: SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  db: {
    schema: 'public'
  }
});

async function adicionarColunasChatInterno() {
  console.log('🚀 Adicionando colunas para chat interno na tabela chat_mensagens...\n');
  console.log(`📍 URL: ${supabaseUrl}\n`);

  const sql = `
-- Adicionar colunas necessárias para chat interno entre usuários
ALTER TABLE chat_mensagens
ADD COLUMN IF NOT EXISTS remetente_id UUID,
ADD COLUMN IF NOT EXISTS destinatario_id UUID,
ADD COLUMN IF NOT EXISTS remetente_nome TEXT,
ADD COLUMN IF NOT EXISTS destinatario_nome TEXT,
ADD COLUMN IF NOT EXISTS lida BOOLEAN DEFAULT false;

-- Criar índices para melhorar performance das queries
CREATE INDEX IF NOT EXISTS idx_chat_mensagens_remetente ON chat_mensagens(remetente_id);
CREATE INDEX IF NOT EXISTS idx_chat_mensagens_destinatario ON chat_mensagens(destinatario_id);
CREATE INDEX IF NOT EXISTS idx_chat_mensagens_lida ON chat_mensagens(lida) WHERE lida = false;
CREATE INDEX IF NOT EXISTS idx_chat_mensagens_remetente_destinatario ON chat_mensagens(remetente_id, destinatario_id);
  `.trim();

  try {
    // Verificar se as colunas já existem
    console.log('🔍 Verificando estrutura da tabela...');
    const { data: testData, error: testError } = await supabase
      .from('chat_mensagens')
      .select('remetente_id, destinatario_id, lida')
      .limit(1);

    if (!testError) {
      console.log('✅ Colunas já existem na tabela!');
      return;
    }

    if (testError && !testError.message.includes('remetente_id') && !testError.message.includes('does not exist')) {
      throw testError;
    }

    console.log('📝 Colunas não encontradas. Adicionando...\n');
    console.log('⚠️  O Supabase não permite executar ALTER TABLE diretamente via API por questões de segurança.');
    console.log('📋 Execute o SQL manualmente no Supabase Dashboard:');
    console.log('='.repeat(70));
    console.log(sql);
    console.log('='.repeat(70));
    console.log('\n📍 Instruções:');
    console.log('   1. Acesse: https://supabase.com/dashboard');
    console.log('   2. Selecione seu projeto');
    console.log('   3. Vá em: SQL Editor > New Query');
    console.log('   4. Cole o SQL acima');
    console.log('   5. Execute (Run ou Ctrl+Enter)');

  } catch (error) {
    console.error('\n❌ Erro:', error);
    console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
    console.log('='.repeat(70));
    console.log(sql);
    console.log('='.repeat(70));
    process.exit(1);
  }
}

adicionarColunasChatInterno().catch(console.error);

