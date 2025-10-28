// 🔒 MELHORIA: Configuração segura do Supabase
const { createClient } = require('@supabase/supabase-js');
const { config } = require('./app-config');
const { logger } = require('./logger');

// Validação das variáveis de ambiente
if (!config.supabaseUrl || !config.supabaseAnonKey) {
  logger.error('❌ ERRO CRÍTICO: Variáveis de ambiente do Supabase não configuradas.');
  logger.error('📋 Verifique se SUPABASE_URL e SUPABASE_ANON_KEY estão definidas no .env');
  process.exit(1);
}

// Configuração do cliente Supabase com validações
const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  },
  db: {
    schema: 'public'
  },
  global: {
    headers: {
      'X-Client-Info': 'intranet-app'
    }
  }
});

// Função para testar conexão
async function testSupabaseConnection() {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('count')
      .limit(1);
    
    if (error) {
      logger.error('❌ Erro na conexão com Supabase:', error.message);
      return false;
    }
    
    logger.info('✅ Conexão com Supabase estabelecida com sucesso');
    return true;
  } catch (error) {
    logger.error('❌ Erro ao testar conexão:', error.message);
    return false;
  }
}

// Função para obter configurações do servidor (sem expor chaves)
function getPublicConfig() {
  return {
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey
  };
}

logger.info('✅ Cliente Supabase configurado com sucesso.');

module.exports = {
  supabase,
  testSupabaseConnection,
  getPublicConfig
};
