/**
 * Script para criar tabela de solicitações de atualização de documentos
 * Executa via Supabase Admin Client
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
  }
});

async function executarSQL() {
  console.log('🚀 Iniciando criação da tabela solicitacoes_documentos...\n');

  try {
    // Verificar se a tabela já existe
    console.log('🔍 Verificando se a tabela já existe...');
    const { data: existe, error: verifError } = await supabase
      .from('solicitacoes_documentos')
      .select('id')
      .limit(1);

    if (!verifError && existe !== null) {
      console.log('✅ Tabela já existe! Criando apenas índices se necessário...');
      await criarIndices();
      return;
    }

    console.log('📝 Criando tabela...\n');

    // SQL completo para criação da tabela
    const createTableSQL = `
CREATE TABLE IF NOT EXISTS solicitacoes_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coleta_id UUID NOT NULL REFERENCES coletas(id) ON DELETE CASCADE,
  motorista_id UUID NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL CHECK (categoria IN ('proprietario', 'veiculo', 'motorista', 'outro')),
  motivo TEXT NOT NULL,
  solicitado_por TEXT NOT NULL,
  solicitado_em TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'atendida', 'cancelada')),
  atendido_em TIMESTAMPTZ,
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
    `.trim();

    // Tentar executar via RPC exec_sql
    console.log('⏳ Executando CREATE TABLE...');
    const { data: rpcData, error: rpcError } = await supabase.rpc('exec_sql', {
      sql_query: createTableSQL
    });

    if (rpcError) {
      console.warn('⚠️ RPC exec_sql não disponível ou falhou:', rpcError.message);
      console.log('📋 Você precisa executar o SQL manualmente no Supabase Dashboard.\n');
      await mostrarSQLParaExecutar();
      return;
    }

    console.log('✅ Tabela criada com sucesso!');

    // Criar índices
    console.log('\n📊 Criando índices...');
    await criarIndices();

    // Verificar novamente
    console.log('\n🔍 Verificando criação final...');
    const { error: finalError } = await supabase
      .from('solicitacoes_documentos')
      .select('id')
      .limit(1);

    if (finalError) {
      console.error('❌ Erro ao verificar tabela:', finalError.message);
      await mostrarSQLParaExecutar();
    } else {
      console.log('✅ Tabela solicitacoes_documentos criada e verificada com sucesso!');
      console.log('\n📋 Estrutura criada:');
      console.log('   ✅ Tabela: solicitacoes_documentos');
      console.log('   ✅ Colunas principais: id, coleta_id, motorista_id, categoria, motivo, status');
      console.log('   ✅ Constraints de validação');
      console.log('   ✅ Índices otimizados');
    }

  } catch (error) {
    console.error('\n❌ Erro ao executar SQL:', error);
    console.error('Stack:', error.stack);
    await mostrarSQLParaExecutar();
    process.exit(1);
  }
}

async function mostrarSQLParaExecutar() {
  const sqlPath = path.join(__dirname, 'sql', 'criar-solicitacoes-atualizacao-docs.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  
  console.log('\n' + '='.repeat(70));
  console.log('📝 SQL PARA EXECUTAR MANUALMENTE NO SUPABASE:');
  console.log('='.repeat(70));
  console.log(sql);
  console.log('='.repeat(70));
  console.log('\n📍 INSTRUÇÕES:');
  console.log('   1. Acesse: https://supabase.com/dashboard');
  console.log('   2. Selecione seu projeto');
  console.log('   3. Vá em: SQL Editor (no menu lateral)');
  console.log('   4. Clique em: "New Query"');
  console.log('   5. Cole o SQL acima');
  console.log('   6. Clique em "Run" ou pressione Ctrl+Enter (Windows) / Cmd+Enter (Mac)');
  console.log('='.repeat(70) + '\n');
}

async function criarTabelaManual() {
  console.log('🔧 Tentando criar tabela via Supabase...');
  
  const sqlComando = `
CREATE TABLE IF NOT EXISTS solicitacoes_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coleta_id UUID NOT NULL REFERENCES coletas(id) ON DELETE CASCADE,
  motorista_id UUID NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL CHECK (categoria IN ('proprietario', 'veiculo', 'motorista', 'outro')),
  motivo TEXT NOT NULL,
  solicitado_por TEXT NOT NULL,
  solicitado_em TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'atendida', 'cancelada')),
  atendido_em TIMESTAMPTZ,
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
  `.trim();

  try {
    // Tentar executar via REST API do Supabase usando pg_net se disponível
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({ sql_query: sqlComando })
    });

    if (response.ok) {
      console.log('✅ Tabela criada via RPC!');
      return true;
    } else {
      const errorText = await response.text();
      throw new Error(errorText);
    }
  } catch (err) {
    console.warn('⚠️ Método automático falhou. Use o SQL Editor do Supabase:');
    console.log('\n📝 SQL para executar manualmente:');
    console.log('='.repeat(70));
    console.log(sqlComando);
    console.log('='.repeat(70));
    console.log('\n📍 Passos:');
    console.log('   1. Acesse: https://supabase.com/dashboard');
    console.log('   2. Selecione seu projeto');
    console.log('   3. Vá em: SQL Editor > New Query');
    console.log('   4. Cole o SQL acima');
    console.log('   5. Clique em "Run" ou pressione Ctrl+Enter');
    console.log('='.repeat(70));
    return false;
  }
}

async function criarIndices() {
  const indices = [
    {
      nome: 'idx_solicitacoes_documentos_motorista',
      sql: 'CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_motorista ON solicitacoes_documentos(motorista_id);'
    },
    {
      nome: 'idx_solicitacoes_documentos_coleta',
      sql: 'CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_coleta ON solicitacoes_documentos(coleta_id);'
    },
    {
      nome: 'idx_solicitacoes_documentos_status',
      sql: 'CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_status ON solicitacoes_documentos(status);'
    },
    {
      nome: 'idx_solicitacoes_documentos_pendentes',
      sql: 'CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_pendentes ON solicitacoes_documentos(motorista_id, status) WHERE status = \'pendente\';'
    }
  ];

  for (const indice of indices) {
    try {
      const { error } = await supabase.rpc('exec_sql', {
        sql_query: indice.sql
      });

      if (error) {
        if (error.message && (error.message.includes('already exists') || error.message.includes('duplicate'))) {
          console.log(`ℹ️ Índice ${indice.nome} já existe`);
        } else {
          console.warn(`⚠️ Índice ${indice.nome}:`, error.message);
        }
      } else {
        console.log(`✅ Índice ${indice.nome} criado`);
      }
    } catch (err) {
      console.warn(`⚠️ Índice ${indice.nome}:`, err.message);
    }
  }
}

// Executar
executarSQL().catch(console.error);

