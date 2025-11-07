// ✅ MELHORIA: Sistema de validação robusto
const Joi = require('joi');

// Schemas de validação
const schemas = {
  // Validação de login
  login: Joi.object({
    usuario: Joi.string().required().messages({
      'any.required': 'O campo usuário é obrigatório.',
      'string.empty': 'O campo usuário não pode ser vazio.'
    }),
    senha: Joi.string().required().messages({
      'any.required': 'O campo senha é obrigatório.',
      'string.empty': 'O campo senha não pode ser vazio.'
    })
  }),

  // Validação de usuário
  user: Joi.object({
    id: Joi.string().alphanum().min(3).max(50).required(),
    nome: Joi.string().min(2).max(100).required(),
    email: Joi.string().email().required(),
    senha: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/).required(),
    departamento: Joi.string().min(2).max(50),
    is_admin: Joi.boolean().default(false)
  }),

  // Validação de motorista
  motorista: Joi.object({
    nome: Joi.string().min(2).max(100).required(),
    telefone1: Joi.string().pattern(/^[0-9]{10,15}$/).required(),
    telefone2: Joi.string().pattern(/^[0-9]{10,15}$/).optional(),
    estado: Joi.string().length(2).uppercase().optional(),
    cnh: Joi.string().pattern(/^[0-9]{11}$/).optional(),
    categoria_cnh: Joi.string().valid('A', 'B', 'C', 'D', 'E').optional(),
    classe_veiculo: Joi.string().min(2).max(50).required(),
    tipo_veiculo: Joi.string().min(2).max(50).optional(),
    tipo_carroceria: Joi.string().min(2).max(50).optional(),
    placa_cavalo: Joi.string().pattern(/^[A-Z]{3}[0-9]{4}$/).optional(),
    placa_carreta1: Joi.string().pattern(/^[A-Z]{3}[0-9]{4}$/).optional(),
    placa_carreta2: Joi.string().pattern(/^[A-Z]{3}[0-9]{4}$/).optional(),
    status: Joi.string().valid('ativo', 'inativo', 'bloqueado').default('ativo')
  }),

  // Validação de mensagem
  mensagem: Joi.object({
    number: Joi.string().pattern(/^[0-9]{10,15}$/).required(),
    message: Joi.string().min(1).max(1000).required(),
    category: Joi.string().min(2).max(50).optional()
  }),

  // Validação de configuração Evolution
  evolutionConfig: Joi.object({
    apiKey: Joi.string().min(10).required(),
    instanceName: Joi.string().min(2).max(50).required(),
    webhookUrl: Joi.string().uri().optional(),
    apiUrl: Joi.string().uri().optional()
  })
};

// Middleware de validação
function validateRequest(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        details: errors
      });
    }

    req.validatedData = value;
    next();
  };
}

// 🔒 SEGURANÇA: Função melhorada para sanitizar dados (proteção contra XSS)
function sanitizeInput(input, options = {}) {
  if (typeof input === 'string') {
    let sanitized = input.trim();
    
    // Remover caracteres potencialmente perigosos para XSS
    // Remove: < > " ' & / e caracteres de controle
    sanitized = sanitized
      .replace(/[<>'"&\/\\\x00-\x1F\x7F]/g, '') // Remove caracteres perigosos
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers (onclick, onerror, etc)
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove tags script
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ''); // Remove tags iframe
    
    // Limitar tamanho
    const maxLength = options.maxLength || 1000;
    sanitized = sanitized.substring(0, maxLength);
    
    return sanitized;
  }
  
  // Para objetos e arrays, sanitizar recursivamente
  if (Array.isArray(input)) {
    return input.map(item => sanitizeInput(item, options));
  }
  
  if (input && typeof input === 'object') {
    const sanitized = {};
    for (const key in input) {
      if (input.hasOwnProperty(key)) {
        sanitized[key] = sanitizeInput(input[key], options);
      }
    }
    return sanitized;
  }
  
  return input;
}

// Função de validação simples (usada no server.js)
function validate(schemaName, data) {
  const schema = schemas[schemaName];
  if (!schema) {
    throw new Error(`Schema "${schemaName}" não encontrado para validação.`);
  }
  const { error, value } = schema.validate(data, { abortEarly: false, allowUnknown: true });
  if (error) {
    return { isValid: false, errors: error.details.map(detail => detail.message) };
  }
  return { isValid: true, value };
}

module.exports = {
  schemas,
  validateRequest,
  sanitizeInput,
  validate
};
