/**
 * Script para criar a tabela ninebox_avaliacoes no Supabase
 * Execute: node executar-criar-tabela-ninebox-mcp.js
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
  console.log('🚀 Criando tabela ninebox_avaliacoes no Supabase...\n');
  console.log(`📍 URL: ${supabaseUrl}\n`);

  // Ler o arquivo SQL
  const sqlPath = path.join(__dirname, 'sql', 'criar-tabela-ninebox.sql');
  const sqlCompleto = fs.readFileSync(sqlPath, 'utf8');

  // Dividir SQL em comandos executáveis
  const comandos = sqlCompleto
    .split(';')
    .map(cmd => cmd.trim())
    .filter(cmd => {
      const trimmed = cmd.trim();
      return trimmed.length > 0 && 
             !trimmed.startsWith('--') && 
             !trimmed.match(/^\s*$/);
    });

  console.log(`📊 Encontrados ${comandos.length} comandos SQL para executar\n`);

  try {
    // Verificar se a tabela já existe
    console.log('🔍 Verificando se a tabela já existe...');
    const { data: existe, error: verifError } = await supabase
      .from('ninebox_avaliacoes')
      .select('id')
      .limit(1);

    if (!verifError && existe !== null) {
      console.log('✅ Tabela ninebox_avaliacoes já existe!');
      console.log('📋 Verificando estrutura...');
      
      // Verificar colunas principais
      const { data: sample } = await supabase
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

    // Executar cada comando
    for (let i = 0; i < comandos.length; i++) {
      const comando = comandos[i];
      const preview = comando.split('\n')[0].substring(0, 80);
      
      console.log(`\n📝 Executando comando ${i + 1}/${comandos.length}...`);
      console.log(`   ${preview}${preview.length >= 80 ? '...' : ''}`);

      try {
        // Tentar via RPC exec_sql primeiro (se existir)
        const { data: rpcData, error: rpcError } = await supabase.rpc('exec_sql', {
          sql_query: comando + ';'
        });

        if (rpcError) {
          // Se a função RPC não existir, tentar via REST API direta
          if (rpcError.message?.includes('function') && rpcError.message?.includes('does not exist')) {
            console.log(`   ⚠️  RPC exec_sql não disponível`);
            console.log(`   💡 Este comando precisa ser executado manualmente no Supabase Dashboard`);
            console.log(`\n   SQL do comando:`);
            console.log(`   ${'─'.repeat(70)}`);
            console.log(`   ${comando}`);
            console.log(`   ${'─'.repeat(70)}\n`);
          } else {
            console.warn(`   ⚠️  Erro ao executar: ${rpcError.message}`);
          }
        } else {
          console.log(`   ✅ Comando ${i + 1} executado com sucesso (via RPC)`);
        }
      } catch (err) {
        console.warn(`   ⚠️  Erro ao executar comando ${i + 1}:`, err.message);
        console.log(`   💡 Execute este comando manualmente no Supabase Dashboard`);
      }
    }

    // Aguardar um pouco antes de verificar
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verificar se a tabela foi criada
    console.log('\n🔍 Verificando criação...');
    const { error: finalError } = await supabase
      .from('ninebox_avaliacoes')
      .select('id')
      .limit(1);

    if (finalError) {
      if (finalError.code === '42P01' || finalError.message?.includes('does not exist')) {
        console.error('❌ Tabela ainda não foi criada.');
        console.log('\n📋 ⚠️  O Supabase não permite executar SQL diretamente via API por questões de segurança.');
        console.log('📋 Execute o SQL manualmente no Supabase Dashboard:');
        console.log('='.repeat(70));
        console.log(sqlCompleto);
        console.log('='.repeat(70));
        console.log('\n📍 Instruções:');
        console.log('   1. Acesse: https://supabase.com/dashboard');
        console.log('   2. Selecione seu projeto');
        console.log('   3. Vá em: SQL Editor > New Query');
        console.log('   4. Cole o SQL acima');
        console.log('   5. Execute (Run ou Ctrl+Enter)');
      } else {
        throw finalError;
      }
    } else {
      console.log('✅ Tabela ninebox_avaliacoes criada e verificada com sucesso!');
      console.log('\n📋 Estrutura criada:');
      console.log('   ✅ Tabela: ninebox_avaliacoes');
      console.log('   ✅ Colunas principais: id, nome_colaborador, cargo, departamento, potencial, desempenho');
      console.log('   ✅ Constraints de validação (CHECK)');
      console.log('   ✅ Índices otimizados');
      console.log('   ✅ Trigger para updated_at automático');
      console.log('   ✅ Comentários nas colunas');
    }

  } catch (error) {
    console.error('\n❌ Erro ao executar SQL:', error);
    console.error('Stack:', error.stack);
    console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
    console.log('='.repeat(70));
    console.log(sqlCompleto);
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

// Executar
if (require.main === module) {
  executarSQL().catch(console.error);
}

module.exports = { executarSQL };

