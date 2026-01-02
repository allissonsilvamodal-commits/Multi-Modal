/**
 * Script para criar função RPC e tabela ninebox_avaliacoes no Supabase
 * Execute: node criar-funcao-rpc-e-tabela-ninebox.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Erro: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no .env');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function criarFuncaoRPCEeTabela() {
  console.log('🚀 Criando função RPC e tabela ninebox_avaliacoes...\n');
  console.log(`📍 URL: ${supabaseUrl}\n`);

  // SQL para criar a função RPC
  const sqlFuncaoRPC = `
CREATE OR REPLACE FUNCTION exec_sql(sql_query text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE sql_query;
END;
$$;
  `.trim();

  // Ler o arquivo SQL da tabela
  const sqlPath = path.join(__dirname, 'sql', 'criar-tabela-ninebox.sql');
  const sqlTabela = fs.readFileSync(sqlPath, 'utf8');

  try {
    // Verificar se a tabela já existe
    console.log('🔍 Verificando se a tabela já existe...');
    const { data: existe, error: verifError } = await supabaseAdmin
      .from('ninebox_avaliacoes')
      .select('id')
      .limit(1);

    if (!verifError && existe !== null) {
      console.log('✅ Tabela ninebox_avaliacoes já existe!');
      console.log('📋 Verificando estrutura...');
      
      const { data: sample } = await supabaseAdmin
        .from('ninebox_avaliacoes')
        .select('nome_colaborador, cargo, departamento, potencial, desempenho')
        .limit(1);
      
      if (sample !== null) {
        console.log('✅ Estrutura da tabela está correta!');
        console.log('\n📋 Colunas verificadas:');
        console.log('   ✅ nome_colaborador');
        console.log('   ✅ cargo');
        console.log('   ✅ departamento');
        console.log('   ✅ potencial');
        console.log('   ✅ desempenho');
      }
      
      return;
    }

    console.log('📝 Tabela não encontrada. Criando...\n');

    // IMPORTANTE: O Supabase não permite executar DDL via API REST
    // Precisamos criar a função RPC primeiro no Dashboard, depois usar ela
    
    console.log('⚠️  ATENÇÃO: O Supabase não permite executar DDL (CREATE TABLE) via API REST.');
    console.log('⚠️  Você precisa executar o SQL manualmente no Supabase Dashboard.\n');
    
    console.log('📋 INSTRUÇÕES PASSO A PASSO:\n');
    console.log('1️⃣  Acesse: https://supabase.com/dashboard');
    console.log('2️⃣  Selecione seu projeto');
    console.log('3️⃣  Vá em: SQL Editor > New Query');
    console.log('4️⃣  Cole e execute o SQL abaixo:\n');
    console.log('═'.repeat(80));
    console.log(sqlTabela);
    console.log('═'.repeat(80));
    console.log('\n5️⃣  Execute (Run ou Ctrl+Enter)');
    console.log('6️⃣  Aguarde a confirmação de sucesso');
    console.log('7️⃣  Recarregue a página ninebox.html\n');

    // Tentar verificar novamente após um delay (caso o usuário execute manualmente)
    console.log('💡 Dica: Após executar o SQL no Dashboard, execute este script novamente para verificar.');
    console.log('   Ou simplesmente recarregue a página ninebox.html\n');

  } catch (error) {
    console.error('\n❌ Erro:', error.message);
    console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
    console.log('═'.repeat(70));
    console.log(sqlTabela);
    console.log('═'.repeat(70));
    process.exit(1);
  }
}

// Executar
if (require.main === module) {
  criarFuncaoRPCEeTabela().catch(console.error);
}

module.exports = { criarFuncaoRPCEeTabela };

