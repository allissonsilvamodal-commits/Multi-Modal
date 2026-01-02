/**
 * Adiciona coluna 'sistema' à tabela gestao_dados via Supabase
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

async function adicionarColunaSistema() {
  console.log('🚀 Adicionando coluna "sistema" à tabela gestao_dados...\n');
  console.log(`📍 URL: ${supabaseUrl}\n`);

  const sql = `ALTER TABLE gestao_dados ADD COLUMN IF NOT EXISTS sistema VARCHAR(10);`;

  try {
    // Verificar se a coluna já existe
    console.log('🔍 Verificando se a coluna já existe...');
    const { data: testData, error: testError } = await supabase
      .from('gestao_dados')
      .select('sistema')
      .limit(1);

    if (!testError) {
      console.log('✅ Coluna "sistema" já existe na tabela!');
      return;
    }

    if (testError && !testError.message.includes('sistema')) {
      throw testError;
    }

    console.log('📝 Coluna não encontrada. Adicionando...\n');

    // Tentar executar via RPC exec_sql
    console.log('⏳ Tentando executar via RPC exec_sql...');
    const { data: rpcData, error: rpcError } = await supabase.rpc('exec_sql', {
      sql_query: sql
    });

    if (rpcError) {
      console.warn('⚠️ RPC exec_sql não disponível:', rpcError.message);
      
      // Tentar método alternativo via REST API
      console.log('⏳ Tentando método alternativo via REST API...');
      
      try {
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({ sql_query: sql })
        });

        if (response.ok) {
          console.log('✅ SQL executado via REST API!');
        } else {
          const errorText = await response.text();
          console.warn('⚠️ REST API não funcionou:', errorText);
          throw new Error('Não foi possível executar via REST API');
        }
      } catch (fetchError) {
        console.warn('⚠️ Método alternativo falhou:', fetchError.message);
        console.log('\n📋 ⚠️  O Supabase não permite executar ALTER TABLE diretamente via API por questões de segurança.');
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
        return;
      }
    } else {
      console.log('✅ SQL executado via RPC!');
    }

    // Verificar se a coluna foi criada
    console.log('\n🔍 Verificando criação...');
    const { data: verifyData, error: verifyError } = await supabase
      .from('gestao_dados')
      .select('sistema')
      .limit(1);

    if (verifyError) {
      if (verifyError.message && verifyError.message.includes('sistema')) {
        console.error('❌ Coluna ainda não foi criada.');
        console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
        console.log('='.repeat(70));
        console.log(sql);
        console.log('='.repeat(70));
        return;
      }
      throw verifyError;
    }

    console.log('✅ Coluna "sistema" adicionada com sucesso!');
    console.log('\n📋 Estrutura atualizada:');
    console.log('   ✅ Tabela: gestao_dados');
    console.log('   ✅ Nova coluna: sistema (VARCHAR(10))');
    console.log('   💡 Valores aceitos: "B2" ou "GW"');

  } catch (error) {
    console.error('\n❌ Erro ao adicionar coluna:', error);
    console.error('Stack:', error.stack);
    console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
    console.log('='.repeat(70));
    console.log(sql);
    console.log('='.repeat(70));
    process.exit(1);
  }
}

adicionarColunaSistema().catch(console.error);

