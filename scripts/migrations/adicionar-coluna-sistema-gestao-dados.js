/**
 * Script para adicionar a coluna 'sistema' à tabela gestao_dados
 * Executa via Supabase
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
  }
});

async function adicionarColunaSistema() {
  console.log('🚀 Adicionando coluna "sistema" à tabela gestao_dados...\n');

  try {
    // Verificar se a coluna já existe
    const { data: columns, error: checkError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'gestao_dados' AND column_name = 'sistema';
      `
    });

    // Tentar adicionar a coluna usando RPC (se disponível) ou diretamente
    const sql = `
      ALTER TABLE gestao_dados
      ADD COLUMN IF NOT EXISTS sistema VARCHAR(10);
    `;

    // Usar o método rpc se disponível, senão usar query direta
    try {
      const { data, error } = await supabase.rpc('exec_sql', { sql });
      
      if (error) {
        // Se RPC não estiver disponível, tentar via query direta
        console.log('⚠️ RPC não disponível, tentando método alternativo...');
        throw error;
      }
      
      console.log('✅ Coluna "sistema" adicionada com sucesso!');
    } catch (rpcError) {
      // Método alternativo: usar query direta do Supabase
      console.log('📝 Tentando adicionar coluna via método alternativo...');
      
      // Verificar se a coluna já existe consultando a estrutura da tabela
      const { data: testData, error: testError } = await supabase
        .from('gestao_dados')
        .select('sistema')
        .limit(1);
      
      if (testError) {
        if (testError.message && testError.message.includes('sistema')) {
          // Coluna não existe, precisamos adicioná-la
          console.log('⚠️ Coluna não existe. Por favor, execute o SQL manualmente no Supabase:');
          console.log('\n' + sql + '\n');
          console.log('📋 Ou execute via SQL Editor no Supabase Dashboard');
          return;
        } else {
          throw testError;
        }
      } else {
        console.log('✅ Coluna "sistema" já existe na tabela!');
      }
    }

    console.log('\n✅ Processo concluído!');
    console.log('💡 A coluna "sistema" agora aceita valores: "B2" ou "GW"');
    
  } catch (error) {
    console.error('❌ Erro ao adicionar coluna:', error);
    console.log('\n📋 Por favor, execute o seguinte SQL manualmente no Supabase SQL Editor:');
    console.log('\n' + sql + '\n');
    process.exit(1);
  }
}

adicionarColunaSistema();

