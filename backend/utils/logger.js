// 📊 MELHORIA: Sistema de logs estruturado
const winston = require('winston');
const path = require('path');

// Configuração de logs
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'intranet-app' },
  transports: [
    // Log de erros
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Log geral
    new winston.transports.File({
      filename: path.join('logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Em desenvolvimento, também log no console
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Funções de log específicas
const loggers = {
  // Log de autenticação
  auth: (message, meta = {}) => {
    logger.info(message, { ...meta, category: 'auth' });
  },

  // Log de operações
  operation: (message, meta = {}) => {
    logger.info(message, { ...meta, category: 'operation' });
  },

  // Log de erro
  error: (message, error = null, meta = {}) => {
    logger.error(message, {
      ...meta,
      category: 'error',
      error: error ? {
        message: error.message,
        stack: error.stack
      } : null
    });
  },

  // Log de segurança
  security: (message, meta = {}) => {
    logger.warn(message, { ...meta, category: 'security' });
  },

  // Log de performance
  performance: (message, meta = {}) => {
    logger.info(message, { ...meta, category: 'performance' });
  }
};

// Middleware para log de requests
function requestLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    };

    if (res.statusCode >= 400) {
      loggers.error('Request error', null, logData);
    } else {
      loggers.operation('Request completed', logData);
    }
  });

  next();
}

module.exports = {
  logger,
  loggers,
  requestLogger
};
