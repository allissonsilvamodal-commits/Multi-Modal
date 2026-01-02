/**
 * Script para executar migração de colunas do chat interno usando Supabase Admin
 * Tenta executar via RPC, se não funcionar, fornece SQL para execução manual
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

async function executarMigracao() {
  console.log('🚀 Executando migração de colunas para chat interno...\n');
  console.log(`📍 URL: ${supabaseUrl}\n`);

  const sqlCommands = [
    `ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS remetente_id UUID;`,
    `ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS destinatario_id UUID;`,
    `ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS remetente_nome TEXT;`,
    `ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS destinatario_nome TEXT;`,
    `ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS lida BOOLEAN DEFAULT false;`,
    `CREATE INDEX IF NOT EXISTS idx_chat_mensagens_remetente ON chat_mensagens(remetente_id);`,
    `CREATE INDEX IF NOT EXISTS idx_chat_mensagens_destinatario ON chat_mensagens(destinatario_id);`,
    `CREATE INDEX IF NOT EXISTS idx_chat_mensagens_lida ON chat_mensagens(lida) WHERE lida = false;`,
    `CREATE INDEX IF NOT EXISTS idx_chat_mensagens_remetente_destinatario ON chat_mensagens(remetente_id, destinatario_id);`
  ];

  try {
    // Verificar se as colunas já existem
    console.log('🔍 Verificando se as colunas já existem...');
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

    console.log('📝 Colunas não encontradas. Tentando adicionar...\n');

    // Tentar criar função RPC primeiro
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

    console.log('⏳ Tentando criar função RPC exec_sql...');
    try {
      const { error: createError } = await supabase.rpc('exec_sql', {
        sql_query: createFunctionSQL
      });
      if (createError && !createError.message.includes('exec_sql')) {
        console.warn('⚠️ Não foi possível criar função RPC:', createError.message);
      } else {
        console.log('✅ Função RPC criada ou já existe!');
      }
    } catch (rpcError) {
      console.warn('⚠️ Erro ao criar função RPC:', rpcError.message);
    }

    // Tentar executar cada comando SQL
    console.log('\n⏳ Executando comandos SQL...\n');
    const resultados = [];
    
    for (let i = 0; i < sqlCommands.length; i++) {
      const sql = sqlCommands[i];
      console.log(`📝 [${i + 1}/${sqlCommands.length}] Executando: ${sql.substring(0, 60)}...`);
      
      try {
        const { error: sqlError } = await supabase.rpc('exec_sql', {
          sql_query: sql
        });

        if (sqlError) {
          console.log(`   ❌ Erro: ${sqlError.message}`);
          resultados.push({ comando: sql, sucesso: false, erro: sqlError.message });
        } else {
          console.log(`   ✅ Sucesso!`);
          resultados.push({ comando: sql, sucesso: true });
        }
      } catch (err) {
        console.log(`   ❌ Erro: ${err.message}`);
        resultados.push({ comando: sql, sucesso: false, erro: err.message });
      }
    }

    const sucessos = resultados.filter(r => r.sucesso).length;
    const falhas = resultados.filter(r => !r.sucesso).length;

    console.log(`\n📊 Resultado: ${sucessos} sucessos, ${falhas} falhas\n`);

    // Verificar se as colunas foram criadas
    console.log('🔍 Verificando se as colunas foram criadas...');
    const { data: verifyData, error: verifyError } = await supabase
      .from('chat_mensagens')
      .select('remetente_id, destinatario_id, lida')
      .limit(1);

    if (verifyError && verifyError.message.includes('remetente_id')) {
      console.log('\n❌ Colunas ainda não foram criadas.');
      console.log('📋 O Supabase não permite executar ALTER TABLE diretamente via API.');
      console.log('📋 Execute o SQL manualmente no Supabase Dashboard:');
      console.log('='.repeat(70));
      console.log(sqlCommands.join('\n'));
      console.log('='.repeat(70));
      return;
    }

    if (!verifyError) {
      console.log('✅ Colunas criadas com sucesso!');
      console.log('\n📋 Migração concluída com sucesso!');
      return;
    }

  } catch (error) {
    console.error('\n❌ Erro:', error);
    console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
    console.log('='.repeat(70));
    console.log(sqlCommands.join('\n'));
    console.log('='.repeat(70));
    console.log('\n📍 Instruções:');
    console.log('   1. Acesse: https://supabase.com/dashboard');
    console.log('   2. Selecione seu projeto');
    console.log('   3. Vá em: SQL Editor > New Query');
    console.log('   4. Cole o SQL acima');
    console.log('   5. Execute (Run ou Ctrl+Enter)');
    process.exit(1);
  }
}

executarMigracao().catch(console.error);

