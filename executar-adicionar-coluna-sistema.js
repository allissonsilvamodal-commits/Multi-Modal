/**
 * Script para adicionar coluna 'sistema' à tabela gestao_dados
 * Tenta várias abordagens e fornece instruções se necessário
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

    console.log('📝 Coluna não encontrada. Tentando adicionar...\n');

    // Método 1: Tentar via RPC exec_sql (se existir)
    console.log('⏳ Método 1: Tentando via RPC exec_sql...');
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('exec_sql', {
        sql_query: sql
      });

      if (!rpcError) {
        console.log('✅ Coluna adicionada com sucesso via RPC!');
        
        // Verificar
        const { data: verifyData, error: verifyError } = await supabase
          .from('gestao_dados')
          .select('sistema')
          .limit(1);

        if (!verifyError) {
          console.log('✅ Verificação: Coluna "sistema" existe!');
          return;
        }
      } else {
        throw rpcError;
      }
    } catch (rpcError) {
      console.warn('⚠️ RPC exec_sql não disponível:', rpcError.message);
    }

    // Método 2: Tentar criar função RPC primeiro e depois usar
    console.log('\n⏳ Método 2: Tentando criar função RPC primeiro...');
    const createFunctionSQL = `
      CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      BEGIN
        EXECUTE sql_query;
      END;
      $$;
    `;

    try {
      // Tentar criar função via REST API direta
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`
        },
        body: JSON.stringify({ sql_query: createFunctionSQL })
      });

      if (response.ok) {
        console.log('✅ Função RPC criada! Tentando adicionar coluna...');
        
        // Agora tentar adicionar coluna
        const alterResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({ sql_query: sql })
        });

        if (alterResponse.ok) {
          console.log('✅ Coluna adicionada com sucesso!');
          return;
        }
      }
    } catch (fetchError) {
      console.warn('⚠️ Método 2 falhou:', fetchError.message);
    }

    // Se chegou aqui, nenhum método funcionou
    console.log('\n❌ Não foi possível executar via API.');
    console.log('📋 O Supabase não permite executar ALTER TABLE diretamente via API por questões de segurança.');
    console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
    console.log('='.repeat(70));
    console.log(sql);
    console.log('='.repeat(70));
    console.log('\n📍 Instruções:');
    console.log('   1. Acesse: https://supabase.com/dashboard');
    console.log('   2. Selecione seu projeto');
    console.log('   3. Vá em: SQL Editor > New Query');
    console.log('   4. Cole o SQL acima');
    console.log('   5. Execute (Run ou Ctrl+Enter)');
    console.log('\n💡 Alternativa: Use o endpoint do servidor:');
    console.log(`   POST ${process.env.PUBLIC_BASE_URL || 'http://localhost:5680'}/api/gestao-dados/adicionar-coluna-sistema`);
    console.log('   (Requer autenticação de admin)');

  } catch (error) {
    console.error('\n❌ Erro:', error);
    console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
    console.log('='.repeat(70));
    console.log(sql);
    console.log('='.repeat(70));
    process.exit(1);
  }
}

adicionarColunaSistema().catch(console.error);

