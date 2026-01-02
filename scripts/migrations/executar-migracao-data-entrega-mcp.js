/**
 * Script para executar a migração de data_entrega via Supabase
 * Adiciona a coluna data_entrega à tabela coletas
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

async function executarMigracao() {
  console.log('🚀 Executando migração: Adicionar coluna data_entrega à tabela coletas\n');
  console.log(`📍 URL: ${supabaseUrl}\n`);

  // Ler SQL da migração
  const migrationPath = path.join(__dirname, 'migration_adicionar_data_entrega_coletas.sql');
  let sql;
  
  if (fs.existsSync(migrationPath)) {
    sql = fs.readFileSync(migrationPath, 'utf8');
    console.log('📄 Migração lida do arquivo: migration_adicionar_data_entrega_coletas.sql\n');
  } else {
    // SQL inline caso o arquivo não exista
    sql = `-- Migration: Adicionar coluna data_entrega à tabela coletas
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

COMMENT ON COLUMN coletas.data_entrega IS 'Data de entrega da coleta ao destino final';`;
    console.log('📄 Usando SQL inline\n');
  }

  try {
    // Primeiro, verificar se a coluna já existe
    console.log('🔍 Verificando se a coluna data_entrega já existe...');
    const { data: coletas, error: verifError } = await supabase
      .from('coletas')
      .select('id, data_recebimento, data_entrega')
      .limit(1);

    if (!verifError && coletas && coletas.length > 0) {
      const coleta = coletas[0];
      if ('data_entrega' in coleta) {
        console.log('✅ Coluna data_entrega JÁ existe na tabela coletas!');
        console.log('\n✅ Migração não é necessária. O banco de dados está pronto!\n');
        return;
      }
    }

    // Se chegou aqui, a coluna não existe ou há erro
    if (verifError && verifError.message && verifError.message.includes('data_entrega')) {
      console.log('❌ Coluna data_entrega não encontrada. Prosseguindo com a migração...\n');
    } else if (verifError) {
      console.log('⚠️  Erro na verificação:', verifError.message);
      console.log('Prosseguindo com a migração...\n');
    } else {
      console.log('❌ Coluna data_entrega não encontrada. Prosseguindo com a migração...\n');
    }

    // Tentar executar via RPC exec_sql (se existir)
    console.log('⏳ Tentando executar migração via RPC exec_sql...');
    const { data: rpcData, error: rpcError } = await supabase.rpc('exec_sql', {
      sql_query: sql
    });

    if (rpcError) {
      console.warn('⚠️ RPC exec_sql não disponível:', rpcError.message);
      console.log('\n📋 ⚠️  O Supabase não permite executar SQL diretamente via API por questões de segurança.');
      console.log('📋 Execute o SQL manualmente no Supabase Dashboard:\n');
      console.log('='.repeat(70));
      console.log(sql);
      console.log('='.repeat(70));
      console.log('\n📍 Instruções:');
      console.log('   1. Acesse: https://supabase.com/dashboard');
      console.log('   2. Selecione seu projeto');
      console.log('   3. Vá em: SQL Editor > New Query');
      console.log('   4. Cole o SQL acima');
      console.log('   5. Execute (Run ou Ctrl+Enter)\n');
      return;
    }

    console.log('✅ SQL executado via RPC!');

    // Verificar se a coluna foi criada
    console.log('\n🔍 Verificando se a coluna foi criada...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Aguardar 1 segundo
    
    const { data: coletasVerif, error: verifError2 } = await supabase
      .from('coletas')
      .select('id, data_recebimento, data_entrega')
      .limit(1);

    if (!verifError2 && coletasVerif && coletasVerif.length > 0) {
      const coleta = coletasVerif[0];
      if ('data_entrega' in coleta) {
        console.log('✅ Coluna data_entrega criada com sucesso!');
        console.log('\n📋 Migração concluída:');
        console.log('   ✅ Tabela: coletas');
        console.log('   ✅ Nova coluna: data_entrega (TIMESTAMPTZ NULL)');
        console.log('   ✅ Comentário adicionado');
        console.log('\n✅ Banco de dados está pronto para usar o campo data_entrega!\n');
        return;
      }
    }

    // Se ainda não existe, pode ser que precise executar manualmente
    console.log('⚠️  Não foi possível confirmar a criação da coluna.');
    console.log('   Execute a migração manualmente no Supabase Dashboard para garantir.\n');

  } catch (error) {
    console.error('\n❌ Erro ao executar migração:', error);
    console.error('Stack:', error.stack);
    console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
    console.log('='.repeat(70));
    console.log(sql);
    console.log('='.repeat(70));
    process.exit(1);
  }
}

// Executar
executarMigracao().catch(console.error);

