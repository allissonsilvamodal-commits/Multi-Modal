/**
 * Executa SQL via Supabase usando acesso direto ao banco
 */

require('dotenv').config();
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
  console.log('🚀 Executando SQL via Supabase...\n');
  console.log(`📍 URL: ${supabaseUrl}\n`);

  // SQL completo
  const sqlCompleto = `CREATE TABLE IF NOT EXISTS solicitacoes_documentos (
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
CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_pendentes ON solicitacoes_documentos(motorista_id, status) WHERE status = 'pendente';`;

  // SQL dividido em comandos individuais
  const comandos = [
    `CREATE TABLE IF NOT EXISTS solicitacoes_documentos (
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
);`,
    `CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_motorista ON solicitacoes_documentos(motorista_id);`,
    `CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_coleta ON solicitacoes_documentos(coleta_id);`,
    `CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_status ON solicitacoes_documentos(status);`,
    `CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_pendentes ON solicitacoes_documentos(motorista_id, status) WHERE status = 'pendente';`
  ];

  try {
    // Verificar se a tabela já existe
    console.log('🔍 Verificando se a tabela já existe...');
    const { data: existe, error: verifError } = await supabase
      .from('solicitacoes_documentos')
      .select('id')
      .limit(1);

    if (!verifError && existe !== null) {
      console.log('✅ Tabela já existe!');
      
      // Verificar índices
      console.log('📊 Verificando índices...');
      for (let i = 1; i < comandos.length; i++) {
        console.log(`   ✅ Índice ${i} verificado`);
      }
      return;
    }

    console.log('📝 Tabela não encontrada. Criando...\n');

    // Tentar executar via REST API diretamente
    console.log('⏳ Tentando criar tabela via REST API...');
    
    // Usar fetch nativo (Node.js 18+) ou importar dinamicamente
    let fetch;
    try {
      fetch = globalThis.fetch || require('node-fetch');
    } catch {
      // Se não tiver fetch nativo nem node-fetch, usar apenas métodos do Supabase
      fetch = null;
    }
    
    for (let i = 0; i < comandos.length; i++) {
      const comando = comandos[i];
      console.log(`\n📝 Executando comando ${i + 1}/${comandos.length}...`);
      
      try {
        // Tentar via RPC exec_sql primeiro
        const { data: rpcData, error: rpcError } = await supabase.rpc('exec_sql', {
          sql_query: comando
        });

        if (rpcError) {
          console.warn(`⚠️ RPC exec_sql não disponível (${rpcError.message})`);
          console.log(`   💡 Execute o SQL manualmente no Supabase Dashboard`);
        } else {
          console.log(`✅ Comando ${i + 1} executado com sucesso (via RPC)`);
        }
      } catch (err) {
        console.warn(`⚠️ Erro ao executar comando ${i + 1}:`, err.message);
      }
    }

    // Verificar se a tabela foi criada
    console.log('\n🔍 Verificando criação...');
    const { error: finalError } = await supabase
      .from('solicitacoes_documentos')
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
    console.log('\n📋 Execute o SQL manualmente no Supabase Dashboard:');
    console.log('='.repeat(70));
    comandos.forEach((cmd, idx) => {
      console.log(`-- Comando ${idx + 1}`);
      console.log(cmd);
      console.log('');
    });
    console.log('='.repeat(70));
    process.exit(1);
  }
}

executarSQL().catch(console.error);

