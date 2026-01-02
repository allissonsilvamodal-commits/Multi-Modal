/**
 * Script para criar tabela via endpoint do servidor
 */

require('dotenv').config();
const fetch = require('node-fetch');

const SERVER_URL = process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:5680';

async function criarTabela() {
  console.log('🚀 Criando tabela via endpoint do servidor...\n');
  console.log(`📡 URL do servidor: ${SERVER_URL}\n`);

  try {
    // Nota: Este endpoint requer autenticação, então será necessário fazer login primeiro
    // ou criar um endpoint público temporário
    console.log('⚠️  Este endpoint requer autenticação.');
    console.log('📋 Execute o SQL manualmente no Supabase Dashboard ou use o endpoint após fazer login.\n');
    
    console.log('SQL para executar:');
    console.log('='.repeat(70));
    const fs = require('fs');
    const path = require('path');
    const sqlPath = path.join(__dirname, 'sql', 'criar-solicitacoes-atualizacao-docs.sql');
    
    if (fs.existsSync(sqlPath)) {
      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log(sql);
    } else {
      console.log(`
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

CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_motorista ON solicitacoes_documentos(motorista_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_coleta ON solicitacoes_documentos(coleta_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_status ON solicitacoes_documentos(status);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_pendentes ON solicitacoes_documentos(motorista_id, status) WHERE status = 'pendente';
      `);
    }
    console.log('='.repeat(70));
    console.log('\n📍 Instruções:');
    console.log('   1. Acesse: https://supabase.com/dashboard');
    console.log('   2. Selecione seu projeto');
    console.log('   3. Vá em: SQL Editor > New Query');
    console.log('   4. Cole o SQL acima');
    console.log('   5. Execute (Run ou Ctrl+Enter)');
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

criarTabela();

