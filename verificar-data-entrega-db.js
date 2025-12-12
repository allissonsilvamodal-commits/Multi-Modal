/**
 * Script para verificar se a coluna data_entrega existe na tabela coletas
 * e executar a migração se necessário
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

async function verificarEstruturaTabela() {
  console.log('🔍 Verificando estrutura da tabela coletas...\n');
  console.log(`📍 URL: ${supabaseUrl}\n`);

  try {
    // Tentar buscar uma coleta com o campo data_entrega
    console.log('📋 Verificando se a coluna data_entrega existe...');
    
    const { data: coletas, error } = await supabase
      .from('coletas')
      .select('id, data_recebimento, data_entrega')
      .limit(1);

    if (error) {
      // Se der erro ao buscar data_entrega, provavelmente a coluna não existe
      if (error.message && error.message.includes('data_entrega')) {
        console.log('❌ Coluna data_entrega NÃO existe na tabela coletas!');
        console.log('\n📝 É necessário executar a migração.\n');
        mostrarInstrucoesMigracao();
        return false;
      } else {
        throw error;
      }
    }

    // Se chegou aqui, a coluna existe
    if (coletas && coletas.length > 0) {
      const coleta = coletas[0];
      
      // Verificar se o campo data_entrega está presente
      if ('data_entrega' in coleta) {
        console.log('✅ Coluna data_entrega JÁ existe na tabela coletas!');
        console.log(`\n📊 Exemplo de dados:`);
        console.log(`   - ID: ${coleta.id}`);
        console.log(`   - Data Recebimento: ${coleta.data_recebimento || 'null'}`);
        console.log(`   - Data Entrega: ${coleta.data_entrega || 'null'}`);
        console.log('\n✅ Banco de dados está OK com a modificação!\n');
        return true;
      } else {
        console.log('❌ Coluna data_entrega NÃO existe na tabela coletas!');
        console.log('\n📝 É necessário executar a migração.\n');
        mostrarInstrucoesMigracao();
        return false;
      }
    } else {
      // Não há coletas, mas vamos verificar a estrutura de outra forma
      console.log('⚠️  Nenhuma coleta encontrada para verificação direta.');
      console.log('📝 Tentando verificar estrutura via query...');
      
      // Tentar fazer um SELECT específico para testar
      const { error: testError } = await supabase
        .from('coletas')
        .select('data_entrega')
        .limit(0);
      
      if (testError && testError.message && testError.message.includes('data_entrega')) {
        console.log('❌ Coluna data_entrega NÃO existe na tabela coletas!');
        console.log('\n📝 É necessário executar a migração.\n');
        mostrarInstrucoesMigracao();
        return false;
      } else {
        console.log('✅ Coluna data_entrega existe na tabela coletas!');
        console.log('✅ Banco de dados está OK com a modificação!\n');
        return true;
      }
    }

  } catch (error) {
    console.error('\n❌ Erro ao verificar estrutura:', error);
    console.error('Mensagem:', error.message);
    console.log('\n📝 Execute a migração manualmente para garantir.\n');
    mostrarInstrucoesMigracao();
    return false;
  }
}

function mostrarInstrucoesMigracao() {
  const migrationPath = path.join(__dirname, 'migration_adicionar_data_entrega_coletas.sql');
  
  console.log('='.repeat(70));
  console.log('📋 INSTRUÇÕES PARA EXECUTAR A MIGRAÇÃO:');
  console.log('='.repeat(70));
  console.log('\n1. Acesse: https://supabase.com/dashboard');
  console.log('2. Selecione seu projeto');
  console.log('3. Vá em: SQL Editor > New Query');
  console.log('4. Cole o SQL abaixo');
  console.log('5. Execute (Run ou Ctrl+Enter)\n');
  
  console.log('='.repeat(70));
  console.log('SQL DA MIGRAÇÃO:');
  console.log('='.repeat(70));
  
  if (fs.existsSync(migrationPath)) {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    console.log(sql);
  } else {
    console.log(`
-- Migration: Adicionar coluna data_entrega à tabela coletas
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'coletas' 
        AND column_name = 'data_entrega'
    ) THEN
        ALTER TABLE coletas 
        ADD COLUMN data_entrega TIMESTAMPTZ NULL;
        
        RAISE NOTICE 'Coluna data_entrega adicionada com sucesso à tabela coletas';
    ELSE
        RAISE NOTICE 'Coluna data_entrega já existe na tabela coletas';
    END IF;
END $$;

COMMENT ON COLUMN coletas.data_entrega IS 'Data de entrega da coleta ao destino final';
    `);
  }
  
  console.log('='.repeat(70));
  console.log('\n');
}

async function main() {
  const colunaExiste = await verificarEstruturaTabela();
  
  if (!colunaExiste) {
    console.log('⚠️  AÇÃO NECESSÁRIA: Execute a migração SQL acima no Supabase Dashboard\n');
    process.exit(1);
  } else {
    console.log('🎉 Tudo certo! O banco de dados está pronto para usar o campo data_entrega.\n');
    process.exit(0);
  }
}

main().catch(console.error);

