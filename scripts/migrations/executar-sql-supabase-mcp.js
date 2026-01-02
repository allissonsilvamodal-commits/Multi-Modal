/**
 * Script para executar SQL via Supabase usando o cliente configurado
 * Executa a criação da tabela solicitacoes_documentos
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
  console.log('🚀 Executando SQL via Supabase...\n');

  // SQL para criar a tabela
  const sql = `
-- Criar tabela solicitacoes_documentos
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

-- Criar índices
CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_motorista ON solicitacoes_documentos(motorista_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_coleta ON solicitacoes_documentos(coleta_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_status ON solicitacoes_documentos(status);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_pendentes ON solicitacoes_documentos(motorista_id, status) WHERE status = 'pendente';
  `.trim();

  try {
    // Verificar se a tabela já existe
    console.log('🔍 Verificando se a tabela já existe...');
    const { data: existe, error: verifError } = await supabase
      .from('solicitacoes_documentos')
      .select('id')
      .limit(1);

    if (!verifError && existe !== null) {
      console.log('✅ Tabela já existe! Verificando índices...');
      
      // Verificar e criar índices se necessário
      await criarIndices();
      return;
    }

    console.log('📝 Tabela não encontrada. Criando...');

    // Tentar executar via RPC exec_sql (se existir)
    console.log('⏳ Tentando executar via RPC exec_sql...');
    const { data: rpcData, error: rpcError } = await supabase.rpc('exec_sql', {
      sql_query: sql
    });

    if (rpcError) {
      console.warn('⚠️ RPC exec_sql não disponível:', rpcError.message);
      console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
      console.log('='.repeat(70));
      console.log(sql);
      console.log('='.repeat(70));
      return;
    }

    console.log('✅ SQL executado via RPC!');

    // Verificar se a tabela foi criada
    console.log('\n🔍 Verificando criação...');
    const { error: finalError } = await supabase
      .from('solicitacoes_documentos')
      .select('id')
      .limit(1);

    if (finalError) {
      console.error('❌ Erro ao verificar tabela:', finalError.message);
      return;
    }

    console.log('✅ Tabela solicitacoes_documentos criada com sucesso!');
    console.log('\n📋 Estrutura criada:');
    console.log('   ✅ Tabela: solicitacoes_documentos');
    console.log('   ✅ Colunas principais: id, coleta_id, motorista_id, categoria, motivo, status');
    console.log('   ✅ Constraints de validação');
    console.log('   ✅ Índices otimizados');

  } catch (error) {
    console.error('\n❌ Erro ao executar SQL:', error);
    console.error('Stack:', error.stack);
    console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
    console.log('='.repeat(70));
    console.log(sql);
    console.log('='.repeat(70));
    process.exit(1);
  }
}

async function criarIndices() {
  const indices = [
    'CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_motorista ON solicitacoes_documentos(motorista_id);',
    'CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_coleta ON solicitacoes_documentos(coleta_id);',
    'CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_status ON solicitacoes_documentos(status);',
    'CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_pendentes ON solicitacoes_documentos(motorista_id, status) WHERE status = \'pendente\';'
  ];

  for (const indexSQL of indices) {
    try {
      const { error } = await supabase.rpc('exec_sql', {
        sql_query: indexSQL
      });

      if (error) {
        if (error.message?.includes('already exists') || error.message?.includes('duplicate')) {
          console.log(`ℹ️ Índice já existe: ${indexSQL.split(' ')[4]}`);
        } else {
          console.warn(`⚠️ Erro ao criar índice: ${error.message}`);
        }
      } else {
        console.log(`✅ Índice criado: ${indexSQL.split(' ')[4]}`);
      }
    } catch (err) {
      console.warn(`⚠️ Erro: ${err.message}`);
    }
  }
}

// Executar
executarSQL().catch(console.error);

