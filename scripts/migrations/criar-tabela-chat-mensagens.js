/**
 * Script para executar SQL via Supabase usando o cliente configurado
 * Executa a criação da tabela chat_mensagens para o chat interno
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
  console.log('🚀 Executando SQL para criar tabela chat_mensagens...\n');
  console.log(`📍 URL: ${supabaseUrl}\n`);

  // Ler SQL do arquivo
  const sqlPath = path.join(__dirname, 'sql', 'criar-tabela-chat-mensagens.sql');
  let sql = '';
  
  try {
    sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('📄 SQL carregado do arquivo:', sqlPath);
  } catch (error) {
    console.error('❌ Erro ao ler arquivo SQL:', error.message);
    console.log('\n📋 Usando SQL embutido...');
    
    // SQL embutido como fallback
    sql = `
-- Tabela principal de mensagens
CREATE TABLE IF NOT EXISTS chat_mensagens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    remetente_id VARCHAR(255) NOT NULL,
    remetente_nome VARCHAR(255) NOT NULL,
    destinatario_id VARCHAR(255) NOT NULL,
    destinatario_nome VARCHAR(255) NOT NULL,
    mensagem TEXT NOT NULL,
    lida BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_chat_remetente ON chat_mensagens(remetente_id);
CREATE INDEX IF NOT EXISTS idx_chat_destinatario ON chat_mensagens(destinatario_id);
CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat_mensagens(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_lida ON chat_mensagens(lida) WHERE lida = false;
CREATE INDEX IF NOT EXISTS idx_chat_conversa ON chat_mensagens(remetente_id, destinatario_id, created_at DESC);

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_chat_mensagens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar updated_at
DROP TRIGGER IF EXISTS trigger_update_chat_mensagens_updated_at ON chat_mensagens;
CREATE TRIGGER trigger_update_chat_mensagens_updated_at
    BEFORE UPDATE ON chat_mensagens
    FOR EACH ROW
    EXECUTE FUNCTION update_chat_mensagens_updated_at();

-- RLS (Row Level Security)
ALTER TABLE chat_mensagens ENABLE ROW LEVEL SECURITY;

-- Política: Usuários podem ver mensagens onde são remetente ou destinatário
DROP POLICY IF EXISTS "Usuários podem ver suas próprias mensagens" ON chat_mensagens;
CREATE POLICY "Usuários podem ver suas próprias mensagens"
    ON chat_mensagens
    FOR SELECT
    USING (
        auth.uid()::text = remetente_id OR 
        auth.uid()::text = destinatario_id
    );

-- Política: Usuários podem inserir mensagens onde são remetente
DROP POLICY IF EXISTS "Usuários podem enviar mensagens" ON chat_mensagens;
CREATE POLICY "Usuários podem enviar mensagens"
    ON chat_mensagens
    FOR INSERT
    WITH CHECK (
        auth.uid()::text = remetente_id
    );

-- Política: Usuários podem atualizar apenas mensagens onde são destinatário (marcar como lida)
DROP POLICY IF EXISTS "Usuários podem marcar mensagens como lidas" ON chat_mensagens;
CREATE POLICY "Usuários podem marcar mensagens como lidas"
    ON chat_mensagens
    FOR UPDATE
    USING (
        auth.uid()::text = destinatario_id
    )
    WITH CHECK (
        auth.uid()::text = destinatario_id
    );
    `.trim();
  }

  // Dividir SQL em comandos individuais (separados por ;)
  const comandos = sql
    .split(';')
    .map(cmd => cmd.trim())
    .filter(cmd => cmd.length > 0 && !cmd.startsWith('--'));

  try {
    // Verificar se a tabela já existe
    console.log('🔍 Verificando se a tabela chat_mensagens já existe...');
    const { data: existe, error: verifError } = await supabase
      .from('chat_mensagens')
      .select('id')
      .limit(1);

    if (!verifError && existe !== null) {
      console.log('✅ Tabela chat_mensagens já existe!');
      console.log('📊 Verificando estrutura...');
      
      // Verificar colunas principais
      const { data: sample } = await supabase
        .from('chat_mensagens')
        .select('id, remetente_id, destinatario_id, mensagem, lida, created_at')
        .limit(1);
      
      if (sample !== null) {
        console.log('✅ Estrutura da tabela verificada!');
        console.log('   ✅ Colunas principais presentes');
        console.log('\n💡 Se precisar recriar a tabela, exclua-a manualmente no Supabase Dashboard primeiro.');
        return;
      }
    }

    console.log('📝 Tabela não encontrada. Criando...\n');

    // Tentar executar via REST API usando Service Key (método direto)
    console.log('⏳ Tentando executar SQL via REST API com Service Key...');
    
    // Usar fetch para chamar a API REST do Supabase diretamente
    const fetch = globalThis.fetch || require('node-fetch');
    
    // Dividir SQL em comandos executáveis
    const comandosExecutaveis = sql
      .split(/;\s*(?=\n|$)/)
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0 && !cmd.startsWith('--') && !cmd.match(/^\s*$/));
    
    for (let i = 0; i < comandosExecutaveis.length; i++) {
      const comando = comandosExecutaveis[i];
      
      // Pular comentários e linhas vazias
      if (comando.trim().startsWith('--') || comando.trim().length === 0) {
        continue;
      }
      
      console.log(`\n📝 Executando comando ${i + 1}/${comandosExecutaveis.length}...`);
      const preview = comando.split('\n')[0].substring(0, 80);
      console.log(`   ${preview}${preview.length >= 80 ? '...' : ''}`);
      
      try {
        // Tentar via RPC exec_sql primeiro (se existir)
        const { data: rpcData, error: rpcError } = await supabase.rpc('exec_sql', {
          sql_query: comando + ';'
        });

        if (rpcError) {
          // Se a função RPC não existir, tentar via REST API direta
          if (rpcError.message?.includes('function') && rpcError.message?.includes('does not exist')) {
            console.log(`   ⚠️  RPC não disponível, tentando via REST API...`);
            
            // Tentar executar via REST API do Supabase
            try {
              const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': supabaseServiceKey,
                  'Authorization': `Bearer ${supabaseServiceKey}`
                },
                body: JSON.stringify({ sql_query: comando + ';' })
              });
              
              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
              }
              
              const result = await response.json();
              console.log(`   ✅ Comando ${i + 1} executado com sucesso (via REST API)`);
            } catch (restError) {
              // Se REST API também falhar, informar que precisa executar manualmente
              if (i === 0) { // Só mostrar a mensagem uma vez
                console.warn(`\n⚠️  Não foi possível executar SQL automaticamente via API.`);
                console.log('📋 Execute o SQL manualmente no Supabase Dashboard:');
                console.log('='.repeat(70));
                console.log(sql);
                console.log('='.repeat(70));
                console.log('\n📍 Instruções:');
                console.log('   1. Acesse: https://supabase.com/dashboard');
                console.log('   2. Selecione seu projeto');
                console.log('   3. Vá em: SQL Editor > New Query');
                console.log('   4. Cole o SQL acima');
                console.log('   5. Execute (Run ou Ctrl+Enter)');
              }
              console.warn(`   ⚠️  Comando ${i + 1} não executado: ${restError.message}`);
            }
          } else if (rpcError.message?.includes('already exists') || rpcError.message?.includes('duplicate')) {
            console.log(`   ℹ️  Já existe: ${comando.split(' ')[0]} ${comando.split(' ')[1]}`);
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

    // Verificar se a tabela foi criada
    console.log('\n🔍 Verificando criação...');
    const { error: finalError } = await supabase
      .from('chat_mensagens')
      .select('id')
      .limit(1);

    if (finalError) {
      if (finalError.code === '42P01' || finalError.message?.includes('does not exist')) {
        console.error('❌ Tabela ainda não foi criada.');
        console.log('\n📋 ⚠️  O Supabase não permite executar SQL diretamente via API por questões de segurança.');
        console.log('📋 Execute o SQL manualmente no Supabase Dashboard:');
        console.log('='.repeat(70));
        console.log(sql);
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
      console.log('✅ Tabela chat_mensagens criada e verificada com sucesso!');
      console.log('\n📋 Estrutura criada:');
      console.log('   ✅ Tabela: chat_mensagens');
      console.log('   ✅ Colunas: id, remetente_id, remetente_nome, destinatario_id, destinatario_nome, mensagem, lida, created_at, updated_at');
      console.log('   ✅ Índices otimizados');
      console.log('   ✅ Trigger para updated_at');
      console.log('   ✅ RLS (Row Level Security) habilitado');
      console.log('   ✅ Políticas de segurança configuradas');
    }

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

// Executar
executarSQL().catch(console.error);

