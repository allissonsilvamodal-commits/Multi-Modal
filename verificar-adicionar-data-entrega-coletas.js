/**
 * Verifica e adiciona a coluna 'data_entrega' à tabela coletas via Supabase
 * 
 * Este script verifica se a coluna data_entrega existe na tabela coletas
 * e fornece instruções para adicioná-la manualmente no Supabase Dashboard
 * caso necessário.
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

async function verificarAdicionarDataEntrega() {
  console.log('🔍 Verificando se a coluna "data_entrega" existe na tabela coletas...\n');
  console.log(`📍 URL: ${supabaseUrl}\n`);

  try {
    // Tentar selecionar a coluna data_entrega para verificar se existe
    console.log('⏳ Testando acesso à coluna data_entrega...');
    const { data: testData, error: testError } = await supabase
      .from('coletas')
      .select('data_entrega')
      .limit(1);

    if (!testError) {
      console.log('✅ Coluna "data_entrega" já existe na tabela coletas!');
      console.log('✅ O banco de dados está pronto para receber os dados de data de entrega.');
      
      // Verificar se há algum registro com data_entrega preenchida
      const { count } = await supabase
        .from('coletas')
        .select('*', { count: 'exact', head: true })
        .not('data_entrega', 'is', null);
      
      console.log(`\n📊 Estatísticas:`);
      console.log(`   - Total de coletas: (consultando...)`);
      const { count: totalCount } = await supabase
        .from('coletas')
        .select('*', { count: 'exact', head: true });
      console.log(`   - Total de coletas: ${totalCount || 0}`);
      console.log(`   - Coletas com data de entrega preenchida: ${count || 0}`);
      
      return;
    }

    // Se der erro dizendo que a coluna não existe
    if (testError && (testError.message.includes('data_entrega') || 
                     testError.message.includes('column') ||
                     testError.code === '42703')) {
      console.log('❌ Coluna "data_entrega" não encontrada na tabela coletas!');
      console.log('\n📋 ⚠️  É necessário adicionar a coluna manualmente no Supabase Dashboard.');
      console.log('📋 Execute o SQL abaixo no Supabase Dashboard:\n');
      console.log('='.repeat(70));
      console.log(`
-- Adicionar coluna data_entrega à tabela coletas
ALTER TABLE coletas 
ADD COLUMN IF NOT EXISTS data_entrega TIMESTAMPTZ NULL;

-- Comentário para documentação
COMMENT ON COLUMN coletas.data_entrega IS 'Data de entrega da coleta ao destino final';
      `);
      console.log('='.repeat(70));
      console.log('\n📍 Instruções:');
      console.log('   1. Acesse: https://supabase.com/dashboard');
      console.log('   2. Selecione seu projeto');
      console.log('   3. Vá em: SQL Editor > New Query');
      console.log('   4. Cole o SQL acima');
      console.log('   5. Execute (Run ou Ctrl+Enter)');
      console.log('\n💡 Ou execute o arquivo: migration_adicionar_data_entrega_coletas.sql');
      return;
    }

    // Outro tipo de erro
    throw testError;

  } catch (error) {
    console.error('\n❌ Erro ao verificar coluna:', error.message);
    console.error('Stack:', error.stack);
    console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
    console.log('='.repeat(70));
    console.log(`
ALTER TABLE coletas 
ADD COLUMN IF NOT EXISTS data_entrega TIMESTAMPTZ NULL;
    `);
    console.log('='.repeat(70));
    process.exit(1);
  }
}

verificarAdicionarDataEntrega().catch(console.error);

