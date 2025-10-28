// 📁 MELHORIA: Configurações centralizadas da aplicação
require('dotenv').config();

const config = {
  // Configurações do servidor
  port: process.env.PORT || 5680,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Configurações de segurança
  sessionSecret: process.env.SESSION_SECRET || 'segredo-muito-secreto-2025',
  jwtSecret: process.env.JWT_SECRET || 'super-secreto-jwt-2025',
  
  // Configurações do Supabase
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  
  // Configurações da Evolution API
  evolutionApi: {
    baseUrl: process.env.EVOLUTION_BASE_URL,
    apiKey: process.env.EVOLUTION_API_KEY,
    instanceName: process.env.EVOLUTION_INSTANCE_NAME
  },
  
  // Configurações de CORS
  allowedOrigins: process.env.ALLOWED_ORIGINS ? 
    process.env.ALLOWED_ORIGINS.split(',') : 
    ['http://localhost:5680', 'http://127.0.0.1:5680'],
  
  // Configurações de debug
  debugMode: process.env.DEBUG_MODE === 'true',
  
  // Configurações de cache
  cache: {
    ttl: parseInt(process.env.CACHE_TTL) || 300, // 5 minutos
    checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD) || 120 // 2 minutos
  },
  
  // Configurações de logs
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    maxSize: process.env.LOG_FILE_MAX_SIZE || '10m',
    maxFiles: parseInt(process.env.LOG_FILE_MAX_FILES) || 5
  }
};

// Validação das configurações críticas
const requiredConfigs = [
  'supabaseUrl',
  'supabaseAnonKey',
  'sessionSecret'
];

const missingConfigs = requiredConfigs.filter(key => !config[key]);

if (missingConfigs.length > 0) {
  console.error('❌ ERRO CRÍTICO: Configurações obrigatórias não encontradas:');
  missingConfigs.forEach(key => {
    console.error(`   - ${key.toUpperCase()}`);
  });
  console.error('📋 Verifique o arquivo .env');
  process.exit(1);
}

console.log('✅ Configurações carregadas com sucesso');

module.exports = { config };
