/**
 * Script para criar a tabela ninebox_avaliacoes no Supabase
 * Usa Service Role Key para executar SQL diretamente
 * Execute: node criar-tabela-ninebox-via-mcp.js
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

// Criar cliente com Service Role Key (tem permissões administrativas)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function criarTabelaViaMCP() {
  console.log('🚀 Criando tabela ninebox_avaliacoes via Supabase...\n');
  console.log(`📍 URL: ${supabaseUrl}\n`);

  // Ler o arquivo SQL
  const sqlPath = path.join(__dirname, 'sql', 'criar-tabela-ninebox.sql');
  const sqlCompleto = fs.readFileSync(sqlPath, 'utf8');

  console.log('📄 SQL carregado do arquivo:', sqlPath);
  console.log('\n📋 SQL a ser executado:');
  console.log('─'.repeat(80));
  console.log(sqlCompleto);
  console.log('─'.repeat(80));
  console.log('\n');

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
      
      // Verificar colunas principais
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

    // IMPORTANTE: O Supabase não permite executar DDL (CREATE TABLE) via API REST
    // por questões de segurança. Precisamos usar uma das seguintes opções:
    
    // Opção 1: Criar função RPC no Supabase que execute o SQL
    // Opção 2: Executar manualmente no Dashboard
    // Opção 3: Usar conexão direta ao PostgreSQL (se tiver acesso)

    console.log('⚠️  O Supabase não permite executar DDL (CREATE TABLE) via API REST por segurança.');
    console.log('\n📋 Para criar a tabela, você tem duas opções:\n');
    
    console.log('OPÇÃO 1: Via Supabase Dashboard (Recomendado)');
    console.log('─'.repeat(80));
    console.log('1. Acesse: https://supabase.com/dashboard');
    console.log('2. Selecione seu projeto');
    console.log('3. Vá em: SQL Editor > New Query');
    console.log('4. Cole o SQL abaixo:');
    console.log('─'.repeat(80));
    console.log(sqlCompleto);
    console.log('─'.repeat(80));
    console.log('5. Execute (Run ou Ctrl+Enter)\n');

    console.log('OPÇÃO 2: Criar função RPC no Supabase');
    console.log('─'.repeat(80));
    console.log('1. No Supabase Dashboard, vá em: SQL Editor');
    console.log('2. Execute primeiro este SQL para criar a função RPC:');
    console.log('─'.repeat(80));
    console.log(`
CREATE OR REPLACE FUNCTION exec_sql(sql_query text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE sql_query;
END;
$$;
    `);
    console.log('─'.repeat(80));
    console.log('3. Depois execute o SQL da tabela normalmente\n');

    // Tentar criar via função RPC se existir
    console.log('⏳ Tentando criar via função RPC exec_sql (se existir)...\n');
    
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

    for (let i = 0; i < comandos.length; i++) {
      const comando = comandos[i];
      const preview = comando.split('\n')[0].substring(0, 80);
      
      console.log(`📝 Tentando executar comando ${i + 1}/${comandos.length}...`);
      console.log(`   ${preview}${preview.length >= 80 ? '...' : ''}`);

      try {
        // Tentar via RPC exec_sql (se existir)
        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('exec_sql', {
          sql_query: comando + ';'
        });

        if (rpcError) {
          if (rpcError.message?.includes('function') && rpcError.message?.includes('does not exist')) {
            console.log(`   ⚠️  Função RPC exec_sql não existe`);
            console.log(`   💡 Crie a função RPC primeiro (veja OPÇÃO 2 acima)`);
          } else {
            console.warn(`   ⚠️  Erro: ${rpcError.message}`);
          }
        } else {
          console.log(`   ✅ Comando ${i + 1} executado com sucesso (via RPC)`);
        }
      } catch (err) {
        console.warn(`   ⚠️  Erro ao executar comando ${i + 1}:`, err.message);
      }
    }

    // Aguardar um pouco antes de verificar
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verificar se a tabela foi criada
    console.log('\n🔍 Verificando criação...');
    const { error: finalError } = await supabaseAdmin
      .from('ninebox_avaliacoes')
      .select('id')
      .limit(1);

    if (finalError) {
      if (finalError.code === 'PGRST205' || finalError.message?.includes('does not exist')) {
        console.error('❌ Tabela ainda não foi criada.');
        console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard (veja OPÇÃO 1 acima)');
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
    process.exit(1);
  }
}

// Executar
if (require.main === module) {
  criarTabelaViaMCP().catch(console.error);
}

module.exports = { criarTabelaViaMCP };

