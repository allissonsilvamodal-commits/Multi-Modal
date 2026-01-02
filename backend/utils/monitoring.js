// 🔍 MELHORIA: Sistema de monitoramento e health check
const os = require('os');
const { getCacheStats } = require('../config/cache');

// Métricas do sistema
function getSystemMetrics() {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  return {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      total: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      external: Math.round(memUsage.external / 1024 / 1024), // MB
      system: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024) // MB
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system
    },
    platform: {
      type: os.type(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release()
    },
    loadAverage: os.loadavg(),
    freeMemory: Math.round(os.freemem() / 1024 / 1024) // MB
  };
}

// Health check completo
async function performHealthCheck() {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {},
    metrics: getSystemMetrics()
  };

  // Verificar Supabase
  try {
    const { supabase } = require('../config/supabase-secure');
    const { data, error } = await supabase
      .from('usuarios')
      .select('count')
      .limit(1);
    
    health.services.supabase = {
      status: error ? 'unhealthy' : 'healthy',
      responseTime: Date.now(),
      error: error?.message
    };
  } catch (error) {
    health.services.supabase = {
      status: 'unhealthy',
      error: error.message
    };
  }

  // Verificar cache
  try {
    const cacheStats = getCacheStats();
    health.services.cache = {
      status: 'healthy',
      stats: cacheStats
    };
  } catch (error) {
    health.services.cache = {
      status: 'unhealthy',
      error: error.message
    };
  }

  // Verificar Evolution API
  try {
    const response = await fetch(process.env.EVOLUTION_BASE_URL, {
      timeout: 5000
    });
    
    health.services.evolution = {
      status: response.ok ? 'healthy' : 'unhealthy',
      statusCode: response.status
    };
  } catch (error) {
    health.services.evolution = {
      status: 'unhealthy',
      error: error.message
    };
  }

  // Determinar status geral
  const unhealthyServices = Object.values(health.services)
    .filter(service => service.status === 'unhealthy');
  
  if (unhealthyServices.length > 0) {
    health.status = 'degraded';
  }

  return health;
}

// Middleware de monitoramento
function monitoringMiddleware(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    // Log de performance
    if (duration > 1000) { // Mais de 1 segundo
      console.warn(`Slow request: ${req.method} ${req.url} - ${duration}ms`);
    }
  });

  next();
}

// Endpoint de métricas
function setupMonitoringRoutes(app) {
  // Health check básico
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // Health check detalhado
  app.get('/health/detailed', async (req, res) => {
    try {
      const health = await performHealthCheck();
      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });

  // Métricas do sistema
  app.get('/metrics', (req, res) => {
    res.json(getSystemMetrics());
  });

  // Status dos serviços
  app.get('/status', async (req, res) => {
    const health = await performHealthCheck();
    res.json(health.services);
  });
}

module.exports = {
  getSystemMetrics,
  performHealthCheck,
  monitoringMiddleware,
  setupMonitoringRoutes
};
