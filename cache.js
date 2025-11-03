// ⚡ MELHORIA: Sistema de cache para performance
const NodeCache = require('node-cache');

// Configuração do cache
const cache = new NodeCache({
  stdTTL: 300, // 5 minutos por padrão
  checkperiod: 120, // Verificar expiração a cada 2 minutos
  useClones: false
});

// Configurações específicas por tipo de dados
const cacheConfig = {
  usuarios: { ttl: 600 }, // 10 minutos
  motoristas: { ttl: 300 }, // 5 minutos
  categorias: { ttl: 1800 }, // 30 minutos
  configuracoes: { ttl: 3600 }, // 1 hora
  estatisticas: { ttl: 60 } // 1 minuto
};

// Função para cache com configuração específica
function cacheData(key, data, type = 'default') {
  const config = cacheConfig[type] || { ttl: 300 };
  return cache.set(key, data, config.ttl);
}

// Função para recuperar dados do cache
function getCachedData(key) {
  return cache.get(key);
}

// Função para invalidar cache
function invalidateCache(pattern) {
  if (pattern) {
    const keys = cache.keys();
    const regex = new RegExp(pattern);
    keys.forEach(key => {
      if (regex.test(key)) {
        cache.del(key);
      }
    });
  } else {
    cache.flushAll();
  }
}

// Middleware de cache para rotas
function cacheMiddleware(type, ttl) {
  return (req, res, next) => {
    const cacheKey = `${type}:${req.originalUrl}:${JSON.stringify(req.query)}`;
    
    // Tentar recuperar do cache
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    // Interceptar resposta para cachear
    const originalSend = res.send;
    res.send = function(data) {
      if (res.statusCode === 200) {
        cacheData(cacheKey, JSON.parse(data), type);
      }
      originalSend.call(this, data);
    };

    next();
  };
}

// Função para cache de queries Supabase
async function cachedSupabaseQuery(queryFn, cacheKey, ttl = 300) {
  // Verificar cache primeiro
  const cached = getCachedData(cacheKey);
  if (cached) {
    return cached;
  }

  // Executar query e cachear resultado
  try {
    const result = await queryFn();
    cacheData(cacheKey, result, 'supabase');
    return result;
  } catch (error) {
    throw error;
  }
}

// Estatísticas do cache
function getCacheStats() {
  return {
    keys: cache.keys().length,
    hits: cache.getStats().hits,
    misses: cache.getStats().misses,
    hitRate: cache.getStats().hits / (cache.getStats().hits + cache.getStats().misses) * 100
  };
}

module.exports = {
  cache,
  cacheData,
  getCachedData,
  invalidateCache,
  cacheMiddleware,
  cachedSupabaseQuery,
  getCacheStats
};
