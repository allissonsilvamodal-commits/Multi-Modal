/**
 * Script para executar migração de colunas do chat interno via endpoint do servidor
 */

require('dotenv').config();
const fetch = require('node-fetch');

const BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:5680';

async function executarMigracao() {
  console.log('🚀 Executando migração de colunas para chat interno...\n');
  console.log(`📍 URL do servidor: ${BASE_URL}\n`);

  try {
    // Primeiro, precisamos fazer login ou usar uma sessão existente
    // Por enquanto, vamos tentar chamar o endpoint diretamente
    // Se precisar de autenticação, você precisará fazer login primeiro
    
    const response = await fetch(`${BASE_URL}/api/chat-interno/adicionar-colunas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include'
    });

    const result = await response.json();

    if (response.ok && result.success) {
      console.log('✅ Migração executada com sucesso!');
      console.log(`📋 ${result.message}`);
      if (result.resultados) {
        console.log('\n📊 Resultados:');
        result.resultados.forEach((r, idx) => {
          console.log(`   ${idx + 1}. ${r.sucesso ? '✅' : '❌'} ${r.comando}`);
          if (r.erro) {
            console.log(`      Erro: ${r.erro}`);
          }
        });
      }
    } else {
      console.log('⚠️ Não foi possível executar via API.');
      console.log(`📋 ${result.error || 'Erro desconhecido'}`);
      
      if (result.sql) {
        console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
        console.log('='.repeat(70));
        console.log(result.sql);
        console.log('='.repeat(70));
      }
      
      if (result.instrucoes) {
        console.log('\n📍 Instruções:');
        result.instrucoes.forEach(inst => console.log(`   ${inst}`));
      }
    }

  } catch (error) {
    console.error('❌ Erro ao executar migração:', error.message);
    console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
    console.log('='.repeat(70));
    console.log(`
-- Adicionar colunas necessárias para chat interno entre usuários
ALTER TABLE chat_mensagens
ADD COLUMN IF NOT EXISTS remetente_id UUID,
ADD COLUMN IF NOT EXISTS destinatario_id UUID,
ADD COLUMN IF NOT EXISTS remetente_nome TEXT,
ADD COLUMN IF NOT EXISTS destinatario_nome TEXT,
ADD COLUMN IF NOT EXISTS lida BOOLEAN DEFAULT false;

-- Criar índices para melhorar performance das queries
CREATE INDEX IF NOT EXISTS idx_chat_mensagens_remetente ON chat_mensagens(remetente_id);
CREATE INDEX IF NOT EXISTS idx_chat_mensagens_destinatario ON chat_mensagens(destinatario_id);
CREATE INDEX IF NOT EXISTS idx_chat_mensagens_lida ON chat_mensagens(lida) WHERE lida = false;
CREATE INDEX IF NOT EXISTS idx_chat_mensagens_remetente_destinatario ON chat_mensagens(remetente_id, destinatario_id);
    `.trim());
    console.log('='.repeat(70));
  }
}

executarMigracao().catch(console.error);

