/**
 * Executa SQL das Ferramentas de Qualidade via Supabase
 * Usa o cliente Supabase com Service Role Key para executar SQL
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
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

async function executarSQL() {
  console.log('🚀 Executando SQL das Ferramentas de Qualidade via Supabase...\n');
  console.log(`📍 URL: ${supabaseUrl}\n`);

  // Ler o arquivo SQL
  const sqlPath = path.join(__dirname, 'sql', 'criar-ferramentas-qualidade.sql');
  
  if (!fs.existsSync(sqlPath)) {
    console.error(`❌ Arquivo não encontrado: ${sqlPath}`);
    process.exit(1);
  }

  const sqlCompleto = fs.readFileSync(sqlPath, 'utf8');
  
  console.log('📝 SQL lido do arquivo\n');
  console.log('⚠️  IMPORTANTE: O Supabase não permite executar DDL (CREATE TABLE) diretamente via API REST.');
  console.log('⚠️  Você precisa executar o SQL manualmente no Supabase Dashboard.\n');
  console.log('='.repeat(80));
  console.log(sqlCompleto);
  console.log('='.repeat(80));
  console.log('\n📍 Instruções para executar:');
  console.log('   1. Acesse: https://supabase.com/dashboard');
  console.log('   2. Selecione seu projeto');
  console.log('   3. Vá em: SQL Editor > New Query');
  console.log('   4. Cole o SQL acima');
  console.log('   5. Execute (Run ou Ctrl+Enter)\n');
  
  // Tentar verificar se as tabelas já existem
  try {
    console.log('🔍 Verificando se as tabelas já existem...');
    
    const { error: checkError1 } = await supabase
      .from('ferramentas_qualidade')
      .select('id')
      .limit(1);
    
    const { error: checkError2 } = await supabase
      .from('ferramentas_qualidade_alertas')
      .select('id')
      .limit(1);

    if (!checkError1 && !checkError2) {
      console.log('✅ Tabelas já existem!');
      console.log('   ✅ ferramentas_qualidade');
      console.log('   ✅ ferramentas_qualidade_alertas');
      return;
    }

    if (checkError1) {
      console.log('❌ Tabela ferramentas_qualidade não existe');
    }
    if (checkError2) {
      console.log('❌ Tabela ferramentas_qualidade_alertas não existe');
    }
    console.log('\n📋 Execute o SQL acima no Supabase Dashboard para criar as tabelas.\n');
  } catch (error) {
    console.log('⚠️ Não foi possível verificar as tabelas:', error.message);
    console.log('\n📋 Execute o SQL acima no Supabase Dashboard.\n');
  }
}

executarSQL().catch(console.error);

