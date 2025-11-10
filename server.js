require('dotenv').config({ path: require('path').resolve(__dirname, '.env'), override: false });
console.log('📁 Diretório atual:', __dirname);
console.log('📁 Arquivo .env esperado em:', require('path').resolve(__dirname, '.env'));

// Verificar se o arquivo .env existe e ler diretamente para debug
const fs = require('fs');
const envPath = require('path').resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const openaiLines = envContent.split('\n').filter(line => line.includes('OPENAI_API_KEY') && !line.trim().startsWith('#'));
  console.log('🔍 Linhas OPENAI_API_KEY encontradas no .env:', openaiLines.length);
  openaiLines.forEach((line, index) => {
    console.log(`  Linha ${index + 1}: ${line.substring(0, 80)}...`);
  });
}

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { validate } = require('./validation');
const { logger } = require('./logger');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 5680;
const APP_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

// ========== CONFIGURAÇÕES DE SEGURANÇA ==========
// Helmet para headers de segurança
const isDevelopment = process.env.NODE_ENV !== 'production';

if (isDevelopment) {
  // CSP mais permissivo para desenvolvimento
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://fonts.googleapis.com", "https:", "data:"],
        styleSrcElem: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://fonts.googleapis.com", "https:", "data:"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https:"],
        scriptSrcElem: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https:"],
        scriptSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "https://*.supabase.co", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https:", "ws:", "wss:"],
        fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com", "https://fonts.googleapis.com", "https:", "data:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        workerSrc: ["'self'", "blob:"],
        manifestSrc: ["'self'"],
        formAction: ["'self'"],
        baseUri: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));
} else {
  // CSP restritivo para produção
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://fonts.googleapis.com"],
        styleSrcElem: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://fonts.googleapis.com"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
        scriptSrcElem: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
        scriptSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "https://*.supabase.co", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
        fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com", "https://fonts.googleapis.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        workerSrc: ["'self'", "blob:"],
        manifestSrc: ["'self'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: []
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));
}

// 🔒 SEGURANÇA: Configurar trust proxy para obter IP real em produção
app.set('trust proxy', 1);

// Rate limiting para prevenir ataques
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: process.env.NODE_ENV === 'production' ? 500 : 1000, // Mais restritivo em produção
  message: {
    error: 'Muitas tentativas de acesso. Tente novamente em 15 minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // 🔒 SEGURANÇA: Aplicar rate limiting mesmo em localhost em produção
    if (process.env.NODE_ENV === 'production') {
      return false; // Sempre aplicar em produção
    }
    // Apenas em desenvolvimento, pular para localhost
    return req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  }
});

app.use(limiter);

// Rate limiting específico para login (proteção contra brute force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: process.env.NODE_ENV === 'production' ? 10 : 20, // Mais restritivo em produção
  message: {
    error: 'Muitas tentativas de login. Tente novamente em 15 minutos.'
  },
  skipSuccessfulRequests: true,
  skip: (req) => {
    // 🔒 SEGURANÇA: Aplicar rate limiting mesmo em localhost em produção
    if (process.env.NODE_ENV === 'production') {
      return false; // Sempre aplicar em produção
    }
    // Apenas em desenvolvimento, pular para localhost
    return req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  }
});

// 🔒 SEGURANÇA: Configuração do Multer para uploads com validação de tipo
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    // Tipos MIME permitidos para CSV
    const allowedMimes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/csv',
      'text/plain' // Alguns sistemas enviam CSV como text/plain
    ];
    
    // Extensões permitidas
    const allowedExtensions = ['.csv'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    // Verificar tipo MIME
    if (allowedMimes.includes(file.mimetype)) {
      // Verificar extensão também
      if (allowedExtensions.includes(fileExtension)) {
        cb(null, true);
      } else {
        cb(new Error('Extensão de arquivo não permitida. Apenas arquivos .csv são aceitos.'));
      }
    } else {
      cb(new Error('Tipo de arquivo não permitido. Apenas arquivos CSV são aceitos.'));
    }
  }
});

// 🔥 IMPORT DO SUPABASE SEGURO
const { supabase } = require('./supabase-secure.js');
const { createClient } = require('@supabase/supabase-js');

// 🔒 SEGURANÇA: Criar cliente Supabase com SERVICE_KEY (sem fallback para ANON_KEY)
const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.error('❌ ERRO CRÍTICO: SUPABASE_SERVICE_KEY ou SUPABASE_SERVICE_ROLE_KEY não configurada');
  console.error('📋 Configure uma das chaves no arquivo .env antes de iniciar.');
  process.exit(1);
}

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  serviceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Log para debug (sem expor a chave)
console.log('🔑 Service Key configurada:', !!serviceKey);
console.log('✅ Cliente Supabase Admin inicializado com segurança');

// 🔒 SEGURANÇA: Função helper para requisições HTTP com timeout
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Requisição expirou após ${timeoutMs}ms`);
    }
    throw error;
  }
}

// ========== CONFIGURAÇÃO EVOLUTION API ==========
const EVOLUTION_CONFIG = {
  baseUrl: process.env.EVOLUTION_BASE_URL,
};

if (!EVOLUTION_CONFIG.baseUrl) {
  console.error('❌ ERRO CRÍTICO: EVOLUTION_BASE_URL não configurada no .env');
  process.exit(1);
}

// ========== FUNÇÕES PARA CONFIGURAÇÕES DO SUPABASE ==========

// 🔧 BUSCAR CONFIGURAÇÃO DO USUÁRIO NO SUPABASE COM FALLBACK PARA .ENV
async function getEvolutionConfigByUser(usuario) {
  try {
    logger.info(`🔍 Buscando configuração Evolution para: ${usuario}`);
    
    // ✅ PRIMEIRO: Buscar configuração específica do usuário no Supabase
    const { data: configData, error: configError } = await supabase
      .from('evolution_config')
      .select('*')
      .eq('usuario_id', usuario)
      .eq('is_active', true)
      .single();

    if (configError && configError.code !== 'PGRST116') {
      logger.error(`❌ Erro ao buscar configuração para ${usuario}:`, { error: configError.message });
    }

    if (configData) {
      logger.info(`✅ Config específica encontrada para ${usuario}: ${configData.instance_name}`);
      return {
        apiKey: configData.api_key,
        instanceName: configData.instance_name,
        webhookUrl: configData.webhook_url,
        id: configData.id,
        apiUrl: configData.api_url,
        usuario: configData.usuario_id
      };
    }

    // ✅ SEGUNDO: Buscar qualquer configuração ativa como fallback
    logger.info(`🔄 Buscando configuração fallback para ${usuario}...`);
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('evolution_config')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (fallbackData) {
      logger.info(`🔄 Usando configuração fallback: ${fallbackData.instance_name}`);
      return {
        apiKey: fallbackData.api_key,
        instanceName: fallbackData.instance_name,
        webhookUrl: fallbackData.webhook_url,
        id: fallbackData.id,
        apiUrl: fallbackData.api_url,
        usuario: fallbackData.usuario_id
      };
    }

    // ✅ TERCEIRO: Fallback para configurações do .env baseado no usuário
    logger.info(`🔄 Usando configurações do .env para ${usuario}...`);
    
    // Mapear usuário para configurações específicas do .env
    const userConfigMap = {
      'admin': {
        apiKey: process.env.ADMIN_API_KEY,
        instanceName: process.env.ADMIN_INSTANCE_NAME,
        webhookUrl: process.env.ADMIN_WEBHOOK_URL
      },
      'JBO': {
        apiKey: process.env.JBO_API_KEY,
        instanceName: process.env.JBO_INSTANCE_NAME,
        webhookUrl: process.env.JBO_WEBHOOK_URL
      },
      'CABO': {
        apiKey: process.env.CABO_API_KEY,
        instanceName: process.env.CABO_INSTANCE_NAME,
        webhookUrl: process.env.CABO_WEBHOOK_URL
      },
      'BA': {
        apiKey: process.env.BA_API_KEY,
        instanceName: process.env.BA_INSTANCE_NAME,
        webhookUrl: process.env.BA_WEBHOOK_URL
      },
      'PB': {
        apiKey: process.env.PB_API_KEY,
        instanceName: process.env.PB_INSTANCE_NAME,
        webhookUrl: process.env.PB_WEBHOOK_URL
      },
      'SP': {
        apiKey: process.env.SP_API_KEY,
        instanceName: process.env.SP_INSTANCE_NAME,
        webhookUrl: process.env.SP_WEBHOOK_URL
      },
      'AL': {
        apiKey: process.env.AL_API_KEY,
        instanceName: process.env.AL_INSTANCE_NAME,
        webhookUrl: process.env.AL_WEBHOOK_URL
      },
      'AMBEV': {
        apiKey: process.env.AMBEV_API_KEY,
        instanceName: process.env.AMBEV_INSTANCE_NAME,
        webhookUrl: process.env.AMBEV_WEBHOOK_URL
      },
      'USINA': {
        apiKey: process.env.USINA_API_KEY,
        instanceName: process.env.USINA_INSTANCE_NAME,
        webhookUrl: process.env.USINA_WEBHOOK_URL
      },
      'DISP3': {
        apiKey: process.env.DISP3_API_KEY,
        instanceName: process.env.DISP3_INSTANCE_NAME,
        webhookUrl: process.env.DISP3_WEBHOOK_URL
      }
    };

    const envConfig = userConfigMap[usuario];
    if (envConfig && envConfig.apiKey && envConfig.instanceName) {
      logger.info(`✅ Configuração do .env encontrada para ${usuario}: ${envConfig.instanceName}`);
      return {
        apiKey: envConfig.apiKey,
        instanceName: envConfig.instanceName,
        webhookUrl: envConfig.webhookUrl || '',
        apiUrl: process.env.EVOLUTION_BASE_URL || EVOLUTION_CONFIG.baseUrl,
        usuario: usuario,
        source: 'env'
      };
    }

    // ✅ QUARTO: Fallback para configuração padrão do .env
    if (process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCE_NAME) {
      logger.info(`🔄 Usando configuração padrão do .env para ${usuario}`);
      return {
        apiKey: process.env.EVOLUTION_API_KEY,
        instanceName: process.env.EVOLUTION_INSTANCE_NAME,
        webhookUrl: '',
        apiUrl: process.env.EVOLUTION_BASE_URL || EVOLUTION_CONFIG.baseUrl,
        usuario: usuario,
        source: 'env_default'
      };
    }

    return {
      error: `Nenhuma configuração Evolution encontrada para ${usuario}`
    };

  } catch (error) {
    console.error(`❌ Erro ao carregar configuração para ${usuario}:`, error);
    return {
      error: `Erro interno ao carregar configuração: ${error.message}`
    };
  }
}

// 🔧 SALVAR/ATUALIZAR CONFIGURAÇÃO NO SUPABASE
async function salvarEvolutionConfig(usuario, config) {
  try {
    console.log(`💾 Salvando configuração para: ${usuario}`);
    
    // ✅ VERIFICAÇÃO COMPATÍVEL
    const { data: existingConfig, error: checkError } = await supabase
      .from('evolution_config')
      .select('id')
      .eq('usuario_id', usuario)
      .single();

    let result;
    
    if (existingConfig) {
      // Atualiza configuração existente
      result = await supabase
        .from('evolution_config')
        .update({
          api_key: config.apiKey,
          instance_name: config.instanceName,
          webhook_url: config.webhookUrl,
          api_url: config.apiUrl,
          updated_at: new Date().toISOString()
        })
        .eq('usuario_id', usuario)
        .select();
    } else {
      // Cria nova configuração
      result = await supabase
        .from('evolution_config')
        .insert([{
          usuario_id: usuario,
          api_key: config.apiKey,
          instance_name: config.instanceName,
          webhook_url: config.webhookUrl,
          api_url: config.apiUrl,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select();
    }

    if (result.error) {
      console.error(`❌ Erro ao salvar configuração:`, result.error);
      return { success: false, error: result.error.message };
    }

    console.log(`✅ Configuração salva para ${usuario}: ${config.instanceName}`);
    return { 
      success: true, 
      data: result.data[0],
      message: existingConfig ? 'Configuração atualizada' : 'Configuração criada'
    };

  } catch (error) {
    console.error(`❌ Erro ao salvar configuração para ${usuario}:`, error);
    return { success: false, error: error.message };
  }
}

// 🔧 LISTAR CONFIGURAÇÕES SIMPLES
async function listarConfiguracoesSimples() {
  try {
    const { data, error } = await supabase
      .from('evolution_config')
      .select('*')
      .eq('is_active', true);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

const DEFAULT_DISPARO_CONFIG = {
  threshold: 50,
  windowMs: 5 * 60 * 1000,
  cooldownMs: 15 * 60 * 1000
};

const userDisparoConfig = new Map();
const userDisparoState = new Map(); // userId => { count, lastReset, cooldownUntil }

async function simulateTypingAction({ enabled, evolutionUrl, instanceName, apiKey, formattedNumber, message }) {
  if (!enabled) {
    return;
  }

  const charCount = (message || '').length;
  let typingSeconds = Math.round(charCount / 12) + 2;
  typingSeconds = Math.max(3, Math.min(typingSeconds, 15));

  const typingUrl = `${evolutionUrl}/message/sendTyping/${instanceName}`;

  try {
    const response = await fetch(typingUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey
      },
      body: JSON.stringify({
        number: formattedNumber,
        time: typingSeconds
      }),
      timeout: 15000
    });

    if (!response.ok) {
      console.warn(`⚠️ Evolution não aceitou simulação de digitação (${response.status}).`);
    } else {
      console.log(`⌨️ Simulação de digitação enviada por ${typingSeconds}s para ${formattedNumber}`);
    }
  } catch (error) {
    console.warn('⚠️ Falha ao simular digitação:', error.message);
  }

  await new Promise(resolve => setTimeout(resolve, typingSeconds * 1000));
}

function getUserConfig(userId) {
  if (!userId) {
    return { ...DEFAULT_DISPARO_CONFIG };
  }
  const stored = userDisparoConfig.get(userId);
  return { ...DEFAULT_DISPARO_CONFIG, ...(stored || {}) };
}

function setUserConfig(userId, overrides = {}) {
  if (!userId || typeof overrides !== 'object') return;
  const sanitized = {};
  if (overrides.threshold && Number.isFinite(overrides.threshold)) {
    const threshold = Math.max(1, Math.min(1000, Math.floor(overrides.threshold)));
    sanitized.threshold = threshold;
  }
  if (overrides.windowMs && Number.isFinite(overrides.windowMs)) {
    const windowMs = Math.max(60 * 1000, Math.min(120 * 60 * 1000, Math.floor(overrides.windowMs)));
    sanitized.windowMs = windowMs;
  }
  if (overrides.cooldownMs && Number.isFinite(overrides.cooldownMs)) {
    const cooldownMs = Math.max(60 * 1000, Math.min(240 * 60 * 1000, Math.floor(overrides.cooldownMs)));
    sanitized.cooldownMs = cooldownMs;
  }
  if (Object.keys(sanitized).length === 0) return;

  const current = userDisparoConfig.get(userId) || {};
  const updated = { ...current, ...sanitized };
  userDisparoConfig.set(userId, updated);
  console.log(`⚙️ Configuração de disparo ajustada para usuário ${userId}:`, updated);
}

function getUserCooldownState(userId) {
  if (!userId) return { blocked: false };
  const now = Date.now();
  const state = userDisparoState.get(userId);
  if (state && state.cooldownUntil && now < state.cooldownUntil) {
    return { blocked: true, remainingMs: state.cooldownUntil - now };
  }
  if (state && state.cooldownUntil && now >= state.cooldownUntil) {
    state.cooldownUntil = 0;
    state.count = 0;
    state.lastReset = now;
    userDisparoState.set(userId, state);
  }
  return { blocked: false };
}

function registerUserSend(userId) {
  if (!userId) {
    return {
      cooldownTriggered: false,
      cooldownUntil: null,
      cooldownMinutes: Math.ceil(DEFAULT_DISPARO_CONFIG.cooldownMs / 60000)
    };
  }

  const config = getUserConfig(userId);
  const threshold = Math.max(1, Math.floor(config.threshold || DEFAULT_DISPARO_CONFIG.threshold));
  const windowMs = Math.max(1, Math.floor(config.windowMs || DEFAULT_DISPARO_CONFIG.windowMs));
  const cooldownMs = Math.max(1, Math.floor(config.cooldownMs || DEFAULT_DISPARO_CONFIG.cooldownMs));

  const now = Date.now();
  let state = userDisparoState.get(userId);
  if (!state) {
    state = { count: 0, lastReset: now, cooldownUntil: 0 };
  }

  if (state.cooldownUntil && now >= state.cooldownUntil) {
    state.cooldownUntil = 0;
  }

  if (!state.lastReset || (windowMs && now - state.lastReset > windowMs)) {
    state.count = 0;
    state.lastReset = now;
  }

  state.count += 1;
  let cooldownTriggered = false;
  if (state.count >= threshold) {
    state.cooldownUntil = now + cooldownMs;
    cooldownTriggered = true;
    state.count = 0;
    state.lastReset = now;
    console.log(`⏳ Cooldown de disparo ativado para usuário ${userId} até ${new Date(state.cooldownUntil).toISOString()}`);
  }

  userDisparoState.set(userId, state);
  return {
    cooldownTriggered,
    cooldownUntil: state.cooldownUntil || null,
    cooldownMinutes: Math.ceil(cooldownMs / 60000)
  };
}

function getCooldownStatus(userId) {
  const state = userDisparoState.get(userId);
  if (!state || !state.cooldownUntil) {
    return { active: false };
  }
  const now = Date.now();
  if (now >= state.cooldownUntil) {
    state.cooldownUntil = 0;
    state.count = 0;
    state.lastReset = now;
    userDisparoState.set(userId, state);
    return { active: false };
  }
  return {
    active: true,
    remainingMs: state.cooldownUntil - now,
    cooldownUntil: state.cooldownUntil
  };
}

// ========== MIDDLEWARES ==========
// 🔒 SEGURANÇA: CORS configurado com validação dinâmica de origem
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : (process.env.NODE_ENV === 'production' 
      ? [] // Em produção, exigir configuração explícita
      : ['http://localhost:5680', 'http://127.0.0.1:5680']); // Desenvolvimento

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.warn('⚠️ ALLOWED_ORIGINS não configurado. Configure no .env para produção.');
}

app.use(cors({
  origin: function (origin, callback) {
    // Permitir requisições sem origem (mobile apps, Postman, etc) apenas em desenvolvimento
    if (!origin) {
      if (process.env.NODE_ENV !== 'production' || allowedOrigins.length === 0) {
        return callback(null, true);
      } else {
        return callback(new Error('Requisições sem origem não permitidas em produção'));
      }
    }
    
    if (allowedOrigins.length === 0 || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`⚠️ Origem bloqueada pelo CORS: ${origin}`);
      callback(new Error('Não permitido pelo CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With']
}));

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ✅✅✅ SESSÃO PRIMEIRO, DEPOIS DEBUG ✅✅✅
const SQLiteStore = require('connect-sqlite3')(session);

// 🔒 SEGURANÇA: Gerar SESSION_SECRET forte se não configurado
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ ERRO CRÍTICO: SESSION_SECRET não configurado em produção!');
    console.error('📋 Configure SESSION_SECRET no arquivo .env antes de iniciar em produção.');
    process.exit(1);
  } else {
    // Em desenvolvimento, gerar um secret aleatório
    SESSION_SECRET = crypto.randomBytes(64).toString('hex');
    console.warn('⚠️ SESSION_SECRET não configurado. Gerando secret temporário para desenvolvimento.');
    console.warn('⚠️ Configure SESSION_SECRET no .env para produção.');
  }
}

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: './',
    table: 'sessions'
  }),
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // HTTPS obrigatório em produção
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    path: '/'
  }
}));

// 🔧 DEBUG DETALHADO DE SESSÃO - AGORA DEPOIS DA SESSÃO
/*
app.use((req, res, next) => {
  console.log('=== SESSÃO DEBUG ===');
  console.log('URL:', req.url);
  console.log('Cookies:', req.headers.cookie);
  console.log('SessionID:', req.sessionID);
  console.log('Session usuario:', req.session?.usuario || 'NÃO DEFINIDO');
  console.log('====================');
  next();
});
*/
// ========== SISTEMA DE AUTENTICAÇÃO ==========
function parseUsuarios() {
  const usuarios = {};
  const usuariosEnv = process.env.USUARIOS;

  if (!usuariosEnv) {
    console.info('ℹ️ USUARIOS não definido no .env. Somente autenticação Supabase será utilizada.');
    console.info('ℹ️ Caso deseje logins locais emergenciais, configure USUARIOS no formato usuario:senha.');
    return usuarios;
  }

  usuariosEnv.split(',').forEach(credencial => {
    const [usuario, senha] = credencial.split(':');
    if (usuario && senha) {
      usuarios[usuario.trim()] = senha.trim();
    }
  });

  return usuarios;
}

const usuarios = parseUsuarios();
console.log('👥 Usuários carregados:', Object.keys(usuarios));

// Middleware de autenticação
async function requireAuth(req, res, next) {
  try {
    if (req.session && req.session.usuario) {
      console.log('🔐 Usuário autenticado (sessão):', req.session.usuario);
      return next();
    }

    const { user, error } = await getSupabaseUserFromRequest(req);

    if (user && !error) {
      req.supabaseUser = user;
      console.log('🔐 Usuário autenticado via Supabase:', user.email || user.id);
      return next();
    }

    if (error && error.status && error.status !== 401) {
      console.warn('⚠️ Erro ao validar token Supabase em requireAuth:', error.message || error);
    }
  } catch (authError) {
    console.warn('⚠️ Erro inesperado no middleware requireAuth:', authError.message || authError);
  }

  console.log('❌ Acesso não autorizado');
  return res.status(401).json({ error: 'Não autenticado' });
}

// ========== BANCO DE DADOS ==========
const db = new sqlite3.Database('./contatos.db', (err) => {
  if (err) {
    console.error('❌ Erro no banco:', err);
  } else {
    console.log('✅ SQLite conectado');
  }
});

// Criar tabela de contatos
db.run(`CREATE TABLE IF NOT EXISTS contatos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  number TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name, number)
)`, (err) => {
  if (err) {
    console.error('❌ Erro ao criar tabela contatos:', err);
  } else {
    console.log('✅ Tabela contatos verificada/criada');
  }
});

// Criar tabela para armazenar permissões dos usuários
db.run(`CREATE TABLE IF NOT EXISTS usuario_permissoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL,
  etapa TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(usuario, etapa)
)`, (err) => {
  if (err) {
    console.error('❌ Erro ao criar tabela permissoes:', err);
  } else {
    console.log('✅ Tabela usuario_permissoes verificada/criada');
  }
});

// Função para carregar permissões de um usuário
function carregarPermissoesUsuario(usuario) {
  return new Promise((resolve, reject) => {
    db.all('SELECT etapa FROM usuario_permissoes WHERE usuario = ?', [usuario], (err, rows) => {
      if (err) {
        console.error('❌ Erro ao carregar permissões:', err);
        reject(err);
      } else {
        let permissoes = rows.map(row => row.etapa);
        
        // ✅ SE FOR ADMIN, GARANTIR QUE TENHA TODAS AS PERMISSÕES
        if (usuario === 'admin') {
          const permissoesEspeciais = ['operacoes', 'coletas', 'monitoramento', 'crm', 'vendas', 'contas-pagar', 'contas-receber', 'folha', 'recrutamento', 'admin'];
          permissoesEspeciais.forEach(permissao => {
            if (!permissoes.includes(permissao)) {
              permissoes.push(permissao);
            }
          });
          console.log(`🎯 Permissões garantidas para admin:`, permissoes);
        }
        
        console.log(`✅ Permissões carregadas para ${usuario}:`, permissoes);
        resolve(permissoes);
      }
    });
  });
}

// Função para salvar permissões de um usuário
function salvarPermissoesUsuario(usuario, permissoes) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Remover permissões antigas
      db.run('DELETE FROM usuario_permissoes WHERE usuario = ?', [usuario], function(err) {
        if (err) {
          db.run('ROLLBACK');
          reject(err);
          return;
        }
        
        console.log(`🗑️ Permissões antigas removidas para ${usuario}: ${this.changes}`);
        
        // Inserir novas permissões
        if (permissoes.length === 0) {
          db.run('COMMIT', (err) => {
            if (err) reject(err);
            else resolve(0);
          });
          return;
        }
        
        const stmt = db.prepare('INSERT OR IGNORE INTO usuario_permissoes (usuario, etapa) VALUES (?, ?)');
        let inseridas = 0;
        
        permissoes.forEach((etapa, index) => {
          stmt.run([usuario, etapa], function(err) {
            if (err) {
              console.error('❌ Erro ao inserir permissão:', err);
            } else if (this.changes > 0) {
              inseridas++;
            }
            
            if (index === permissoes.length - 1) {
              stmt.finalize((err) => {
                if (err) {
                  db.run('ROLLBACK');
                  reject(err);
                  return;
                }
                
                db.run('COMMIT', (err) => {
                  if (err) reject(err);
                  else {
                    console.log(`✅ ${inseridas} permissões salvas para ${usuario}`);
                    resolve(inseridas);
                  }
                });
              });
            }
          });
        });
      });
    });
  });
}

// ========== SISTEMA DE BACKUP AUTOMÁTICO ==========
const BACKUP_FILE = './contatos_backup.json';

// Salvar backup dos contatos
function salvarBackupContatos() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM contatos', (err, rows) => {
      if (err) {
        console.error('❌ Erro ao ler contatos para backup:', err);
        reject(err);
        return;
      }
      
      const backupData = {
        timestamp: new Date().toISOString(),
        contatos: rows
      };
      
      fs.writeFileSync(BACKUP_FILE, JSON.stringify(backupData, null, 2));
      console.log(`✅ Backup salvo: ${rows.length} contatos`);
      resolve(rows.length);
    });
  });
}
// Restaurar contatos do backup
function restaurarBackupContatos() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(BACKUP_FILE)) {
      console.log('📭 Nenhum backup encontrado');
      resolve(0);
      return;
    }
    
    try {
      const backupData = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
      const contatos = backupData.contatos || [];
      
      if (contatos.length === 0) {
        console.log('📭 Backup vazio');
        resolve(0);
        return;
      }
      
      db.serialize(() => {
        db.run('DELETE FROM contatos', (err) => {
          if (err) {
            console.error('❌ Erro ao limpar contatos:', err);
            reject(err);
            return;
          }
          
          const stmt = db.prepare('INSERT OR IGNORE INTO contatos (name, number, category) VALUES (?, ?, ?)');
          let inseridos = 0;
          
          contatos.forEach((contato, index) => {
            stmt.run([contato.name, contato.number, contato.category], function(err) {
              if (err) {
                console.error('❌ Erro ao restaurar contato:', err);
              } else if (this.changes > 0) {
                inseridos++;
              }
              
              if (index === contatos.length - 1) {
                stmt.finalize(() => {
                  console.log(`✅ Backup restaurado: ${inseridos} contatos`);
                  resolve(inseridos);
                });
              }
            });
          });
        });
      });
      
    } catch (error) {
      console.error('❌ Erro ao restaurar backup:', error);
      reject(error);
    }
  });
}

// Middleware para salvar backup após operações importantes
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function(data) {
    const backupRoutes = [
      '/webhook/contatos/lote',
      '/webhook/importar-csv', 
      '/webhook/contatos',
      '/webhook/limpar-contatos'
    ];
    
    if (backupRoutes.some(route => req.originalUrl.includes(route)) && req.method !== 'GET') {
      setTimeout(() => {
        salvarBackupContatos().catch(err => {
          console.error('❌ Erro ao salvar backup automático:', err);
        });
      }, 1000);
    }
    
    originalSend.call(this, data);
  };
  next();
});

// ========== MAPEAMENTOS E NORMALIZAÇÃO DE TIPOS DE VEÍCULO E CARROCERIA ==========
// Mapeamento de tipos de veículo (valores válidos no banco)
const TIPOS_VEICULO_MAP = {
  '3/4': '3/4',
  'fiorino': 'Fiorino',
  'toco': 'Toco',
  'vlc': 'VLC',
  'bitruck': 'Bitruck',
  'truck': 'Truck',
  'bitrem': 'Bitrem',
  'carreta': 'Carreta',
  'carreta_ls': 'Carreta LS',
  'carreta ls': 'Carreta LS',
  'rodotrem': 'Rodotrem',
  'vanderleia': 'Vanderleia',
  'nao_informado': 'Não informado'
};

// Mapeamento de tipos de carroceria (valores válidos no banco)
const TIPOS_CARROCERIA_MAP = {
  'bau': 'bau',
  'baú': 'bau',
  'bau_frigorifico': 'bau_frigorifico',
  'bau frigorifico': 'bau_frigorifico',
  'baú frigorífico': 'bau_frigorifico',
  'bau_refrigerado': 'bau_refrigerado',
  'bau refrigerado': 'bau_refrigerado',
  'baú refrigerado': 'bau_refrigerado',
  'sider': 'sider',
  'cacamba': 'cacamba',
  'caçamba': 'cacamba',
  'caamba': 'cacamba', // Variação quando o ç foi removido incorretamente
  'CAÇAMBA': 'cacamba',
  'Caçamba': 'cacamba',
  'CaçamBA': 'cacamba',
  'graneleiro': 'graneleiro',
  'plataforma': 'plataforma',
  'prancha': 'prancha',
  'bitrem': 'bitrem',
  'carreta': 'carreta',
  'carreta_ls': 'carreta_ls',
  'carreta ls': 'carreta_ls',
  'rodotrem': 'rodotrem',
  'vanderleia': 'vanderleia',
  'apenas_cavalo': 'apenas_cavalo',
  'apenas cavalo': 'apenas_cavalo',
  'cegonheiro': 'cegonheiro',
  'gaiola': 'gaiola',
  'tanque': 'tanque',
  'grade_baixa': 'grade_baixa',
  'grade baixa': 'grade_baixa',
  'GRADE BAIXA': 'grade_baixa',
  'basculante': 'basculante',
  'BASCULANTE': 'basculante',
  'porta_container_20': 'porta_container_20',
  'porta container 20': 'porta_container_20',
  'PORTA CONTAINER 20': 'porta_container_20',
  'porta_container_40': 'porta_container_40',
  'porta container 40': 'porta_container_40',
  'PORTA CONTAINER 40': 'porta_container_40',
  'porta_container20/40': 'porta_container_20',
  'PORTA CONTAINER20/40': 'porta_container_20',
  'nao_informado': 'nao_informado'
};

const VALID_UF = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

const MOTORISTA_EMAIL_DOMAINS = [
  'multimodal.app',
  'logmultimodal.com.br',
  'multimodal.com.br',
  'multimodal.com'
];

const CARROCERIA_LABELS = {
  bau: 'Baú',
  bau_frigorifico: 'Baú Frigorífico',
  bau_refrigerado: 'Baú Refrigerado',
  sider: 'Sider',
  cacamba: 'Caçamba',
  graneleiro: 'Graneleiro',
  plataforma: 'Plataforma',
  prancha: 'Prancha',
  bitrem: 'Bitrem',
  carreta: 'Carreta',
  carreta_ls: 'Carreta LS',
  rodotrem: 'Rodotrem',
  vanderleia: 'Vanderleia',
  apenas_cavalo: 'Apenas cavalo',
  cegonheiro: 'Cegonheiro',
  gaiola: 'Gaiola',
  tanque: 'Tanque',
  grade_baixa: 'Grade baixa',
  basculante: 'Basculante',
  porta_container_20: 'Porta contêiner 20',
  porta_container_40: 'Porta contêiner 40'
};

const VEHICLE_CLASS_OPTIONS = {
  leve: {
    label: 'Veículos leves (Fiorino, 3/4, Toco, VLC)',
    keywords: ['leve', 'leves', '1', 'veiculo leve', 'veiculos leves'],
    tiposVeiculo: ['Fiorino', '3/4', 'Toco', 'VLC'],
    carrocerias: ['bau', 'bau_frigorifico', 'bau_refrigerado', 'cacamba', 'prancha']
  },
  medio: {
    label: 'Veículos médios (Bitruck, Truck)',
    keywords: ['medio', 'médio', 'medios', 'médios', '2', 'veiculo medio', 'veiculos medios'],
    tiposVeiculo: ['Bitruck', 'Truck'],
    carrocerias: ['bau', 'bau_frigorifico', 'sider', 'graneleiro', 'plataforma', 'basculante']
  },
  pesado: {
    label: 'Pesados (Carreta, Bitrem, Rodotrem...)',
    keywords: ['pesado', 'pesados', '3', 'veiculo pesado', 'veiculos pesados'],
    tiposVeiculo: ['Bitrem', 'Carreta', 'Carreta LS', 'Rodotrem', 'Vanderleia'],
    carrocerias: [
      'bau', 'sider', 'graneleiro', 'grade_baixa', 'bitrem', 'carreta',
      'carreta_ls', 'rodotrem', 'vanderleia', 'apenas_cavalo', 'cegonheiro',
      'gaiola', 'tanque', 'porta_container_20', 'porta_container_40', 'basculante'
    ]
  }
};

function formatCarroceriaLabel(value) {
  if (!value) return '';
  return CARROCERIA_LABELS[value] || value.replace(/_/g, ' ').replace(/\b\w/g, letra => letra.toUpperCase());
}

function resolveVehicleClass(input) {
  if (!input) return null;
  const normalized = normalizeText(input);
  for (const [value, info] of Object.entries(VEHICLE_CLASS_OPTIONS)) {
    if (normalized === normalizeText(value)) return value;
    if (info.keywords && info.keywords.some(keyword => normalizeText(keyword) === normalized)) {
      return value;
    }
  }
  return null;
}

function resolveVehicleType(classKey, input) {
  if (!classKey || !VEHICLE_CLASS_OPTIONS[classKey] || !input) return null;
  const normalized = normalizeText(input);
  const match = VEHICLE_CLASS_OPTIONS[classKey].tiposVeiculo.find(tipo => normalizeText(tipo) === normalized);
  return match || null;
}

function resolveCarroceria(classKey, input) {
  if (!classKey || !VEHICLE_CLASS_OPTIONS[classKey] || !input) return null;
  const normalized = normalizeTipoCarroceria(input);
  if (!normalized || normalized === 'nao_informado') return null;
  return VEHICLE_CLASS_OPTIONS[classKey].carrocerias.includes(normalized) ? normalized : null;
}

// Função para normalizar texto (remove acentos, converte para minúsculas)
function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

// Função para encontrar a chave correta no mapeamento de tipos de veículo
function normalizeTipoVeiculo(valor) {
  if (!valor || valor.trim() === '') return 'nao_informado';
  
  const valorNormalizado = normalizeText(valor);
  const valorOriginal = valor.trim().toLowerCase();
  
  // Tentar correspondência exata primeiro
  if (TIPOS_VEICULO_MAP[valorOriginal]) {
    return TIPOS_VEICULO_MAP[valorOriginal];
  }
  
  // Tentar correspondência por normalização
  for (const [chave, valorMapeado] of Object.entries(TIPOS_VEICULO_MAP)) {
    const chaveNormalizada = normalizeText(chave);
    if (valorNormalizado === chaveNormalizada || 
        valorNormalizado.includes(chaveNormalizada) ||
        chaveNormalizada.includes(valorNormalizado)) {
      return valorMapeado;
    }
  }
  
  // Match parcial mais flexível
  for (const [chave, valorMapeado] of Object.entries(TIPOS_VEICULO_MAP)) {
    const chaveNormalizada = normalizeText(chave);
    if (valorNormalizado.length >= 3 && chaveNormalizada.length >= 3) {
      if (valorNormalizado.substring(0, 3) === chaveNormalizada.substring(0, 3)) {
        return valorMapeado;
      }
    }
  }
  
  // Se não encontrar, retornar valor normalizado sem espaços
  return valorOriginal.replace(/ /g, '_');
}

// Função para encontrar a chave correta no mapeamento de tipos de carroceria
function normalizeTipoCarroceria(valor) {
  if (!valor || valor.trim() === '') return 'nao_informado';
  
  const valorOriginal = valor.trim().toLowerCase();
  const valorNormalizado = normalizeText(valor);
  
  // Tentar correspondência exata primeiro (sem normalização)
  if (TIPOS_CARROCERIA_MAP[valorOriginal]) {
    return TIPOS_CARROCERIA_MAP[valorOriginal];
  }
  
  // Tentar correspondência com normalização (para pegar variações como "caamba")
  if (valorNormalizado === 'caamba') {
    return 'cacamba'; // Corrigir caso onde o ç foi removido incorretamente
  }
  
  // Tentar correspondência por normalização
  for (const [chave, valorMapeado] of Object.entries(TIPOS_CARROCERIA_MAP)) {
    const chaveNormalizada = normalizeText(chave);
    if (valorNormalizado === chaveNormalizada || 
        valorNormalizado.includes(chaveNormalizada) ||
        chaveNormalizada.includes(valorNormalizado)) {
      return valorMapeado;
    }
  }
  
  // Match parcial mais flexível (especialmente para casos como "caamba" → "cacamba")
  for (const [chave, valorMapeado] of Object.entries(TIPOS_CARROCERIA_MAP)) {
    const chaveNormalizada = normalizeText(chave);
    if (valorNormalizado.length >= 3 && chaveNormalizada.length >= 3) {
      // Verificar se são similares (especialmente para "caamba" vs "cacamba")
      if (valorNormalizado.substring(0, 3) === chaveNormalizada.substring(0, 3)) {
        return valorMapeado;
      }
      // Match especial para "caamba" que deve mapear para "cacamba"
      if (valorNormalizado === 'caamba' && chaveNormalizada.startsWith('cac')) {
        return 'cacamba';
      }
    }
  }
  
  // Se não encontrar, retornar valor normalizado sem espaços
  return valorOriginal.replace(/ /g, '_');
}

// ========== FUNÇÕES AUXILIARES ==========
function formatNumberForEvolution(number) {
  let cleanNumber = number.replace(/\D/g, '');
  if (!cleanNumber.startsWith('55')) {
    cleanNumber = '55' + cleanNumber;
  }
  return cleanNumber + '@c.us';
}

function normalizePhone(value) {
  if (!value) return '';
  const digits = value.toString().replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 11) {
    return digits.slice(-11);
  }
  if (digits.startsWith('55') && digits.length > 11) {
    return digits.slice(-11);
  }
  return digits;
}

function phonesMatch(inputPhone, ...storedPhones) {
  const normalizedInput = normalizePhone(inputPhone);
  if (!normalizedInput) return false;
  return storedPhones
    .map(normalizePhone)
    .filter(Boolean)
    .some(stored => normalizedInput.endsWith(stored) || stored.endsWith(normalizedInput));
}

const MOTORISTA_SELECT_FIELDS = 'id, nome, status, telefone1, telefone2, placa_cavalo, placa_carreta1, placa_carreta2, placa_carreta3, classe_veiculo, tipo_veiculo, tipo_carroceria, created_by_departamento, auth_user_id, created_by, usuario_id';

async function fetchMotoristasByPhone(normalizedPhone) {
  if (!normalizedPhone) return [];

  const phonePattern = `%${normalizedPhone}%`;
  const phonePatternFull = `%${normalizedPhone.split('').join('%')}%`;
  const last7 = normalizedPhone.length > 7 ? normalizedPhone.slice(-7) : normalizedPhone;
  const phonePatternShort = `%${last7.split('').join('%')}%`;

  const filters = Array.from(new Set([
    `telefone1.ilike.${phonePattern}`,
    `telefone2.ilike.${phonePattern}`,
    `telefone1.ilike.${phonePatternFull}`,
    `telefone2.ilike.${phonePatternFull}`,
    `telefone1.ilike.${phonePatternShort}`,
    `telefone2.ilike.${phonePatternShort}`
  ])).join(',');

  let motoristas = [];

  if (filters.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('motoristas')
      .select(MOTORISTA_SELECT_FIELDS)
      .or(filters)
      .limit(100);

    if (error && error.code !== '42703') {
      throw error;
    }

    motoristas = data || [];
  }

  if (!motoristas || motoristas.length === 0) {
    const { data: fallbackData, error: fallbackError } = await supabaseAdmin
      .from('motoristas')
      .select(MOTORISTA_SELECT_FIELDS)
      .limit(500);

    if (fallbackError && fallbackError.code !== '42703') {
      throw fallbackError;
    }

    const dataset = fallbackData || [];
    motoristas = dataset.filter(m => phonesMatch(normalizedPhone, m.telefone1, m.telefone2));
  }

  return motoristas || [];
}

function mapMotoristaResponse(motorista) {
  if (!motorista) return null;
  return {
    id: motorista.id,
    nome: motorista.nome,
    status: motorista.status || 'ativo',
    telefone1: motorista.telefone1 || null,
    telefone2: motorista.telefone2 || null,
    placas: {
      cavalo: motorista.placa_cavalo || null,
      carreta1: motorista.placa_carreta1 || null,
      carreta2: motorista.placa_carreta2 || null,
      carreta3: motorista.placa_carreta3 || null
    },
    classeVeiculo: motorista.classe_veiculo || null,
    tipoVeiculo: motorista.tipo_veiculo || null,
    tipoCarroceria: motorista.tipo_carroceria || null,
    cidade: motorista.cidade || null,
    estado: motorista.estado || null,
    empresa: motorista.empresa || null,
    createdAt: motorista.created_at || null,
    departamento: motorista.created_by_departamento || null
  };
}

function mapColetaOpportunity(coleta) {
  if (!coleta) return null;
  return {
    id: coleta.id,
    cliente: coleta.cliente || '—',
    origem: coleta.origem || '—',
    destino: coleta.destino || '—',
    status: coleta.status || 'pendente',
    etapaAtual: coleta.etapa_atual || 'comercial',
    prioridade: coleta.prioridade || 'normal',
    dataRecebimento: coleta.data_recebimento || null,
    valor: coleta.valor !== undefined ? coleta.valor : null,
    km: coleta.km !== undefined ? coleta.km : null,
    veiculo: coleta.veiculo || null,
    observacoes: coleta.observacoes || null,
    filial: coleta.filial || null
  };
}

const REQUIRED_DOCUMENT_CATEGORIES = ['proprietario', 'veiculo', 'motorista'];
const DOCUMENT_CATEGORY_LABELS = {
  proprietario: 'Documentos - Proprietário',
  veiculo: 'Documentos - Veículo',
  motorista: 'Documentos - Motorista',
  documento: 'Documentos',
  outro: 'Documentos'
};

const DOCUMENT_STATUS_PRIORITY = {
  aprovado: 3,
  pendente: 2,
  reprovado: 1
};

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) {
      return parsed
        .map(item => (item ?? '').toString().trim())
        .filter(item => item.length > 0);
    }
  } catch (error) {
    console.warn('⚠️ Não foi possível converter valor em lista JSON:', error.message || error);
  }
  return [];
}

async function getSupabaseUserFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { error: { status: 401, message: 'Sessão não encontrada. Faça login pelo assistente do portal do motorista.' } };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { error: { status: 401, message: 'Token de acesso inválido.' } };
  }

  console.log('🔐 Validando token Supabase...', {
    tokenPrefix: token.slice(0, 12) + '...'
  });

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (!error && data && data.user) {
      console.log('🔐 Token válido via supabaseAdmin');
      return { user: data.user, token };
    }
    if (error) {
      console.warn('⚠️ Falha ao validar token via supabaseAdmin:', error.message || error);
      if (error.status === 403) {
        console.warn('⚠️ Service role sem permissão para auth.getUser; tentando fallback.');
      }
    }
  } catch (err) {
    console.warn('⚠️ Erro inesperado ao validar token via supabaseAdmin:', err);
  }

  // 🆕 Fallback: validar token chamando o Auth Admin API do Supabase
  try {
    const authUrl = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`;
    const resp = await fetch(authUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
      }
    });
    if (resp.ok) {
      console.log('🔐 Token válido via Auth API');
      const data = await resp.json();
      if (data && data.id) {
        return {
          user: {
            id: data.id,
            email: data.email,
            user_metadata: data.user_metadata || {}
          },
          token
        };
      }
    } else {
      const text = await resp.text();
      console.warn('⚠️ Auth API retornou status', resp.status, text);
    }
  } catch (err) {
    console.warn('⚠️ Erro inesperado ao validar token via Auth API:', err);
  }

  console.warn('❌ Token inválido. Encerrando sessão.');
  return { error: { status: 401, message: 'Sessão expirada ou inválida. Faça login novamente.' } };
}

function normalizePlate(value) {
  if (!value) return '';
  return value.toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function buildPlateVariants(plate) {
  const normalized = normalizePlate(plate);
  if (!normalized) return [];
  const variants = new Set();
  variants.add(normalized);
  if (normalized.length === 7) {
    variants.add(`${normalized.slice(0, 3)}-${normalized.slice(3)}`);
    variants.add(`${normalized.slice(0, 4)}-${normalized.slice(4)}`);
  }
  if (normalized.length === 8) {
    variants.add(`${normalized.slice(0, 3)}-${normalized.slice(3)}`);
  }
  return Array.from(variants);
}

function isValidApiConfig(config) {
  if (!config || config.error) {
    return false;
  }
  
  const required = ['apiKey', 'instanceName', 'apiUrl'];
  const missing = required.filter(field => !config[field]);
  
  if (missing.length > 0) {
    logger.warn(`Configuração incompleta - campos faltando: ${missing.join(', ')}`);
    return false;
  }
  
  return true;
}

function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateUUID() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const buffer = crypto.randomBytes(16);
  buffer[6] = (buffer[6] & 0x0f) | 0x40;
  buffer[8] = (buffer[8] & 0x3f) | 0x80;
  const hex = buffer.toString('hex');
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}`;
}

const STORAGE_URL_PREFIX = 'storage://';
const STORAGE_SIGNED_URL_TTL = parseInt(process.env.STORAGE_SIGNED_URL_TTL || '3600', 10);
const ANEXOS_BUCKET = process.env.SUPABASE_ANEXOS_BUCKET || 'anexos';
const MOTORISTA_DOCS_BUCKET = process.env.SUPABASE_MOTORISTA_DOCS_BUCKET || 'motoristas-docs';
const TREINAMENTOS_DOCS_BUCKET = process.env.SUPABASE_TREINAMENTOS_DOCS_BUCKET || 'treinamentos-docs';

function sanitizeFilename(filename) {
  if (!filename) {
    return 'arquivo';
  }

  return filename
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

function buildStorageUrl(bucket, filePath) {
  return `${STORAGE_URL_PREFIX}${bucket}/${filePath}`;
}

function parseStorageUrl(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  if (!value.startsWith(STORAGE_URL_PREFIX)) {
    return null;
  }

  const withoutPrefix = value.slice(STORAGE_URL_PREFIX.length);
  if (!withoutPrefix) {
    return null;
  }

  const segments = withoutPrefix.split('/');
  if (segments.length < 2) {
    return null;
  }

  const [bucket, ...pathParts] = segments;
  const pathValue = pathParts.join('/');

  if (!bucket || !pathValue) {
    return null;
  }

  return { bucket, path: pathValue };
}

async function createSignedUrlFromStorage(value, expiresIn = STORAGE_SIGNED_URL_TTL) {
  const parsed = parseStorageUrl(value);

  if (!parsed) {
    return {
      signedUrl: value || null,
      bucket: null,
      path: null,
      isStorage: false
    };
  }

  const { bucket, path: storagePath } = parsed;

  try {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(storagePath, expiresIn);

    if (error) {
      console.warn('⚠️ Não foi possível gerar URL assinada, tentando URL pública:', error.message || error);
      
      // Tentar gerar URL pública como fallback (para buckets públicos)
      try {
        const { data: publicData } = supabaseAdmin.storage
          .from(bucket)
          .getPublicUrl(storagePath);
        
        if (publicData?.publicUrl) {
          return {
            signedUrl: publicData.publicUrl,
            bucket,
            path: storagePath,
            isStorage: true
          };
        }
      } catch (publicError) {
        console.warn('⚠️ Não foi possível gerar URL pública:', publicError.message || publicError);
      }
      
      return {
        signedUrl: null,
        bucket,
        path: storagePath,
        isStorage: true
      };
    }

    return {
      signedUrl: data?.signedUrl || null,
      bucket,
      path: storagePath,
      isStorage: true
    };
  } catch (error) {
    console.warn('⚠️ Erro inesperado ao gerar URL assinada:', error.message || error);
    
    // Tentar URL pública como fallback
    try {
      const { data: publicData } = supabaseAdmin.storage
        .from(parsed.bucket)
        .getPublicUrl(parsed.path);
      
      if (publicData?.publicUrl) {
        return {
          signedUrl: publicData.publicUrl,
          bucket: parsed.bucket,
          path: parsed.path,
          isStorage: true
        };
      }
    } catch (publicError) {
      // Ignorar erro de URL pública
    }
    
    return {
      signedUrl: null,
      bucket: parsed.bucket,
      path: parsed.path,
      isStorage: true
    };
  }
}

async function injectSignedUrl(record, options = {}) {
  if (!record) {
    return record;
  }

  const {
    urlField = 'url',
    targetField = 'signed_url',
    expiresIn = STORAGE_SIGNED_URL_TTL
  } = options;

  const storageValue = record[urlField];
  const info = await createSignedUrlFromStorage(storageValue, expiresIn);
  const output = { ...record };

  if (info.isStorage) {
    output.storage_url = storageValue;
    output.storage_bucket = info.bucket;
    output.storage_path = info.path;
  }

  if (info.signedUrl) {
    output[targetField] = info.signedUrl;
    output[urlField] = info.signedUrl;
  } else if (info.isStorage) {
    output[targetField] = null;
  }

  return output;
}

async function injectSignedUrls(records, options = {}) {
  if (!Array.isArray(records)) {
    return records;
  }

  const results = [];
  for (const record of records) {
    results.push(await injectSignedUrl(record, options));
  }
  return results;
}

function buildMotoristaEmail(phone) {
  const digits = normalizePhone(phone);
  if (!digits) {
    return `motorista@multimodal.app`;
  }
  return `motorista+${digits}@multimodal.app`;
}

function buildMotoristaEmailVariations(rawPhone) {
  const digitsOnly = (rawPhone || '').toString().replace(/\D/g, '');
  const candidates = new Set();
  const phoneCandidates = new Set();

  if (digitsOnly) {
    phoneCandidates.add(digitsOnly);
    if (digitsOnly.startsWith('55') && digitsOnly.length > 2) {
      phoneCandidates.add(digitsOnly.slice(2));
    }
    if (digitsOnly.length > 11) {
      phoneCandidates.add(digitsOnly.slice(-11));
    }
  }

  phoneCandidates.add(normalizePhone(rawPhone));

  Array.from(phoneCandidates)
    .filter(Boolean)
    .forEach(digits => {
      MOTORISTA_EMAIL_DOMAINS.forEach(domain => {
        candidates.add(`motorista+${digits}@${domain}`);
      });
    });

  return Array.from(candidates);
}

function formatE164Phone(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return '';
  if (digits.startsWith('55')) {
    return `+${digits}`;
  }
  return `+55${digits}`;
}

function createSupabaseAuthClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

async function ensureMotoristaRecordForAuthUser({ authUserId, nome, telefone, estado, classeVeiculo, tipoVeiculo, tipoCarroceria }) {
  if (!authUserId) {
    throw new Error('authUserId é obrigatório para vincular motorista.');
  }

  const normalizedPhone = normalizePhone(telefone);
  const normalizedTipoVeiculo = tipoVeiculo ? normalizeTipoVeiculo(tipoVeiculo) : null;
  const normalizedTipoCarroceria = tipoCarroceria ? normalizeTipoCarroceria(tipoCarroceria) : null;
  let existingMotorista = null;

  const { data: motoristaByAuth, error: motoristaByAuthError } = await supabaseAdmin
    .from('motoristas')
    .select(MOTORISTA_SELECT_FIELDS)
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (motoristaByAuthError && motoristaByAuthError.code !== 'PGRST116') {
    throw motoristaByAuthError;
  }

  if (motoristaByAuth) {
    existingMotorista = motoristaByAuth;
  } else if (normalizedPhone) {
    const motoristasPorTelefone = await fetchMotoristasByPhone(normalizedPhone);
    existingMotorista = motoristasPorTelefone.find(m => !m.auth_user_id || m.auth_user_id === authUserId) || null;
  }

  if (existingMotorista) {
    const updatePayload = {};
    if (nome && nome.trim() && (!existingMotorista.nome || existingMotorista.nome.trim() !== nome.trim())) {
      updatePayload.nome = nome.trim();
    }
    if (normalizedPhone && normalizedPhone !== existingMotorista.telefone1) {
      updatePayload.telefone1 = normalizedPhone;
    }
    if (!existingMotorista.auth_user_id) {
      updatePayload.auth_user_id = authUserId;
    }
    if (estado && estado.length === 2 && estado !== existingMotorista.estado) {
      updatePayload.estado = estado;
    }
    if (classeVeiculo && classeVeiculo !== existingMotorista.classe_veiculo) {
      updatePayload.classe_veiculo = classeVeiculo;
    }
    if (normalizedTipoVeiculo && normalizedTipoVeiculo !== existingMotorista.tipo_veiculo) {
      updatePayload.tipo_veiculo = normalizedTipoVeiculo;
    }
    if (normalizedTipoCarroceria && normalizedTipoCarroceria !== existingMotorista.tipo_carroceria) {
      updatePayload.tipo_carroceria = normalizedTipoCarroceria;
    }
    if (!existingMotorista.created_by_departamento || existingMotorista.created_by_departamento !== 'portal-motorista') {
      updatePayload.created_by_departamento = 'portal-motorista';
    }

    if (Object.keys(updatePayload).length > 0) {
      const { data: atualizado, error: updateError } = await supabaseAdmin
        .from('motoristas')
        .update(updatePayload)
        .eq('id', existingMotorista.id)
        .select(MOTORISTA_SELECT_FIELDS)
        .single();

      if (updateError) {
        throw updateError;
      }

      return atualizado;
    }

    return existingMotorista;
  }

  const insertPayload = {
    nome: nome || 'Motorista',
    telefone1: normalizedPhone || null,
    auth_user_id: authUserId,
    status: 'cadastro_pendente',
    created_by_departamento: 'portal-motorista',
    created_by: authUserId,
    usuario_id: authUserId,
    estado: estado && estado.length === 2 ? estado : null,
    classe_veiculo: classeVeiculo || 'Não informado',
    tipo_veiculo: normalizedTipoVeiculo || 'Não informado',
    tipo_carroceria: normalizedTipoCarroceria || 'Não informado'
  };

  const { data: novoMotorista, error: insertError } = await supabaseAdmin
    .from('motoristas')
    .insert(insertPayload)
    .select(MOTORISTA_SELECT_FIELDS)
    .single();

  if (insertError) {
    throw insertError;
  }

  return novoMotorista;
}

async function requireMotoristaAuth(req) {
  if (req.session && req.session.motorista && req.session.motorista.motoristaId) {
    try {
      const motoristaId = req.session.motorista.motoristaId;
      const { data: motorista, error } = await supabaseAdmin
        .from('motoristas')
        .select(MOTORISTA_SELECT_FIELDS)
        .eq('id', motoristaId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (!motorista) {
        delete req.session.motorista;
        return { error: { status: 401, message: 'Sessão expirada. Faça login novamente.' } };
      }

      const email = req.session.motorista.email || buildMotoristaEmail(motorista.telefone1 || '');
      return {
        user: {
          id: motorista.auth_user_id || req.session.motorista.authUserId || motorista.id,
          email,
          user_metadata: {
            nome: motorista.nome
          }
        },
        motorista,
        token: null,
        source: 'session'
      };
    } catch (error) {
      console.error('❌ Erro ao validar sessão do motorista:', error);
      delete req.session.motorista;
      return { error: { status: 500, message: 'Erro ao validar sessão.' } };
    }
  }

  const result = await getSupabaseUserFromRequest(req);
  if (result.error) {
    return { error: result.error };
  }

  let motorista = null;
  if (result.user && result.user.id) {
    const { data, error } = await supabaseAdmin
      .from('motoristas')
      .select(MOTORISTA_SELECT_FIELDS)
      .eq('auth_user_id', result.user.id)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('❌ Erro ao buscar motorista por auth_user_id:', error);
      return { error: { status: 500, message: 'Erro ao recuperar dados do motorista.' } };
    }

    motorista = data || null;
  }

  return {
    user: result.user,
    motorista,
    token: result.token || null,
    source: 'token'
  };
}
// ========== ROTAS DE AUTENTICAÇÃO ==========
// ✅✅✅ ENDPOINT DE LOGIN COM FALLBACK PARA .ENV
app.post('/api/login', loginLimiter, express.json(), async (req, res) => {
  // Validar dados de entrada
  const validation = validate('login', req.body);
  if (!validation.isValid) {
    return res.status(400).json({ 
      success: false, 
      error: 'Dados inválidos', 
      details: validation.errors 
    });
  }

  const { usuario, senha } = validation.value;
  
  logger.info('Tentativa de login', { usuario, sessionID: req.sessionID });
  
  try {
    // ✅ PRIMEIRO: Tentar autenticação via Supabase
    const { data: usuarios, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', usuario)
      .limit(1);

    if (!error && usuarios && usuarios.length > 0) {
      // ✅ Autenticação via Supabase
      const usuarioData = usuarios[0];
      logger.info('Usuário encontrado no Supabase', { 
        id: usuarioData.id, 
        nome: usuarioData.nome,
        hasSenha: !!usuarioData.senha_hash 
      });
      
      // ✅ VERIFICAR SENHA COM BCRYPT
      const senhaValida = await bcrypt.compare(senha, usuarioData.senha_hash);
      
      if (!senhaValida) {
        logger.warn('Senha inválida', { usuario });
        return res.status(401).json({ success: false, error: 'Senha inválida' });
      }

      // ✅ CARREGAR PERMISSÕES E CONFIGURAÇÃO
      const permissoes = await carregarPermissoesUsuario(usuario);
      const userConfig = await getEvolutionConfigByUser(usuario);
      
      // ✅✅✅ CRUCIAL: SALVAR USUÁRIO NA SESSÃO
      req.session.usuario = usuarioData.id;
      req.session.permissoes = permissoes;
      req.session.isAdmin = usuarioData.is_admin || false;
      req.session.userData = {
        nome: usuarioData.nome,
        email: usuarioData.email,
        departamento: usuarioData.departamento
      };

      console.log('✅ Dados da sessão a serem salvos:', {
        usuario: req.session.usuario,
        isAdmin: req.session.isAdmin,
        permissoes: req.session.permissoes,
        sessionID: req.sessionID
      });

      // ✅ SALVAR A SESSÃO
      req.session.save((err) => {
        if (err) {
          console.error('❌ Erro ao salvar sessão:', err);
          return res.status(500).json({ success: false, error: 'Erro de sessão' });
        }
        
        console.log('💾 Sessão salva com sucesso!');
        console.log('🔐 Sessão após save:', req.session);
        
        res.json({ 
          success: true, 
          usuario: usuarioData.id,
          nome: usuarioData.nome,
          permissoes: permissoes,
          isAdmin: usuarioData.is_admin || false,
          config: userConfig,
          source: 'supabase'
        });
      });

      return;
    }

    // ✅ SEGUNDO: Fallback para autenticação via .env
    logger.info('Tentando autenticação via .env', { usuario });
    
    if (usuarios[usuario] && usuarios[usuario] === senha) {
      logger.info('Usuário autenticado via .env', { usuario });
      
      // ✅ CARREGAR PERMISSÕES E CONFIGURAÇÃO
      const permissoes = await carregarPermissoesUsuario(usuario);
      const userConfig = await getEvolutionConfigByUser(usuario);
      
      // ✅✅✅ CRUCIAL: SALVAR USUÁRIO NA SESSÃO
      req.session.usuario = usuario;
      req.session.permissoes = permissoes;
      req.session.isAdmin = usuario === 'admin';
      req.session.userData = {
        nome: usuario,
        email: `${usuario}@multimodal.com`,
        departamento: 'Operações'
      };

      console.log('✅ Dados da sessão a serem salvos (ENV):', {
        usuario: req.session.usuario,
        isAdmin: req.session.isAdmin,
        permissoes: req.session.permissoes,
        sessionID: req.sessionID
      });

      // ✅ SALVAR A SESSÃO
      req.session.save((err) => {
        if (err) {
          console.error('❌ Erro ao salvar sessão:', err);
          return res.status(500).json({ success: false, error: 'Erro de sessão' });
        }
        
        console.log('💾 Sessão salva com sucesso (ENV)!');
        console.log('🔐 Sessão após save:', req.session);
        
        res.json({ 
          success: true, 
          usuario: usuario,
          nome: usuario,
          permissoes: permissoes,
          isAdmin: usuario === 'admin',
          config: userConfig,
          source: 'env'
        });
      });

      return;
    }

    // ✅ Se chegou até aqui, usuário não encontrado
    logger.warn('Usuário não encontrado', { usuario });
    return res.status(401).json({ success: false, error: 'Usuário não encontrado' });

  } catch (error) {
    console.error('❌ Erro no login:', error);
    res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

app.post('/api/logout', (req, res) => {
  const usuario = req.session.usuario;
  req.session.destroy((err) => {
    if (err) {
      console.error('❌ Erro ao fazer logout:', err);
      return res.status(500).json({ success: false, error: 'Erro interno' });
    }
    console.log('🚪 Logout do usuário:', usuario);
    res.json({ success: true });
  });
});

app.post('/api/motoristas/logout', (req, res) => {
  try {
    if (req.session) {
      if (req.session.motorista) {
        console.log('🚪 Logout solicitada para motorista:', req.session.motorista.motoristaId);
      }
      delete req.session.motorista;
      delete req.session.motoristaChat;
      req.session.save((err) => {
        if (err) {
          console.error('❌ Erro ao salvar sessão durante logout do motorista:', err);
          return res.status(500).json({ success: false, error: 'Erro ao encerrar sessão.' });
        }
        res.json({ success: true });
      });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erro ao processar logout do motorista:', error);
    res.status(500).json({ success: false, error: 'Erro ao encerrar sessão.' });
  }
});

app.post('/api/motoristas/chat-login', express.json(), async (req, res) => {
  try {
    if (!req.session) {
      return res.status(500).json({ success: false, error: 'Sessão indisponível. Atualize a página.' });
    }

    const actionRaw = (req.body?.action || '').toString().toLowerCase();
    const inputRaw = (req.body?.input || '').toString().trim();
    const normalizedInput = inputRaw.toLowerCase();

    if (req.session.motorista && actionRaw !== 'reset') {
      return res.json({
        success: true,
        done: true,
        state: 'completed',
        reply: 'Você já está autenticado. Redirecionando para o portal do motorista...',
        redirect: '/portal-motorista.html'
      });
    }

    if (actionRaw === 'reset') {
      delete req.session.motoristaChat;
    }

    if (actionRaw === 'start' || !req.session.motoristaChat) {
      req.session.motoristaChat = {
        step: 'awaiting_intent',
        mode: null,
        data: {},
        attempts: {}
      };

      return res.json({
        success: true,
        state: 'awaiting_intent',
        reply: 'Olá! Eu sou o assistente virtual da Multimodal. Você quer fazer login ou se cadastrar?',
        options: [
          { label: 'Fazer login', value: 'login' },
          { label: 'Cadastrar', value: 'cadastro' },
          { label: 'Falar com humano', value: 'humano' }
        ]
      });
    }

    const chatState = req.session.motoristaChat;

    const sendMessage = ({ reply, options, state, error = false, done = false, redirect, supabase: supabasePayload, motorista }) => {
      const payload = {
        success: !error,
        reply,
        state: state || chatState.step,
        done
      };

      if (options) {
        payload.options = options;
      }

      if (redirect) {
        payload.redirect = redirect;
      }

      if (supabasePayload) {
        payload.supabase = supabasePayload;
      }

      if (motorista) {
        payload.motorista = motorista;
      }

      if (error) {
        payload.error = true;
      }

      return res.json(payload);
    };

    const showHelpMessage = () => {
      return sendMessage({
        reply: 'Se preferir atendimento humano, fale com nossa equipe pelo WhatsApp (81) 9 99736-9039 ou envie um e-mail para suporte@logmultimodal.com.br. Posso continuar te ajudando?',
        options: [
          { label: 'Fazer login', value: 'login' },
          { label: 'Cadastrar', value: 'cadastro' }
        ]
      });
    };

    const matches = (value, ...keys) => keys.some(key => value.includes(key));

    if (chatState.step === 'awaiting_intent') {
      if (matches(normalizedInput, 'login', 'entrar', 'acessar', 'logar', 'já tenho', '1')) {
        chatState.mode = 'login';
        chatState.step = 'awaiting_login_phone';
        return sendMessage({
          state: chatState.step,
          reply: 'Perfeito! Informe seu telefone com DDD (ex: 5511999998888) para buscarmos sua conta.'
        });
      }

      if (matches(normalizedInput, 'cad', 'novo', 'registr', 'cadastrar', 'criar', '2')) {
        chatState.mode = 'signup';
        chatState.step = 'awaiting_signup_name';
        return sendMessage({
          state: chatState.step,
          reply: 'Vamos começar! Qual é o seu nome completo?'
        });
      }

      if (matches(normalizedInput, 'humano', 'suporte', 'atendente', 'ajuda')) {
        return showHelpMessage();
      }

      return sendMessage({
        reply: 'Não entendi. Você deseja fazer login ou se cadastrar?',
        options: [
          { label: 'Fazer login', value: 'login' },
          { label: 'Cadastrar', value: 'cadastro' },
          { label: 'Falar com humano', value: 'humano' }
        ]
      });
    }

    if (chatState.mode === 'login') {
      if (chatState.step === 'awaiting_login_phone') {
        const rawDigits = inputRaw.replace(/\D/g, '');
        const normalizedPhone = normalizePhone(rawDigits);
        if (!normalizedPhone || normalizedPhone.length < 10 || normalizedPhone.length > 11) {
          return sendMessage({
            reply: 'O telefone informado parece inválido. Envie novamente usando apenas números, incluindo o DDD.',
            state: chatState.step,
            error: true
          });
        }

        chatState.step = 'awaiting_login_password';
        const candidateEmails = buildMotoristaEmailVariations(rawDigits || normalizedPhone);
        const phoneCandidates = Array.from(new Set([
          normalizedPhone,
          rawDigits || '',
          rawDigits?.startsWith('55') && rawDigits.length > 2 ? rawDigits.slice(2) : null,
          normalizedPhone.length > 7 ? normalizedPhone.slice(-7) : null
        ].filter(Boolean)));

        chatState.data.telefone = normalizedPhone;
        chatState.data.telefoneCompleto = rawDigits || normalizedPhone;
        chatState.data.emailCandidates = candidateEmails;
        chatState.data.email = candidateEmails[0] || buildMotoristaEmail(normalizedPhone);

        try {
          for (const phoneCandidate of phoneCandidates) {
            const motoristas = await fetchMotoristasByPhone(phoneCandidate);
            const candidato = motoristas.find(m => m);
            if (candidato) {
              if (!chatState.data.motoristaId) {
                chatState.data.motoristaId = candidato.id;
              }
              if (!chatState.data.motoristaNome && candidato.nome) {
                chatState.data.motoristaNome = candidato.nome;
              }
              if (!chatState.data.supabaseUserId && candidato.auth_user_id) {
                chatState.data.supabaseUserId = candidato.auth_user_id;
              }
            }
            if (chatState.data.motoristaId && chatState.data.motoristaNome) {
              break;
            }
          }
        } catch (fallbackError) {
          console.error('⚠️ Erro ao buscar motorista pelo telefone:', fallbackError);
        }

        return sendMessage({
          state: chatState.step,
          reply: 'Ótimo! Agora informe sua senha de acesso.'
        });
      }

      if (chatState.step === 'awaiting_login_password') {
        const senha = inputRaw;
        if (!senha || senha.length < 6) {
          return sendMessage({
            reply: 'A senha deve ter pelo menos 6 caracteres. Tente novamente.',
            state: chatState.step,
            error: true
          });
        }

        chatState.attempts.password = (chatState.attempts.password || 0) + 1;
        if (chatState.attempts.password > 5) {
          chatState.step = 'awaiting_intent';
          chatState.mode = null;
          chatState.data = {};
          chatState.attempts = {};
          return sendMessage({
            state: 'awaiting_intent',
            reply: 'Detectamos muitas tentativas inválidas. Vamos recomeçar? Você pode fazer login novamente ou solicitar cadastro.',
            error: true,
            options: [
              { label: 'Fazer login', value: 'login' },
              { label: 'Cadastrar', value: 'cadastro' },
              { label: 'Falar com humano', value: 'humano' }
            ]
          });
        }

        const profileOverrides = {
          estado: chatState.data.estado,
          classeVeiculo: chatState.data.classeVeiculo,
          tipoVeiculo: chatState.data.tipoVeiculo,
          tipoCarroceria: chatState.data.tipoCarroceria
        };
        try {
          const authClient = createSupabaseAuthClient();
          const emailCandidates = Array.isArray(chatState.data.emailCandidates) && chatState.data.emailCandidates.length
            ? chatState.data.emailCandidates
            : [chatState.data.email || buildMotoristaEmail(chatState.data.telefone)];

          let signInData = null;
          let signInError = null;
          let resolvedEmail = null;

          for (const candidateEmail of emailCandidates) {
            const { data, error } = await authClient.auth.signInWithPassword({
              email: candidateEmail,
              password: senha
            });

            if (data?.session && data?.user) {
              signInData = data;
              resolvedEmail = candidateEmail;
              signInError = null;
              break;
            }

            if (error && error.message && !error.message.toLowerCase().includes('invalid login credentials')) {
              signInError = error;
              break;
            }

            signInError = error;
          }

          if (signInError || !signInData?.session || !signInData?.user) {
            return sendMessage({
              reply: 'Não foi possível entrar com esse telefone e senha. Verifique as informações ou solicite suporte para redefinir o acesso.',
              state: chatState.step,
              error: true,
              options: [
                { label: 'Tentar novamente', value: 'login' },
                { label: 'Quero me cadastrar', value: 'cadastro' },
                { label: 'Falar com humano', value: 'humano' }
              ]
            });
          }

          const supabaseUser = signInData.user;
          chatState.data.supabaseUserId = supabaseUser.id;
          chatState.data.email = resolvedEmail || supabaseUser.email || chatState.data.email;

          const motoristaRecord = await ensureMotoristaRecordForAuthUser({
            authUserId: supabaseUser.id,
            nome: chatState.data.motoristaNome || supabaseUser.user_metadata?.nome || supabaseUser.email,
            telefone: chatState.data.telefone,
            estado: profileOverrides.estado,
            classeVeiculo: profileOverrides.classeVeiculo,
            tipoVeiculo: profileOverrides.tipoVeiculo,
            tipoCarroceria: profileOverrides.tipoCarroceria
          });

          req.session.motorista = {
            motoristaId: motoristaRecord.id,
            authUserId: supabaseUser.id,
            telefone: chatState.data.telefone,
            nome: motoristaRecord.nome,
            email: supabaseUser.email
          };

          delete req.session.motoristaChat;

          const supabasePayload = {
            url: process.env.SUPABASE_URL,
            anonKey: process.env.SUPABASE_ANON_KEY,
            session: {
              access_token: signInData.session.access_token,
              refresh_token: signInData.session.refresh_token,
              expires_in: signInData.session.expires_in,
              token_type: signInData.session.token_type
            },
            user: {
              id: supabaseUser.id,
              email: supabaseUser.email
            }
          };

          return sendMessage({
            done: true,
            state: 'completed',
            reply: `Tudo certo, ${motoristaRecord.nome?.split(' ')[0] || 'motorista'}! Estamos preparando seu portal...`,
            redirect: '/portal-motorista.html',
            supabase: supabasePayload,
            motorista: mapMotoristaResponse(motoristaRecord)
          });
        } catch (authError) {
          console.error('❌ Erro ao autenticar motorista:', authError);
          return sendMessage({
            reply: 'Não conseguimos validar sua senha agora. Tente novamente em instantes ou procure o suporte.',
            state: chatState.step,
            error: true
          });
        }
      }
    }

    if (chatState.mode === 'signup') {
      if (chatState.step === 'awaiting_signup_name') {
        if (!inputRaw || inputRaw.length < 3) {
          return sendMessage({
            reply: 'Informe seu nome completo para seguirmos.',
            state: chatState.step,
            error: true
          });
        }
        chatState.data.nome = inputRaw.trim();
        chatState.step = 'awaiting_signup_phone';
        return sendMessage({
          state: chatState.step,
      reply: 'Informe seu telefone principal no formato 55DDDNXXXXXXXX (ex: 5581999998888).'
        });
      }

      if (chatState.step === 'awaiting_signup_phone') {
    const digits = inputRaw.replace(/\D/g, '');
    if (!/^55\d{2}9\d{8}$/.test(digits)) {
          return sendMessage({
        reply: 'O número precisa seguir o padrão 55 + DDD + 9 + número (ex: 5581999998888).',
            state: chatState.step,
            error: true
          });
        }

    const normalizedPhone = normalizePhone(digits);
        const email = buildMotoristaEmail(normalizedPhone);
        try {
          const { data: existingUser } = await supabaseAdmin.auth.admin.getUserByEmail(email);
          if (existingUser && existingUser.user) {
            chatState.mode = 'login';
            chatState.step = 'awaiting_login_password';
            chatState.data.telefone = normalizedPhone;
            chatState.data.email = email;
            chatState.data.supabaseUserId = existingUser.user.id;
        chatState.data.telefoneCompleto = digits;
            return sendMessage({
              state: chatState.step,
              reply: 'Encontramos um cadastro com esse telefone. Informe sua senha para entrar.',
              options: [
                { label: 'Esqueci a senha', value: 'humano' }
              ]
            });
          }
        } catch (lookupError) {
          if (lookupError && lookupError.message && !lookupError.message.includes('no user found')) {
            console.error('❌ Erro ao verificar usuário existente:', lookupError);
          }
        }

    chatState.data.telefone = normalizedPhone;
    chatState.data.telefoneCompleto = digits;
        chatState.data.email = email;
    chatState.step = 'awaiting_signup_state';
        return sendMessage({
          state: chatState.step,
      reply: 'Em qual estado (UF) você está baseado? Digite somente a sigla, por exemplo: PE.'
        });
      }

  if (chatState.step === 'awaiting_signup_state') {
    const uf = inputRaw.toString().trim().toUpperCase();
    if (!VALID_UF.includes(uf)) {
      return sendMessage({
        reply: 'Use apenas a sigla do estado, por exemplo PE, SP ou BA.',
        state: chatState.step,
        error: true
      });
    }
    chatState.data.estado = uf;
    chatState.step = 'awaiting_signup_vehicle_class';
    return sendMessage({
      state: chatState.step,
      reply: 'Qual a classe do seu veículo principal?',
      options: Object.entries(VEHICLE_CLASS_OPTIONS).map(([value, info]) => ({
        label: info.label,
        value
      }))
    });
  }

  if (chatState.step === 'awaiting_signup_vehicle_class') {
    const selectedClass = resolveVehicleClass(inputRaw);
    if (!selectedClass) {
      return sendMessage({
        reply: 'Escolha entre veículos leves, médios ou pesados. Você pode clicar em uma das opções acima.',
        state: chatState.step,
        error: true,
        options: Object.entries(VEHICLE_CLASS_OPTIONS).map(([value, info]) => ({
          label: info.label,
          value
        }))
      });
    }
    chatState.data.classeVeiculo = selectedClass;
    chatState.step = 'awaiting_signup_vehicle_type';
    const typeOptions = VEHICLE_CLASS_OPTIONS[selectedClass].tiposVeiculo.map(tipo => ({
      label: tipo,
      value: tipo
    }));
    return sendMessage({
      state: chatState.step,
      reply: 'Qual é o tipo de veículo que você opera?',
      options: typeOptions
    });
  }

  if (chatState.step === 'awaiting_signup_vehicle_type') {
    const classKey = chatState.data.classeVeiculo;
    const resolvedType = resolveVehicleType(classKey, inputRaw);
    if (!resolvedType) {
      const typeOptions = (VEHICLE_CLASS_OPTIONS[classKey]?.tiposVeiculo || []).map(tipo => ({
        label: tipo,
        value: tipo
      }));
      return sendMessage({
        reply: 'Não reconheci esse tipo de veículo. Escolha uma das opções sugeridas.',
        state: chatState.step,
        error: true,
        options: typeOptions
      });
    }
    chatState.data.tipoVeiculo = resolvedType;
    chatState.step = 'awaiting_signup_bodywork';
    const carroceriaOptions = (VEHICLE_CLASS_OPTIONS[classKey]?.carrocerias || []).map(carroceria => ({
      label: formatCarroceriaLabel(carroceria),
      value: carroceria
    }));
    return sendMessage({
      state: chatState.step,
      reply: 'E qual é a carroceria/implemento principal?',
      options: carroceriaOptions
    });
  }

  if (chatState.step === 'awaiting_signup_bodywork') {
    const classKey = chatState.data.classeVeiculo;
    const resolvedCarroceria = resolveCarroceria(classKey, inputRaw);
    if (!resolvedCarroceria) {
      const carroceriaOptions = (VEHICLE_CLASS_OPTIONS[classKey]?.carrocerias || []).map(carroceria => ({
        label: formatCarroceriaLabel(carroceria),
        value: carroceria
      }));
      return sendMessage({
        reply: 'Selecione uma carroceria válida nas opções ou digite uma das sugestões.',
        state: chatState.step,
        error: true,
        options: carroceriaOptions
      });
    }
    chatState.data.tipoCarroceria = resolvedCarroceria;
    chatState.step = 'awaiting_signup_password';
    return sendMessage({
      state: chatState.step,
      reply: 'Para finalizar, defina uma senha com no mínimo 6 caracteres.'
    });
  }

      if (chatState.step === 'awaiting_signup_password') {
        const senha = inputRaw;
        if (!senha || senha.length < 6) {
          return sendMessage({
            reply: 'A senha precisa ter pelo menos 6 caracteres. Tente outra.',
            state: chatState.step,
            error: true
          });
        }

        const email = chatState.data.email;
        const normalizedPhone = chatState.data.telefone;
        const nome = chatState.data.nome;

        try {
          const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: senha,
            email_confirm: true,
            phone: formatE164Phone(normalizedPhone),
            user_metadata: {
              nome,
              telefone: normalizedPhone,
              tipo: 'motorista'
            }
          });

          if (createError) {
            console.error('❌ Erro ao criar usuário Supabase:', createError);
          if (createError.message && createError.message.includes('already been registered')) {
            let existingUser = null;
            try {
              const { data } = await supabaseAdmin.auth.admin.getUserByEmail(email);
              existingUser = data?.user || null;
            } catch (existingError) {
              console.error('❌ Erro ao buscar usuário existente após conflito:', existingError);
            }

            chatState.mode = 'login';
            chatState.step = 'awaiting_login_password';
            if (existingUser?.id) {
              chatState.data.supabaseUserId = existingUser.id;
            }
            return sendMessage({
              state: chatState.step,
              reply: 'Esse telefone já possui cadastro. Informe sua senha para continuar.',
              options: [
                { label: 'Esqueci a senha', value: 'humano' }
              ]
            });
          }
            return sendMessage({
              reply: createError.message || 'Não foi possível concluir o cadastro. Tente novamente mais tarde.',
              state: chatState.step,
              error: true
            });
          }

          const supabaseUser = createdUser?.user;
          if (!supabaseUser) {
            return sendMessage({
              reply: 'Cadastro criado, mas não foi possível concluir o login automático. Tente fazer login manualmente.',
              state: 'awaiting_intent',
              error: true,
              options: [
                { label: 'Fazer login', value: 'login' },
                { label: 'Falar com humano', value: 'humano' }
              ]
            });
          }

          const authClient = createSupabaseAuthClient();
          const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
            email,
            password: senha
          });

          if (signInError || !signInData?.session) {
            console.error('❌ Erro ao gerar sessão após cadastro:', signInError);
            return sendMessage({
              reply: 'Cadastro realizado, mas não foi possível entrar automaticamente. Faça login usando seu telefone e senha.',
              state: 'awaiting_intent',
              error: true,
              options: [
                { label: 'Fazer login', value: 'login' },
                { label: 'Falar com humano', value: 'humano' }
              ]
            });
          }

          const motoristaRecord = await ensureMotoristaRecordForAuthUser({
            authUserId: supabaseUser.id,
            nome,
            telefone: normalizedPhone,
            estado: chatState.data.estado,
            classeVeiculo: chatState.data.classeVeiculo,
            tipoVeiculo: chatState.data.tipoVeiculo,
            tipoCarroceria: chatState.data.tipoCarroceria
          });

          req.session.motorista = {
            motoristaId: motoristaRecord.id,
            authUserId: supabaseUser.id,
            telefone: normalizedPhone,
            nome: motoristaRecord.nome,
            email: supabaseUser.email
          };

          delete req.session.motoristaChat;

          const supabasePayload = {
            url: process.env.SUPABASE_URL,
            anonKey: process.env.SUPABASE_ANON_KEY,
            session: {
              access_token: signInData.session.access_token,
              refresh_token: signInData.session.refresh_token,
              expires_in: signInData.session.expires_in,
              token_type: signInData.session.token_type
            },
            user: {
              id: supabaseUser.id,
              email: supabaseUser.email
            }
          };

          return sendMessage({
            done: true,
            state: 'completed',
            reply: `Cadastro concluído, ${motoristaRecord.nome?.split(' ')[0] || 'motorista'}! Vamos abrir o portal para você finalizar seus dados.`,
            redirect: '/portal-motorista.html',
            supabase: supabasePayload,
            motorista: mapMotoristaResponse(motoristaRecord)
          });
        } catch (signupError) {
          console.error('❌ Erro inesperado no cadastro conversacional:', signupError);
          return sendMessage({
            reply: 'Estamos com instabilidade para concluir o cadastro. Tente novamente em instantes ou fale com nossa equipe.',
            state: chatState.step,
            error: true,
            options: [
              { label: 'Falar com humano', value: 'humano' }
            ]
          });
        }
      }
    }

    return sendMessage({
      reply: 'Desculpe, não entendi. Você deseja fazer login ou se cadastrar?',
      state: 'awaiting_intent',
      options: [
        { label: 'Fazer login', value: 'login' },
        { label: 'Cadastrar', value: 'cadastro' },
        { label: 'Falar com humano', value: 'humano' }
      ]
    });
  } catch (error) {
    console.error('❌ Erro no fluxo de chat do motorista:', error);
    return res.status(500).json({ success: false, error: 'Erro interno ao processar sua solicitação.' });
  }
});

app.get('/api/motoristas/auth/me', async (req, res) => {
  try {
    const { user, motorista, error } = await requireMotoristaAuth(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const motoristaResponse = motorista ? mapMotoristaResponse(motorista) : null;
    const nomeUsuario = user?.user_metadata?.nome || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email;

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        nome: nomeUsuario
      },
      motorista: motoristaResponse
    });
  } catch (error) {
    console.error('❌ Erro ao carregar sessão do motorista:', error);
    res.status(500).json({ success: false, error: 'Erro ao validar sessão. Tente novamente.' });
  }
});

app.post('/api/mensagens/variar', express.json(), async (req, res) => {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const mensagemOriginal = (req.body?.mensagem || '').toString();
    const contexto = req.body?.contexto || {};

    if (!mensagemOriginal || mensagemOriginal.trim().length < 5) {
      return res.status(400).json({ success: false, error: 'Mensagem inválida' });
    }

    if (!openai) {
      return res.json({ success: true, mensagem: mensagemOriginal });
    }

    const camposFixos = Object.entries(contexto)
      .filter(([_, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    const systemPrompt = 'Você é um copywriter em português responsável por gerar variações naturais de mensagens de WhatsApp sem alterar dados importantes.';

    const userPrompt = `
Reescreva a mensagem abaixo criando uma variação sutil, mantendo o sentido original e preservando todos os dados sensíveis (nomes, números, datas, valores, links, telefones, e-mails, placas).

- Não traduza os termos.
- Mantenha o tom profissional, cordial e direto.
- Você pode alterar saudações, ordem das frases, adicionar ou remover um emoji e substituir algumas palavras por sinônimos.
- Evite gerar listas ou formatos muito diferentes. Retorne apenas uma mensagem contínua.
- Tamanho aproximado da mensagem deve ser preservado (+/- 25%).

Mensagem original:
"""${mensagemOriginal.trim()}"""

Dados que não podem ser alterados:
${camposFixos || 'Nenhum dado adicional informado.'}
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      temperature: 0.85,
      max_tokens: 220,
      top_p: 1,
      frequency_penalty: 0.2,
      presence_penalty: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    let mensagemVariada = completion.choices[0]?.message?.content || '';
    mensagemVariada = mensagemVariada.trim();
    if (!mensagemVariada) {
      mensagemVariada = mensagemOriginal;
    } else {
      mensagemVariada = mensagemVariada.replace(/^["'`]+|["'`]+$/g, '').trim();
    }

    res.json({ success: true, mensagem: mensagemVariada });
  } catch (error) {
    console.error('❌ Erro ao gerar variação de mensagem:', error);
    res.json({
      success: true,
      mensagem: (req.body?.mensagem || '').toString()
    });
  }
});

// ========== ENDPOINT PARA IMPORTAÇÃO CSV DE MOTORISTAS ==========
app.post('/api/motoristas/importar-csv', upload.single('csv'), async (req, res) => {
  try {
    // Verificar autenticação
    const { user, error: userError } = await getUserFromRequest(req);
    if (userError) {
      return res.status(userError.status || 401).json({ success: false, error: userError.message || 'Não autenticado' });
    }
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Nenhum arquivo CSV enviado' });
    }

    const userId = user.id || user.user_id || 'sistema';
    const userDepartment = user.departamento || null;

    const sobrescrever = req.body.sobrescrever === 'true';
    const manterInativos = req.body.manter_inativos === 'true';

    // Ler e processar CSV
    const csvContent = req.file.buffer.toString('utf8');
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      return res.status(400).json({ success: false, error: 'Arquivo CSV vazio' });
    }

    // Verificar se tem cabeçalho
    const header = lines[0].toLowerCase();
    const hasHeader = header.includes('nome') || header.includes('name') || header.includes('telefone');
    const startLine = hasHeader ? 1 : 0;

    if (lines.length <= startLine) {
      return res.status(400).json({ success: false, error: 'Nenhum dado encontrado no CSV' });
    }

    const motoristas = [];
    const erros = [];
    let inseridos = 0;
    let atualizados = 0;

    // Mapeamento de colunas esperadas
    const columnMap = {
      nome: ['nome', 'name', 'nome_completo'],
      telefone1: ['telefone1', 'telefone', 'telefone_1', 'phone', 'phone1'],
      telefone2: ['telefone2', 'telefone_2', 'phone2'],
      cnh: ['cnh', 'numero_cnh'],
      categoria_cnh: ['categoria_cnh', 'categoria', 'categoria_cnh'],
      estado: ['estado', 'uf', 'estado_uf'],
      classe_veiculo: ['classe_veiculo', 'classe', 'classe_veiculo'],
      tipo_veiculo: ['tipo_veiculo', 'tipo', 'tipo_veiculo'],
      tipo_carroceria: ['tipo_carroceria', 'carroceria', 'tipo_carroceria'],
      placa_cavalo: ['placa_cavalo', 'placa', 'placa_cavalo'],
      placa_carreta1: ['placa_carreta1', 'carreta1', 'placa_carreta_1'],
      placa_carreta2: ['placa_carreta2', 'carreta2', 'placa_carreta_2'],
      placa_carreta3: ['placa_carreta3', 'carreta3', 'placa_carreta_3'],
      status: ['status', 'situacao']
    };

    // Encontrar índices das colunas
    let columnIndexes = {};
    if (hasHeader) {
      const headerColumns = lines[0].split(',').map(c => c.trim().toLowerCase().replace(/["']/g, ''));
      Object.keys(columnMap).forEach(key => {
        const possibleNames = columnMap[key];
        for (let name of possibleNames) {
          const index = headerColumns.indexOf(name);
          if (index !== -1) {
            columnIndexes[key] = index;
            break;
          }
        }
      });
    } else {
      // Se não tem cabeçalho, assumir ordem padrão
      columnIndexes = {
        nome: 0,
        telefone1: 1,
        telefone2: 2,
        cnh: 3,
        categoria_cnh: 4,
        estado: 5,
        classe_veiculo: 6,
        tipo_veiculo: 7,
        tipo_carroceria: 8,
        placa_cavalo: 9,
        placa_carreta1: 10,
        placa_carreta2: 11,
        placa_carreta3: 12,
        status: 13
      };
    }

    // Processar cada linha
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        // Parse CSV (considerando aspas e vírgulas dentro de campos)
        const values = [];
        let current = '';
        let insideQuotes = false;
        
        for (let j = 0; j < line.length; j++) {
          const char = line[j];
          if (char === '"') {
            insideQuotes = !insideQuotes;
          } else if (char === ',' && !insideQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());

        // Extrair valores
        const getValue = (key) => {
          const index = columnIndexes[key];
          return index !== undefined && index < values.length ? values[index].replace(/^["']|["']$/g, '').trim() : '';
        };

        const nome = getValue('nome');
        const telefone1 = normalizePhone(getValue('telefone1'));
        
        if (!nome || !telefone1) {
          erros.push({ linha: i + 1, erro: 'Nome e telefone1 são obrigatórios' });
          continue;
        }

        const motoristaData = {
          nome: nome,
          telefone1: telefone1,
          telefone2: normalizePhone(getValue('telefone2')) || null,
          cnh: getValue('cnh') || null,
          categoria_cnh: getValue('categoria_cnh')?.toUpperCase() || null,
          estado: getValue('estado')?.toUpperCase() || null,
          classe_veiculo: getValue('classe_veiculo')?.toLowerCase() || 'pesado',
          tipo_veiculo: normalizeTipoVeiculo(getValue('tipo_veiculo')),
          tipo_carroceria: normalizeTipoCarroceria(getValue('tipo_carroceria')),
          placa_cavalo: (getValue('placa_cavalo') ? normalizePlate(getValue('placa_cavalo')) : null) || null,
          placa_carreta1: (getValue('placa_carreta1') ? normalizePlate(getValue('placa_carreta1')) : null) || null,
          placa_carreta2: (getValue('placa_carreta2') ? normalizePlate(getValue('placa_carreta2')) : null) || null,
          placa_carreta3: (getValue('placa_carreta3') ? normalizePlate(getValue('placa_carreta3')) : null) || null,
          status: getValue('status')?.toLowerCase() || 'ativo',
          data_cadastro: new Date().toISOString(),
          data_atualizacao: new Date().toISOString(),
          created_by: userId,
          created_by_departamento: userDepartment,
          usuario_id: userId // Campo obrigatório na tabela motoristas
        };

        // Validar campos obrigatórios
        if (!motoristaData.tipo_veiculo || motoristaData.tipo_veiculo === 'nao_informado') {
          motoristaData.tipo_veiculo = 'nao_informado';
        }
        if (!motoristaData.tipo_carroceria || motoristaData.tipo_carroceria === 'nao_informado') {
          motoristaData.tipo_carroceria = 'nao_informado';
        }

        // Verificar se já existe (por telefone)
        const { data: existente } = await supabaseAdmin
          .from('motoristas')
          .select('id, status')
          .eq('telefone1', motoristaData.telefone1)
          .maybeSingle();

        // Garantir que created_by existe em user_profiles (necessário para foreign key)
        if (motoristaData.created_by) {
          const { data: createdByProfile } = await supabaseAdmin
            .from('user_profiles')
            .select('id')
            .eq('id', motoristaData.created_by)
            .maybeSingle();
          
          if (!createdByProfile) {
            // Criar perfil automaticamente se não existir
            try {
              const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(motoristaData.created_by);
              if (authUser && authUser.user) {
                await supabaseAdmin
                  .from('user_profiles')
                  .insert({
                    id: motoristaData.created_by,
                    role: 'user',
                    nome: authUser.user.email || 'Usuário',
                    active: true,
                    email: authUser.user.email
                  });
                console.log('✅ Perfil criado automaticamente para created_by:', motoristaData.created_by);
              } else {
                // Se não conseguir buscar do auth, criar perfil básico
                await supabaseAdmin
                  .from('user_profiles')
                  .insert({
                    id: motoristaData.created_by,
                    role: 'user',
                    nome: 'Usuário Importação',
                    active: true,
                    email: null
                  });
                console.log('✅ Perfil básico criado para created_by:', motoristaData.created_by);
              }
            } catch (profileError) {
              console.warn('⚠️ Não foi possível criar perfil para created_by:', profileError);
              // Tentar continuar sem created_by ou usar null
              motoristaData.created_by = null;
            }
          }
        }

        if (existente) {
          if (!sobrescrever) {
            erros.push({ linha: i + 1, erro: 'Motorista já existe e sobrescrever está desabilitado' });
            continue;
          }

          // Atualizar existente
          if (manterInativos && existente.status === 'inativo') {
            motoristaData.status = 'inativo';
          }

          const { error: updateError } = await supabaseAdmin
            .from('motoristas')
            .update(motoristaData)
            .eq('id', existente.id);

          if (updateError) {
            console.error(`❌ Erro ao atualizar linha ${i + 1}:`, updateError);
            erros.push({ linha: i + 1, erro: updateError.message || JSON.stringify(updateError) });
          } else {
            atualizados++;
            console.log(`✅ Linha ${i + 1} atualizada com sucesso`);
          }
        } else {
          // Inserir novo
          console.log(`📝 Tentando inserir linha ${i + 1}:`, {
            nome: motoristaData.nome,
            telefone1: motoristaData.telefone1,
            created_by: motoristaData.created_by,
            tipo_veiculo: motoristaData.tipo_veiculo,
            tipo_carroceria: motoristaData.tipo_carroceria
          });
          
          const { error: insertError, data: insertedData } = await supabaseAdmin
            .from('motoristas')
            .insert([motoristaData])
            .select();

          if (insertError) {
            console.error(`❌ Erro ao inserir linha ${i + 1}:`, insertError);
            console.error(`❌ Dados tentados:`, JSON.stringify(motoristaData, null, 2));
            erros.push({ linha: i + 1, erro: insertError.message || JSON.stringify(insertError) });
          } else {
            inseridos++;
            console.log(`✅ Linha ${i + 1} inserida com sucesso. ID:`, insertedData?.[0]?.id);
          }
        }
      } catch (error) {
        erros.push({ linha: i + 1, erro: error.message || 'Erro ao processar linha' });
      }
    }

    res.json({
      success: true,
      inseridos,
      atualizados,
      erros: erros.length,
      detalhesErros: erros.slice(0, 20), // Retornar mais erros para debug
      mensagem: erros.length > 0 
        ? `Processamento concluído com ${erros.length} erro(s). Verifique os detalhes dos erros abaixo.`
        : `Importação concluída com sucesso! ${inseridos} inseridos, ${atualizados} atualizados.`
    });

  } catch (error) {
    console.error('❌ Erro ao importar CSV:', error);
    res.status(500).json({ success: false, error: 'Erro ao processar arquivo CSV: ' + error.message });
  }
});

app.post('/api/motoristas/auth/profile', express.json(), async (req, res) => {
  let payload = null;
  try {
    const { user, motorista: motoristaAtual, error } = await requireMotoristaAuth(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const body = req.body || {};
    const normalizedPhone = normalizePhone(body.telefone);

    if (!normalizedPhone || normalizedPhone.length < 10) {
      return res.status(400).json({ success: false, error: 'Informe um telefone válido com DDD.' });
    }

    const normalizedPhone2 = normalizePhone(body.telefoneSecundario);
    const nome = (body.nome || user.user_metadata?.full_name || user.user_metadata?.name || user.email || '').toString().trim();
    if (!nome) {
      return res.status(400).json({ success: false, error: 'Informe o nome completo.' });
    }

    // Garantir que o perfil do usuário existe em user_profiles
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError && profileError.code !== 'PGRST116') {
      throw profileError;
    }

    if (!userProfile) {
      // Criar perfil automaticamente se não existir
      const { error: createProfileError } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          id: user.id,
          role: 'user',
          nome: nome,
          active: true,
          email: user.email
        });

      if (createProfileError) {
        console.error('❌ Erro ao criar perfil do usuário:', createProfileError);
        throw createProfileError;
      }
      console.log('✅ Perfil do usuário criado automaticamente:', user.id);
    }

    let motoristaSelecionado = motoristaAtual || null;

    const motoristasPorTelefone = await fetchMotoristasByPhone(normalizedPhone);
    const motoristaPorTelefone = motoristasPorTelefone.find(m => phonesMatch(normalizedPhone, m.telefone1, m.telefone2));

    if (!motoristaSelecionado && motoristaPorTelefone) {
      if (motoristaPorTelefone.auth_user_id && motoristaPorTelefone.auth_user_id !== user.id) {
        return res.status(409).json({ success: false, error: 'Este telefone já está vinculado a outra conta. Contate a central.' });
      }
      motoristaSelecionado = motoristaPorTelefone;
    }

    const departamento = (body.departamento || 'portal-motorista').toString().trim() || 'portal-motorista';

    payload = {
      nome,
      telefone1: normalizedPhone,
      auth_user_id: user.id,
      created_by_departamento: departamento,
      created_by: motoristaSelecionado?.created_by || user.id,
      usuario_id: motoristaSelecionado?.usuario_id || user.id
    };

    if (normalizedPhone2) {
      payload.telefone2 = normalizedPhone2;
    } else if (body.telefoneSecundario === '') {
      payload.telefone2 = null;
    }

    const optionalFields = {
      cnh: body.cnh ? body.cnh.trim() : null,
      categoria_cnh: body.categoriaCnh ? body.categoriaCnh.trim() : null,
      placa_cavalo: body.placaCavalo && body.placaCavalo.trim() ? normalizePlate(body.placaCavalo) : null,
      placa_carreta1: body.placaCarreta1 && body.placaCarreta1.trim() ? normalizePlate(body.placaCarreta1) : null,
      placa_carreta2: body.placaCarreta2 && body.placaCarreta2.trim() ? normalizePlate(body.placaCarreta2) : null,
      placa_carreta3: body.placaCarreta3 && body.placaCarreta3.trim() ? normalizePlate(body.placaCarreta3) : null,
      classe_veiculo: body.classeVeiculo ? body.classeVeiculo.trim() : null,
      tipo_veiculo: body.tipoVeiculo ? normalizeTipoVeiculo(body.tipoVeiculo) : null,
      tipo_carroceria: body.tipoCarroceria ? normalizeTipoCarroceria(body.tipoCarroceria) : null,
      cidade: body.cidade ? body.cidade.trim() : null,
      estado: body.estado ? body.estado.trim() : null,
      empresa: body.empresa ? body.empresa.trim() : null
    };

    Object.entries(optionalFields).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        payload[key] = value;
      }
    });

    if (!payload.classe_veiculo) {
      payload.classe_veiculo = motoristaSelecionado?.classe_veiculo || 'Não informado';
    }

    if (!payload.tipo_veiculo) {
      payload.tipo_veiculo = motoristaSelecionado?.tipo_veiculo || 'Não informado';
    }

    if (!payload.tipo_carroceria) {
      payload.tipo_carroceria = motoristaSelecionado?.tipo_carroceria || 'Não informado';
    }

    let resultData = null;

    if (motoristaSelecionado) {
      const { data, error: updateError } = await supabaseAdmin
        .from('motoristas')
        .update(payload)
        .eq('id', motoristaSelecionado.id)
        .select(MOTORISTA_SELECT_FIELDS)
        .single();

      if (updateError) {
        throw updateError;
      }

      resultData = data;
    } else {
      payload.status = body.status ? body.status.trim() : 'ativo';
      const { data, error: insertError } = await supabaseAdmin
        .from('motoristas')
        .insert(payload)
        .select(MOTORISTA_SELECT_FIELDS)
        .single();

      if (insertError) {
        throw insertError;
      }

      resultData = data;
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        nome
      },
      motorista: mapMotoristaResponse(resultData)
    });
  } catch (error) {
    console.error('❌ Erro ao vincular perfil de motorista:', error);
    console.error('❌ Detalhes do erro:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      stack: error.stack
    });
    if (payload) {
      console.error('❌ Payload enviado:', JSON.stringify(payload, null, 2));
    }
    console.error('❌ Body recebido:', JSON.stringify(req.body, null, 2));
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao salvar dados do motorista. Tente novamente.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/motoristas/documentos/status', async (req, res) => {
  try {
    const { motorista, error } = await requireMotoristaAuth(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const defaultCategorias = () => {
      const obj = {};
      REQUIRED_DOCUMENT_CATEGORIES.forEach(cat => {
        obj[cat] = {
          possui: false,
          status: 'ausente',
          quantidade: 0,
          ultimoEnvio: null,
          label: DOCUMENT_CATEGORY_LABELS[cat] || 'Documentos',
          documentos: []
        };
      });
      return obj;
    };

    if (!motorista) {
      const categorias = defaultCategorias();
      return res.json({
        success: true,
        motorista: null,
        categorias,
        faltando: REQUIRED_DOCUMENT_CATEGORIES,
        documentos: []
      });
    }

    const { data: documentos, error: docsError } = await supabaseAdmin
      .from('motorista_documentos')
      .select('id, categoria, nome_arquivo, tipo_arquivo, tamanho, url, status, validade, observacoes, uploaded_by, created_at, updated_at')
      .eq('motorista_id', motorista.id)
      .order('created_at', { ascending: false });

    if (docsError) {
      throw docsError;
    }

    const documentosComUrls = await injectSignedUrls(documentos || []);

    const categorias = defaultCategorias();

    (documentosComUrls || []).forEach(doc => {
      const categoria = (doc.categoria || 'outro').toLowerCase();
      if (!categorias[categoria]) {
        categorias[categoria] = {
          possui: false,
          status: 'ausente',
          quantidade: 0,
          ultimoEnvio: null,
          label: DOCUMENT_CATEGORY_LABELS[categoria] || 'Documentos',
          documentos: []
        };
      }

      const categoriaInfo = categorias[categoria];
      categoriaInfo.possui = true;
      categoriaInfo.quantidade += 1;
      categoriaInfo.documentos.push(doc);

      const statusAtual = (doc.status || 'pendente').toLowerCase();
      const scoreAtual = DOCUMENT_STATUS_PRIORITY[statusAtual] || 0;
      const scoreAnterior = DOCUMENT_STATUS_PRIORITY[categoriaInfo.status] || 0;
      if (scoreAtual > scoreAnterior) {
        categoriaInfo.status = statusAtual;
      }

      if (doc.created_at) {
        if (!categoriaInfo.ultimoEnvio || new Date(doc.created_at) > new Date(categoriaInfo.ultimoEnvio)) {
          categoriaInfo.ultimoEnvio = doc.created_at;
        }
      }
    });

    const faltando = REQUIRED_DOCUMENT_CATEGORIES.filter(cat => !categorias[cat]?.possui);

    res.json({
      success: true,
      motorista: motorista.id,
      categorias,
      faltando,
      documentos: documentosComUrls || []
    });
  } catch (error) {
    console.error('❌ Erro ao consultar status de documentos:', error);
    res.status(500).json({ success: false, error: 'Erro ao consultar documentos. Tente novamente.' });
  }
});

app.get('/api/motoristas/oportunidades', async (req, res) => {
  try {
    const { error } = await requireMotoristaAuth(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const { data, error: coletasError } = await supabaseAdmin
      .from('coletas')
      .select('id, cliente, origem, destino, valor, km, veiculo, status, etapa_atual, prioridade, data_recebimento, observacoes, filial, motorista_id')
      .is('motorista_id', null)
      .order('data_recebimento', { ascending: true });

    if (coletasError) {
      throw coletasError;
    }

    const oportunidades = (data || []).filter(coleta => !coleta.motorista_id).map(mapColetaOpportunity);
    res.json({ success: true, oportunidades });
  } catch (error) {
    console.error('❌ Erro ao listar oportunidades para motoristas:', error);
    res.status(500).json({ success: false, error: 'Erro ao carregar oportunidades. Tente novamente.' });
  }
});
app.get('/api/motoristas/viagens', async (req, res) => {
  try {
    const { motorista, error } = await requireMotoristaAuth(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    if (!motorista) {
      return res.json({ success: true, cadastroPendente: true, viagens: [] });
    }

    const { data: viagensData, error: viagensError } = await supabaseAdmin
      .from('coletas')
      .select('id, cliente, origem, destino, valor, km, veiculo, status, etapa_atual, prioridade, data_recebimento, observacoes, filial')
      .eq('motorista_id', motorista.id)
      .order('data_recebimento', { ascending: true });

    if (viagensError) {
      throw viagensError;
    }

    res.json({
      success: true,
      motorista: mapMotoristaResponse(motorista),
      viagens: (viagensData || []).map(mapColetaOpportunity)
    });
  } catch (error) {
    console.error('❌ Erro ao listar viagens do motorista:', error);
    res.status(500).json({ success: false, error: 'Erro ao carregar suas viagens. Tente novamente.' });
  }
});

app.post('/api/motoristas/oportunidades/:coletaId/assumir', async (req, res) => {
  try {
    const { user, motorista, error } = await requireMotoristaAuth(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const coletaId = req.params.coletaId;
    if (!coletaId) {
      return res.status(400).json({ success: false, error: 'Identificador da coleta é obrigatório.' });
    }

    if (!motorista) {
      return res.status(409).json({ success: false, error: 'Complete seu cadastro para assumir uma coleta.' });
    }

    // Verificar se o motorista já tem uma viagem ativa
    const { data: viagemAtiva, error: viagemAtivaError } = await supabaseAdmin
      .from('coletas')
      .select('id, cliente, origem, destino, status, etapa_atual')
      .eq('motorista_id', motorista.id)
      .in('status', ['pendente', 'em_andamento'])
      .not('etapa_atual', 'eq', 'concluida')
      .not('etapa_atual', 'eq', 'monitoramento')
      .limit(1)
      .maybeSingle();

    if (viagemAtivaError && viagemAtivaError.code !== 'PGRST116') {
      throw viagemAtivaError;
    }

    if (viagemAtiva) {
      return res.status(409).json({ 
        success: false, 
        error: `Você já tem uma viagem ativa (${viagemAtiva.cliente || viagemAtiva.id}: ${viagemAtiva.origem} → ${viagemAtiva.destino}). Conclua ou cancele essa viagem antes de assumir outra.`,
        viagemAtiva: {
          id: viagemAtiva.id,
          cliente: viagemAtiva.cliente,
          origem: viagemAtiva.origem,
          destino: viagemAtiva.destino,
          status: viagemAtiva.status,
          etapaAtual: viagemAtiva.etapa_atual
        }
      });
    }

    const { data: coletaAtual, error: coletaBuscaError } = await supabaseAdmin
      .from('coletas')
      .select('id, motorista_id, status, etapa_atual')
      .eq('id', coletaId)
      .maybeSingle();

    if (coletaBuscaError && coletaBuscaError.code !== 'PGRST116') {
      throw coletaBuscaError;
    }

    if (!coletaAtual) {
      return res.status(404).json({ success: false, error: 'Coleta não encontrada.' });
    }

    if (coletaAtual.motorista_id) {
      return res.status(409).json({ success: false, error: 'Essa coleta já foi assumida por outro motorista.' });
    }

    const updatePayload = {
      motorista_id: motorista.id,
      etapa_atual: 'gr'
    };

    if (coletaAtual.status && coletaAtual.status.toLowerCase() === 'pendente') {
      updatePayload.status = 'em_andamento';
    }

    const { data: coletaAtualizada, error: updateError } = await supabaseAdmin
      .from('coletas')
      .update(updatePayload)
      .eq('id', coletaId)
      .select('id, cliente, origem, destino, valor, km, veiculo, status, etapa_atual, prioridade, data_recebimento, observacoes, filial, motorista_id')
      .single();

    if (updateError) {
      throw updateError;
    }

    try {
      await supabaseAdmin.from('historico_coletas').insert({
        coleta_id: coletaId,
        etapa_anterior: coletaAtual.etapa_atual,
        etapa_atual: 'gr',
        acao: 'motorista_assumiu',
        usuario: motorista.nome || user.email || 'motorista_portal',
        observacoes: `Motorista ${motorista.nome || motorista.id} assumiu a coleta via portal. Etapa movida para GR.`
      });
    } catch (historicoError) {
      console.warn('⚠️ Não foi possível registrar histórico da coleta:', historicoError.message || historicoError);
    }

    try {
      await supabaseAdmin.from('chat_mensagens').insert({
        coleta_id: coletaId,
        usuario: motorista.nome || user.email || 'motorista_portal',
        mensagem: `🚚 Motorista ${motorista.nome || motorista.id} assumiu a coleta via portal. Etapa movida para GR.`,
        tipo_mensagem: 'sistema'
      });
    } catch (chatError) {
      console.warn('⚠️ Não foi possível registrar mensagem automática no chat:', chatError.message || chatError);
    }

    res.json({
      success: true,
      coleta: mapColetaOpportunity(coletaAtualizada),
      motorista: mapMotoristaResponse(motorista)
    });
  } catch (error) {
    console.error('❌ Erro ao assumir oportunidade de coleta:', error);
    res.status(500).json({ success: false, error: 'Não foi possível assumir esta coleta agora. Tente novamente mais tarde.' });
  }
});

app.post('/api/motoristas/coletas/:coletaId/documentos', upload.array('arquivos', 30), async (req, res) => {
  try {
    const { user, motorista, error } = await requireMotoristaAuth(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const coletaId = req.params.coletaId;
    if (!coletaId) {
      return res.status(400).json({ success: false, error: 'Identificador da coleta é obrigatório.' });
    }

    if (!motorista) {
      return res.status(409).json({ success: false, error: 'Complete seu cadastro para enviar documentos.' });
    }

    const arquivos = req.files || [];
    if (!arquivos.length) {
      return res.status(400).json({ success: false, error: 'Envie ao menos um arquivo.' });
    }

    // Processar categorias (pode vir como array ou string, com ou sem [] no nome)
    const rawCategorias = req.body.categorias || req.body['categorias[]'];
    let categorias = [];
    
    if (Array.isArray(rawCategorias)) {
      categorias = rawCategorias.map(value => (value ?? '').toString().trim().toLowerCase());
    } else if (typeof rawCategorias === 'string') {
      // Se vier como string única, criar array com ela
      categorias = [rawCategorias.toString().trim().toLowerCase()];
    } else if (rawCategorias) {
      // Caso seja objeto (improvável mas seguro)
      categorias = [String(rawCategorias).trim().toLowerCase()];
    }

    // Garantir que temos uma categoria para cada arquivo
    while (categorias.length < arquivos.length) {
      categorias.push('documento');
    }
    
    // Limitar ao número de arquivos (caso tenham enviado categorias extras)
    categorias = categorias.slice(0, arquivos.length);

    const categoriasObrigatorias = ['proprietario', 'veiculo', 'motorista'];
    const presentes = new Set(categorias);
    if (!categoriasObrigatorias.every(cat => presentes.has(cat))) {
      return res.status(400).json({ success: false, error: 'Envie todos os documentos obrigatórios (proprietário, veículo e motorista).' });
    }

    const referenciasPessoais = parseJsonArray(req.body.referencias_pessoais);
    const referenciasComerciais = parseJsonArray(req.body.referencias_comerciais);

    if (referenciasPessoais.length < 2 || referenciasComerciais.length < 2) {
      return res.status(400).json({ success: false, error: 'Informe ao menos duas referências pessoais e duas referências comerciais.' });
    }

    const processedFiles = [];

    for (let index = 0; index < arquivos.length; index++) {
      const file = arquivos[index];
      if (!file || !file.buffer) {
        throw new Error('Falha ao processar arquivo recebido.');
      }
      const categoriaOriginal = (categorias[index] || 'documento').toLowerCase();
      const categoria = DOCUMENT_CATEGORY_LABELS[categoriaOriginal] ? categoriaOriginal : 'documento';
      const safeOriginalName = sanitizeFilename(file.originalname);
      const fileExt = path.extname(safeOriginalName) || '';
      const uniqueName = `${Date.now()}-${generateId()}`;
      const finalFileName = `${uniqueName}${fileExt}`;
      const anexoStoragePath = `coletas/${coletaId}/${categoria}/${finalFileName}`;
      const motoristaStoragePath = `motoristas/${motorista.id}/${categoria}/${finalFileName}`;
      const uploadOptions = {
        contentType: file.mimetype || 'application/octet-stream',
        cacheControl: '3600',
        upsert: false
      };
      const fileBuffer = file.buffer;

      const { error: anexoUploadError } = await supabaseAdmin.storage
        .from(ANEXOS_BUCKET)
        .upload(anexoStoragePath, fileBuffer, uploadOptions);

      if (anexoUploadError) {
        throw anexoUploadError;
      }

      const { error: motoristaUploadError } = await supabaseAdmin.storage
        .from(MOTORISTA_DOCS_BUCKET)
        .upload(motoristaStoragePath, fileBuffer, uploadOptions);

      if (motoristaUploadError) {
        await supabaseAdmin.storage
          .from(ANEXOS_BUCKET)
          .remove([anexoStoragePath])
          .catch(() => {});
        throw motoristaUploadError;
      }

      categorias[index] = categoria;

      processedFiles.push({
        originalName: file.originalname,
        mimetype: file.mimetype || 'application/octet-stream',
        size: file.size,
        categoria,
        anexoStorageUrl: buildStorageUrl(ANEXOS_BUCKET, anexoStoragePath),
        motoristaStorageUrl: buildStorageUrl(MOTORISTA_DOCS_BUCKET, motoristaStoragePath)
      });
    }

    // Montar payload adaptativo para diferentes schemas
    const anexosPayload = processedFiles.map((item) => {
      const payload = {
        id: generateUUID(),
        coleta_id: coletaId,
        nome_arquivo: item.originalName,
        tipo_arquivo: item.mimetype,
        tamanho: item.size,
        url: item.anexoStorageUrl
      };
      
      return payload;
    });

    console.log('📦 Inserindo anexos:', anexosPayload.length, 'arquivo(s)');
    let { data: anexosInseridos, error: anexosError } = await supabaseAdmin
      .from('anexos')
      .insert(anexosPayload)
      .select('id, nome_arquivo, url, tamanho, tipo_arquivo');

    // Se falhar com 'tamanho', tentar com schema alternativo (tamanho_arquivo + caminho_arquivo)
    if (anexosError && (anexosError.message?.includes('tamanho') || anexosError.message?.includes('url'))) {
      console.log('⚠️ Tentando com schema alternativo (tamanho_arquivo + caminho_arquivo)');
      const anexosPayloadAlt = processedFiles.map((item) => ({
        id: generateUUID(),
        coleta_id: coletaId,
        nome_arquivo: item.originalName,
        tipo_arquivo: item.mimetype,
        tamanho_arquivo: item.size,
        caminho_arquivo: item.anexoStorageUrl
      }));
      
      ({ data: anexosInseridos, error: anexosError } = await supabaseAdmin
        .from('anexos')
        .insert(anexosPayloadAlt)
        .select('id, nome_arquivo, caminho_arquivo as url, tamanho_arquivo as tamanho, tipo_arquivo'));
    }

    if (anexosError) {
      console.error('❌ Erro ao inserir anexos:', anexosError);
      console.error('❌ Detalhes do erro:', JSON.stringify(anexosError, null, 2));
      throw anexosError;
    }
    
    console.log('✅ Anexos inseridos com sucesso:', anexosInseridos?.length || 0);

    // Tentar inserir documentos permanentes do motorista (opcional)
    try {
      const motoristaDocsPayload = processedFiles.map((item) => {
        const categoria = REQUIRED_DOCUMENT_CATEGORIES.includes(item.categoria) ? item.categoria : 'outro';
        return {
          id: generateUUID(),
          motorista_id: motorista.id,
          categoria,
          nome_arquivo: item.originalName,
          tipo_arquivo: item.mimetype,
          tamanho: item.size,
          url: item.motoristaStorageUrl,
          status: 'pendente'
        };
      });

      if (motoristaDocsPayload.length) {
        console.log('📁 Tentando inserir', motoristaDocsPayload.length, 'documento(s) permanente(s) do motorista');
        const { error: motoristaDocsError } = await supabaseAdmin
          .from('motorista_documentos')
          .insert(motoristaDocsPayload);

        if (motoristaDocsError) {
          // Se a tabela não existir, apenas logar como aviso
          if (motoristaDocsError.message?.includes('does not exist') || 
              motoristaDocsError.code === 'PGRST116' ||
              motoristaDocsError.message?.includes('motorista_documentos')) {
            console.warn('⚠️ Tabela motorista_documentos não encontrada. Documentos serão salvos apenas em anexos.');
          } else {
            throw motoristaDocsError;
          }
        } else {
          console.log('✅ Documentos permanentes do motorista inseridos com sucesso');
        }
      }
    } catch (docError) {
      console.warn('⚠️ Não foi possível registrar documentos permanentes do motorista:', docError.message || docError);
      // Não bloquear o fluxo se falhar aqui
    }

    const referenciasMensagem = [];
    if (referenciasPessoais.length) {
      referenciasMensagem.push('• Referências pessoais:\n  - ' + referenciasPessoais.join('\n  - '));
    }
    if (referenciasComerciais.length) {
      referenciasMensagem.push('• Referências comerciais:\n  - ' + referenciasComerciais.join('\n  - '));
    }

    const categoriaResumo = categorias.reduce((acc, categoria) => {
      const key = (categoria || 'documento').toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const linhasCategorias = Object.entries(categoriaResumo).map(([categoria, quantidade]) => {
      const label = DOCUMENT_CATEGORY_LABELS[categoria] || categoria;
      return `• ${label}: ${quantidade} arquivo(s)`;
    });

    const partesMensagem = ['📎 Documentos enviados pelo motorista via portal.'];
    if (linhasCategorias.length) {
      partesMensagem.push(...linhasCategorias);
    }
    if (referenciasMensagem.length) {
      partesMensagem.push(...referenciasMensagem);
    }

    const mensagem = partesMensagem.join('\n');

    try {
      // Tentar com tipo_mensagem primeiro (schema mais recente)
      let chatPayload = {
        coleta_id: coletaId,
        usuario: user.email || user.id,
        mensagem
      };
      
      // Tentar inserir com tipo_mensagem
      let { error: chatError } = await supabaseAdmin
        .from('chat_mensagens')
        .insert({ ...chatPayload, tipo_mensagem: 'sistema' });
      
      // Se falhar, tentar com tipo (schema antigo)
      if (chatError && chatError.message && chatError.message.includes('tipo_mensagem')) {
        console.log('⚠️ Tentando com coluna "tipo" em vez de "tipo_mensagem"');
        chatError = null;
        ({ error: chatError } = await supabaseAdmin
          .from('chat_mensagens')
          .insert({ ...chatPayload, tipo: 'system' }));
      }
      
      if (chatError) {
        console.warn('⚠️ Não foi possível registrar mensagem automática no chat:', chatError.message || chatError);
      }
    } catch (chatError) {
      console.warn('⚠️ Não foi possível registrar mensagem automática no chat:', chatError.message || chatError);
    }

    // Marcar solicitações pendentes como atendidas se o documento foi atualizado
    try {
      const categoriasEnviadas = new Set(categorias.map(c => c.toLowerCase()));
      const { data: solicitacoesPendentes } = await supabaseAdmin
        .from('solicitacoes_documentos')
        .select('id, categoria')
        .eq('motorista_id', motorista.id)
        .eq('coleta_id', coletaId)
        .eq('status', 'pendente');

      if (solicitacoesPendentes && solicitacoesPendentes.length > 0) {
        const solicitacoesAtendidas = solicitacoesPendentes
          .filter(s => categoriasEnviadas.has(s.categoria.toLowerCase()))
          .map(s => s.id);

        if (solicitacoesAtendidas.length > 0) {
          await supabaseAdmin
            .from('solicitacoes_documentos')
            .update({
              status: 'atendida',
              atendido_em: new Date().toISOString()
            })
            .in('id', solicitacoesAtendidas);

          console.log('✅', solicitacoesAtendidas.length, 'solicitação(ões) marcada(s) como atendida(s)');
        }
      }
    } catch (solicitacoesError) {
      console.warn('⚠️ Não foi possível atualizar status das solicitações:', solicitacoesError);
    }

    console.log('🔗 Gerando URLs assinadas para', anexosInseridos?.length || 0, 'anexo(s)');
    const anexosComUrls = await injectSignedUrls(anexosInseridos || []);
    console.log('✅ URLs geradas com sucesso');

    res.json({ success: true, anexos: anexosComUrls });
  } catch (error) {
    console.error('❌ Erro ao receber documentos do motorista:', error);
    console.error('❌ Stack trace:', error.stack);
    res.status(500).json({ success: false, error: 'Não foi possível enviar seus documentos agora. Tente novamente.' });
  }
});

// ========== ENDPOINTS PARA SOLICITAÇÕES DE ATUALIZAÇÃO DE DOCUMENTOS ==========

// Endpoint para GR solicitar atualização de documento
app.post('/api/coletas/:coletaId/solicitar-atualizacao-documento', requireAuth, async (req, res) => {
  try {
    const coletaId = req.params.coletaId;
    const { categoria, motivo } = req.body;

    if (!categoria || !motivo) {
      return res.status(400).json({ success: false, error: 'Categoria e motivo são obrigatórios.' });
    }

    if (!REQUIRED_DOCUMENT_CATEGORIES.includes(categoria.toLowerCase())) {
      return res.status(400).json({ success: false, error: 'Categoria inválida. Use: proprietario, veiculo ou motorista.' });
    }

    // Buscar a coleta e verificar se está na etapa GR
    const { data: coleta, error: coletaError } = await supabaseAdmin
      .from('coletas')
      .select('id, motorista_id, etapa_atual')
      .eq('id', coletaId)
      .single();

    if (coletaError || !coleta) {
      return res.status(404).json({ success: false, error: 'Coleta não encontrada.' });
    }

    if (coleta.etapa_atual !== 'gr') {
      return res.status(400).json({ success: false, error: 'Solicitações de atualização só podem ser feitas na etapa GR.' });
    }

    if (!coleta.motorista_id) {
      return res.status(400).json({ success: false, error: 'Coleta não tem motorista vinculado.' });
    }

    // Criar solicitação
    const usuario = req.session?.usuario || req.supabaseUser?.email || req.supabaseUser?.id || 'sistema';
    
    console.log('📝 Criando solicitação:', { coletaId, motorista_id: coleta.motorista_id, categoria, usuario });
    
    const { data: solicitacao, error: solicitacaoError } = await supabaseAdmin
      .from('solicitacoes_documentos')
      .insert({
        coleta_id: coletaId,
        motorista_id: coleta.motorista_id,
        categoria: categoria.toLowerCase(),
        motivo: motivo.trim(),
        solicitado_por: usuario,
        status: 'pendente'
      })
      .select()
      .single();

    if (solicitacaoError) {
      console.error('❌ Erro ao inserir solicitação:', solicitacaoError);
      console.error('❌ Código do erro:', solicitacaoError.code);
      console.error('❌ Mensagem completa:', JSON.stringify(solicitacaoError, null, 2));
      
      // Se a tabela não existir, informar ao usuário
      if (solicitacaoError.code === '42P01' || 
          solicitacaoError.code === 'PGRST202' ||
          solicitacaoError.message?.includes('does not exist') || 
          solicitacaoError.message?.includes('solicitacoes_documentos') ||
          solicitacaoError.message?.includes('relation') && solicitacaoError.message?.includes('does not exist')) {
        return res.status(500).json({ 
          success: false, 
          error: 'Tabela de solicitações não encontrada. É necessário criar a tabela no banco de dados primeiro.',
          sql: 'Execute o SQL do arquivo sql/criar-solicitacoes-atualizacao-docs.sql no Supabase Dashboard',
          endpoint: 'Ou use: POST /api/admin/criar-tabela-solicitacoes (requer login como admin)'
        });
      }
      
      throw solicitacaoError;
    }
    
    console.log('✅ Solicitação criada:', solicitacao?.id);

    // Criar mensagem no chat
    try {
      const chatPayload = {
        coleta_id: coletaId,
        usuario: usuario,
        mensagem: `📋 Solicitação de atualização de documentos: ${DOCUMENT_CATEGORY_LABELS[categoria.toLowerCase()] || categoria}\n\nMotivo: ${motivo}`
      };

      let { error: chatError } = await supabaseAdmin
        .from('chat_mensagens')
        .insert({ ...chatPayload, tipo_mensagem: 'sistema' });

      if (chatError && chatError.message?.includes('tipo_mensagem')) {
        ({ error: chatError } = await supabaseAdmin
          .from('chat_mensagens')
          .insert({ ...chatPayload, tipo: 'system' }));
      }
    } catch (chatError) {
      console.warn('⚠️ Não foi possível criar mensagem no chat:', chatError);
    }

    res.json({ success: true, solicitacao });
  } catch (error) {
    console.error('❌ Erro ao solicitar atualização de documento:', error);
    console.error('❌ Stack trace:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Não foi possível criar a solicitação. Tente novamente.',
      details: error.message || error.toString()
    });
  }
});

// Endpoint para motorista ver notificações de atualização de documentos
app.get('/api/motoristas/notificacoes', async (req, res) => {
  try {
    const { motorista, error } = await requireMotoristaAuth(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    if (!motorista) {
      return res.json({ success: true, notificacoes: [] });
    }

    // Buscar solicitações pendentes
    const { data: solicitacoes, error: solicitacoesError } = await supabaseAdmin
      .from('solicitacoes_documentos')
      .select(`
        id,
        coleta_id,
        categoria,
        motivo,
        solicitado_por,
        solicitado_em,
        status,
        observacoes,
        coletas:coleta_id (
          id,
          cliente,
          origem,
          destino
        )
      `)
      .eq('motorista_id', motorista.id)
      .eq('status', 'pendente')
      .order('solicitado_em', { ascending: false });

    if (solicitacoesError) {
      throw solicitacoesError;
    }

    const notificacoes = (solicitacoes || []).map(s => ({
      id: s.id,
      coletaId: s.coleta_id,
      categoria: s.categoria,
      categoriaLabel: DOCUMENT_CATEGORY_LABELS[s.categoria] || s.categoria,
      motivo: s.motivo,
      solicitadoPor: s.solicitado_por,
      solicitadoEm: s.solicitado_em,
      coleta: s.coletas ? {
        id: s.coletas.id,
        cliente: s.coletas.cliente,
        origem: s.coletas.origem,
        destino: s.coletas.destino
      } : null
    }));

    res.json({ success: true, notificacoes, total: notificacoes.length });
  } catch (error) {
    console.error('❌ Erro ao buscar notificações:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar notificações. Tente novamente.' });
  }
});

// Endpoint para marcar solicitação como atendida (quando motorista atualizar documento)
app.post('/api/motoristas/solicitacoes/:solicitacaoId/atender', async (req, res) => {
  try {
    const { user, motorista, error } = await requireMotoristaAuth(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const solicitacaoId = req.params.solicitacaoId;

    if (!motorista) {
      return res.status(404).json({ success: false, error: 'Motorista não encontrado.' });
    }

    // Verificar se a solicitação pertence ao motorista
    const { data: solicitacao, error: solicitacaoError } = await supabaseAdmin
      .from('solicitacoes_documentos')
      .select('id, motorista_id, coleta_id, categoria')
      .eq('id', solicitacaoId)
      .single();

    if (solicitacaoError || !solicitacao) {
      return res.status(404).json({ success: false, error: 'Solicitação não encontrada.' });
    }

    if (solicitacao.motorista_id !== motorista.id) {
      return res.status(403).json({ success: false, error: 'Você não tem permissão para atender esta solicitação.' });
    }

    // Marcar como atendida
    const { error: updateError } = await supabaseAdmin
      .from('solicitacoes_documentos')
      .update({
        status: 'atendida',
        atendido_em: new Date().toISOString()
      })
      .eq('id', solicitacaoId);

    if (updateError) {
      throw updateError;
    }

    res.json({ success: true, message: 'Solicitação marcada como atendida.' });
  } catch (error) {
    console.error('❌ Erro ao atender solicitação:', error);
    res.status(500).json({ success: false, error: 'Erro ao atualizar solicitação. Tente novamente.' });
  }
});

// ========== ENDPOINT PARA CRIAR TABELA DE SOLICITAÇÕES ==========
// Endpoint para criar tabela - pode ser chamado via MCP ou diretamente
app.post('/api/admin/criar-tabela-solicitacoes', async (req, res) => {
  try {
    console.log('🔧 Endpoint chamado para criar tabela solicitacoes_documentos...');

    console.log('🔧 Criando tabela solicitacoes_documentos...');

    // SQL para criar a tabela
    const createTableSQL = `
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
    `.trim();

    // Tentar executar via RPC exec_sql
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('exec_sql', {
      sql_query: createTableSQL
    });

    if (rpcError) {
      console.error('❌ Erro ao criar tabela via RPC:', rpcError);
      return res.status(500).json({
        success: false,
        error: 'Não foi possível criar a tabela automaticamente. Execute o SQL manualmente no Supabase Dashboard.',
        sql: createTableSQL,
        instrucoes: 'Acesse: Supabase Dashboard > SQL Editor > New Query > Cole o SQL > Run'
      });
    }

    // Criar índices
    const indices = [
      'CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_motorista ON solicitacoes_documentos(motorista_id);',
      'CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_coleta ON solicitacoes_documentos(coleta_id);',
      'CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_status ON solicitacoes_documentos(status);',
      'CREATE INDEX IF NOT EXISTS idx_solicitacoes_documentos_pendentes ON solicitacoes_documentos(motorista_id, status) WHERE status = \'pendente\';'
    ];

    const indicesCriados = [];
    for (const indexSQL of indices) {
      const { error: indexError } = await supabaseAdmin.rpc('exec_sql', {
        sql_query: indexSQL
      });
      if (!indexError) {
        indicesCriados.push(indexSQL.split(' ')[4]); // Nome do índice
      }
    }

    // Verificar se a tabela foi criada
    const { error: verifError } = await supabaseAdmin
      .from('solicitacoes_documentos')
      .select('id')
      .limit(1);

    if (verifError) {
      return res.status(500).json({
        success: false,
        error: 'Tabela criada mas não está acessível. Verifique no Supabase Dashboard.',
        sql: createTableSQL
      });
    }

    console.log('✅ Tabela solicitacoes_documentos criada com sucesso!');

    res.json({
      success: true,
      message: 'Tabela solicitacoes_documentos criada com sucesso!',
      indices: indicesCriados
    });
  } catch (error) {
    console.error('❌ Erro ao criar tabela:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao criar tabela: ' + error.message
    });
  }
});

// Trocar senha
app.post('/api/auth/trocar-senha', express.json(), async (req, res) => {
  try {
    console.log('🔍 POST /api/auth/trocar-senha - Verificando autenticação...');
    console.log('📋 req.session:', req.session ? {
      usuario: req.session.usuario,
      userData: req.session.userData,
      isAdmin: req.session.isAdmin
    } : 'Nenhuma sessão');
    console.log('📋 req.body:', req.body);
    
    const { senhaAtual, novaSenha, usuarioId } = req.body || {};
    
    // Tentar obter o ID do usuário: primeiro da sessão, depois do body
    let usuarioIdFinal = req.session?.usuario || usuarioId;
    
    if (!usuarioIdFinal) {
      console.error('❌ Nenhum ID de usuário encontrado');
      return res.status(401).json({ success: false, error: 'Não autenticado. Faça login novamente.' });
    }

    if (!senhaAtual || !novaSenha) {
      return res.status(400).json({ success: false, error: 'Senha atual e nova senha são obrigatórias' });
    }

    if (novaSenha.length < 6) {
      return res.status(400).json({ success: false, error: 'A nova senha deve ter no mínimo 6 caracteres' });
    }

    console.log('🔍 Buscando usuário com ID:', usuarioIdFinal);

    // Buscar usuário no Supabase Auth
    const { data: authUserData, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(usuarioIdFinal);
    
    if (getUserError || !authUserData || !authUserData.user) {
      console.error('❌ Erro ao buscar usuário:', getUserError);
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    const user = authUserData.user;
    console.log('✅ Usuário encontrado:', user.email);

    // Verificar senha atual usando a API do Supabase Auth
    // Como não temos acesso direto à senha hash, vamos tentar autenticar o usuário
    // Para verificar a senha atual, vamos tentar fazer login com as credenciais
    try {
      // Criar um cliente temporário para testar a senha
      const { createClient } = require('@supabase/supabase-js');
      const tempClient = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
      );
      
      // Tentar fazer sign in com email e senha atual
      const { data: signInData, error: signInError } = await tempClient.auth.signInWithPassword({
        email: user.email,
        password: senhaAtual
      });

      if (signInError || !signInData) {
        console.warn('⚠️ Senha atual incorreta para usuário:', user.email);
        return res.status(401).json({ success: false, error: 'Senha atual incorreta' });
      }

      console.log('✅ Senha atual verificada com sucesso');
    } catch (authError) {
      console.error('❌ Erro ao verificar senha atual:', authError);
      // Se falhar a verificação, ainda assim tentar atualizar (pode ser que o usuário não tenha senha definida)
      console.warn('⚠️ Continuando mesmo com erro na verificação...');
    }

    // Atualizar senha usando a API Admin do Supabase
    const { data: updateData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      usuarioIdFinal,
      { password: novaSenha }
    );

    if (updateError) {
      console.error('❌ Erro ao atualizar senha:', updateError);
      return res.status(500).json({ 
        success: false, 
        error: 'Erro ao atualizar senha. Tente novamente ou contate o administrador.' 
      });
    }

    console.log('✅ Senha alterada com sucesso para usuário:', user.email);

    return res.json({
      success: true,
      message: 'Senha alterada com sucesso'
    });
  } catch (error) {
    console.error('❌ Erro ao trocar senha:', error);
    return res.status(500).json({ success: false, error: 'Erro interno ao alterar senha' });
  }
});

app.get('/api/auth/status', async (req, res) => {
  const autenticado = !!(req.session && req.session.usuario);
  
  console.log('🔍 Verificando status de autenticação...');
  console.log('📋 req.session:', req.session ? {
    usuario: req.session.usuario,
    userData: req.session.userData,
    isAdmin: req.session.isAdmin,
    permissoes: req.session.permissoes
  } : 'Nenhuma sessão');
  
  if (!autenticado) {
    console.log('❌ Usuário NÃO autenticado');
    return res.json({ 
      autenticado: false,
      usuario: null,
      permissoes: [],
      isAdmin: false
    });
  }

  try {
    const userConfig = await getEvolutionConfigByUser(req.session.usuario);
    
    console.log('✅ Usuário autenticado:', {
      usuario: req.session.usuario,
      isAdmin: req.session.isAdmin,
      permissoes: req.session.permissoes,
      userData: req.session.userData
    });
    
    res.json({ 
      autenticado: true,
      usuario: req.session.usuario,
      permissoes: req.session.permissoes || [],
      isAdmin: req.session.isAdmin || false,
      userData: req.session.userData || null,
      config: userConfig
    });
  } catch (error) {
    console.error('❌ Erro ao carregar status:', error);
    res.json({ 
      autenticado: false,
      usuario: null,
      permissoes: [],
      isAdmin: false
    });
  }
});

// ========== ENDPOINT PARA CONTAR USUÁRIOS LOGADOS ==========
app.get('/api/active-sessions', async (req, res) => {
  try {
    const usuariosUnicos = new Set();
    const usuariosDetalhes = new Map(); // Map para armazenar detalhes dos usuários
    
    // Buscar IDs de motoristas para excluir (fazer isso primeiro)
    const motoristaIds = new Set();
    try {
      const { data: motoristas, error: motoristasError } = await supabaseAdmin
        .from('motoristas')
        .select('auth_user_id')
        .not('auth_user_id', 'is', null);
      
      if (!motoristasError && motoristas) {
        motoristas.forEach(m => {
          if (m.auth_user_id) {
            motoristaIds.add(m.auth_user_id);
          }
        });
      }
    } catch (error) {
      console.warn('⚠️ Erro ao buscar motoristas:', error.message);
    }
    
    // 1. Contar sessões ativas do SQLite (express-session)
    try {
      const db = new sqlite3.Database('./sessions.db');
      const query = `SELECT sid, sess, expire, expired, expires FROM sessions`;
      
      await new Promise((resolve, reject) => {
        db.all(query, [], (err, rows) => {
          db.close();
          
          if (err) {
            console.warn('⚠️ Erro ao buscar sessões SQLite:', err);
            resolve();
            return;
          }
          
          const now = Date.now();
          
          if (rows && rows.length) {
            rows.forEach(row => {
              try {
                const expireMs = typeof row.expire === 'number' ? row.expire
                  : (typeof row.expired === 'number' ? row.expired : null);
                
                let notExpired = true;
                if (expireMs !== null) {
                  notExpired = expireMs > now;
                } else if (row.expires) {
                  const expParsed = new Date(row.expires).getTime();
                  if (!Number.isNaN(expParsed)) {
                    notExpired = expParsed > now;
                  }
                }
                
                if (notExpired) {
                  const sessData = typeof row.sess === 'string' ? JSON.parse(row.sess) : row.sess;
                  if (sessData && sessData.usuario) {
                    // Adicionar ID do usuário ou email como identificador único
                    const userId = sessData.userData?.id || sessData.userData?.email || sessData.usuario?.id || sessData.usuario?.email || sessData.usuario;
                    if (userId) {
                      // Excluir motoristas
                      if (motoristaIds.has(userId)) {
                        return;
                      }
                      usuariosUnicos.add(userId);
                      // Armazenar detalhes da sessão
                      if (sessData.userData) {
                        usuariosDetalhes.set(userId, {
                          id: userId,
                          nome: sessData.userData.nome || sessData.userData.username || sessData.userData.email,
                          email: sessData.userData.email,
                          tipo: 'sessao'
                        });
                      }
                    }
                  }
                }
              } catch (parseError) {
                // Ignorar erros de parsing
              }
            });
          }
          
          resolve();
        });
      });
    } catch (error) {
      console.warn('⚠️ Erro ao processar sessões SQLite:', error.message);
    }
    
    // 2. Contar tokens ativos do Supabase Auth (últimas 24 horas)
    try {
      const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();
      
      if (!authError && authUsers && authUsers.users) {
        const agora = Date.now();
        const vinteQuatroHoras = 24 * 60 * 60 * 1000; // 24 horas em ms
        
        authUsers.users.forEach(user => {
          // Excluir motoristas
          if (motoristaIds.has(user.id)) {
            return;
          }
          
          // Verificar se o usuário tem última sessão recente (últimas 24h)
          if (user.last_sign_in_at) {
            const lastSignIn = new Date(user.last_sign_in_at).getTime();
            const diff = agora - lastSignIn;
            
            // Se fez login nas últimas 24 horas, considerar como ativo
            if (diff < vinteQuatroHoras) {
              usuariosUnicos.add(user.id);
              
              // Buscar dados completos do usuário no user_profiles
              usuariosDetalhes.set(user.id, {
                id: user.id,
                email: user.email,
                last_sign_in_at: user.last_sign_in_at,
                tipo: 'supabase'
              });
            }
          }
        });
      }
    } catch (error) {
      console.warn('⚠️ Erro ao buscar usuários do Supabase Auth:', error.message);
    }
    
    // 3. Buscar informações completas dos usuários no user_profiles e filtrar motoristas
    const usuariosCompletos = [];
    for (const userId of usuariosUnicos) {
      // Excluir motoristas antes de buscar perfil
      if (motoristaIds.has(userId)) {
        continue;
      }
      
      try {
        const { data: profile, error } = await supabaseAdmin
          .from('user_profiles')
          .select('id, nome, email, role, departamento, cargo')
          .eq('id', userId)
          .maybeSingle();
        
        const detalhes = usuariosDetalhes.get(userId) || {};
        if (!error && profile) {
          usuariosCompletos.push({
            id: profile.id,
            nome: profile.nome || detalhes.nome || 'Sem nome',
            email: profile.email || detalhes.email,
            role: profile.role || 'user',
            departamento: profile.departamento || null,
            cargo: profile.cargo || null,
            last_sign_in_at: detalhes.last_sign_in_at || null
          });
        } else if (detalhes && detalhes.id) {
          // Se não encontrou no user_profiles, usar dados da sessão (só se não for motorista)
          usuariosCompletos.push({
            id: detalhes.id,
            nome: detalhes.nome || 'Sem nome',
            email: detalhes.email,
            role: 'user',
            departamento: null,
            cargo: null,
            last_sign_in_at: detalhes.last_sign_in_at || null
          });
        }
      } catch (error) {
        console.warn(`⚠️ Erro ao buscar perfil do usuário ${userId}:`, error.message);
      }
    }
    
    const totalUsuariosLogados = usuariosCompletos.length;
    
    console.log(`👥 Usuários administrativos únicos logados: ${totalUsuariosLogados} (motoristas excluídos)`);
    
    res.json({
      success: true,
      count: totalUsuariosLogados,
      usuarios: usuariosCompletos
    });
  } catch (error) {
    console.error('❌ Erro ao contar sessões ativas:', error);
    res.json({
      success: true,
      count: 0,
      usuarios: [],
      error: 'Erro ao contar sessões'
    });
  }
});

// ========== ENDPOINT PARA DADOS DE ATIVIDADE DO SISTEMA ==========
app.get('/api/system-activity', async (req, res) => {
  try {
    const agora = new Date();
    const ontem = new Date(agora);
    ontem.setDate(ontem.getDate() - 1);
    
    // Inicializar dados por período (6 períodos de 4 horas)
    const atividadeData = {
      '00-04': 0,
      '04-08': 0,
      '08-12': 0,
      '12-16': 0,
      '16-20': 0,
      '20-24': 0
    };
    
    // 1. Buscar coletas criadas
    try {
      const { data: coletas, error } = await supabaseAdmin
        .from('coletas')
        .select('created_at')
        .gte('created_at', ontem.toISOString());
      
      if (!error && coletas) {
        coletas.forEach(coleta => {
          const hora = new Date(coleta.created_at).getHours();
          if (hora >= 0 && hora < 4) atividadeData['00-04']++;
          else if (hora >= 4 && hora < 8) atividadeData['04-08']++;
          else if (hora >= 8 && hora < 12) atividadeData['08-12']++;
          else if (hora >= 12 && hora < 16) atividadeData['12-16']++;
          else if (hora >= 16 && hora < 20) atividadeData['16-20']++;
          else if (hora >= 20) atividadeData['20-24']++;
        });
      }
    } catch (error) {
      console.warn('⚠️ Erro ao buscar coletas:', error.message);
    }
    
    // 2. Buscar disparos de mensagens
    try {
      const { data: disparos, error } = await supabaseAdmin
        .from('disparos_log')
        .select('created_at')
        .gte('created_at', ontem.toISOString());
      
      if (!error && disparos) {
        disparos.forEach(disp => {
          const hora = new Date(disp.created_at).getHours();
          if (hora >= 0 && hora < 4) atividadeData['00-04']++;
          else if (hora >= 4 && hora < 8) atividadeData['04-08']++;
          else if (hora >= 8 && hora < 12) atividadeData['08-12']++;
          else if (hora >= 12 && hora < 16) atividadeData['12-16']++;
          else if (hora >= 16 && hora < 20) atividadeData['16-20']++;
          else if (hora >= 20) atividadeData['20-24']++;
        });
      }
    } catch (error) {
      console.warn('⚠️ Erro ao buscar disparos:', error.message);
    }
    
    // 3. Buscar cadastros de motoristas
    try {
      const { data: motoristas, error } = await supabaseAdmin
        .from('motoristas')
        .select('data_cadastro')
        .gte('data_cadastro', ontem.toISOString());
      
      if (!error && motoristas) {
        motoristas.forEach(m => {
          const hora = new Date(m.data_cadastro).getHours();
          if (hora >= 0 && hora < 4) atividadeData['00-04']++;
          else if (hora >= 4 && hora < 8) atividadeData['04-08']++;
          else if (hora >= 8 && hora < 12) atividadeData['08-12']++;
          else if (hora >= 12 && hora < 16) atividadeData['12-16']++;
          else if (hora >= 16 && hora < 20) atividadeData['16-20']++;
          else if (hora >= 20) atividadeData['20-24']++;
        });
      }
    } catch (error) {
      console.warn('⚠️ Erro ao buscar motoristas:', error.message);
    }
    
    // 4. Buscar histórico de coletas (ações)
    try {
      const { data: historico, error } = await supabaseAdmin
        .from('historico_coletas')
        .select('created_at')
        .gte('created_at', ontem.toISOString());
      
      if (!error && historico) {
        historico.forEach(h => {
          const hora = new Date(h.created_at).getHours();
          if (hora >= 0 && hora < 4) atividadeData['00-04']++;
          else if (hora >= 4 && hora < 8) atividadeData['04-08']++;
          else if (hora >= 8 && hora < 12) atividadeData['08-12']++;
          else if (hora >= 12 && hora < 16) atividadeData['12-16']++;
          else if (hora >= 16 && hora < 20) atividadeData['16-20']++;
          else if (hora >= 20) atividadeData['20-24']++;
        });
      }
    } catch (error) {
      console.warn('⚠️ Erro ao buscar histórico:', error.message);
    }
    
    // 5. Buscar chat com IA
    try {
      const { data: chatIA, error } = await supabaseAdmin
        .from('chat_ia_conversas')
        .select('created_at')
        .gte('created_at', ontem.toISOString());
      
      if (!error && chatIA) {
        chatIA.forEach(chat => {
          const hora = new Date(chat.created_at).getHours();
          if (hora >= 0 && hora < 4) atividadeData['00-04']++;
          else if (hora >= 4 && hora < 8) atividadeData['04-08']++;
          else if (hora >= 8 && hora < 12) atividadeData['08-12']++;
          else if (hora >= 12 && hora < 16) atividadeData['12-16']++;
          else if (hora >= 16 && hora < 20) atividadeData['16-20']++;
          else if (hora >= 20) atividadeData['20-24']++;
        });
      }
    } catch (error) {
      console.warn('⚠️ Erro ao buscar chat IA:', error.message);
    }
    
    // 6. Buscar logs de atividade
    try {
      const { data: logs, error } = await supabaseAdmin
        .from('user_activity_logs')
        .select('created_at')
        .gte('created_at', ontem.toISOString());
      
      if (!error && logs) {
        logs.forEach(log => {
          const hora = new Date(log.created_at).getHours();
          if (hora >= 0 && hora < 4) atividadeData['00-04']++;
          else if (hora >= 4 && hora < 8) atividadeData['04-08']++;
          else if (hora >= 8 && hora < 12) atividadeData['08-12']++;
          else if (hora >= 12 && hora < 16) atividadeData['12-16']++;
          else if (hora >= 16 && hora < 20) atividadeData['16-20']++;
          else if (hora >= 20) atividadeData['20-24']++;
        });
      }
    } catch (error) {
      console.warn('⚠️ Erro ao buscar logs de atividade:', error.message);
    }
    
    // Converter para array na ordem correta
    const data = [
      atividadeData['00-04'],
      atividadeData['04-08'],
      atividadeData['08-12'],
      atividadeData['12-16'],
      atividadeData['16-20'],
      atividadeData['20-24']
    ];
    
    console.log('📊 Dados de atividade do sistema:', data);
    
    res.json({
      success: true,
      data: data,
      labels: ['00h-04h', '04h-08h', '08h-12h', '12h-16h', '16h-20h', '20h-24h']
    });
  } catch (error) {
    console.error('❌ Erro ao buscar dados de atividade:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar dados de atividade',
      data: [0, 0, 0, 0, 0, 0],
      labels: ['00h-04h', '04h-08h', '08h-12h', '12h-16h', '16h-20h', '20h-24h']
    });
  }
});

// ========== ENDPOINT PARA HISTÓRICO DE ATIVIDADES DO USUÁRIO ==========
app.get('/api/user-activity/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Verificar autenticação - tentar múltiplas formas
    let user = null;
    let isAdmin = false;
    
    // 1. Tentar via getUserFromRequest (sessão ou token Supabase)
    const userResult = await getUserFromRequest(req);
    
    if (userResult && userResult.user) {
      user = userResult.user;
      // Buscar role no user_profiles
      try {
        const { data: profile, error } = await supabaseAdmin
          .from('user_profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        
        if (!error && profile) {
          isAdmin = profile.role === 'admin';
          user.role = profile.role;
        }
      } catch (error) {
        console.warn('⚠️ Erro ao buscar role do usuário:', error.message);
      }
    }
    
    // 2. Se não encontrou, tentar verificar se é admin através do localStorage via header
    if (!user) {
      const xUserEmail = req.headers['x-user-email'];
      if (xUserEmail) {
        try {
          // Buscar usuário pelo email no user_profiles
          const { data: profile, error } = await supabaseAdmin
            .from('user_profiles')
            .select('id, role, email')
            .eq('email', xUserEmail)
            .maybeSingle();
          
          if (!error && profile) {
            user = {
              id: profile.id,
              email: profile.email,
              role: profile.role
            };
            isAdmin = profile.role === 'admin';
          }
        } catch (error) {
          console.warn('⚠️ Erro ao buscar usuário por email:', error.message);
        }
      }
    }
    
    // 3. Se ainda não encontrou, retornar erro
    if (!user || !user.id) {
      console.log('❌ Usuário não autenticado no endpoint /api/user-activity');
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }
    
    // Verificar permissões
    const isOwnProfile = user.id === userId;
    
    // Permitir acesso se for admin OU se for o próprio perfil
    if (!isAdmin && !isOwnProfile) {
      console.log(`❌ Sem permissão: user.id=${user.id}, userId=${userId}, isAdmin=${isAdmin}`);
      return res.status(403).json({ success: false, error: 'Sem permissão para acessar este histórico' });
    }
    
    console.log(`✅ Permissão concedida: user.id=${user.id}, userId=${userId}, isAdmin=${isAdmin}`);
    
    // Buscar histórico de atividades da tabela user_activity_logs
    const { data: activityLogs, error: activityError } = await supabaseAdmin
      .from('user_activity_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    
    if (activityError) {
      console.error('❌ Erro ao buscar activity logs:', activityError);
    }
    
    // Buscar último login do user_profiles
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('last_login, created_at')
      .eq('id', userId)
      .maybeSingle();
    
    // Buscar histórico de coletas
    const { data: coletasHistory, error: coletasError } = await supabaseAdmin
      .from('historico_coletas')
      .select('acao, detalhes, created_at')
      .ilike('usuario', userId) // Usar ilike para buscar por string
      .order('created_at', { ascending: false })
      .limit(50);
    
    // Buscar disparos de mensagens
    const { data: disparos, error: disparosError } = await supabaseAdmin
      .from('disparos_log')
      .select('numero, status, created_at, mensagem_tamanho')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    // Buscar uso do chat com IA
    const { data: chatIA, error: chatError } = await supabaseAdmin
      .from('chat_ia_conversas')
      .select('mensagem, resposta, pagina_origem, categoria, tokens_usados, satisfacao, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    // Buscar histórico de movimentações em coletas
    const { data: movimentacoes, error: movError } = await supabaseAdmin
      .from('historico_movimentacoes')
      .select('acao, detalhes, created_at')
      .eq('usuario_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    // Buscar cadastros de motoristas realizados pelo usuário
    const { data: cadastros, error: cadastrosError } = await supabaseAdmin
      .from('motoristas')
      .select('id, nome, telefone1, cnh, tipo_veiculo, tipo_carroceria, placa_cavalo, status, data_cadastro')
      .eq('created_by', userId)
      .order('data_cadastro', { ascending: false })
      .limit(50);
    
    if (cadastrosError) {
      console.error('❌ Erro ao buscar cadastros:', cadastrosError);
    }
    
    // Buscar última sessão do Supabase Auth
    let lastSignIn = null;
    try {
      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (!authError && authUser?.user?.last_sign_in_at) {
        lastSignIn = authUser.user.last_sign_in_at;
      }
    } catch (error) {
      console.warn('⚠️ Erro ao buscar last_sign_in_at:', error.message);
    }
    
    res.json({
      success: true,
      data: {
        userId,
        lastLogin: profile?.last_login || lastSignIn,
        accountCreated: profile?.created_at,
        activityLogs: activityLogs || [],
        coletasHistory: coletasHistory || [],
        disparos: disparos || [],
        chatIA: chatIA || [],
        movimentacoes: movimentacoes || [],
        cadastros: cadastros || []
      }
    });
  } catch (error) {
    console.error('❌ Erro ao buscar histórico de atividades:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar histórico de atividades'
    });
  }
});

// ========== ENDPOINT CHECK-AUTH PARA PAINEL.HTML ==========
app.get('/api/check-auth', async (req, res) => {
  const autenticado = !!(req.session && req.session.usuario);
  
  console.log('🔍 Verificando autenticação para painel...');
  console.log('📋 Sessão:', req.session);
  
  if (!autenticado) {
    console.log('❌ Usuário NÃO autenticado');
    return res.json({ 
      authenticated: false,
      user: null,
      isAdmin: false
    });
  }

  try {
    console.log('✅ Usuário autenticado:', req.session.usuario);
    
    res.json({ 
      authenticated: true,
      user: req.session.usuario,
      isAdmin: req.session.isAdmin || false
    });
  } catch (error) {
    console.error('❌ Erro ao verificar autenticação:', error);
    res.json({ 
      authenticated: false,
      user: null,
      isAdmin: false
    });
  }
});
// ========== ROTAS DE CONFIGURAÇÃO EVOLUTION ==========
// 🔧 OBTER CONFIGURAÇÃO DO USUÁRIO LOGADO
app.get('/api/evolution-config', requireAuth, async (req, res) => {
  try {
    const userConfig = await getEvolutionConfigByUser(req.session.usuario);
    
    if (userConfig.error) {
      return res.status(404).json({
        success: false,
        error: userConfig.error
      });
    }
    
    res.json({
      success: true,
      config: userConfig
    });
    
  } catch (error) {
    console.error('❌ Erro ao buscar configuração:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno ao buscar configuração'
    });
  }
});

// 🔧 SALVAR CONFIGURAÇÃO DO USUÁRIO LOGADO
app.post('/api/evolution-config', requireAuth, async (req, res) => {
  try {
    const { apiKey, instanceName, webhookUrl } = req.body;
    
    if (!apiKey || !instanceName) {
      return res.status(400).json({
        success: false,
        error: 'API Key e Instance Name são obrigatórios'
      });
    }
    
    const config = {
      apiKey,
      instanceName,
      webhookUrl: webhookUrl || ''
    };
    
    const result = await salvarEvolutionConfig(req.session.usuario, config);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    res.json({
      success: true,
      message: result.message,
      config: result.data
    });
    
  } catch (error) {
    console.error('❌ Erro ao salvar configuração:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno ao salvar configuração'
    });
  }
});

// 🔧 CONFIGURAÇÃO PADRÃO FALLBACK
app.get('/api/evolution-config/fallback', requireAuth, async (req, res) => {
  try {
    const { data: fallbackData, error } = await supabase
      .from('evolution_config')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (error || !fallbackData) {
      return res.status(404).json({
        success: false,
        error: 'Nenhuma configuração ativa encontrada'
      });
    }

    res.json({
      success: true,
      config: {
        apiKey: fallbackData.api_key,
        instanceName: fallbackData.instance_name,
        webhookUrl: fallbackData.webhook_url
      }
    });
    
  } catch (error) {
    console.error('❌ Erro no fallback:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno'
    });
  }
});

// ========== ROTAS DE PERMISSÕES ==========
app.get('/api/user/permissoes', requireAuth, async (req, res) => {
  try {
    const permissoes = await carregarPermissoesUsuario(req.session.usuario);
    res.json({
      usuario: req.session.usuario,
      permissoes: permissoes,
      isAdmin: req.session.usuario === 'admin'
    });
  } catch (error) {
    console.error('❌ Erro ao obter permissões:', error);
    res.status(500).json({ error: 'Erro ao carregar permissões' });
  }
});

app.get('/api/permissoes/todos', requireAuth, async (req, res) => {
  if (req.session.usuario !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
  }

  try {
    db.all('SELECT usuario, GROUP_CONCAT(etapa) as etapas FROM usuario_permissoes GROUP BY usuario', (err, rows) => {
      if (err) {
        console.error('❌ Erro ao listar permissões:', err);
        res.status(500).json({ error: 'Erro ao carregar permissões' });
      } else {
        const permissoes = {};
        rows.forEach(row => {
          permissoes[row.usuario] = row.etapas ? row.etapas.split(',') : [];
        });
        
        Object.keys(usuarios).forEach(usuario => {
          if (!permissoes[usuario]) {
            permissoes[usuario] = [];
          }
        });
        
        res.json(permissoes);
      }
    });
  } catch (error) {
    console.error('❌ Erro ao listar permissões:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.post('/api/permissoes/salvar', requireAuth, async (req, res) => {
  if (req.session.usuario !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
  }

  const { usuario, permissoes } = req.body;
  
  if (!usuario || !Array.isArray(permissoes)) {
    return res.status(400).json({ error: 'Dados inválidos. Usuário e array de permissões são obrigatórios.' });
  }

  if (!usuarios[usuario]) {
    return res.status(400).json({ error: 'Usuário não existe no sistema.' });
  }

  try {
    const totalSalvas = await salvarPermissoesUsuario(usuario, permissoes);
    res.json({
      success: true,
      message: `Permissões salvas para ${usuario}`,
      usuario: usuario,
      permissoes: permissoes,
      total: totalSalvas
    });
  } catch (error) {
    console.error('❌ Erro ao salvar permissões:', error);
    res.status(500).json({ error: 'Erro ao salvar permissões' });
  }
});

app.get('/api/permissoes/verificar/:etapa', requireAuth, async (req, res) => {
  const etapa = req.params.etapa;
  
  try {
    const permissoes = await carregarPermissoesUsuario(req.session.usuario);
    const temPermissao = permissoes.includes(etapa) || req.session.usuario === 'admin';
    
    res.json({
      usuario: req.session.usuario,
      etapa: etapa,
      temPermissao: temPermissao,
      isAdmin: req.session.usuario === 'admin'
    });
  } catch (error) {
    console.error('❌ Erro ao verificar permissão:', error);
    res.status(500).json({ error: 'Erro ao verificar permissão' });
  }
});

// ========== ROTAS PÚBLICAS ==========
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 🧪 ROTA DE TESTE DE SESSÃO
app.get('/api/debug-session', (req, res) => {
  console.log('🧪 Debug Session Route:', {
    sessionID: req.sessionID,
    usuario: req.session.usuario,
    session: req.session
  });
  
  res.json({
    sessionID: req.sessionID,
    usuario: req.session.usuario,
    autenticado: !!req.session.usuario,
    cookies: req.headers.cookie
  });
});

// ========== ROTAS PRINCIPAIS ==========
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/comercial.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'comercial.html'));
});

// ========== ROTAS PROTEGIDAS ==========
app.get('/painel.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'painel.html'));
});

app.get('/portal.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'portal.html'));
});

app.get('/coletas.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'coletas.html'));
});

app.get('/settings.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'settings.html'));
});

app.get('/relatorios.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'relatorios.html'));
});

app.get('/cadastro.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'cadastro.html'));
});

app.get('/contatos.csv', requireAuth, (req, res) => {
  const csvPath = path.join(__dirname, 'contatos.csv');
  if (!fs.existsSync(csvPath)) {
    return res.status(404).json({ error: 'Arquivo contatos.csv não encontrado' });
  }
  res.sendFile(csvPath);
});

// Rota para obter perfil do usuário autenticado
app.get('/api/user/profile', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    
    if (!userResult || !userResult.user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Não autenticado' 
      });
    }

    const user = userResult.user;
    const userId = user.id || user.user_id;

    // Buscar perfil completo na tabela user_profiles
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, nome, email, role, departamento, cargo, telefone')
      .eq('id', userId)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      console.warn('⚠️ Erro ao buscar perfil:', profileError);
    }

    // Se encontrou perfil, retornar dados completos
    if (profile && !profileError) {
      return res.json({
        success: true,
        id: profile.id,
        nome: profile.nome,
        email: profile.email || user.email,
        role: profile.role,
        departamento: profile.departamento,
        cargo: profile.cargo,
        telefone: profile.telefone
      });
    }

    // Fallback: retornar dados básicos do usuário autenticado
    return res.json({
      success: true,
      id: userId,
      nome: user.user_metadata?.nome || user.email?.split('@')[0] || 'Usuário',
      email: user.email,
      role: user.user_metadata?.role || 'user'
    });
  } catch (error) {
    console.error('❌ Erro ao buscar perfil do usuário:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Erro ao buscar perfil do usuário' 
    });
  }
});

// ========== ROTAS DA API ==========
app.get('/api/user/info', requireAuth, async (req, res) => {
  try {
    const userConfig = await getEvolutionConfigByUser(req.session.usuario);
    
    if (!isValidApiConfig(userConfig)) {
      return res.status(500).json({
        error: 'Configuração incompleta',
        details: userConfig.error,
        usuario: req.session.usuario
      });
    }
    
    res.json({
      usuario: req.session.usuario,
      permissoes: req.session.permissoes || [],
      isAdmin: req.session.isAdmin || false,
      config: userConfig,
      instancia: userConfig.instanceName,
      baseUrl: EVOLUTION_CONFIG.baseUrl
    });
  } catch (error) {
    console.error('❌ Erro ao carregar info do usuário:', error);
    res.status(500).json({
      error: 'Erro ao carregar informações do usuário'
    });
  }
});

// ========== ROTAS DO EVOLUTION API ==========

// 🔧 ENDPOINT PARA TESTAR CONFIGURAÇÃO DA EVOLUTION
app.get('/api/evolution-config', requireAuth, async (req, res) => {
  try {
    const userConfig = await getEvolutionConfigByUser(req.session.usuario);
    
    logger.info('🔍 Testando configuração Evolution para:', req.session.usuario);
    
    res.json({
      success: true,
      usuario: req.session.usuario,
      config: {
        instanceName: userConfig.instanceName,
        apiKey: userConfig.apiKey ? '***' + userConfig.apiKey.slice(-4) : 'NÃO CONFIGURADA',
        apiUrl: userConfig.apiUrl,
        webhookUrl: userConfig.webhookUrl,
        id: userConfig.id,
        isValid: isValidApiConfig(userConfig)
      },
      error: userConfig.error || null
    });
    
  } catch (error) {
    logger.error('Erro ao buscar configuração Evolution:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno ao buscar configuração',
      details: error.message
    });
  }
});

// ========== WEBHOOK STATUS EVOLUTION (ALTERNATIVA SEGURA) ==========
app.get('/webhook/status-evolution', async (req, res) => {
  try {
    console.log('🔍 Verificando status da Evolution API (modo alternativo)...');
    
    // ✅ Buscar credenciais do usuário específico
    const { usuario } = req.query;
    let config = null;
    
    if (usuario) {
      console.log('👤 Verificando credenciais para usuário:', usuario);
      
      // Buscar ID do usuário pelo email
      const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
      const user = authUsers?.users?.find(u => u.email === usuario);
      
      if (user) {
        console.log('✅ Usuário encontrado:', user.id);
        
        // Buscar credenciais na tabela user_evolution_apis
        const { data: userCreds } = await supabaseAdmin
          .from('user_evolution_apis')
          .select('*')
          .eq('user_id', user.id)
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (userCreds) {
          console.log('✅ Usando credenciais do usuário:', userCreds.instance_name);
          config = {
            api_url: userCreds.api_url,
            api_key: userCreds.api_key,
            instance_name: userCreds.instance_name,
            source: 'user_credentials'
          };
        }
      }
    }
    
    // ✅ Fallback para configuração padrão do .env
    if (!config) {
      console.log('🔄 Usando configuração padrão do .env');
      config = {
      api_url: process.env.EVOLUTION_BASE_URL || 'https://b1336382a159.ngrok-free.app',
      api_key: process.env.EVOLUTION_API_KEY || '2CA53A24D6A7-4544-A440-36BBE4FB80C5',
        instance_name: process.env.EVOLUTION_INSTANCE_NAME || 'TESTE',
        source: 'env_default'
    };
    }
    
    console.log('📋 Configuração Evolution:', {
      url: config.api_url,
      instance: config.instance_name,
      key: config.api_key ? '***' + config.api_key.slice(-4) : 'NÃO CONFIGURADA'
    });
    
    // 🔒 SEGURANÇA: Verificar se a Evolution API está respondendo com timeout
    const evolutionUrl = `${config.api_url}/instance/connectionState/${config.instance_name}`;
    console.log('🌐 Testando Evolution API:', evolutionUrl);
    
    try {
      const response = await fetchWithTimeout(evolutionUrl, {
        method: 'GET',
        headers: {
          'apikey': config.api_key,
          'Content-Type': 'application/json'
        }
      }, 10000); // Timeout de 10 segundos
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Evolution API conectada:', data);
        
        res.json({
          success: true,
          status: 'connected',
          url: config.api_url,
          instance: config.instance_name,
          data: data,
          message: 'Evolution API conectada com sucesso'
        });
      } else {
        console.log('⚠️ Evolution API respondeu com erro:', response.status);
        res.json({
          success: false,
          status: 'error',
          url: config.api_url,
          instance: config.instance_name,
          error: `HTTP ${response.status}`,
          message: 'Evolution API não está respondendo corretamente'
        });
      }
    } catch (fetchError) {
      console.log('❌ Erro ao conectar com Evolution API:', fetchError.message);
      res.json({
        success: false,
        status: 'disconnected',
        url: config.api_url,
        instance: config.instance_name,
        error: fetchError.message,
        message: 'Não foi possível conectar com a Evolution API'
      });
    }
    
  } catch (error) {
    console.error('❌ Erro geral na verificação:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      error: error.message,
      message: 'Erro interno do servidor'
    });
  }
});

// ========== WEBHOOK SEND (ALTERNATIVA SEGURA) ==========
app.post('/webhook/send', async (req, res) => {
  try {
    const { number, text } = req.body;
    
    console.log('📤 Enviando mensagem via Evolution API (modo alternativo)...');
    console.log('📱 Número:', number);
    console.log('💬 Mensagem:', text ? text.substring(0, 50) + '...' : 'N/A');
    
    // Configuração padrão do .env
    const config = {
      api_url: process.env.EVOLUTION_BASE_URL || 'https://b1336382a159.ngrok-free.app',
      api_key: process.env.EVOLUTION_API_KEY || '2CA53A24D6A7-4544-A440-36BBE4FB80C5',
      instance_name: process.env.EVOLUTION_INSTANCE_NAME || 'TESTE'
    };
    
    // Validar dados
    if (!number || !text) {
      return res.status(400).json({
        success: false,
        error: 'Dados incompletos',
        message: 'Número e mensagem são obrigatórios'
      });
    }
    
    // 🔒 SEGURANÇA: Enviar mensagem via Evolution API com timeout
    const sendUrl = `${config.api_url}/message/sendText/${config.instance_name}`;
    console.log('🌐 Enviando para:', sendUrl);
    
    const response = await fetchWithTimeout(sendUrl, {
      method: 'POST',
      headers: {
        'apikey': config.api_key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        number: number,
        text: text
      })
    }, 30000); // Timeout de 30 segundos
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Mensagem enviada com sucesso:', data);
      
      // Registrar disparo anônimo (sem auth) no Supabase
      try {
        await supabaseAdmin.from('disparos_log').insert([{
          user_id: null,
          departamento: null,
          numero: number,
          mensagem_tamanho: (text || '').length,
          status: 'success'
        }]);
        console.log('✅ Disparo registrado no BI (send anônimo)');
      } catch (logErr) {
        console.error('❌ Falha ao registrar disparo (send):', logErr.message, logErr);
      }
      
      res.json({
        success: true,
        message: 'Mensagem enviada com sucesso',
        data: data,
        number: number
      });
    } else {
      const errorData = await response.text();
      console.log('❌ Erro ao enviar mensagem:', response.status, errorData);
      
      res.status(500).json({
        success: false,
        error: `HTTP ${response.status}`,
        message: 'Erro ao enviar mensagem',
        details: errorData
      });
    }
    
  } catch (error) {
    console.error('❌ Erro geral no envio:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Erro interno do servidor'
    });
  }
});

// ========== WEBHOOK SEND (VERSÃO ORIGINAL COM AUTH) ==========
app.post('/webhook/send-auth', requireAuth, async (req, res) => {
  const { number, message } = req.body;
  const usuario = req.session.usuario;
  const userConfig = await getEvolutionConfigByUser(usuario);
  
  console.log('📤 Tentando enviar mensagem:');
  console.log('👤 Usuário:', usuario);
  console.log('🔢 Número:', number);
  console.log('🏷️ Instância:', userConfig.instanceName);
  console.log('🔑 API Key:', userConfig.apiKey ? '***' + userConfig.apiKey.slice(-4) : 'NÃO CONFIGURADA');
  
  if (!isValidApiConfig(userConfig)) {
    return res.status(500).json({ 
      success: false, 
      error: `❌ Configuração incompleta para ${usuario}`,
      details: userConfig.error
    });
  }
  
  if (!number || !message) {
    return res.status(400).json({ 
      success: false, 
      error: 'Número e mensagem são obrigatórios' 
    });
  }
  
  try {
    const formattedNumber = formatNumberForEvolution(number);
    console.log('🔢 Número formatado:', formattedNumber);
    
    // ✅ USAR A URL DA CONFIGURAÇÃO DO SUPABASE
    const evolutionUrl = userConfig.apiUrl || EVOLUTION_CONFIG.baseUrl;
    const url = `${evolutionUrl}/message/sendText/${userConfig.instanceName}`;
    
    logger.info(`📤 Enviando mensagem via Evolution: ${url}`);
    console.log('🌐 URL da requisição:', url);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': userConfig.apiKey
      },
      body: JSON.stringify({
        number: formattedNumber,
        text: message
      }),
      timeout: 30000
    });
    
    console.log('📡 Status da Evolution:', response.status);
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Mensagem enviada com sucesso:', result);
      
      // Registrar disparo autenticado no Supabase
      try {
        await supabaseAdmin.from('disparos_log').insert([{
          user_id: usuario,
          departamento: req.session?.userData?.departamento || null,
          numero: formattedNumber,
          mensagem_tamanho: (message || '').length,
          status: 'success'
        }]);
        console.log('✅ Disparo registrado no BI com sucesso (send-auth)');
      } catch (logErr) {
        console.error('❌ Falha ao registrar disparo (send-auth):', logErr.message, logErr);
      }
      
      res.json({ 
        success: true, 
        message: '✅ Mensagem enviada com sucesso!',
        usuario: usuario,
        instancia: userConfig.instanceName,
        messageId: result.key?.id
      });
    } else if (response.status === 404) {
      console.log('❌ Instância não encontrada');
      res.status(500).json({ 
        success: false, 
        error: '❌ Instância não encontrada',
        details: `A instância "${userConfig.instanceName}" não existe no Evolution`,
        solution: 'Verifique o nome da instância no Evolution Manager'
      });
    } else if (response.status === 401) {
      console.log('❌ API Key inválida');
      res.status(500).json({ 
        success: false, 
        error: '❌ API Key inválida',
        details: 'A API Key não é válida para esta instância',
        solution: 'Verifique a API Key no Evolution Manager'
      });
    } else {
      const errorText = await response.text();
      console.log('❌ Erro da Evolution:', errorText);
      res.status(500).json({ 
        success: false, 
        error: `❌ Erro ${response.status} do Evolution`,
        details: errorText
      });
    }
    
  } catch (error) {
    console.log('❌ Erro de conexão:', error.message);
    res.status(500).json({ 
      success: false, 
      error: '❌ Erro de comunicação com o Evolution',
      details: error.message,
      solution: 'Verifique se o Evolution está rodando e acessível'
    });
  }
});
// ========== NOVA ROTA PARA ENVIO COM SUPABASE ==========
app.post('/webhook/send-supabase', upload.single('media'), async (req, res) => {
  const { number, message, usuario, userId } = req.body;
  const mediaFile = req.file;

  console.log('📤 Nova requisição de envio via Supabase:');
  console.log('👤 Usuário:', usuario);
  console.log('🆔 User ID (direto):', userId);
  console.log('🔢 Número:', number);
  if (mediaFile) {
    console.log('🖼️ Arquivo recebido:', mediaFile.originalname, mediaFile.mimetype, `${Math.round(mediaFile.size / 1024)}KB`);
  }
  
  if ((!usuario && !userId) || !number || !message) {
    if (mediaFile) {
      try { fs.unlinkSync(mediaFile.path); } catch (error) { console.warn('⚠️ Falha ao remover arquivo temporário', error.message); }
    }
    return res.status(400).json({ 
      success: false, 
      error: 'User ID (ou email), número e mensagem são obrigatórios' 
    });
  }
  
  const cleanupFile = () => {
    if (mediaFile) {
      try {
        fs.unlinkSync(mediaFile.path);
      } catch (error) {
        console.warn('⚠️ Falha ao remover arquivo temporário:', error.message);
      }
    }
  };

  let mediaData = null;
  if (mediaFile) {
    if (!mediaFile.mimetype.startsWith('image/')) {
      cleanupFile();
      return res.status(400).json({
        success: false,
        error: 'Somente arquivos de imagem são permitidos'
      });
    }

    if (mediaFile.size > 5 * 1024 * 1024) {
      cleanupFile();
      return res.status(400).json({
        success: false,
        error: 'A imagem deve ter no máximo 5MB'
      });
    }

    try {
      const buffer = fs.readFileSync(mediaFile.path);
      mediaData = {
        fileName: mediaFile.originalname,
        mimetype: mediaFile.mimetype,
        base64: buffer.toString('base64')
      };
    } catch (error) {
      cleanupFile();
      return res.status(500).json({
        success: false,
        error: 'Falha ao processar a imagem enviada',
        details: error.message
      });
    }
  }

  try {
    // ✅ Usar userId direto do body se disponível
    let userIdentity = userId;

    // Se userId não foi fornecido, buscar pelo email
    if (!userId && usuario) {
      console.log('📧 Buscando userId pelo email:', usuario);

      try {
        const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();

        if (!authError && authUsers?.users) {
          const user = authUsers.users.find(u => u.email === usuario);
          if (user) {
            userIdentity = user.id;
            console.log('✅ User_id encontrado via admin API:', userIdentity);
          }
        } else {
          console.warn('⚠️ Não foi possível listar usuários via admin API');
        }
      } catch (adminError) {
        console.warn('⚠️ Erro ao usar admin API:', adminError.message);
      }
    }

    if (!userIdentity) {
      console.error('❌ User ID não encontrado');
      cleanupFile();
      return res.status(404).json({
        success: false,
        error: 'User ID não identificado',
        solution: 'Faça login novamente',
        details: 'O ID do usuário não pôde ser determinado'
      });
    }

    console.log('✅ Usando user_id:', userIdentity);

    const overrides = {};
    const maxMessages = parseInt(req.body?.maxMessages, 10);
    if (Number.isFinite(maxMessages) && maxMessages >= 1) {
      overrides.threshold = maxMessages;
    }
    const cooldownMinutesOverride = parseInt(req.body?.cooldownMinutes, 10);
    if (Number.isFinite(cooldownMinutesOverride) && cooldownMinutesOverride >= 1) {
      overrides.cooldownMs = cooldownMinutesOverride * 60 * 1000;
    }
    const windowMinutesOverride = parseInt(req.body?.windowMinutes, 10);
    if (Number.isFinite(windowMinutesOverride) && windowMinutesOverride >= 1) {
      overrides.windowMs = windowMinutesOverride * 60 * 1000;
    }
    if (Object.keys(overrides).length) {
      setUserConfig(userIdentity, overrides);
    }

    const userConfig = getUserConfig(userIdentity);
    const cooldownState = getUserCooldownState(userIdentity);
    if (cooldownState.blocked) {
      const remainingMinutes = Math.ceil((cooldownState.remainingMs || 0) / 60000);
      console.warn(`⛔ Usuário ${userIdentity} em cooldown. Restam ${remainingMinutes} minutos.`);
      cleanupFile();
      const cooldownMinutesConfig = Math.ceil((userConfig.cooldownMs || DEFAULT_DISPARO_CONFIG.cooldownMs) / 60000);
      return res.status(429).json({
        success: false,
        error: `Limite de envios atingido. Aguarde ${cooldownMinutesConfig} minuto(s) antes de enviar novas mensagens.`,
        remainingMs: cooldownState.remainingMs || DEFAULT_DISPARO_CONFIG.cooldownMs,
        remainingMinutes: remainingMinutes > 0 ? remainingMinutes : cooldownMinutesConfig,
        cooldownMinutes: cooldownMinutesConfig
      });
    }

    // Buscar credenciais da Evolution API do usuário
    console.log('🔍 Buscando credenciais para user_id:', userIdentity);

    let userCreds = null;
    let credsError = null;

    const { data, error } = await supabaseAdmin
      .from('user_evolution_apis')
      .select('*')
      .eq('user_id', userIdentity)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    userCreds = data;
    credsError = error;

    if (!userCreds) {
      console.log('🔍 Tentando buscar sem filtro de active...');
      const { data: allCreds } = await supabaseAdmin
        .from('user_evolution_apis')
        .select('*')
        .eq('user_id', userIdentity);

      if (allCreds) {
        console.log('📋 Credenciais encontradas (ativas e inativas):', allCreds);
      }
    }

    console.log('📋 Resultado da busca:', {
      tem_credenciais: !!userCreds,
      erro: credsError,
      user_id_buscado: userIdentity
    });

    if (credsError || !userCreds) {
      console.error('❌ Credenciais não encontradas:', credsError);
      console.error('👤 Email do usuário:', usuario);
      console.error('🆔 ID do usuário:', userIdentity);

      const { data: credenciaisInativas } = await supabaseAdmin
        .from('user_evolution_apis')
        .select('*')
        .eq('user_id', userIdentity);

      console.log('📊 Credenciais do usuário (ativas e inativas):', credenciaisInativas);

      const { data: todasCredenciais } = await supabaseAdmin
        .from('user_evolution_apis')
        .select('*');

      console.log('📋 TODAS as credenciais cadastradas:');
      if (todasCredenciais && todasCredenciais.length > 0) {
        todasCredenciais.forEach(cred => {
          console.log(`  - User ID: ${cred.user_id}, Instância: ${cred.instance_name}, Ativa: ${cred.active}`);
        });
      } else {
        console.log('  - Nenhuma credencial encontrada no banco');
      }

      cleanupFile();
      return res.status(404).json({
        success: false,
        error: `Credenciais da Evolution API não configuradas para ${usuario}`,
        solution: 'Configure suas credenciais em Settings > Evolution API',
        details: credsError?.message || 'Nenhuma credencial ativa encontrada'
      });
    }

    console.log('✅ Credenciais encontradas:');
    console.log('🏷️ Instância:', userCreds.instance_name);
    console.log('🔑 API Key:', userCreds.api_key ? '***' + userCreds.api_key.slice(-4) : 'NÃO CONFIGURADA');
    console.log('🔗 API URL:', userCreds.api_url);
    console.log('👤 User ID:', userCreds.user_id);

    if (!userCreds.api_key || !userCreds.api_url || !userCreds.instance_name) {
      cleanupFile();
      return res.status(500).json({
        success: false,
        error: `Configuração incompleta para ${usuario}`,
        solution: 'Complete todas as informações das credenciais'
      });
    }

    const formattedNumber = formatNumberForEvolution(number);
    console.log('🔢 Número formatado:', formattedNumber);

    const evolutionUrl = userCreds.api_url;
    const simulateTypingRaw = (req.body?.simulateTyping || req.body?.simulate_typing || '').toString().toLowerCase();
    const simulateTypingEnabled = ['1', 'true', 'on', 'yes'].includes(simulateTypingRaw);

    if (!mediaData) {
      const textUrl = `${evolutionUrl}/message/sendText/${userCreds.instance_name}`;
      console.log('🌐 URL da requisição:', textUrl);

      await simulateTypingAction({
        enabled: simulateTypingEnabled,
        evolutionUrl,
        instanceName: userCreds.instance_name,
        apiKey: userCreds.api_key,
        formattedNumber,
        message
      });

      const response = await fetch(textUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': userCreds.api_key
        },
        body: JSON.stringify({
          number: formattedNumber,
          text: message
        }),
        timeout: 30000
      });

      console.log('📡 Status da Evolution:', response.status);

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Mensagem enviada com sucesso:', result);
        const cooldownInfo = registerUserSend(userIdentity);
        cleanupFile();

        // Registrar disparo no BI
        try {
          await supabaseAdmin.from('disparos_log').insert([
            {
              user_id: userCreds.user_id || userIdentity || null,
              departamento: req.session?.userData?.departamento || null,
              numero: formattedNumber,
              mensagem_tamanho: (message || '').length,
              status: 'success'
            }
          ]);
          console.log('✅ Disparo registrado no BI com sucesso');
        } catch (logErr) {
          console.error('❌ Falha ao registrar disparo (send-supabase texto):', logErr.message, logErr);
        }

        res.json({
          success: true,
          message: '✅ Mensagem enviada com sucesso!',
          usuario: usuario,
          instancia: userCreds.instance_name,
          messageId: result.key?.id,
          mediaEnviada: null,
          cooldownTriggered: cooldownInfo.cooldownTriggered,
          cooldownUntil: cooldownInfo.cooldownUntil,
          cooldownMinutes: cooldownInfo.cooldownTriggered ? cooldownInfo.cooldownMinutes : null
        });
        return;
      }

      const errorText = await response.text();
      console.log('❌ Erro da Evolution (texto):', errorText);
      // Registrar falha no BI
      try {
        await supabaseAdmin.from('disparos_log').insert([
          {
            user_id: userCreds.user_id || userIdentity || null,
            departamento: req.session?.userData?.departamento || null,
            numero: formattedNumber,
            mensagem_tamanho: (message || '').length,
            status: 'error'
          }
        ]);
        console.log('✅ Falha de disparo registrada no BI');
      } catch (logErr) {
        console.error('❌ Falha ao registrar disparo (erro texto):', logErr.message, logErr);
      }
      cleanupFile();
      return res.status(500).json({
        success: false,
        error: `❌ Erro ${response.status} do Evolution`,
        details: errorText
      });
    }

    const isImage = mediaData.mimetype.startsWith('image/');
    const rawBase64 = mediaData.base64;
    const prefixedBase64 = rawBase64.startsWith('data:') ? rawBase64 : `data:${mediaData.mimetype};base64,${rawBase64}`;
    const guessedExtension = path.extname(mediaData.fileName) || (isImage ? '.jpg' : '');
    const normalizedFileName = mediaData.fileName || `arquivo${guessedExtension}`;

    const mediaAttempts = [
      {
        name: 'message/sendFileBase64',
        url: `${evolutionUrl}/message/sendFileBase64/${userCreds.instance_name}`,
        payload: {
          number: formattedNumber,
          caption: message,
          fileName: normalizedFileName,
          filename: normalizedFileName,
          base64: rawBase64,
          mimetype: mediaData.mimetype
        }
      },
      {
        name: 'message/sendMediaFromBase64',
        url: `${evolutionUrl}/message/sendMediaFromBase64/${userCreds.instance_name}`,
        payload: {
          number: formattedNumber,
          caption: message,
          fileName: normalizedFileName,
          mimetype: mediaData.mimetype,
          mediaData: prefixedBase64,
          base64: rawBase64,
          media: prefixedBase64
        }
      },
      {
        name: 'message/sendMediaBase64',
        url: `${evolutionUrl}/message/sendMediaBase64/${userCreds.instance_name}`,
        payload: {
          number: formattedNumber,
          caption: message,
          fileName: normalizedFileName,
          mimetype: mediaData.mimetype,
          base64: rawBase64,
          media: prefixedBase64
        }
      },
      {
        name: 'message/sendMedia',
        url: `${evolutionUrl}/message/sendMedia/${userCreds.instance_name}`,
        payload: {
          number: formattedNumber,
          message,
          caption: message,
          mediatype: isImage ? 'image' : mediaData.mimetype,
          mediaType: isImage ? 'image' : mediaData.mimetype,
          fileName: normalizedFileName,
          filename: normalizedFileName,
          mimetype: mediaData.mimetype,
          base64: rawBase64,
          media: prefixedBase64,
          mediaData: prefixedBase64,
          owned: {
            type: isImage ? 'image' : 'file',
            media: prefixedBase64,
            base64: rawBase64,
            filename: normalizedFileName,
            mimetype: mediaData.mimetype,
            caption: message
          },
          mediaMessage: {
            mediatype: isImage ? 'image' : mediaData.mimetype,
            media: prefixedBase64,
            base64: rawBase64,
            fileName: normalizedFileName,
            mimetype: mediaData.mimetype,
            caption: message
          }
        }
      },
      {
        name: 'message/sendImageBase64',
        url: `${evolutionUrl}/message/sendImageBase64/${userCreds.instance_name}`,
        payload: {
          number: formattedNumber,
          caption: message,
          fileName: normalizedFileName,
          filename: normalizedFileName,
          base64: rawBase64,
          media: prefixedBase64
        }
      }
    ];

    const attemptLogs = [];
    await simulateTypingAction({
      enabled: simulateTypingEnabled,
      evolutionUrl,
      instanceName: userCreds.instance_name,
      apiKey: userCreds.api_key,
      formattedNumber,
      message
    });
    let evolutionResult = null;
    let lastErrorText = null;
    let lastStatus = null;

    for (const attempt of mediaAttempts) {
      try {
        console.log(`🌐 Tentando Evolution endpoint: ${attempt.name}`);
        const response = await fetch(attempt.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': userCreds.api_key
          },
          body: JSON.stringify(attempt.payload),
          timeout: 30000
        });

        lastStatus = response.status;

        if (response.ok) {
          evolutionResult = await response.json();
          attemptLogs.push({ endpoint: attempt.name, status: response.status, success: true });
          console.log(`✅ Evolution aceitou no endpoint ${attempt.name}`);
          break;
        }

        const errorText = await response.text();
        attemptLogs.push({ endpoint: attempt.name, status: response.status, body: errorText });
        console.log(`⚠️ Evolution respondeu ${response.status} em ${attempt.name}:`, errorText);

        lastErrorText = errorText;

        if (response.status === 404) {
          continue; // tentar próximo endpoint
        }

        // Se não for 404, interrompe as tentativas
        break;
      } catch (err) {
        lastErrorText = err.message;
        attemptLogs.push({ endpoint: attempt.name, networkError: err.message });
        console.log(`❌ Erro de rede em ${attempt.name}:`, err.message);
        break;
      }
    }

    console.log('📝 Tentativas Evolution:', attemptLogs);
    cleanupFile();

    if (evolutionResult) {
      const cooldownInfo = registerUserSend(userIdentity);
      // Registrar disparo no BI
      try {
        await supabaseAdmin.from('disparos_log').insert([
          {
            user_id: userCreds.user_id || userIdentity || null,
            departamento: req.session?.userData?.departamento || null,
            numero: formattedNumber,
            mensagem_tamanho: (message || '').length,
            status: 'success'
          }
        ]);
        console.log('✅ Disparo registrado no BI (mídia)');
      } catch (logErr) {
        console.error('❌ Falha ao registrar disparo (send-supabase mídia):', logErr.message, logErr);
      }

      return res.json({
        success: true,
        message: '✅ Mensagem enviada com sucesso!',
        usuario: usuario,
        instancia: userCreds.instance_name,
        messageId: evolutionResult.key?.id,
        mediaEnviada: mediaData.fileName,
        endpointUsado: attemptLogs.find(a => a.success)?.endpoint || null,
        cooldownTriggered: cooldownInfo.cooldownTriggered,
        cooldownUntil: cooldownInfo.cooldownUntil,
        cooldownMinutes: cooldownInfo.cooldownTriggered ? cooldownInfo.cooldownMinutes : null
      });
    }

    // Registrar falha no BI
    try {
      await supabaseAdmin.from('disparos_log').insert([
        {
          user_id: userCreds.user_id || userIdentity || null,
          departamento: req.session?.userData?.departamento || null,
          numero: formattedNumber,
          mensagem_tamanho: (message || '').length,
          status: 'error'
        }
      ]);
      console.log('✅ Falha de disparo registrada no BI (mídia)');
    } catch (logErr) {
      console.error('❌ Falha ao registrar disparo (erro mídia):', logErr.message, logErr);
    }

    return res.status(500).json({
      success: false,
      error: lastStatus ? `❌ Erro ${lastStatus} do Evolution` : '❌ Evolution não respondeu',
      details: lastErrorText,
      tentativas: attemptLogs
    });

  } catch (error) {
    console.log('❌ Erro:', error.message);
    // Registrar falha inesperada no BI
    try {
      await supabaseAdmin.from('disparos_log').insert([
        {
          user_id: userIdentity || null,
          departamento: req.session?.userData?.departamento || null,
          numero: (typeof number !== 'undefined') ? String(number) : null,
          mensagem_tamanho: (message || '').length,
          status: 'error'
        }
      ]);
      console.log('✅ Falha inesperada de disparo registrada no BI');
    } catch (logErr) {
      console.error('❌ Falha ao registrar disparo (erro catch):', logErr.message, logErr);
    }
    cleanupFile();
    res.status(500).json({
      success: false,
      error: '❌ Erro ao processar envio',
      details: error.message
    });
  }
});

// ========== ALERTA DE EMERGÊNCIA ==========
app.post('/api/emergencia/acionar', async (req, res) => {
  try {
    // Verificar autenticação do motorista
    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (authError) {
      return res.status(authError.status || 401).json({ 
        success: false, 
        error: authError.message 
      });
    }

    // Buscar motorista vinculado ao usuário
    const { data: motorista, error: motoristaError } = await supabaseAdmin
      .from('motoristas')
      .select('id, nome, telefone1, telefone2, placa_cavalo, placa_carreta1, placa_carreta2, placa_carreta3')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (motoristaError && motoristaError.code !== 'PGRST116') {
      throw motoristaError;
    }

    if (!motorista) {
      return res.status(400).json({
        success: false,
        error: 'Motorista não encontrado. Complete seu cadastro primeiro.'
      });
    }

    // Buscar coleta vinculada ao motorista
    const { data: coletas, error: coletasError } = await supabaseAdmin
      .from('coletas')
      .select('id, cliente, origem, destino, valor, km, veiculo, status, etapa_atual, prioridade, observacoes')
      .eq('motorista_id', motorista.id)
      .in('status', ['pendente', 'em_andamento'])
      .order('data_recebimento', { ascending: false })
      .limit(1);

    if (coletasError) {
      throw coletasError;
    }

    if (!coletas || coletas.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Você não está vinculado a nenhuma coleta/viagem no momento. Apenas motoristas com coletas ativas podem acionar o alerta de emergência.'
      });
    }

    const coleta = coletas[0];

    // Buscar configuração de usuários para notificações de emergência
    const { data: config, error: configError } = await supabaseAdmin
      .from('configuracoes_sistema')
      .select('valor')
      .eq('chave', 'emergencia_notificacoes')
      .maybeSingle();

    if (configError && configError.code !== 'PGRST116') {
      console.error('❌ Erro ao buscar configuração de emergência:', configError);
      throw configError;
    }

    console.log('📋 Configuração encontrada:', config);
    
    // O valor pode vir como string JSON ou como objeto, dependendo de como foi salvo
    let valorConfig = config?.valor;
    if (typeof valorConfig === 'string') {
      try {
        valorConfig = JSON.parse(valorConfig);
      } catch (e) {
        console.error('❌ Erro ao fazer parse do valor:', e);
        valorConfig = null;
      }
    }
    
    const usuariosNotificar = valorConfig?.usuarios || [];
    
    console.log('👥 Usuários para notificar:', usuariosNotificar);
    console.log('📊 Tipo do valor:', typeof valorConfig);
    console.log('📊 Valor completo:', JSON.stringify(valorConfig, null, 2));
    
    if (!usuariosNotificar || usuariosNotificar.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nenhum usuário configurado para receber notificações de emergência. Configure em Settings > Sistema.'
      });
    }

    // Buscar dados dos usuários que devem receber notificações
    const { data: usuarios, error: usuariosError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, nome, email, telefone, role')
      .in('id', usuariosNotificar)
      .eq('active', true);

    if (usuariosError) {
      throw usuariosError;
    }

    if (!usuarios || usuarios.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Usuários configurados não foram encontrados ou estão inativos.'
      });
    }

    // Montar mensagem de alerta
    const dataHora = new Date().toLocaleString('pt-BR', { 
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'medium'
    });

    let mensagem = `🚨 *ALERTA DE EMERGÊNCIA* 🚨\n\n`;
    mensagem += `*Data/Hora:* ${dataHora}\n\n`;
    mensagem += `*MOTORISTA:*\n`;
    mensagem += `Nome: ${motorista.nome || 'N/A'}\n`;
    mensagem += `Telefone: ${motorista.telefone1 || 'N/A'}\n`;
    if (motorista.telefone2) {
      mensagem += `Telefone 2: ${motorista.telefone2}\n`;
    }
    mensagem += `Placa Cavalo: ${motorista.placa_cavalo || 'N/A'}\n`;
    if (motorista.placa_carreta1) {
      mensagem += `Placa Carreta 1: ${motorista.placa_carreta1}\n`;
    }
    if (motorista.placa_carreta2) {
      mensagem += `Placa Carreta 2: ${motorista.placa_carreta2}\n`;
    }
    if (motorista.placa_carreta3) {
      mensagem += `Placa Carreta 3: ${motorista.placa_carreta3}\n`;
    }
    mensagem += `\n*COLETA/VIAGEM:*\n`;
    mensagem += `Cliente: ${coleta.cliente || 'N/A'}\n`;
    mensagem += `Origem: ${coleta.origem || 'N/A'}\n`;
    mensagem += `Destino: ${coleta.destino || 'N/A'}\n`;
    mensagem += `Status: ${coleta.status || 'N/A'}\n`;
    mensagem += `Etapa: ${coleta.etapa_atual || 'N/A'}\n`;
    if (coleta.observacoes) {
      mensagem += `Observações: ${coleta.observacoes}\n`;
    }
    mensagem += `\n⚠️ *Ação imediata necessária!*`;

    // Enviar mensagem para cada usuário configurado
    const resultados = [];
    let sucessos = 0;
    let falhas = 0;

    for (const usuario of usuarios) {
      if (!usuario.telefone) {
        console.warn(`⚠️ Usuário ${usuario.nome} (${usuario.id}) não tem telefone cadastrado`);
        falhas++;
        resultados.push({
          usuario: usuario.nome,
          telefone: null,
          status: 'erro',
          motivo: 'Telefone não cadastrado'
        });
        continue;
      }

      try {
        // Buscar credenciais da Evolution API do primeiro admin disponível
        const { data: credenciais, error: credError } = await supabaseAdmin
          .from('user_evolution_apis')
          .select('api_url, api_key, instance_name, user_id')
          .eq('active', true)
          .eq('is_valid', true)
          .limit(1)
          .maybeSingle();

        if (credError || !credenciais) {
          throw new Error('Credenciais da Evolution API não disponíveis');
        }

        const telefoneFormatado = formatNumberForEvolution(usuario.telefone);
        const url = `${credenciais.api_url}/message/sendText/${credenciais.instance_name}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': credenciais.api_key
          },
          body: JSON.stringify({
            number: telefoneFormatado,
            text: mensagem
          }),
          timeout: 30000
        });

        if (response.ok) {
          const result = await response.json();
          sucessos++;
          resultados.push({
            usuario: usuario.nome,
            telefone: usuario.telefone,
            status: 'enviado',
            messageId: result.key?.id
          });

          // Registrar no log de disparos
          try {
            await supabaseAdmin.from('disparos_log').insert([{
              user_id: credenciais.user_id,
              departamento: 'Emergência',
              numero: telefoneFormatado,
              mensagem_tamanho: mensagem.length,
              status: 'success'
            }]);
          } catch (logErr) {
            console.warn('⚠️ Erro ao registrar log:', logErr.message);
          }
        } else {
          const errorText = await response.text();
          falhas++;
          resultados.push({
            usuario: usuario.nome,
            telefone: usuario.telefone,
            status: 'erro',
            motivo: `HTTP ${response.status}: ${errorText.substring(0, 100)}`
          });
        }
      } catch (error) {
        console.error(`❌ Erro ao enviar para ${usuario.nome}:`, error);
        falhas++;
        resultados.push({
          usuario: usuario.nome,
          telefone: usuario.telefone,
          status: 'erro',
          motivo: error.message
        });
      }
    }

    // Registrar histórico da emergência
    try {
      await supabaseAdmin.from('historico_coletas').insert([{
        coleta_id: coleta.id,
        usuario: motorista.nome,
        acao: 'Alerta de Emergência Acionado',
        detalhes: JSON.stringify({
          motorista_id: motorista.id,
          usuarios_notificados: resultados.length,
          sucessos,
          falhas
        })
      }]);
    } catch (histErr) {
      console.warn('⚠️ Erro ao registrar histórico:', histErr.message);
    }

    res.json({
      success: true,
      message: `Alerta de emergência acionado! ${sucessos} notificação(ões) enviada(s), ${falhas} falha(s).`,
      resultados,
      total: resultados.length,
      sucessos,
      falhas,
      coleta: {
        id: coleta.id,
        cliente: coleta.cliente,
        origem: coleta.origem,
        destino: coleta.destino
      }
    });

  } catch (error) {
    console.error('❌ Erro ao acionar alerta de emergência:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao acionar alerta de emergência: ' + error.message
    });
  }
});
// ========== ROTAS DE GERENCIAMENTO DE CONTATOS ==========
app.get('/webhook/importar-csv', requireAuth, async (req, res) => {
  console.log('🔄 Iniciando importação do CSV por:', req.session.usuario);
  
  try {
    const csvPath = path.join(__dirname, 'contatos.csv');
    
    if (!fs.existsSync(csvPath)) {
      return res.status(404).json({ 
        success: false, 
        error: 'Arquivo contatos.csv não encontrado' 
      });
    }
    
    const csvText = fs.readFileSync(csvPath, 'utf8');
    const lines = csvText.split('\n').filter(line => line.trim());
    
    const contatos = [];
    const header = lines[0].toLowerCase();
    const hasHeader = header.includes('nome') || header.includes('name');
    const startLine = hasHeader ? 1 : 0;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const parts = line.split(',').map(part => part.trim());
      if (parts.length >= 2) {
        const name = parts[0];
        const number = parts[1];
        const category = parts[2] || 'sider';
        
        if (name && number) {
          contatos.push({ name, number, category });
        }
      }
    }
    
    if (contatos.length === 0) {
      return res.json({ 
        success: false, 
        error: 'Nenhum contato válido encontrado no CSV' 
      });
    }
    
    console.log(`📄 ${req.session.usuario} importando ${contatos.length} contatos`);
    
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      db.run('DELETE FROM contatos', function(err) {
        if (err) {
          console.error('❌ Erro ao limpar contatos:', err);
          db.run('ROLLBACK');
          return res.status(500).json({ 
            success: false, 
            error: 'Erro ao limpar contatos antigos' 
          });
        }
        
        console.log(`🗑️ Contatos antigos removidos: ${this.changes}`);
        
        const stmt = db.prepare('INSERT OR IGNORE INTO contatos (name, number, category) VALUES (?, ?, ?)');
        let inseridos = 0;
        let duplicados = 0;

        contatos.forEach((contato, index) => {
          stmt.run([contato.name, contato.number, contato.category], function(err) {
            if (err) {
              console.error('❌ Erro ao inserir:', err);
              duplicados++;
            } else {
              if (this.changes > 0) {
                inseridos++;
              } else {
                duplicados++;
              }
            }
            
            if (index === contatos.length - 1) {
              stmt.finalize((err) => {
                if (err) {
                  console.error('❌ Erro ao finalizar statement:', err);
                  db.run('ROLLBACK');
                  return res.status(500).json({ 
                    success: false, 
                    error: 'Erro na importação' 
                  });
                }
                
                db.run('COMMIT', (err) => {
                  if (err) {
                    console.error('❌ Erro no commit:', err);
                    return res.status(500).json({ 
                      success: false, 
                      error: 'Erro ao salvar dados' 
                    });
                  }
                  
                  console.log(`📊 Importação concluída: ${inseridos} inseridos, ${duplicados} duplicados/erros`);
                  
                  res.json({
                    success: true,
                    message: 'CSV importado com sucesso',
                    total: contatos.length,
                    inseridos: inseridos,
                    duplicados: duplicados,
                    usuario: req.session.usuario
                  });
                });
              });
            }
          });
        });
      });
    });
    
  } catch (error) {
    console.error('❌ Erro ao importar CSV:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno ao importar CSV: ' + error.message
    });
  }
});

app.get('/webhook/contatos', requireAuth, (req, res) => {
  const categoria = req.query.categoria;
  if (!categoria) {
    return res.status(400).json({ error: 'Parâmetro categoria é necessário' });
  }

  db.all('SELECT id, name, number, category FROM contatos WHERE category = ? ORDER BY name', 
    [categoria], (err, rows) => {
    if (err) {
      console.error('❌ Erro ao buscar contatos:', err);
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/webhook/categorias', requireAuth, (req, res) => {
  db.all('SELECT DISTINCT category FROM contatos ORDER BY category', (err, rows) => {
    if (err) {
      console.error('❌ Erro ao buscar categorias:', err);
      res.status(500).json({ error: err.message });
    } else {
      const categorias = rows.map(row => row.category);
      res.json(categorias);
    }
  });
});

app.post('/webhook/contatos', requireAuth, (req, res) => {
  const { name, number, category } = req.body;
  if (!name || !number || !category) {
    return res.status(400).json({ error: 'Nome, número e categoria são obrigatórios' });
  }

  db.run('INSERT OR IGNORE INTO contatos (name, number, category) VALUES (?, ?, ?)',
    [name, number, category], function(err) {
    if (err) {
      console.error('❌ Erro ao adicionar contato:', err);
      res.status(500).json({ error: err.message });
    } else {
      if (this.changes > 0) {
        res.json({ id: this.lastID, message: 'Contato adicionado com sucesso' });
      } else {
        res.status(409).json({ error: 'Contato já existe' });
      }
    }
  });
});

app.post('/webhook/contatos/lote', requireAuth, async (req, res) => {
  const { contatos } = req.body;
  const usuario = req.session.usuario;
  
  console.log(`📥 ${usuario} importando ${contatos?.length || 0} contatos em lote`);
  
  if (!contatos || !Array.isArray(contatos) || contatos.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Lista de contatos vazia ou inválida'
    });
  }

  try {
    let inseridos = 0;
    let duplicados = 0;
    let erros = 0;

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        const stmt = db.prepare('INSERT OR IGNORE INTO contatos (name, number, category) VALUES (?, ?, ?)');

        contatos.forEach((contato, index) => {
          if (!contato.name || !contato.number) {
            erros++;
            return;
          }

          stmt.run([contato.name, contato.number, contato.category || 'sider'], function(err) {
            if (err) {
              console.error('❌ Erro ao inserir contato:', err);
              erros++;
            } else {
              if (this.changes > 0) {
                inseridos++;
              } else {
                duplicados++;
              }
            }

            if (index === contatos.length - 1) {
              stmt.finalize((err) => {
                if (err) {
                  db.run('ROLLBACK');
                  console.error('❌ Erro ao finalizar statement:', err);
                  reject(err);
                  return;
                }
                
                db.run('COMMIT', (err) => {
                  if (err) {
                    console.error('❌ Erro no commit:', err);
                    reject(err);
                    return;
                  }
                  
                  console.log(`✅ Importação em lote concluída: ${inseridos} inseridos, ${duplicados} duplicados, ${erros} erros`);
                  
                  res.json({
                    success: true,
                    message: 'Contatos importados com sucesso!',
                    total: contatos.length,
                    inseridos: inseridos,
                    duplicados: duplicados,
                    erros: erros
                  });
                  
                  resolve();
                });
              });
            }
          });
        });
      });
    });
    
  } catch (error) {
    console.error('❌ Erro na importação em lote:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno ao importar contatos: ' + error.message
    });
  }
});

app.delete('/webhook/contatos/:id', requireAuth, (req, res) => {
  const contactId = req.params.id;
  console.log('🗑️ Tentando excluir contato ID:', contactId);
  
  db.run('DELETE FROM contatos WHERE id = ?', [contactId], function(err) {
    if (err) {
      console.error('❌ Erro ao excluir:', err);
      res.status(500).json({ error: err.message });
    } else {
      console.log('✅ Contato excluído, changes:', this.changes);
      if (this.changes > 0) {
        res.json({ message: 'Contato excluído com sucesso' });
      } else {
        res.status(404).json({ error: 'Contato não encontrado' });
      }
    }
  });
});

app.delete('/webhook/limpar-contatos', requireAuth, (req, res) => {
  console.log('🗑️ Limpando TODOS os contatos do banco...');
  
  db.run('DELETE FROM contatos', function(err) {
    if (err) {
      console.error('❌ Erro ao limpar contatos:', err);
      res.status(500).json({ error: err.message });
    } else {
      console.log('✅ Contatos apagados:', this.changes);
      res.json({ 
        success: true,
        message: 'Todos os contatos foram apagados',
        contatos_apagados: this.changes
      });
    }
  });
});

// ========== SISTEMA DE COLETAS COM SUPABASE ==========
app.get('/api/coletas', requireAuth, async (req, res) => {
  try {
    console.log('🔍 Buscando coletas no Supabase para:', req.session.usuario);
    
    const { data, error } = await supabase
      .from('coletas')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Erro no Supabase:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log(`✅ ${data?.length || 0} coletas encontradas`);
    res.json(data || []);
    
  } catch (error) {
    console.error('❌ Erro interno:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/coletas', requireAuth, async (req, res) => {
  try {
    const coletaData = req.body;
    console.log('➕ Criando coleta para:', req.session.usuario);

    // Validação dos dados obrigatórios
    const camposObrigatorios = ['filial', 'cliente', 'dataRecebimento', 'origem', 'destino'];
    const camposFaltando = camposObrigatorios.filter(campo => !coletaData[campo]);
    
    if (camposFaltando.length > 0) {
      return res.status(400).json({ 
        error: 'Campos obrigatórios faltando', 
        campos: camposFaltando 
      });
    }

    // Validação de tipos de dados
    if (coletaData.km && isNaN(parseFloat(coletaData.km))) {
      return res.status(400).json({ error: 'KM deve ser um número válido' });
    }

    if (coletaData.valor && isNaN(parseFloat(coletaData.valor))) {
      return res.status(400).json({ error: 'Valor deve ser um número válido' });
    }

    // Validação de data
    if (coletaData.dataRecebimento) {
      const dataRecebimento = new Date(coletaData.dataRecebimento);
      if (isNaN(dataRecebimento.getTime())) {
        return res.status(400).json({ error: 'Data de recebimento inválida' });
      }
    }

    const coletaId = `COL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const novaColeta = {
      id: coletaId,
      filial: coletaData.filial?.trim(),
      cliente: coletaData.cliente?.trim(),
      dataRecebimento: coletaData.dataRecebimento,
      origem: coletaData.origem?.trim(),
      destino: coletaData.destino?.trim(),
      km: coletaData.km ? parseFloat(coletaData.km) : null,
      veiculo: coletaData.veiculo?.trim() || '',
      status: coletaData.status || 'pendente',
      etapaAtual: coletaData.etapaAtual || 'comercial',
      valor: coletaData.valor ? parseFloat(coletaData.valor) : null,
      observacoes: coletaData.observacoes?.trim() || '',
      usuario_criador: req.session.usuario,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('coletas')
      .insert([novaColeta])
      .select();

    if (error) {
      console.error('❌ Erro ao criar coleta:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('✅ Coleta criada com ID:', data[0].id);
    res.json(data[0]);
    
  } catch (error) {
    console.error('❌ Erro interno:', error);
    res.status(500).json({ error: 'Erro ao criar coleta' });
  }
});

app.put('/api/coletas/:id', requireAuth, async (req, res) => {
  try {
    const coletaId = req.params.id;
    const coletaData = req.body;
    
    console.log('✏️ Atualizando coleta:', coletaId);

    // Validação de tipos de dados
    if (coletaData.km && isNaN(parseFloat(coletaData.km))) {
      return res.status(400).json({ error: 'KM deve ser um número válido' });
    }

    if (coletaData.valor && isNaN(parseFloat(coletaData.valor))) {
      return res.status(400).json({ error: 'Valor deve ser um número válido' });
    }

    // Validação de data
    if (coletaData.dataRecebimento) {
      const dataRecebimento = new Date(coletaData.dataRecebimento);
      if (isNaN(dataRecebimento.getTime())) {
        return res.status(400).json({ error: 'Data de recebimento inválida' });
      }
    }

    // Preparar dados para atualização
    const updateData = {
      updated_at: new Date().toISOString()
    };

    // Campos permitidos para atualização
    const camposPermitidos = [
      'filial', 'cliente', 'dataRecebimento', 'origem', 'destino',
      'km', 'veiculo', 'status', 'etapaAtual', 'valor', 'observacoes'
    ];

    camposPermitidos.forEach(campo => {
      if (coletaData[campo] !== undefined) {
        if (campo === 'km' || campo === 'valor') {
          updateData[campo] = coletaData[campo] ? parseFloat(coletaData[campo]) : null;
        } else {
          updateData[campo] = typeof coletaData[campo] === 'string' 
            ? coletaData[campo].trim() 
            : coletaData[campo];
        }
      }
    });

    const { data, error } = await supabase
      .from('coletas')
      .update(updateData)
      .eq('id', coletaId)
      .select();

    if (error) {
      console.error('❌ Erro ao atualizar coleta:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Coleta não encontrada' });
    }

    console.log('✅ Coleta atualizada:', coletaId);
    res.json(data[0]);
    
  } catch (error) {
    console.error('❌ Erro interno:', error);
    res.status(500).json({ error: 'Erro ao atualizar coleta' });
  }
});

app.delete('/api/coletas/:id', requireAuth, async (req, res) => {
  try {
    if (req.session.usuario !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem excluir coletas' });
    }

    const coletaId = req.params.id;
    console.log('🗑️ Excluindo coleta:', coletaId);

    const { error } = await supabase
      .from('coletas')
      .delete()
      .eq('id', coletaId);

    if (error) {
      console.error('❌ Erro ao excluir coleta:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('✅ Coleta excluída:', coletaId);
    res.json({ success: true, message: 'Coleta excluída com sucesso' });
    
  } catch (error) {
    console.error('❌ Erro interno:', error);
    res.status(500).json({ error: 'Erro ao excluir coleta' });
  }
});

// ========== ENDPOINTS AVANÇADOS PARA COLETAS ==========

// Busca avançada com filtros
app.get('/api/coletas/busca', requireAuth, async (req, res) => {
  try {
    const { 
      filial, 
      cliente, 
      status, 
      etapaAtual, 
      dataInicio, 
      dataFim, 
      origem, 
      destino,
      busca,
      pagina = 1,
      limite = 50
    } = req.query;

    console.log('🔍 Busca avançada de coletas:', req.query);

    let query = supabase
      .from('coletas')
      .select('*', { count: 'exact' });

    // Aplicar filtros
    if (filial) query = query.eq('filial', filial);
    if (cliente) query = query.ilike('cliente', `%${cliente}%`);
    if (status) query = query.eq('status', status);
    if (etapaAtual) query = query.eq('etapaAtual', etapaAtual);
    if (origem) query = query.ilike('origem', `%${origem}%`);
    if (destino) query = query.ilike('destino', `%${destino}%`);

    // Filtro de data
    if (dataInicio) {
      query = query.gte('dataRecebimento', dataInicio);
    }
    if (dataFim) {
      query = query.lte('dataRecebimento', dataFim);
    }

    // Busca geral
    if (busca) {
      query = query.or(`cliente.ilike.%${busca}%,origem.ilike.%${busca}%,destino.ilike.%${busca}%,observacoes.ilike.%${busca}%`);
    }

    // Paginação
    const offset = (pagina - 1) * limite;
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limite - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('❌ Erro na busca:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log(`✅ ${data?.length || 0} coletas encontradas (total: ${count})`);

    res.json({
      coletas: data || [],
      paginacao: {
        pagina: parseInt(pagina),
        limite: parseInt(limite),
        total: count || 0,
        totalPaginas: Math.ceil((count || 0) / limite)
      }
    });

  } catch (error) {
    console.error('❌ Erro interno na busca:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Estatísticas das coletas
app.get('/api/coletas/estatisticas', requireAuth, async (req, res) => {
  try {
    console.log('📊 Gerando estatísticas de coletas...');

    // Total de coletas
    const { count: totalColetas, error: totalError } = await supabase
      .from('coletas')
      .select('*', { count: 'exact', head: true });

    if (totalError) throw totalError;

    // Coletas por status
    const { data: statusData, error: statusError } = await supabase
      .from('coletas')
      .select('status')
      .not('status', 'is', null);

    if (statusError) throw statusError;

    const statusCount = {};
    statusData.forEach(coleta => {
      statusCount[coleta.status] = (statusCount[coleta.status] || 0) + 1;
    });

    // Coletas por etapa
    const { data: etapaData, error: etapaError } = await supabase
      .from('coletas')
      .select('etapaAtual')
      .not('etapaAtual', 'is', null);

    if (etapaError) throw etapaError;

    const etapaCount = {};
    etapaData.forEach(coleta => {
      etapaCount[coleta.etapaAtual] = (etapaCount[coleta.etapaAtual] || 0) + 1;
    });

    // Coletas por filial
    const { data: filialData, error: filialError } = await supabase
      .from('coletas')
      .select('filial')
      .not('filial', 'is', null);

    if (filialError) throw filialError;

    const filialCount = {};
    filialData.forEach(coleta => {
      filialCount[coleta.filial] = (filialCount[coleta.filial] || 0) + 1;
    });

    // Valor total das coletas
    const { data: valorData, error: valorError } = await supabase
      .from('coletas')
      .select('valor')
      .not('valor', 'is', null);

    if (valorError) throw valorError;

    const valorTotal = valorData.reduce((total, coleta) => total + (coleta.valor || 0), 0);

    // KM total
    const { data: kmData, error: kmError } = await supabase
      .from('coletas')
      .select('km')
      .not('km', 'is', null);

    if (kmError) throw kmError;

    const kmTotal = kmData.reduce((total, coleta) => total + (coleta.km || 0), 0);

    const estatisticas = {
      totalColetas: totalColetas || 0,
      porStatus: statusCount,
      porEtapa: etapaCount,
      porFilial: filialCount,
      valorTotal: valorTotal,
      kmTotal: kmTotal,
      valorMedio: totalColetas > 0 ? valorTotal / totalColetas : 0,
      kmMedio: totalColetas > 0 ? kmTotal / totalColetas : 0
    };

    console.log('✅ Estatísticas geradas:', estatisticas);
    res.json(estatisticas);

  } catch (error) {
    console.error('❌ Erro ao gerar estatísticas:', error);
    res.status(500).json({ error: 'Erro ao gerar estatísticas' });
  }
});

// Exportar coletas para CSV
app.get('/api/coletas/exportar', requireAuth, async (req, res) => {
  try {
    const { formato = 'csv' } = req.query;
    
    console.log('📤 Exportando coletas...');

    const { data: coletas, error } = await supabase
      .from('coletas')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (formato === 'csv') {
      // Gerar CSV
      const headers = [
        'ID', 'Filial', 'Cliente', 'Data Recebimento', 'Origem', 'Destino',
        'KM', 'Veículo', 'Status', 'Etapa Atual', 'Valor', 'Observações',
        'Usuário Criador', 'Data Criação', 'Data Atualização'
      ];

      const csvRows = [headers.join(',')];

      coletas.forEach(coleta => {
        const row = [
          coleta.id,
          `"${coleta.filial || ''}"`,
          `"${coleta.cliente || ''}"`,
          coleta.dataRecebimento || '',
          `"${coleta.origem || ''}"`,
          `"${coleta.destino || ''}"`,
          coleta.km || '',
          `"${coleta.veiculo || ''}"`,
          coleta.status || '',
          coleta.etapaAtual || '',
          coleta.valor || '',
          `"${coleta.observacoes || ''}"`,
          coleta.usuario_criador || '',
          coleta.created_at || '',
          coleta.updated_at || ''
        ];
        csvRows.push(row.join(','));
      });

      const csv = csvRows.join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="coletas_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } else {
      res.json(coletas);
    }

    console.log(`✅ ${coletas.length} coletas exportadas`);

  } catch (error) {
    console.error('❌ Erro ao exportar:', error);
    res.status(500).json({ error: 'Erro ao exportar coletas' });
  }
});
// ========== ENDPOINTS PARA ANEXOS ==========
// Upload de anexos
app.post('/api/anexos', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const { coleta_id, usuario } = req.body;
    
    if (!coleta_id) {
      return res.status(400).json({ error: 'ID da coleta é obrigatório' });
    }

    console.log('📎 Upload de anexo:', req.file.originalname);
    const sanitizedName = sanitizeFilename(req.file.originalname);
    const fileExt = path.extname(sanitizedName) || '';
    const uniqueName = `${Date.now()}-${generateId()}`;
    const storagePath = `coletas/${coleta_id}/anexos/${uniqueName}${fileExt}`;
    const uploadOptions = {
      contentType: req.file.mimetype || 'application/octet-stream',
      cacheControl: '3600',
      upsert: false
    };

    try {
      if (!req.file.buffer) {
        throw new Error('Falha ao processar arquivo recebido.');
      }

      if (!req.file.buffer) {
        throw new Error('Falha ao processar arquivo recebido.');
      }

      const fileBuffer = req.file.buffer;

      const { error: storageError } = await supabaseAdmin.storage
        .from(ANEXOS_BUCKET)
        .upload(storagePath, fileBuffer, uploadOptions);

      if (storageError) {
        throw storageError;
      }

      const storageUrl = buildStorageUrl(ANEXOS_BUCKET, storagePath);

      const { data, error } = await supabase
        .from('anexos')
        .insert([{
          id: generateUUID(),
          coleta_id: coleta_id,
          nome_arquivo: req.file.originalname,
          tipo_arquivo: req.file.mimetype,
          tamanho: req.file.size,
          url: storageUrl
        }])
        .select();

      if (error) {
        await supabaseAdmin.storage
          .from(ANEXOS_BUCKET)
          .remove([storagePath])
          .catch(() => {});
        throw error;
      }

      const anexoInserido = data && data[0] ? data[0] : null;
      const anexoComUrl = await injectSignedUrl(anexoInserido);

      if (anexoComUrl) {
        console.log('✅ Anexo salvo:', anexoComUrl.id);
      }

      return res.json({ success: true, anexo: anexoComUrl });
    } catch (error) {
      console.error('❌ Erro no upload:', error);
      return res.status(500).json({ error: 'Erro ao fazer upload do arquivo' });
    }

  } catch (error) {
    console.error('❌ Erro inesperado no upload:', error);
    res.status(500).json({ error: 'Erro ao fazer upload do arquivo' });
  }
});

app.get('/api/anexos/:id/info', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('anexos')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ success: false, error: 'Anexo não encontrado' });
    }

    const anexoComUrl = await injectSignedUrl(data);

    res.json({ success: true, anexo: anexoComUrl });
  } catch (error) {
    console.error('❌ Erro ao buscar anexo:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar anexo' });
  }
});

// Download de anexos
app.get('/api/anexos/:id/download', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('📥 Download de anexo:', id);

    const { data, error } = await supabase
      .from('anexos')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'Anexo não encontrado' });
    }

    const anexoComUrl = await injectSignedUrl(data);

    if (anexoComUrl?.url) {
      return res.redirect(anexoComUrl.url);
    }

    let filePath = anexoComUrl?.caminho_arquivo || null;

    if (!filePath && data.url && !data.url.startsWith(STORAGE_URL_PREFIX)) {
      try {
        let relativePath = data.url;
        if (data.url.startsWith('http://') || data.url.startsWith('https://')) {
          relativePath = data.url.replace(APP_BASE_URL, '');
        }
        relativePath = relativePath.replace(/^\//, '');
        filePath = path.join(__dirname, relativePath);
      } catch (err) {
        console.warn('⚠️ Não foi possível determinar caminho local do anexo:', err.message || err);
      }
    }

    if (filePath && fs.existsSync(filePath)) {
      return res.download(filePath, data.nome_arquivo);
    }

    if (data.url && !data.url.startsWith(STORAGE_URL_PREFIX)) {
      return res.redirect(data.url);
    }

    return res.status(404).json({ error: 'Arquivo não encontrado' });

  } catch (error) {
    console.error('❌ Erro no download:', error);
    res.status(500).json({ error: 'Erro ao baixar arquivo' });
  }
});

// Listar anexos de uma coleta
app.get('/api/anexos/coleta/:coleta_id', requireAuth, async (req, res) => {
  try {
    const { coleta_id } = req.params;
    
    console.log('📋 Listando anexos da coleta:', coleta_id);

    const { data, error } = await supabase
      .from('anexos')
      .select('*')
      .eq('coleta_id', coleta_id);

    if (error) throw error;

    const anexosOrdenados = (data || []).slice().sort((a, b) => {
      const dataB = b?.created_at || b?.data_upload || null;
      const dataA = a?.created_at || a?.data_upload || null;

      if (dataA && dataB) {
        return new Date(dataB).getTime() - new Date(dataA).getTime();
      }

      if (dataB) return 1;
      if (dataA) return -1;

      return 0;
    });

    const anexos = await injectSignedUrls(anexosOrdenados);

    res.json({ success: true, anexos });

  } catch (error) {
    console.error('❌ Erro ao listar anexos:', error);
    res.status(500).json({ error: 'Erro ao listar anexos' });
  }
});

// Excluir anexo
app.delete('/api/anexos/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🗑️ Excluindo anexo:', id);

    // Buscar informações do anexo
    const { data: anexo, error: fetchError } = await supabase
      .from('anexos')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    if (!anexo) {
      return res.status(404).json({ error: 'Anexo não encontrado' });
    }

    // Excluir do Supabase
    const { error: deleteError } = await supabase
      .from('anexos')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    // Excluir arquivo físico / storage
    const storageInfo = parseStorageUrl(anexo.url);

    if (storageInfo) {
      await supabaseAdmin.storage
        .from(storageInfo.bucket)
        .remove([storageInfo.path])
        .catch((removeError) => {
          console.warn('⚠️ Falha ao remover arquivo do storage:', removeError.message || removeError);
        });
    } else if (anexo.caminho_arquivo && fs.existsSync(anexo.caminho_arquivo)) {
      fs.unlinkSync(anexo.caminho_arquivo);
    } else if (anexo.url && !anexo.url.startsWith('http://') && !anexo.url.startsWith('https://')) {
      const relativePath = anexo.url.replace(/^\//, '');
      const localPath = path.join(__dirname, relativePath);
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
      }
    }

    console.log('✅ Anexo excluído:', id);
    res.json({ success: true });

  } catch (error) {
    console.error('❌ Erro ao excluir anexo:', error);
    res.status(500).json({ error: 'Erro ao excluir anexo' });
  }
});

// ========== ENDPOINTS PARA CHAT ==========

// Enviar mensagem no chat
app.post('/api/chat/mensagem', requireAuth, async (req, res) => {
  try {
    const { coleta_id, mensagem } = req.body;
    
    if (!coleta_id || !mensagem) {
      return res.status(400).json({ error: 'Coleta ID e mensagem são obrigatórios' });
    }

    console.log('💬 Nova mensagem no chat da coleta:', coleta_id);

    const { data, error } = await supabase
      .from('chat_mensagens')
      .insert([{
        coleta_id: coleta_id,
        usuario: req.session.usuario,
        mensagem: mensagem.trim()
      }])
      .select();

    if (error) throw error;

    console.log('✅ Mensagem enviada:', data[0].id);
    res.json({ success: true, mensagem: data[0] });

  } catch (error) {
    console.error('❌ Erro ao enviar mensagem:', error);
    res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
});

// Listar mensagens do chat
app.get('/api/chat/coleta/:coleta_id', requireAuth, async (req, res) => {
  try {
    const { coleta_id } = req.params;
    
    console.log('📋 Listando mensagens da coleta:', coleta_id);

    const { data, error } = await supabase
      .from('chat_mensagens')
      .select('*')
      .eq('coleta_id', coleta_id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({ success: true, mensagens: data || [] });

  } catch (error) {
    console.error('❌ Erro ao listar mensagens:', error);
    res.status(500).json({ error: 'Erro ao listar mensagens' });
  }
});

// ========== ENDPOINTS PARA CONTATO COMERCIAL ==========

// Salvar mensagem de contato
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, phone, company, message } = req.body;
    
    if (!name || !email || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nome, email e mensagem são obrigatórios' 
      });
    }

    console.log('📧 Nova mensagem de contato:', { name, email, phone, company });

    // Salvar no Supabase (se disponível) ou em arquivo local
    try {
      // 1. Salvar mensagem na tabela de mensagens_contato (compatibilidade)
      const { data: messageData, error: messageError } = await supabase
        .from('mensagens_contato')
        .insert([{
          nome: name,
          email: email,
          telefone: phone || null,
          mensagem: message,
          status: 'nova',
          created_at: new Date().toISOString()
        }])
        .select();

      if (messageError) {
        console.warn('⚠️ Erro ao salvar mensagem:', messageError);
      } else {
        console.log('✅ Mensagem salva no Supabase:', messageData[0]?.id);
      }

      // 2. Criar lead no CRM
      const { data: leadData, error: leadError } = await supabase
        .from('leads')
        .insert([{
          nome_completo: name,
          email: email,
          telefone: phone || null,
          empresa: company || null,
          mensagem: message,
          origem: 'site',
          status: 'novo',
          score: 10, // Score inicial baseado na origem (site)
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select();

      if (leadError) {
        console.warn('⚠️ Erro ao criar lead no CRM:', leadError);
        // Não falha a requisição se apenas o lead não foi criado
      } else {
        console.log('✅ Lead criado no CRM:', leadData[0]?.id);
      }

      res.json({ success: true, message: 'Mensagem enviada com sucesso! Entraremos em contato em breve.' });

    } catch (supabaseError) {
      console.log('⚠️ Supabase não disponível, salvando localmente');
      
      // Fallback: salvar em arquivo local
      const fs = require('fs');
      const messagesFile = './mensagens_contato.json';
      
      let messages = [];
      if (fs.existsSync(messagesFile)) {
        messages = JSON.parse(fs.readFileSync(messagesFile, 'utf8'));
      }
      
      const newMessage = {
        id: Date.now().toString(),
        nome: name,
        email: email,
        telefone: phone || null,
        mensagem: message,
        status: 'nova',
        created_at: new Date().toISOString()
      };
      
      messages.push(newMessage);
      fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));
      
      console.log('✅ Mensagem salva localmente:', newMessage.id);
      res.json({ success: true, message: 'Mensagem enviada com sucesso!' });
    }

  } catch (error) {
    console.error('❌ Erro ao salvar mensagem:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// Listar mensagens de contato
app.get('/api/contact/messages', async (req, res) => {
  try {
    console.log('📋 Listando mensagens de contato...');

    try {
      const { data, error } = await supabase
        .from('mensagens_contato')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      console.log(`✅ ${data?.length || 0} mensagens encontradas no Supabase`);
      res.json({ success: true, messages: data || [] });

    } catch (supabaseError) {
      console.log('⚠️ Supabase não disponível, carregando localmente');
      
      // Fallback: carregar de arquivo local
      const fs = require('fs');
      const messagesFile = './mensagens_contato.json';
      
      let messages = [];
      if (fs.existsSync(messagesFile)) {
        messages = JSON.parse(fs.readFileSync(messagesFile, 'utf8'));
      }
      
      console.log(`✅ ${messages.length} mensagens encontradas localmente`);
      res.json({ success: true, messages: messages });
    }

  } catch (error) {
    console.error('❌ Erro ao carregar mensagens:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// ========== ENDPOINTS PARA CONFIGURAÇÕES DO SISTEMA ==========

// Obter configurações do sistema
app.get('/api/configuracoes-sistema', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('configuracoes_sistema')
            .select('*');

        if (error) throw error;

        const configuracoes = {};
        data.forEach(config => {
            configuracoes[config.chave] = config.valor;
        });

        res.json({ success: true, configuracoes });
    } catch (error) {
        console.error('❌ Erro ao obter configurações:', error);
        res.status(500).json({ error: 'Erro ao obter configurações' });
    }
});

// Salvar configurações do sistema
app.post('/api/configuracoes-sistema', requireAuth, async (req, res) => {
    try {
        if (req.session.usuario !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores podem alterar configurações' });
        }

        const { configuracoes } = req.body;

        for (const [chave, valor] of Object.entries(configuracoes)) {
            const { error } = await supabase
                .from('configuracoes_sistema')
                .upsert({
                    chave: chave,
                    valor: valor,
                    updated_at: new Date().toISOString()
                });

            if (error) throw error;
        }

        res.json({ success: true, message: 'Configurações salvas com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao salvar configurações:', error);
        res.status(500).json({ error: 'Erro ao salvar configurações' });
    }
});

// ========== ENDPOINTS PARA PERMISSÕES DE USUÁRIO ==========

// Obter permissões de um usuário
app.get('/api/usuario-permissoes/:usuario', requireAuth, async (req, res) => {
    try {
        const { usuario } = req.params;

        const { data, error } = await supabase
            .from('usuario_permissoes')
            .select('etapa')
            .eq('usuario', usuario);

        if (error) throw error;

        const permissoes = data.map(p => p.etapa);
        res.json({ success: true, permissoes });
    } catch (error) {
        console.error('❌ Erro ao obter permissões:', error);
        res.status(500).json({ error: 'Erro ao obter permissões' });
    }
});

// Salvar permissões de um usuário
app.post('/api/usuario-permissoes/:usuario', requireAuth, async (req, res) => {
    try {
        if (req.session.usuario !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores podem alterar permissões' });
        }

        const { usuario } = req.params;
        const { etapas } = req.body;

        // Remover permissões existentes
        const { error: deleteError } = await supabase
            .from('usuario_permissoes')
            .delete()
            .eq('usuario', usuario);

        if (deleteError) throw deleteError;

        // Adicionar novas permissões
        if (etapas && etapas.length > 0) {
            const permissoes = etapas.map(etapa => ({
                usuario: usuario,
                etapa: etapa,
                created_at: new Date().toISOString()
            }));

            const { error: insertError } = await supabase
                .from('usuario_permissoes')
                .insert(permissoes);

            if (insertError) throw insertError;
        }

        res.json({ success: true, message: 'Permissões salvas com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao salvar permissões:', error);
        res.status(500).json({ error: 'Erro ao salvar permissões' });
    }
});

// Obter todas as permissões
app.get('/api/todas-permissoes', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('usuario_permissoes')
            .select('usuario, etapa')
            .order('usuario');

        if (error) throw error;

        const permissoes = {};
        data.forEach(p => {
            if (!permissoes[p.usuario]) {
                permissoes[p.usuario] = [];
            }
            permissoes[p.usuario].push(p.etapa);
        });

        res.json({ success: true, permissoes });
    } catch (error) {
        console.error('❌ Erro ao obter permissões:', error);
        res.status(500).json({ error: 'Erro ao obter permissões' });
    }
});

// ========== ENDPOINTS PARA RELATÓRIOS ==========

// Obter dados para relatórios
app.get('/api/relatorio-dados', requireAuth, async (req, res) => {
    try {
        const { dataInicio, dataFim, usuario } = req.query;

        let query = supabase
            .from('coletas')
            .select('*')
            .gte('created_at', dataInicio)
            .lte('created_at', dataFim + 'T23:59:59');

        if (usuario) {
            query = query.eq('usuario_criador', usuario);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ success: true, dados: data || [] });
    } catch (error) {
        console.error('❌ Erro ao obter dados do relatório:', error);
        res.status(500).json({ error: 'Erro ao obter dados do relatório' });
    }
});

// ========== RELATÓRIOS: MOTORISTAS (KPIs e Séries) ==========
app.get('/api/relatorios/motoristas/filtros', async (req, res) => {
  try {
    const { data: mot, error: motErr } = await supabaseAdmin
      .from('motoristas')
      .select('created_by, created_by_departamento')
      .not('created_by', 'is', null);
    if (motErr) throw motErr;
    const ids = Array.from(new Set((mot || []).map(m => m.created_by)));
    // Departamentos diretos dos registros (quando já gravados no cadastro)
    const departamentosDiretos = new Set((mot || [])
      .map(m => m.created_by_departamento)
      .filter(Boolean));
    let usuarios = [];
    if (ids.length) {
      const { data: perfis, error: perfErr } = await supabaseAdmin
        .from('user_profiles')
        .select('id, nome, departamento')
        .in('id', ids);
      if (perfErr) throw perfErr;
      usuarios = perfis || [];
    }
    const departamentosViaPerfil = new Set(usuarios.map(u => u.departamento).filter(Boolean));
    const departamentos = Array.from(new Set([ ...departamentosDiretos, ...departamentosViaPerfil ]));
    res.json({ usuarios, departamentos });
  } catch (error) {
    console.error('❌ Erro filtros motoristas:', error);
    res.status(500).json({ error: 'Erro ao carregar filtros' });
  }
});

app.get('/api/relatorios/motoristas/kpis', async (req, res) => {
  try {
    const { inicio, fim, usuarioId, departamento } = req.query;
    let query = supabaseAdmin.from('motoristas').select('id, created_by, created_by_departamento, data_cadastro');
    if (inicio) query = query.gte('data_cadastro', inicio);
    if (fim) query = query.lte('data_cadastro', fim);
    if (usuarioId) query = query.eq('created_by', usuarioId);
    if (departamento) query = query.eq('created_by_departamento', departamento);
    const { data: motoristas, error } = await query;
    if (error) throw error;
    const porUsuario = new Map();
    const userIds = new Set();
    (motoristas || []).forEach(m => { if (m.created_by) { userIds.add(m.created_by); porUsuario.set(m.created_by, (porUsuario.get(m.created_by) || 0) + 1); } });
    let idToPerfil = new Map();
    if (userIds.size) {
      const { data: perf } = await supabaseAdmin
        .from('user_profiles')
        .select('id, departamento')
        .in('id', Array.from(userIds));
      idToPerfil = new Map((perf || []).map(p => [p.id, p]));
    }
    const porDept = new Map();
    porUsuario.forEach((count, uid) => {
      // Preferir departamento salvo no registro; se não houver, usar perfil
      const depDireto = (motoristas || []).find(m => m.created_by === uid && m.created_by_departamento)?.created_by_departamento;
      const dep = depDireto || idToPerfil.get(uid)?.departamento || 'Sem Dep.';
      if (departamento && dep !== departamento) return;
      porDept.set(dep, (porDept.get(dep) || 0) + count);
    });
    res.json({ total: (motoristas || []).length, usuarios: porUsuario.size, departamentos: porDept.size });
  } catch (error) {
    console.error('❌ Erro KPIs motoristas:', error);
    res.status(500).json({ error: 'Erro ao carregar KPIs' });
  }
});

app.get('/api/relatorios/motoristas/series', async (req, res) => {
  try {
    const { inicio, fim, usuarioId, departamento } = req.query;
    let query = supabaseAdmin.from('motoristas').select('id, created_by, created_by_departamento, data_cadastro');
    if (inicio) query = query.gte('data_cadastro', inicio);
    if (fim) query = query.lte('data_cadastro', fim);
    if (usuarioId) query = query.eq('created_by', usuarioId);
    if (departamento) query = query.eq('created_by_departamento', departamento);
    const { data: motoristas, error } = await query;
    if (error) throw error;
    const porUsuario = new Map();
    const userIds = new Set();
    (motoristas || []).forEach(m => { if (m.created_by) { userIds.add(m.created_by); porUsuario.set(m.created_by, (porUsuario.get(m.created_by) || 0) + 1); } });
    let idToPerfil = new Map();
    if (userIds.size) {
      const { data: perf } = await supabaseAdmin
        .from('user_profiles')
        .select('id, nome, departamento')
        .in('id', Array.from(userIds));
      idToPerfil = new Map((perf || []).map(p => [p.id, p]));
    }
    const byUser = Array.from(porUsuario.entries()).map(([uid, count]) => ({
      usuarioId: uid, nome: idToPerfil.get(uid)?.nome || uid, count
    }));
    const porDept = new Map();
    byUser.forEach(u => {
      const depDireto = (motoristas || []).find(m => m.created_by === u.usuarioId && m.created_by_departamento)?.created_by_departamento;
      const dep = depDireto || idToPerfil.get(u.usuarioId)?.departamento || 'Sem Dep.';
      if (departamento && dep !== departamento) return;
      porDept.set(dep, (porDept.get(dep) || 0) + u.count);
    });
    const byDepartment = Array.from(porDept.entries()).map(([dep, count]) => ({ departamento: dep, count }));
    const porDia = new Map();
    (motoristas || []).forEach(m => {
      const d = m.data_cadastro ? new Date(m.data_cadastro) : null;
      if (!d) return;
      const key = d.toISOString().slice(0, 10);
      porDia.set(key, (porDia.get(key) || 0) + 1);
    });
    const byDay = Array.from(porDia.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));
    res.json({ byUser, byDepartment, byDay });
  } catch (error) {
    console.error('❌ Erro séries motoristas:', error);
    res.status(500).json({ error: 'Erro ao carregar séries' });
  }
});

// ========== RELATÓRIOS: DISPAROS (KPIs e Séries) ==========
app.get('/api/relatorios/disparos/filtros', async (req, res) => {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from('disparos_log')
      .select('user_id, departamento');
    if (error) throw error;
    const userIds = Array.from(new Set((rows || []).map(r => r.user_id).filter(Boolean)));
    const departamentosDiretos = Array.from(new Set((rows || []).map(r => r.departamento).filter(Boolean)));
    let usuarios = [];
    if (userIds.length) {
      const { data: perfis, error: perfErr } = await supabaseAdmin
        .from('user_profiles')
        .select('id, nome, departamento')
        .in('id', userIds);
      if (perfErr) throw perfErr;
      usuarios = perfis || [];
    }
    const departamentosViaPerfil = new Set(usuarios.map(u => u.departamento).filter(Boolean));
    const departamentos = Array.from(new Set([ ...departamentosDiretos, ...departamentosViaPerfil ]));
    res.json({ usuarios, departamentos });
  } catch (e) {
    console.error('❌ Erro filtros disparos:', e);
    res.status(500).json({ error: 'Erro ao carregar filtros de disparos' });
  }
});

app.get('/api/relatorios/disparos/kpis', async (req, res) => {
  try {
    const { inicio, fim, usuarioId, departamento } = req.query;
    let query = supabaseAdmin.from('disparos_log').select('user_id, departamento, created_at');
    if (inicio) query = query.gte('created_at', inicio);
    if (fim) query = query.lte('created_at', fim);
    if (usuarioId) query = query.eq('user_id', usuarioId);
    if (departamento) query = query.eq('departamento', departamento);
    const { data: logs, error } = await query;
    if (error) throw error;
    const total = (logs || []).length;
    const usuariosSet = new Set((logs || []).map(l => l.user_id).filter(Boolean));
    const departamentosSet = new Set((logs || []).map(l => l.departamento).filter(Boolean));
    // Caso não haja departamento salvo, tentar buscar via perfil
    if (!departamento && departamentosSet.size === 0 && usuariosSet.size) {
      const { data: perfis } = await supabaseAdmin
        .from('user_profiles')
        .select('id, departamento')
        .in('id', Array.from(usuariosSet));
      (perfis || []).forEach(p => { if (p.departamento) departamentosSet.add(p.departamento); });
    }
    res.json({ total, usuarios: usuariosSet.size, departamentos: departamentosSet.size });
  } catch (e) {
    console.error('❌ Erro KPIs disparos:', e);
    res.status(500).json({ error: 'Erro ao carregar KPIs de disparos' });
  }
});
app.get('/api/relatorios/disparos/series', async (req, res) => {
  try {
    const { inicio, fim, usuarioId, departamento } = req.query;
    let query = supabaseAdmin.from('disparos_log').select('user_id, departamento, created_at');
    if (inicio) query = query.gte('created_at', inicio);
    if (fim) query = query.lte('created_at', fim);
    if (usuarioId) query = query.eq('user_id', usuarioId);
    if (departamento) query = query.eq('departamento', departamento);
    const { data: logs, error } = await query;
    if (error) throw error;
    const porUsuario = new Map();
    const userIds = new Set();
    (logs || []).forEach(l => { if (l.user_id) { userIds.add(l.user_id); porUsuario.set(l.user_id, (porUsuario.get(l.user_id) || 0) + 1); } });
    let idToPerfil = new Map();
    if (userIds.size) {
      const { data: perf } = await supabaseAdmin
        .from('user_profiles')
        .select('id, nome, departamento')
        .in('id', Array.from(userIds));
      idToPerfil = new Map((perf || []).map(p => [p.id, p]));
    }
    const byUser = Array.from(porUsuario.entries()).map(([uid, count]) => ({
      usuarioId: uid, nome: idToPerfil.get(uid)?.nome || uid, count
    }));
    const porDept = new Map();
    (logs || []).forEach(l => {
      const dep = l.departamento || idToPerfil.get(l.user_id)?.departamento || 'Sem Dep.';
      if (departamento && dep !== departamento) return;
      porDept.set(dep, (porDept.get(dep) || 0) + 1);
    });
    const byDepartment = Array.from(porDept.entries()).map(([dep, count]) => ({ departamento: dep, count }));
    const porDia = new Map();
    (logs || []).forEach(l => {
      const d = l.created_at ? new Date(l.created_at) : null;
      if (!d) return;
      const key = d.toISOString().slice(0, 10);
      porDia.set(key, (porDia.get(key) || 0) + 1);
    });
    const byDay = Array.from(porDia.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));
    res.json({ byUser, byDepartment, byDay });
  } catch (e) {
    console.error('❌ Erro séries disparos:', e);
    res.status(500).json({ error: 'Erro ao carregar séries de disparos' });
  }
});

// ========== QUALIDADE / TREINAMENTOS ==========
app.post('/api/treinamentos/assinaturas', express.json(), async (req, res) => {
  try {
    const { treinamento_slug, nome, cpf, assinatura_texto } = req.body || {};
    if (!treinamento_slug || !nome || !assinatura_texto) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios: treinamento_slug, nome, assinatura_texto' });
    }

    let userId = null;
    try {
      const { user, error: authError } = await getSupabaseUserFromRequest(req);
      if (user && !authError) {
        userId = user.id;
        console.log('✅ User ID capturado para assinatura:', userId);
      } else {
        console.warn('⚠️ Não foi possível capturar user_id da requisição:', authError?.message || 'Token não fornecido');
      }
    } catch (err) {
      console.warn('⚠️ Erro ao obter usuário da requisição:', err.message);
    }

    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString();
    const ua = req.headers['user-agent'] || '';

    const dadosInsercao = {
      treinamento_slug,
      user_id: userId,
      nome,
      cpf: cpf || null,
      assinatura_texto,
      ip_address: ip,
      user_agent: ua
    };

    console.log('📝 Salvando assinatura:', {
      treinamento_slug,
      user_id: userId || 'null',
      nome: nome.substring(0, 20) + '...'
    });

    const { data, error } = await supabaseAdmin
      .from('treinamentos_assinaturas')
      .insert([dadosInsercao])
      .select();
    
    if (error) throw error;
    
    console.log('✅ Assinatura salva com sucesso. ID:', data?.[0]?.id, 'User ID:', data?.[0]?.user_id);
    
    return res.json({
      success: true,
      id: data?.[0]?.id,
      user_id: data?.[0]?.user_id,
      data_assinatura: data?.[0]?.data_assinatura
    });
  } catch (e) {
    console.error('❌ Erro ao salvar assinatura de treinamento:', e);
    return res.status(500).json({ success: false, error: 'Erro ao salvar assinatura: ' + (e.message || 'Erro desconhecido') });
  }
});

app.get('/api/treinamentos/status', async (req, res) => {
  try {
    const slug = (req.query.slug || '').toString().trim();
    if (!slug) {
      return res.status(400).json({ success: false, error: 'Parâmetro slug é obrigatório' });
    }

    const { user, error } = await getUserFromRequest(req);
    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
    }

    const userId = user.id;

    const { data, error: queryError } = await supabaseAdmin
      .from('treinamentos_assinaturas')
      .select('id, treinamento_slug, data_assinatura, created_at, nome')
      .eq('treinamento_slug', slug)
      .eq('user_id', userId)
      .order('data_assinatura', { ascending: false })
      .limit(1);

    if (queryError) {
      throw queryError;
    }

    const assinatura = data && data.length ? data[0] : null;

    if (assinatura) {
      return res.json({
        success: true,
        concluido: true,
        assinatura
      });
    }

    return res.json({
      success: true,
      concluido: false
    });
  } catch (err) {
    console.error('❌ Erro ao verificar status do treinamento:', err);
    return res.status(500).json({ success: false, error: 'Erro ao verificar treinamento: ' + (err.message || 'Erro desconhecido') });
  }
});

// Função auxiliar para obter usuário autenticado (sessão ou Supabase)
async function getUserFromRequest(req) {
  // Tentar autenticação via sessão primeiro
  if (req.session && req.session.usuario) {
    const sessionUsuario = req.session.usuario;
    console.log('🔍 Verificando sessão - req.session.usuario:', sessionUsuario);
    console.log('🔍 req.session.userData:', req.session.userData);
    
    // req.session.usuario pode ser email ou user_id, vamos tentar ambos
    let userEmail = null;
    let userId = null;
    
    // Se tem userData na sessão, usar o email de lá
    if (req.session.userData && req.session.userData.email) {
      userEmail = req.session.userData.email;
      userId = req.session.userData.id || sessionUsuario;
    } else {
      // Tentar como email primeiro
      if (typeof sessionUsuario === 'string' && sessionUsuario.includes('@')) {
        userEmail = sessionUsuario;
      } else {
        // Pode ser um ID
        userId = sessionUsuario;
      }
    }
    
    console.log('🔍 userEmail:', userEmail, 'userId:', userId);
    
    // Se temos userId, buscar diretamente
    if (userId) {
      try {
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (!authError && authUser && authUser.user) {
          console.log('✅ Usuário encontrado via userId:', authUser.user.id);
          return { user: authUser.user, error: null };
        }
      } catch (err) {
        console.warn('⚠️ Erro ao buscar usuário por ID:', err);
      }
    }
    
    // Se temos email, buscar pelo email
    if (userEmail) {
      // Buscar o user_id através do user_profiles pelo email
      const { data: userProfile, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('id, email')
        .eq('email', userEmail)
        .maybeSingle();
      
      if (profileError) {
        console.warn('⚠️ Erro ao buscar perfil do usuário:', profileError);
      }
      
      if (userProfile && userProfile.id) {
        // Buscar dados completos do usuário no auth.users usando admin API
        try {
          const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userProfile.id);
          if (!authError && authUser && authUser.user) {
            console.log('✅ Usuário encontrado via user_profiles:', authUser.user.id);
            return { user: authUser.user, error: null };
          }
        } catch (err) {
          console.warn('⚠️ Erro ao buscar usuário no auth:', err);
        }
        
        // Fallback: criar objeto user básico se não conseguir buscar do auth
        console.log('✅ Usando fallback com userProfile.id:', userProfile.id);
        return {
          user: {
            id: userProfile.id,
            email: userProfile.email || userEmail,
            user_metadata: {}
          },
          error: null
        };
      }
      
      // Tentar buscar pelo email diretamente no auth (fallback)
      try {
        const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
        const authUser = authUsers?.users?.find(u => u.email === userEmail);
        if (authUser) {
          console.log('✅ Usuário encontrado via listUsers:', authUser.id);
          return { user: authUser, error: null };
        }
      } catch (err) {
        console.warn('⚠️ Erro ao listar usuários:', err);
      }
    }
  }
  
  // Tentar autenticação via token Supabase (verificar header Authorization)
  console.log('🔍 Tentando autenticação via token Supabase...');
  const authHeader = req.headers.authorization || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      console.log('🔐 Token encontrado no header, validando...');
      try {
        const { data, error } = await supabaseAdmin.auth.getUser(token);
        if (!error && data && data.user) {
          console.log('✅ Token válido via supabaseAdmin.auth.getUser');
          // Buscar perfil do usuário para obter departamento
          const { data: userProfile } = await supabaseAdmin
            .from('user_profiles')
            .select('departamento')
            .eq('id', data.user.id)
            .maybeSingle();
          
          const user = {
            ...data.user,
            departamento: userProfile?.departamento || null
          };
          
          return { user, error: null };
        }
      } catch (err) {
        console.warn('⚠️ Erro ao validar token:', err);
      }
    }
  }
  
  const userIdHeader = req.headers['x-user-id'];
  if (userIdHeader) {
    console.log('🔍 Tentando autenticação via userId header:', userIdHeader);
    try {
      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userIdHeader);
      if (!authError && authUser && authUser.user) {
        const { data: perfil } = await supabaseAdmin
          .from('user_profiles')
          .select('departamento')
          .eq('id', userIdHeader)
          .maybeSingle();

        const user = {
          ...authUser.user,
          departamento: perfil?.departamento || null
        };

        return { user, error: null };
      }
    } catch (err) {
      console.warn('⚠️ Erro ao autenticar via userId header:', err);
    }
  }

  // Tentar autenticação via email do localStorage (header X-User-Email)
  const userEmailHeader = req.headers['x-user-email'];
  if (userEmailHeader) {
    console.log('🔍 Tentando autenticação via email do localStorage:', userEmailHeader);
    try {
      // Buscar o user_id através do user_profiles pelo email
      const { data: userProfile, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('id, email')
        .eq('email', userEmailHeader)
        .maybeSingle();
      
      if (profileError) {
        console.warn('⚠️ Erro ao buscar user_profile:', profileError);
      }
      
      if (userProfile && userProfile.id) {
        try {
          const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userProfile.id);
          if (!authError && authUser && authUser.user) {
            console.log('✅ Usuário encontrado via email do localStorage:', authUser.user.id);
            
            // Buscar perfil completo
            const { data: fullProfile } = await supabaseAdmin
              .from('user_profiles')
              .select('departamento')
              .eq('id', userProfile.id)
              .maybeSingle();
            
            const user = {
              ...authUser.user,
              departamento: fullProfile?.departamento || null
            };
            
            return { user, error: null };
          }
        } catch (err) {
          console.warn('⚠️ Erro ao buscar usuário por user_profile.id:', err);
        }
      }
      
      // Tentar buscar pelo email diretamente no auth (fallback)
      try {
        const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
        const authUser = authUsers?.users?.find(u => u.email === userEmailHeader);
        if (authUser) {
          console.log('✅ Usuário encontrado via listUsers (email):', authUser.id);
          
          // Buscar perfil para obter departamento
          const { data: userProfile } = await supabaseAdmin
            .from('user_profiles')
            .select('departamento')
            .eq('id', authUser.id)
            .maybeSingle();
          
          const user = {
            ...authUser,
            departamento: userProfile?.departamento || null
          };
          
          return { user, error: null };
        }
      } catch (err) {
        console.warn('⚠️ Erro ao listar usuários:', err);
      }
    } catch (err) {
      console.warn('⚠️ Erro ao autenticar via email:', err);
    }
  }
  
  // Se não encontrou, retornar erro
  console.error('❌ Usuário não encontrado no sistema');
  console.error('   - Sessão presente?', !!req.session);
  console.error('   - Sessão usuario?', req.session?.usuario);
  console.error('   - Token presente?', !!authHeader);
  console.error('   - Email header presente?', !!userEmailHeader);
  return { error: { status: 401, message: 'Não autenticado. Faça login novamente.' } };
}

// ========== INICIALIZAÇÃO DO OPENAI ==========
// A chave da OpenAI DEVE estar no arquivo .env
// Verificar todas as variáveis relacionadas
let openaiApiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;

// Se a chave não foi carregada corretamente, tentar ler diretamente do arquivo .env
if (!openaiApiKey || openaiApiKey.includes('sua_chav') || openaiApiKey.length < 50) {
  console.warn('⚠️ Chave não encontrada em process.env, tentando ler diretamente do arquivo .env...');
  try {
    const envPath = require('path').resolve(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const lines = envContent.split('\n');
      
      // Procurar pela linha OPENAI_API_KEY
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('OPENAI_API_KEY=') && !trimmedLine.startsWith('#')) {
          const keyValue = trimmedLine.split('=')[1];
          if (keyValue && keyValue.length > 50 && keyValue.startsWith('sk-')) {
            openaiApiKey = keyValue.trim();
            console.log('✅ Chave encontrada diretamente no arquivo .env');
            break;
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Erro ao ler arquivo .env diretamente:', error.message);
  }
}

// Logs de diagnóstico detalhados
console.log('🔍 Diagnóstico OpenAI:');
console.log('  - OPENAI_API_KEY existe?', !!process.env.OPENAI_API_KEY);
console.log('  - OPENAI_KEY existe?', !!process.env.OPENAI_KEY);
console.log('  - Valor OPENAI_API_KEY (process.env):', process.env.OPENAI_API_KEY);
console.log('  - Valor OPENAI_KEY (process.env):', process.env.OPENAI_KEY);
console.log('  - Chave selecionada (final):', openaiApiKey ? openaiApiKey.substring(0, 20) + '...' : 'N/A');
console.log('  - Tamanho da chave selecionada:', openaiApiKey ? openaiApiKey.length : 0);
console.log('  - Primeiros 20 caracteres:', openaiApiKey ? openaiApiKey.substring(0, 20) + '...' : 'N/A');

if (!openaiApiKey || openaiApiKey.trim().length === 0) {
  console.error('❌ ERRO CRÍTICO: OPENAI_API_KEY não configurada no arquivo .env');
  console.error('⚠️ O chat com IA não funcionará até que a chave seja configurada.');
  console.error('📝 Adicione OPENAI_API_KEY=sua_chave_aqui no arquivo .env');
  console.error('💡 Certifique-se de que o servidor foi reiniciado após adicionar a chave');
  console.error('💡 Verifique se não há espaços ao redor do sinal de igual (=)');
  console.error('💡 Verifique se a linha não está quebrada ou comentada');
} else if (openaiApiKey.includes('sua_chav') || openaiApiKey.includes('your_api_key') || openaiApiKey.length < 50) {
  console.error('❌ ERRO: OPENAI_API_KEY no .env parece ser um placeholder ou está incompleta');
  console.error('⚠️ Valor encontrado:', openaiApiKey);
  console.error('⚠️ Por favor, configure uma chave válida da OpenAI no arquivo .env');
  console.error('💡 A chave deve começar com "sk-" e ter mais de 50 caracteres');
} else {
  console.log('✅ Chave da OpenAI encontrada e válida');
}

// Inicializar OpenAI apenas se a chave for válida
let openai = null;
if (openaiApiKey && 
    !openaiApiKey.includes('sua_chav') && 
    !openaiApiKey.includes('your_api_key') && 
    openaiApiKey.length > 50 &&
    openaiApiKey.startsWith('sk-')) {
  try {
    openai = new OpenAI({
      apiKey: openaiApiKey.trim()
    });
    console.log('✅ OpenAI inicializado com sucesso');
  } catch (error) {
    console.error('❌ Erro ao inicializar OpenAI:', error.message);
  }
} else {
  console.warn('⚠️ OpenAI não inicializado - chave inválida ou não configurada');
  if (openaiApiKey) {
    console.warn('   Detalhes da chave:');
    console.warn('   - Começa com sk-?', openaiApiKey.startsWith('sk-'));
    console.warn('   - Tamanho:', openaiApiKey.length);
    console.warn('   - Contém placeholder?', openaiApiKey.includes('sua_chav') || openaiApiKey.includes('your_api_key'));
  }
}

// ========== FUNÇÃO PARA DETECTAR CATEGORIA DA CONVERSA ==========
function detectarCategoriaConversa(mensagem, referer = '') {
  const msgLower = mensagem.toLowerCase();
  
  // Palavras-chave para cada categoria
  const categorias = {
    'cadastro': ['cadastrar', 'cadastro', 'motorista', 'novo motorista', 'adicionar motorista', 'importar', 'csv', 'placa', 'cnh', 'carroceria', 'veículo'],
    'disparos': ['disparar', 'disparo', 'mensagem', 'whatsapp', 'enviar mensagem', 'painel', 'filtro', 'destinatário'],
    'coletas': ['coleta', 'coletas', 'etapa', 'gr', 'comercial', 'preço', 'documentação', 'controladoria', 'vincular', 'motorista'],
    'relatorios': ['relatório', 'relatórios', 'bi', 'gráfico', 'métrica', 'dashboard', 'estatística', 'dados'],
    'treinamentos': ['treinamento', 'treinamentos', 'assinatura', 'declaração', 'documento', 'ata'],
    'configuracoes': ['configuração', 'configurações', 'usuário', 'permissão', 'senha', 'admin', 'settings'],
    'emergencia': ['emergência', 'emergencia', 'alerta', 'socorro', 'urgente'],
    'autenticacao': ['login', 'logout', 'entrar', 'sair', 'autenticação', 'senha', 'conta'],
    'duvida_geral': [] // Fallback
  };
  
  // Verificar referer (página de origem)
  const refererLower = referer.toLowerCase();
  if (refererLower.includes('cadastro')) return 'cadastro';
  if (refererLower.includes('painel')) return 'disparos';
  if (refererLower.includes('coletas')) return 'coletas';
  if (refererLower.includes('relatorios')) return 'relatorios';
  if (refererLower.includes('treinamentos')) return 'treinamentos';
  if (refererLower.includes('settings')) return 'configuracoes';
  if (refererLower.includes('emergencia')) return 'emergencia';
  
  // Verificar palavras-chave na mensagem
  for (const [cat, keywords] of Object.entries(categorias)) {
    if (keywords.length > 0 && keywords.some(keyword => msgLower.includes(keyword))) {
      return cat;
    }
  }
  
  return 'duvida_geral';
}

// ========== ENDPOINT PARA CHAT COM IA ==========
app.post('/api/chat/ia', express.json(), async (req, res) => {
  try {
    console.log('📨 Requisição de chat recebida');
    console.log('🔍 Headers:', {
      authorization: req.headers.authorization ? 'Presente' : 'Ausente',
      cookie: req.headers.cookie ? 'Presente' : 'Ausente',
      xUserEmail: req.headers['x-user-email'] || 'Ausente'
    });
    console.log('🔍 Session:', {
      hasSession: !!req.session,
      usuario: req.session?.usuario,
      userData: req.session?.userData
    });
    
    // Verificar se OpenAI está inicializado
    if (!openai) {
      return res.status(503).json({ 
        success: false, 
        error: 'Serviço de IA não disponível. A chave da OpenAI não está configurada no arquivo .env' 
      });
    }

    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      console.error('❌ Erro de autenticação:', authError?.message || 'Usuário não encontrado');
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    console.log('✅ Usuário autenticado:', user.email || user.id);

    const { mensagem, historico = [] } = req.body;

    if (!mensagem || mensagem.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Mensagem não pode estar vazia' });
    }

    // Construir contexto do sistema com informações detalhadas sobre o portal
    const sistemaPrompt = `Você é um assistente virtual inteligente da plataforma Multimodal Intranet.

## SUA FUNÇÃO
Você ajuda os usuários a entender e utilizar todas as funcionalidades da plataforma de forma eficiente e segura.

## MÓDULOS E FUNCIONALIDADES DISPONÍVEIS

### 📋 Operações
- **Coletas**: Gestão completa de coletas logísticas
  - Criar e gerenciar coletas
  - Acompanhar etapas (Comercial, Preço, CS, Contratação, GR, Documentação, Controladoria, Contas a Pagar, Contas a Receber, Monitoramento, Finalizar Operação)
  - Vincular motoristas às coletas
  - Etiquetas personalizadas para categorização
  - Histórico completo de movimentações

### 🚛 Cadastro de Motoristas
- Cadastro completo com dados pessoais e veículos
- CNH, categoria e estado
- Classes de veículo: Leve, Médio, Pesado
- Tipos de veículo: Carreta, Truck, VUC, etc.
- Carrocerias: Baú, Sider, Grade Baixa, Truck, Basculante, Porta Container, Caçamba, etc.
- Múltiplas placas (cavalo, carretas)
- Importação em lote via CSV
- Filtros avançados por tipo, carroceria, estado, status

### 📱 Disparo de Mensagens (Painel)
- Envio de mensagens WhatsApp via Evolution API
- Filtros por categoria, tipo de veículo, carroceria, estado
- Seleção múltipla de destinatários
- Templates de mensagens
- Log de todos os disparos
- Relatórios de uso por usuário e departamento

### 📊 Relatórios e BI
- **BI de Disparos**: Análise de mensagens enviadas
  - Por usuário e departamento
  - Por período (diário, semanal, mensal, personalizado)
  - Gráficos e métricas visuais
- **BI de Cadastros**: Análise de cadastros de motoristas
  - Por usuário e departamento
  - Por período
  - Estatísticas de cadastros realizados

### 🎓 Treinamentos
- Treinamentos disponíveis:
  - Cadastro de Motoristas
  - Disparador de Mensagens
  - Trocar Senha
- Assinatura digital com canvas
- Documentos de treinamentos (upload de PDFs, imagens)
- Acompanhamento de treinamentos concluídos por usuário

### ⚙️ Configurações
- Gestão de usuários e permissões
- Configurações de sistema
- Notificações de emergência
- Tags e etiquetas personalizadas

### 🚨 Emergência
- Portal do motorista pode acionar alerta de emergência
- Notificações via WhatsApp para usuários configurados
- Apenas disponível quando motorista está vinculado a uma coleta ativa

### 🔐 Autenticação
- Login com email/senha ou Google OAuth
- Portal do motorista separado
- Sistema de permissões por módulo
- Troca de senha disponível

## RESTRIÇÕES IMPORTANTES DE SEGURANÇA

⚠️ **VOCÊ NÃO PODE E NÃO DEVE:**
- Revelar dados sensíveis de usuários (CPF, telefones completos, emails específicos)
- Expor informações financeiras (valores de coletas, salários, etc.)
- Compartilhar credenciais de acesso ou tokens
- Modificar ou executar comandos SQL diretamente
- Acessar ou modificar dados do banco de dados
- Revelar informações de segurança interna
- Fornecer instruções para bypass de permissões ou segurança
- Compartilhar informações sobre estrutura de banco de dados ou schemas específicos

✅ **VOCÊ PODE:**
- Explicar como usar as funcionalidades do sistema
- Orientar sobre navegação e interface
- Dar dicas de melhor uso das ferramentas
- Explicar o que cada módulo faz
- Ajudar com dúvidas sobre fluxos de trabalho
- Sugerir melhorias de uso (sem expor dados)
- Explicar conceitos gerais do sistema

## DIRETRIZES DE RESPOSTA

1. **Seja específico e útil**: Quando explicar funcionalidades, seja detalhado sobre os passos
2. **Mantenha contexto**: Use o histórico da conversa para dar respostas mais relevantes
3. **Seja educado e profissional**: Use linguagem corporativa apropriada
4. **Se não souber**: Seja honesto e sugira consultar a documentação ou contatar o administrador
5. **Foque em instruções**: Sempre que possível, forneça passos claros de como fazer algo
6. **Evite dados específicos**: Não cite dados reais de usuários ou operações, apenas explique processos gerais

## EXEMPLOS DE RESPOSTAS ÚTEIS

Usuário: "Como cadastrar um motorista?"
Você deve explicar:
- Onde encontrar o módulo de cadastro
- Quais campos são obrigatórios
- Como selecionar classe, tipo e carroceria
- Como usar importação em lote se necessário

Usuário: "Como disparar mensagens?"
Você deve explicar:
- Onde encontrar o painel de disparos
- Como usar os filtros
- Como selecionar destinatários
- Como compor e enviar mensagens

Lembre-se: Você é um assistente útil e seguro. Sua prioridade é ajudar os usuários a utilizar o sistema de forma eficiente, sempre respeitando a segurança e privacidade dos dados.`;


    // Preparar mensagens para o OpenAI
    const messages = [
      { role: 'system', content: sistemaPrompt }
    ];

    // Adicionar histórico (últimas 10 mensagens para manter contexto)
    if (historico && historico.length > 0) {
      const historicoLimitado = historico.slice(-10);
      historicoLimitado.forEach(msg => {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      });
    }

    // Adicionar mensagem atual
    messages.push({ role: 'user', content: mensagem.trim() });

    console.log('🤖 Enviando mensagem para OpenAI...');

    // Chamar API da OpenAI com configurações otimizadas
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: messages,
      temperature: 0.7, // Criatividade balanceada
      max_tokens: 800, // Aumentado para respostas mais completas
      top_p: 1,
      frequency_penalty: 0.3, // Evitar repetições
      presence_penalty: 0.3 // Encorajar variedade
    });

    const respostaIA = completion.choices[0]?.message?.content || 'Desculpe, não consegui processar sua mensagem.';

    console.log('✅ Resposta recebida da OpenAI');

    // Detectar categoria da conversa automaticamente
    const categoria = detectarCategoriaConversa(mensagem.trim(), req.headers.referer || '');

    // Salvar conversa no banco de dados
    try {
      const paginaOrigem = req.headers.referer ? new URL(req.headers.referer).pathname.replace('/', '') : 'desconhecida';
      
      const { error: saveError } = await supabaseAdmin
        .from('chat_ia_conversas')
        .insert({
          user_id: user.id,
          mensagem: mensagem.trim(),
          resposta: respostaIA,
          categoria: categoria,
          pagina_origem: paginaOrigem,
          tokens_usados: completion.usage?.total_tokens || 0
        });

      if (saveError) {
        console.warn('⚠️ Erro ao salvar conversa no banco:', saveError);
        // Não bloquear a resposta se houver erro ao salvar
      } else {
        console.log('✅ Conversa salva no banco de dados');
      }
    } catch (saveError) {
      console.warn('⚠️ Erro ao salvar conversa:', saveError);
    }

    res.json({
      success: true,
      resposta: respostaIA,
      tokens_usados: completion.usage?.total_tokens || 0,
      categoria: categoria
    });

  } catch (error) {
    console.error('❌ Erro ao processar chat com IA:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao processar mensagem. Tente novamente.'
    });
  }
});

// ========== ENDPOINT PARA LISTAR CONVERSAS DO USUÁRIO ==========
app.get('/api/chat/ia/historico', async (req, res) => {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { limite = 50 } = req.query;

    const { data: conversas, error } = await supabaseAdmin
      .from('chat_ia_conversas')
      .select('id, mensagem, resposta, categoria, pagina_origem, tokens_usados, satisfacao, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limite));

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      conversas: conversas || [],
      total: conversas?.length || 0
    });

  } catch (error) {
    console.error('❌ Erro ao buscar histórico:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar histórico de conversas'
    });
  }
});

// ========== ENDPOINT PARA AVALIAR RESPOSTA ==========
app.post('/api/chat/ia/avaliar', express.json(), async (req, res) => {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { conversa_id, satisfacao } = req.body;

    if (!conversa_id || !satisfacao || satisfacao < 1 || satisfacao > 5) {
      return res.status(400).json({
        success: false,
        error: 'ID da conversa e satisfação (1-5) são obrigatórios'
      });
    }

    const { error } = await supabaseAdmin
      .from('chat_ia_conversas')
      .update({ satisfacao: parseInt(satisfacao) })
      .eq('id', conversa_id)
      .eq('user_id', user.id); // Garantir que o usuário só avalia suas próprias conversas

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      message: 'Avaliação salva com sucesso'
    });

  } catch (error) {
    console.error('❌ Erro ao salvar avaliação:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao salvar avaliação'
    });
  }
});
// ========== ENDPOINT PARA ANÁLISE DE CONVERSAS (ADMIN) ==========
app.get('/api/chat/ia/analise', requireAuth, async (req, res) => {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    // Verificar se é admin
    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (userProfile?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Acesso negado. Apenas administradores.' });
    }

    const { dataInicio, dataFim, categoria } = req.query;

    let query = supabaseAdmin
      .from('chat_ia_conversas')
      .select('id, categoria, pagina_origem, tokens_usados, satisfacao, created_at, user_id');

    if (dataInicio) {
      query = query.gte('created_at', dataInicio);
    }
    if (dataFim) {
      query = query.lte('created_at', dataFim);
    }
    if (categoria) {
      query = query.eq('categoria', categoria);
    }

    const { data: conversas, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Estatísticas
    const stats = {
      total: conversas?.length || 0,
      por_categoria: {},
      por_pagina: {},
      satisfacao_media: 0,
      total_tokens: 0
    };

    if (conversas && conversas.length > 0) {
      const satisfacoes = [];
      
      conversas.forEach(conv => {
        // Por categoria
        stats.por_categoria[conv.categoria] = (stats.por_categoria[conv.categoria] || 0) + 1;
        
        // Por página
        stats.por_pagina[conv.pagina_origem] = (stats.por_pagina[conv.pagina_origem] || 0) + 1;
        
        // Tokens
        stats.total_tokens += conv.tokens_usados || 0;
        
        // Satisfação
        if (conv.satisfacao) {
          satisfacoes.push(conv.satisfacao);
        }
      });
      
      // Calcular média de satisfação
      if (satisfacoes.length > 0) {
        stats.satisfacao_media = satisfacoes.reduce((a, b) => a + b, 0) / satisfacoes.length;
      }
    }

    res.json({
      success: true,
      conversas: conversas || [],
      estatisticas: stats
    });

  } catch (error) {
    console.error('❌ Erro ao buscar análise:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar análise de conversas'
    });
  }
});

// ========== ENDPOINT PARA LISTAR USUÁRIOS E SEUS TREINAMENTOS ==========
app.get('/api/treinamentos/usuarios', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    
    if (!userResult || !userResult.user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Não autenticado' 
      });
    }

    // Buscar todos os usuários ativos do sistema
    const { data: usuarios, error: usuariosError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, nome, email, departamento, role, active')
      .eq('active', true)
      .order('nome', { ascending: true });

    if (usuariosError) {
      throw usuariosError;
    }

    // Buscar assinaturas de treinamentos para cada usuário
    const usuariosComTreinamentos = await Promise.all(
      (usuarios || []).map(async (usuario) => {
    const { data: assinaturas, error: assinaturasError } = await supabaseAdmin
      .from('treinamentos_assinaturas')
          .select('treinamento_slug, data_assinatura')
          .eq('user_id', usuario.id)
      .order('data_assinatura', { ascending: false });

        return {
          ...usuario,
          treinamentos: assinaturasError ? [] : (assinaturas || [])
        };
      })
    );

    res.json({
      success: true,
      usuarios: usuariosComTreinamentos
    });
  } catch (error) {
    console.error('❌ Erro ao buscar usuários e treinamentos:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao carregar dados'
    });
  }
});

// ========== DOCUMENTOS DE TREINAMENTOS ==========
// Upload de documento de treinamento
app.post('/api/treinamentos/documentos/upload', upload.single('arquivo'), async (req, res) => {
  try {
    console.log('🔍 POST /api/treinamentos/documentos/upload - Verificando autenticação...');
    console.log('📋 req.session:', req.session ? {
      usuario: req.session.usuario,
      userData: req.session.userData,
      isAdmin: req.session.isAdmin
    } : 'Nenhuma sessão');
    
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      console.error('❌ Erro de autenticação:', authError?.message || 'Usuário não encontrado');
      return res.status(authError?.status || 401).json({ success: false, error: authError?.message || 'Não autenticado' });
    }
    
    console.log('✅ Usuário autenticado:', user.email || user.id);

    // Verificar permissão de qualidade
    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role, nome')
      .eq('id', user.id)
      .maybeSingle();

    const isAdmin = userProfile?.role === 'admin';
    const { data: permissao } = await supabaseAdmin
      .from('permissoes_portal')
      .select('permissao_id')
      .eq('usuario_id', user.id)
      .eq('permissao_id', 'qualidade')
      .maybeSingle();

    if (!isAdmin && !permissao) {
      return res.status(403).json({ success: false, error: 'Você não tem permissão para enviar documentos de treinamento' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
    }

    const { treinamento_slug, descricao } = req.body || {};
    if (!treinamento_slug) {
      return res.status(400).json({ success: false, error: 'treinamento_slug é obrigatório' });
    }

    const file = req.file;
    const sanitizedName = sanitizeFilename(file.originalname);
    const fileExt = path.extname(sanitizedName) || '';
    const uniqueName = `${Date.now()}-${generateId()}`;
    const storagePath = `treinamentos/${treinamento_slug}/${uniqueName}${fileExt}`;

    const uploadOptions = {
      contentType: file.mimetype || 'application/octet-stream',
      cacheControl: '3600',
      upsert: false
    };

    const fileBuffer = file.buffer;

    // Upload para Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from(TREINAMENTOS_DOCS_BUCKET)
      .upload(storagePath, fileBuffer, uploadOptions);

    if (uploadError) {
      console.error('❌ Erro ao fazer upload:', uploadError);
      throw uploadError;
    }

    const storageUrl = buildStorageUrl(TREINAMENTOS_DOCS_BUCKET, storagePath);

    // Buscar departamento do usuário
    const { data: userDept } = await supabaseAdmin
      .from('user_profiles')
      .select('departamento')
      .eq('id', user.id)
      .maybeSingle();

    // Salvar metadados no banco
    const { data, error: dbError } = await supabaseAdmin
      .from('treinamentos_documentos')
      .insert([{
        treinamento_slug,
        nome_arquivo: sanitizedName,
        tipo_arquivo: file.mimetype || 'application/octet-stream',
        tamanho: file.size,
        url: storageUrl,
        uploaded_by: user.id,
        uploaded_by_nome: userProfile?.nome || user.email || 'Usuário',
        uploaded_by_departamento: userDept?.departamento || 'Qualidade',
        descricao: descricao || null
      }])
      .select()
      .single();

    if (dbError) {
      // Se falhar ao salvar no banco, remover arquivo do storage
      await supabaseAdmin.storage
        .from(TREINAMENTOS_DOCS_BUCKET)
        .remove([storagePath])
        .catch(() => {});
      throw dbError;
    }

    console.log('✅ Documento de treinamento enviado com sucesso:', data.id);

    return res.json({
      success: true,
      documento: data
    });
  } catch (e) {
    console.error('❌ Erro ao enviar documento de treinamento:', e);
    return res.status(500).json({ 
      success: false, 
      error: 'Erro ao enviar documento: ' + (e.message || 'Erro desconhecido') 
    });
  }
});

// Listar documentos de treinamentos
app.get('/api/treinamentos/documentos', async (req, res) => {
  try {
    console.log('🔍 GET /api/treinamentos/documentos - Verificando autenticação...');
    console.log('📋 req.session:', req.session ? {
      usuario: req.session.usuario,
      userData: req.session.userData,
      isAdmin: req.session.isAdmin
    } : 'Nenhuma sessão');
    
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      console.error('❌ Erro de autenticação:', authError?.message || 'Usuário não encontrado');
      return res.status(authError?.status || 401).json({ success: false, error: authError?.message || 'Não autenticado' });
    }
    
    console.log('✅ Usuário autenticado:', user.email || user.id);

    const { treinamento_slug } = req.query;

    let query = supabaseAdmin
      .from('treinamentos_documentos')
      .select('*')
      .order('data_upload', { ascending: false });

    if (treinamento_slug) {
      query = query.eq('treinamento_slug', treinamento_slug);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Gerar URLs assinadas para cada documento
    const documentosComUrl = await Promise.all(
      (data || []).map(async (doc) => {
        const urlInfo = await createSignedUrlFromStorage(doc.url, 3600);
        return {
          ...doc,
          url: urlInfo.signedUrl || doc.url
        };
      })
    );

    return res.json({
      success: true,
      documentos: documentosComUrl
    });
  } catch (e) {
    console.error('❌ Erro ao listar documentos de treinamento:', e);
    return res.status(500).json({ 
      success: false, 
      error: 'Erro ao listar documentos: ' + (e.message || 'Erro desconhecido') 
    });
  }
});

// Excluir documento de treinamento
app.delete('/api/treinamentos/documentos/:id', async (req, res) => {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(authError?.status || 401).json({ success: false, error: authError?.message || 'Não autenticado' });
    }

    const { id } = req.params;

    // Buscar documento
    const { data: documento, error: fetchError } = await supabaseAdmin
      .from('treinamentos_documentos')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!documento) {
      return res.status(404).json({ success: false, error: 'Documento não encontrado' });
    }

    // Verificar permissão (apenas quem enviou ou admin pode excluir)
    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    const isAdmin = userProfile?.role === 'admin';
    const canDelete = isAdmin || documento.uploaded_by === user.id;

    if (!canDelete) {
      return res.status(403).json({ success: false, error: 'Você não tem permissão para excluir este documento' });
    }

    // Remover arquivo do storage
    const parsed = parseStorageUrl(documento.url);
    if (parsed) {
      await supabaseAdmin.storage
        .from(parsed.bucket)
        .remove([parsed.path])
        .catch(err => console.warn('⚠️ Erro ao remover arquivo do storage:', err));
    }

    // Remover registro do banco
    const { error: deleteError } = await supabaseAdmin
      .from('treinamentos_documentos')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    console.log('✅ Documento excluído com sucesso:', id);

    return res.json({
      success: true,
      message: 'Documento excluído com sucesso'
    });
  } catch (e) {
    console.error('❌ Erro ao excluir documento de treinamento:', e);
    return res.status(500).json({ 
      success: false, 
      error: 'Erro ao excluir documento: ' + (e.message || 'Erro desconhecido') 
    });
  }
});

// ========== FILTROS: TIPOS DE VEÍCULO E CARROCERIA (DISTINCT VIA SERVICE ROLE) ==========
app.get('/api/filtros/motoristas/tipos', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('motoristas')
      .select('tipo_veiculo', { count: 'exact', head: false })
      .not('tipo_veiculo', 'is', null)
      .neq('tipo_veiculo', '')
      .limit(10000);
    if (error) throw error;
    const uniq = Array.from(new Set((data || []).map(r => (r.tipo_veiculo || '').trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    res.json({ success: true, tipos: uniq });
  } catch (e) {
    console.error('❌ Erro filtros tipos:', e);
    res.status(500).json({ success: false, error: 'Erro ao carregar tipos de veículo' });
  }
});

app.get('/api/filtros/motoristas/carrocerias', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('motoristas')
      .select('tipo_carroceria', { count: 'exact', head: false })
      .not('tipo_carroceria', 'is', null)
      .neq('tipo_carroceria', '')
      .limit(10000);
    if (error) throw error;
    const uniq = Array.from(new Set((data || []).map(r => (r.tipo_carroceria || '').trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    res.json({ success: true, carrocerias: uniq });
  } catch (e) {
    console.error('❌ Erro filtros carrocerias:', e);
    res.status(500).json({ success: false, error: 'Erro ao carregar carrocerias' });
  }
});

// Obter estatísticas gerais
app.get('/api/estatisticas-gerais', requireAuth, async (req, res) => {
    try {
        const { dataInicio, dataFim } = req.query;

        let query = supabase
            .from('coletas')
            .select('status, prioridade, usuario_criador, created_at, updated_at, valorEstimado');

        if (dataInicio && dataFim) {
            query = query
                .gte('created_at', dataInicio)
                .lte('created_at', dataFim + 'T23:59:59');
        }

        const { data, error } = await query;

        if (error) throw error;

        const estatisticas = {
            total: data.length,
            porStatus: {},
            porPrioridade: {},
            porUsuario: {},
            valorTotal: 0,
            tempoMedioResolucao: 0
        };

        // Calcular estatísticas
        data.forEach(demanda => {
            // Por status
            estatisticas.porStatus[demanda.status] = (estatisticas.porStatus[demanda.status] || 0) + 1;
            
            // Por prioridade
            if (demanda.prioridade) {
                estatisticas.porPrioridade[demanda.prioridade] = (estatisticas.porPrioridade[demanda.prioridade] || 0) + 1;
            }
            
            // Por usuário
            if (demanda.usuario_criador) {
                estatisticas.porUsuario[demanda.usuario_criador] = (estatisticas.porUsuario[demanda.usuario_criador] || 0) + 1;
            }
            
            // Valor total
            if (demanda.valorEstimado) {
                estatisticas.valorTotal += demanda.valorEstimado;
            }
        });

        // Calcular tempo médio de resolução
        const demandasConcluidas = data.filter(d => d.status === 'concluida');
        if (demandasConcluidas.length > 0) {
            const temposResolucao = demandasConcluidas.map(demanda => {
                const criacao = new Date(demanda.created_at);
                const conclusao = new Date(demanda.updated_at);
                return Math.ceil((conclusao - criacao) / (1000 * 60 * 60 * 24));
            });
            
            estatisticas.tempoMedioResolucao = temposResolucao.reduce((a, b) => a + b, 0) / temposResolucao.length;
        }

        res.json({ success: true, estatisticas });
    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro ao obter estatísticas' });
    }
});

// Criar tabelas para chat e anexos
app.post('/api/setup-tables', requireAuth, async (req, res) => {
  try {
    if (req.session.usuario !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem criar tabelas' });
    }

    console.log('🔧 Criando tabelas necessárias para o sistema de coletas...');

    // 1. Criar tabela chat_mensagens
    const chatSql = `
      CREATE TABLE IF NOT EXISTS chat_mensagens (
        id TEXT PRIMARY KEY,
        coleta_id TEXT NOT NULL,
        usuario TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        tipo TEXT DEFAULT 'user',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    const { error: chatError } = await supabase.rpc('exec_sql', { sql_query: chatSql });
    
    if (chatError) {
      console.error('❌ Erro ao criar chat_mensagens:', chatError);
      return res.status(500).json({ error: 'Erro ao criar tabela chat_mensagens' });
    }

    // 2. Criar tabela anexos
    const anexosSql = `
      CREATE TABLE IF NOT EXISTS anexos (
        id TEXT PRIMARY KEY,
        coleta_id TEXT NOT NULL,
        nome_arquivo TEXT NOT NULL,
        tipo_arquivo TEXT NOT NULL,
        tamanho BIGINT NOT NULL,
        url TEXT NOT NULL,
        data_upload TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    const { error: anexosError } = await supabase.rpc('exec_sql', { sql_query: anexosSql });
    
    if (anexosError) {
      console.error('❌ Erro ao criar anexos:', anexosError);
      return res.status(500).json({ error: 'Erro ao criar tabela anexos' });
    }

    // 3. Criar tabela historico_coletas
    const historicoSql = `
      CREATE TABLE IF NOT EXISTS historico_coletas (
        id TEXT PRIMARY KEY,
        coleta_id TEXT NOT NULL,
        acao TEXT NOT NULL,
        descricao TEXT,
        usuario TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    const { error: historicoError } = await supabase.rpc('exec_sql', { sql_query: historicoSql });
    
    if (historicoError) {
      console.error('❌ Erro ao criar historico_coletas:', historicoError);
      return res.status(500).json({ error: 'Erro ao criar tabela historico_coletas' });
    }

    console.log('✅ Todas as tabelas criadas com sucesso');

    res.json({ 
      success: true, 
      message: 'Tabelas criadas com sucesso',
      tabelas: ['chat_mensagens', 'anexos', 'historico_coletas']
    });

  } catch (error) {
    console.error('❌ Erro geral:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Verificar status das tabelas
app.get('/api/check-tables', requireAuth, async (req, res) => {
  try {
    console.log('🔍 Verificando status das tabelas...');

    const tabelas = ['coletas', 'chat_mensagens', 'anexos', 'historico_coletas'];
    const status = {};

    for (const tabela of tabelas) {
      const { data: columns, error } = await supabase
        .from('information_schema.columns')
        .select('column_name, data_type')
        .eq('table_schema', 'public')
        .eq('table_name', tabela)
        .order('ordinal_position');

      if (error) {
        status[tabela] = { exists: false, error: error.message };
      } else {
        status[tabela] = { 
          exists: true, 
          columns: columns.map(col => ({ name: col.column_name, type: col.data_type }))
        };
      }
    }

    console.log('✅ Verificação concluída');
    res.json({ success: true, tabelas: status });

  } catch (error) {
    console.error('❌ Erro na verificação:', error);
    res.status(500).json({ error: 'Erro ao verificar tabelas' });
  }
});

// 🔄 PROXY PARA EVITAR CORS
app.post('/api/proxy', requireAuth, async (req, res) => {
  try {
    const { url, method, body, headers } = req.body;
    
    console.log('🔁 Proxy request para:', url);
    
    const response = await fetch(url, {
      method: method || 'GET',
      headers: {
        'apikey': headers?.apikey || '',
        'Content-Type': 'application/json',
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
    
  } catch (error) {
    console.error('❌ Erro no proxy:', error);
    res.status(500).json({
      error: 'Erro no proxy: ' + error.message
    });
  }
});

// ========== ROTAS DE BACKUP ==========
app.post('/webhook/backup/exportar', requireAuth, async (req, res) => {
  try {
    const total = await salvarBackupContatos();
    res.json({
      success: true,
      message: `Backup criado com ${total} contatos`,
      total: total
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao criar backup: ' + error.message
    });
  }
});

app.post('/webhook/backup/restaurar', requireAuth, async (req, res) => {
  try {
    const total = await restaurarBackupContatos();
    res.json({
      success: true,
      message: `Backup restaurado com ${total} contatos`,
      total: total
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao restaurar backup: ' + error.message
    });
  }
});

// ========== ROTA DE TESTE DO SUPABASE ==========
app.get('/api/test-supabase', async (req, res) => {
  try {
    console.log('🧪 Testando conexão com Supabase...');
    
    // Testa a tabela evolution_config
    const { data, error } = await supabase
      .from('evolution_config')
      .select('*')
      .limit(1);

    if (error) {
      console.error('❌ Erro no Supabase:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message
      });
    }

    console.log('✅ Supabase funcionando! Configurações:', data?.length || 0);
    res.json({
      success: true,
      message: 'Supabase conectado com sucesso!',
      configs_encontradas: data?.length || 0
    });
    
  } catch (error) {
    console.error('❌ Erro no teste:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🔒 ROTA SEGURA PARA CONFIGURAÇÕES
app.get('/api/supabase-config', (req, res) => {
    const baseUrl = process.env.PUBLIC_BASE_URL || req.protocol + '://' + req.get('host');
    res.json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
        baseUrl: baseUrl
    });
});

// Endpoint de diagnóstico OAuth
app.get('/api/diagnostico-oauth', (req, res) => {
    const baseUrl = process.env.PUBLIC_BASE_URL || req.protocol + '://' + req.get('host');
    const redirectUrl = `${baseUrl}/login-motorista.html`;
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseCallbackUrl = supabaseUrl ? `${supabaseUrl}/auth/v1/callback` : '';
    
    res.json({
        sucesso: true,
        informacoes: {
            urlAplicacao: baseUrl,
            urlRedirect: redirectUrl,
            urlCallbackSupabase: supabaseCallbackUrl,
            supabaseConfigurado: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
            instrucoes: {
                googleCloud: `1. Acesse o Google Cloud Console (https://console.cloud.google.com/)
2. Vá em APIs & Services > Credentials
3. Encontre seu OAuth 2.0 Client ID (usado pelo Supabase)
4. Em "Authorized redirect URIs", adicione: ${supabaseCallbackUrl}`,
                supabase: `1. Acesse o painel do Supabase (https://app.supabase.com/)
2. Selecione seu projeto
3. Vá em Authentication > URL Configuration
4. Em "Redirect URLs", adicione: ${redirectUrl}
5. Vá em Authentication > Providers > Google
6. Certifique-se de que está "Enabled"
7. Verifique se Client ID e Client Secret estão corretos`
            }
        }
    });
});

// ========== ENDPOINT PARA BUSCAR PERFIL DO USUÁRIO ==========
app.get('/api/user-profile/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        console.log('🔍 Buscando perfil do usuário:', userId);
        
        // Buscar perfil usando service role para bypass de RLS
        const { data, error } = await supabaseAdmin
            .from('user_profiles')
            .select('*')
            .eq('id', userId)
            .single();
        
        if (error) {
            console.error('❌ Erro ao buscar perfil:', error);
            return res.status(404).json({ error: 'Perfil não encontrado' });
        }
        
        console.log('✅ Perfil encontrado:', data);
        res.json(data);
    } catch (error) {
        console.error('❌ Erro no endpoint de perfil:', error);
        res.status(500).json({ error: 'Erro ao buscar perfil' });
    }
});
// 🔧 ENDPOINT PARA LIMPAR RATE LIMITING (apenas para desenvolvimento)
app.post('/api/clear-rate-limit', (req, res) => {
    try {
        // Limpar rate limiting para desenvolvimento
        console.log('🧹 Limpando rate limiting para desenvolvimento...');
        
        // Resetar contadores de rate limiting
        if (limiter.resetKey) {
            limiter.resetKey(req.ip);
        }
        if (loginLimiter.resetKey) {
            loginLimiter.resetKey(req.ip);
        }
        
        res.json({
            success: true,
            message: 'Rate limiting limpo com sucesso',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Erro ao limpar rate limiting:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao limpar rate limiting'
        });
    }
});

// 🔧 DIAGNÓSTICO DETALHADO
app.get('/api/diagnostico', requireAuth, async (req, res) => {
  try {
    const usuario = req.session.usuario;
    console.log(`🔍 Diagnóstico para: ${usuario}`);
    
    // 1. Testar conexão básica
    const { data: testData, error: testError } = await supabase
      .from('evolution_config')
      .select('count')
      .limit(1);

    // 2. Buscar configuração do usuário
    const userConfig = await getEvolutionConfigByUser(usuario);
    
    // 3. Listar todas as configurações
    const todasConfigs = await listarConfiguracoesSimples();

    res.json({
      usuario: usuario,
      supabase: {
        conectado: !testError,
        erro: testError?.message,
        configs_totais: todasConfigs.success ? todasConfigs.data.length : 0
      },
      configuracao_usuario: {
        encontrada: !userConfig.error,
        dados: userConfig.error ? null : userConfig,
        erro: userConfig.error
      },
      todas_configuracoes: todasConfigs.success ? todasConfigs.data : []
    });
    
  } catch (error) {
    console.error('❌ Erro no diagnóstico:', error);
    res.status(500).json({
      error: 'Erro no diagnóstico: ' + error.message
    });
  }
});

// ========== API PARA REPROVAR MOTORISTA ==========
app.post('/api/motoristas/reprovar', async (req, res) => {
  try {
    const { motoristaId, coletaId, motivo, usuarioNome } = req.body;

    if (!motoristaId || !coletaId || !motivo) {
      return res.status(400).json({
        success: false,
        error: 'motoristaId, coletaId e motivo são obrigatórios'
      });
    }

    console.log('🔄 Reprovar motorista via API:', {
      motoristaId,
      coletaId,
      motivo,
      usuarioNome
    });

    // Atualizar motorista com reprovação usando service key (ignora RLS)
    const updateData = {
      reprovado: true,
      motivo_reprovacao: motivo,
      reprovado_por: usuarioNome || 'Sistema',
      data_reprovacao: new Date().toISOString(),
      coleta_id_reprovacao: coletaId
    };

    const { data: dataMotorista, error: errorMotorista } = await supabaseAdmin
      .from('motoristas')
      .update(updateData)
      .eq('id', motoristaId)
      .select();

    if (errorMotorista) {
      console.error('❌ Erro ao atualizar motorista:', errorMotorista);
      return res.status(500).json({
        success: false,
        error: `Erro ao atualizar motorista: ${errorMotorista.message}`
      });
    }

    console.log('✅ Motorista atualizado:', dataMotorista);

    // NÃO remover vínculo do motorista - manter vinculado mas marcado como reprovado
    // O usuário pode trocar manualmente se desejar
    // Isso permite que o card continue sendo exibido com a informação de reprovação
    console.log('✅ Motorista mantido vinculado (mas reprovado) - usuário pode trocar se desejar');

    res.json({
      success: true,
      message: 'Motorista reprovado com sucesso',
      data: dataMotorista
    });

  } catch (error) {
    console.error('❌ Erro ao reprovar motorista:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno ao reprovar motorista: ' + error.message
    });
  }
});

// ========== HEALTH CHECK ==========
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    evolution: EVOLUTION_CONFIG.baseUrl
  });
});

// Endpoint para criar tabelas de ferramentas de qualidade (admin only)
app.post('/api/ferramentas-qualidade/criar-tabelas', requireAuth, async (req, res) => {
  try {
    // Verificar se é admin
    const usuario = req.session?.usuario;
    if (!usuario) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    // Verificar se é admin
    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', usuario)
      .maybeSingle();

    if (!userProfile || userProfile.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Acesso negado. Apenas administradores.' });
    }

    const fs = require('fs');
    const path = require('path');
    
    // Ler o arquivo SQL
    const sqlPath = path.join(__dirname, 'sql', 'criar-ferramentas-qualidade.sql');
    const sqlCompleto = fs.readFileSync(sqlPath, 'utf8');
    
    // Dividir em comandos (separados por ;)
    const comandos = sqlCompleto
      .split(';')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0 && !cmd.startsWith('--') && !cmd.match(/^\s*$/));

    let sucessos = 0;
    let erros = [];

    for (let i = 0; i < comandos.length; i++) {
      const comando = comandos[i] + ';';
      
      try {
        const { error: rpcError } = await supabaseAdmin.rpc('exec_sql', {
          sql_query: comando
        });

        if (rpcError) {
          // Se a função não existe, retornar instruções
          if (rpcError.message?.includes('function') || rpcError.code === '42883') {
            return res.status(400).json({
              success: false,
              error: 'Função RPC exec_sql não encontrada no Supabase',
              instrucoes: 'Execute o SQL manualmente no Supabase Dashboard',
              sql: sqlCompleto
            });
          }
          erros.push({ comando: i + 1, erro: rpcError.message });
        } else {
          sucessos++;
        }
      } catch (err) {
        erros.push({ comando: i + 1, erro: err.message });
      }
    }

    if (erros.length > 0) {
      return res.status(500).json({
        success: false,
        error: 'Alguns comandos falharam',
        sucessos,
        erros
      });
    }

    res.json({
      success: true,
      mensagem: `Tabelas criadas com sucesso! ${sucessos} comandos executados.`
    });
  } catch (error) {
    console.error('❌ Erro ao criar tabelas:', error);
    res.status(500).json({ success: false, error: 'Erro ao criar tabelas: ' + error.message });
  }
});

// ========== FERRAMENTAS DE QUALIDADE ==========

// Função para verificar e criar tabelas se necessário
async function verificarTabelasFerramentasQualidade() {
  try {
    // Verificar se a tabela de alertas existe
    const { error: checkError } = await supabaseAdmin
      .from('ferramentas_qualidade_alertas')
      .select('id')
      .limit(1);
    
    if (checkError && (checkError.code === '42P01' || checkError.code === 'PGRST116')) {
      console.warn('⚠️ Tabela ferramentas_qualidade_alertas não existe');
      console.log('ℹ️ Execute o script SQL: sql/criar-ferramentas-qualidade.sql');
      return false;
    }
    
    return true;
  } catch (error) {
    console.warn('⚠️ Erro ao verificar tabelas:', error.message);
    return false;
  }
}

// Verificar tabelas ao iniciar
verificarTabelasFerramentasQualidade().then(existe => {
  if (existe) {
    console.log('✅ Tabelas de ferramentas de qualidade verificadas');
    } else {
    console.log('⚠️ Execute o script SQL para criar as tabelas: sql/criar-ferramentas-qualidade.sql');
  }
});

// Endpoint para listar usuários (para dropdowns)
app.get('/api/ferramentas-qualidade/usuarios', async (req, res) => {
  try {
    // Tentar autenticação, mas não bloquear se falhar
    const userResult = await getUserFromRequest(req);

    // Buscar usuários ativos, excluindo motoristas
    const { data: motoristas } = await supabaseAdmin
      .from('motoristas')
      .select('auth_user_id')
      .not('auth_user_id', 'is', null);

    const motoristaIds = new Set((motoristas || []).map(m => m.auth_user_id));

    const { data: usuarios, error } = await supabaseAdmin
      .from('user_profiles')
      .select('id, nome, email, departamento, cargo, role')
      .eq('active', true)
      .order('nome');

    if (error) throw error;

    // Filtrar motoristas
    const usuariosFiltrados = (usuarios || []).filter(u => !motoristaIds.has(u.id));

    res.json({
      success: true,
      usuarios: usuariosFiltrados.map(u => ({
        id: u.id,
        nome: u.nome || u.email || 'Sem nome',
        email: u.email,
        departamento: u.departamento,
        cargo: u.cargo,
        role: u.role
      }))
    });
  } catch (error) {
    console.error('❌ Erro ao buscar usuários:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar usuários' });
  }
});

// Buscar superior de um usuário (por departamento ou hierarquia)
async function buscarSuperiorUsuario(userId) {
  try {
    const { data: usuario } = await supabaseAdmin
      .from('user_profiles')
      .select('departamento, cargo')
      .eq('id', userId)
      .maybeSingle();

    if (!usuario || !usuario.departamento) return null;

    // Buscar gerente/supervisor do mesmo departamento
    const { data: superior } = await supabaseAdmin
      .from('user_profiles')
      .select('id, nome, email')
      .eq('departamento', usuario.departamento)
      .in('role', ['admin', 'manager'])
      .neq('id', userId)
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    return superior || null;
  } catch (error) {
    console.error('❌ Erro ao buscar superior:', error);
    return null;
  }
}

// Endpoint para listar ferramentas do usuário
app.get('/api/ferramentas-qualidade', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    // Se não tiver usuário autenticado, retornar lista vazia
    if (!userId) {
      return res.json({
        success: true,
        ferramentas: []
      });
    }

    const { arquivado, tipo } = req.query;

    let query = supabaseAdmin
      .from('ferramentas_qualidade')
      .select('*')
      .eq('criado_por', userId)
      .order('criado_em', { ascending: false });

    if (arquivado !== undefined) {
      query = query.eq('arquivado', arquivado === 'true');
    }

    if (tipo) {
      query = query.eq('tipo_ferramenta', tipo);
    }

    const { data: ferramentas, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      ferramentas: ferramentas || []
    });
  } catch (error) {
    console.error('❌ Erro ao listar ferramentas:', error);
    res.status(500).json({ success: false, error: 'Erro ao listar ferramentas' });
  }
});

// IMPORTANTE: Rotas específicas devem vir ANTES das rotas com parâmetros dinâmicos
// Endpoint para buscar ações do usuário logado (DEVE VIR ANTES DE /:id)
app.get('/api/ferramentas-qualidade/minhas-acoes', async (req, res) => {
  try {
    let userResult;
    try {
      userResult = await getUserFromRequest(req);
    } catch (authError) {
      console.warn('⚠️ Erro ao obter usuário da requisição:', authError);
      // Se houver erro na autenticação, retornar lista vazia
      return res.json({ success: true, acoes: [] });
    }
    
    // Se não tiver usuário autenticado, retornar lista vazia (não erro)
    if (!userResult || !userResult.user || !userResult.user.id) {
      console.log('⚠️ Usuário não autenticado, retornando lista vazia');
      return res.json({ success: true, acoes: [] });
    }

    const userId = userResult.user.id;
    const { status, busca } = req.query;

    console.log('📋 Buscando ações para usuário:', userId);

    try {
      // Buscar alertas do usuário (onde ele é responsável)
      let query = supabaseAdmin
        .from('ferramentas_qualidade_alertas')
        .select('*')
        .eq('responsavel_id', userId)
        .order('prazo', { ascending: true });

      if (status) {
        query = query.eq('status', status);
      }

      const { data: alertas, error: alertasError } = await query;

      if (alertasError) {
        console.error('❌ Erro ao buscar alertas:', alertasError);
        console.error('❌ Código do erro:', alertasError.code);
        console.error('❌ Mensagem do erro:', alertasError.message);
        // Se a tabela não existir, retornar lista vazia
        if (alertasError.code === '42P01' || 
            alertasError.code === 'PGRST116' ||
            alertasError.message?.includes('does not exist') ||
            alertasError.message?.includes('relation') ||
            alertasError.message?.includes('tabela') ||
            alertasError.message?.includes('table')) {
          console.warn('⚠️ Tabela ferramentas_qualidade_alertas não existe ainda');
          return res.json({ success: true, acoes: [] });
        }
        throw alertasError;
      }

      if (!alertas || alertas.length === 0) {
        console.log('✅ Nenhum alerta encontrado para o usuário');
        return res.json({ success: true, acoes: [] });
      }

      console.log(`📊 Encontrados ${alertas.length} alertas para o usuário`);

      // Buscar dados das ferramentas e ações
      const acoesCompletas = await Promise.all(alertas.map(async (alerta) => {
        try {
          // Buscar ferramenta
          const { data: ferramenta, error: ferramentaError } = await supabaseAdmin
            .from('ferramentas_qualidade')
            .select('id, tipo_ferramenta, titulo, dados')
            .eq('id', alerta.ferramenta_id)
            .single();

          if (ferramentaError) {
            console.warn(`⚠️ Erro ao buscar ferramenta ${alerta.ferramenta_id}:`, ferramentaError);
            return null;
          }

          if (!ferramenta || !ferramenta.dados) {
            console.warn(`⚠️ Ferramenta ${alerta.ferramenta_id} não encontrada ou sem dados`);
            return null;
          }

          // Buscar ação específica dentro dos dados da ferramenta
          let acao = null;
          if (ferramenta.tipo_ferramenta === 'plano_acao' && ferramenta.dados.acoes) {
            acao = ferramenta.dados.acoes.find(a => a.id === alerta.acao_id);
          }

          if (!acao) {
            console.warn(`⚠️ Ação ${alerta.acao_id} não encontrada na ferramenta ${alerta.ferramenta_id}`);
            return null;
          }

          // Aplicar filtro de busca se necessário
          if (busca) {
            const buscaLower = busca.toLowerCase();
            const matchAcao = (acao.acao || '').toLowerCase().includes(buscaLower);
            const matchFerramenta = (ferramenta.titulo || '').toLowerCase().includes(buscaLower);
            if (!matchAcao && !matchFerramenta) {
              return null;
            }
          }

          return {
            acao_id: alerta.acao_id,
            ferramenta_id: ferramenta.id,
            ferramenta_tipo: ferramenta.tipo_ferramenta,
            ferramenta_titulo: ferramenta.titulo,
            acao: acao.acao,
            responsavel: acao.responsavel,
            gestor_imediato: acao.gestor_imediato,
            prioridade: acao.prioridade,
            progresso: acao.progresso || 0,
            inicio: acao.inicio,
            revisao: acao.revisao,
            finalizacao: acao.finalizacao,
            status: alerta.status,
            prazo: alerta.prazo,
            obs: acao.obs,
            acao_contingencia: acao.acao_contingencia
          };
        } catch (err) {
          console.warn('⚠️ Erro ao buscar dados da ação:', err);
          return null;
        }
      }));

      // Filtrar nulls
      const acoesFiltradas = acoesCompletas.filter(a => a !== null);

      console.log(`✅ Retornando ${acoesFiltradas.length} ações para o usuário`);

      res.json({
        success: true,
        acoes: acoesFiltradas
      });
    } catch (queryError) {
      console.error('❌ Erro na query de alertas:', queryError);
      console.error('❌ Stack:', queryError.stack);
      // Se for erro de tabela não existir, retornar vazio
      if (queryError.code === '42P01' || 
          queryError.code === 'PGRST116' ||
          queryError.message?.includes('does not exist') ||
          queryError.message?.includes('relation') ||
          queryError.message?.includes('tabela') ||
          queryError.message?.includes('table')) {
        return res.json({ success: true, acoes: [] });
      }
      // Para qualquer outro erro, retornar lista vazia também
      console.warn('⚠️ Erro desconhecido na query, retornando lista vazia');
      return res.json({ success: true, acoes: [] });
    }
  } catch (error) {
    console.error('❌ Erro geral ao buscar ações do usuário:', error);
    console.error('❌ Stack:', error.stack);
    // Sempre retornar lista vazia em caso de erro, não erro 500
    res.json({ 
      success: true, 
      acoes: [],
      warning: 'Erro ao carregar ações, retornando lista vazia'
    });
  }
});

// Endpoint para buscar TODAS as ferramentas (com permissões) - PAINEL
app.get('/api/ferramentas-qualidade/painel', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    // Verificar permissão para visualizar painel
    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    const isAdmin = userProfile?.role === 'admin';

    // Verificar permissão - qualquer permissão de qualidade permite visualizar o painel
    const { data: permissoes } = await supabaseAdmin
      .from('permissoes_portal')
      .select('permissao_id')
      .eq('usuario_id', userId)
      .eq('tipo', 'qualidade');

    const temPermissao = isAdmin || (permissoes && permissoes.length > 0);

    if (!temPermissao) {
      return res.status(403).json({ 
        success: false, 
        error: 'Você não tem permissão para visualizar o painel de qualidade' 
      });
    }

    // Parâmetros de filtro
    const { 
      tipo_ferramenta, 
      arquivado, 
      responsavel_id, 
      status_alerta,
      busca,
      limit = 50,
      offset = 0
    } = req.query;

    // Construir query base
    let query = supabaseAdmin
      .from('ferramentas_qualidade')
      .select('*')
      .order('criado_em', { ascending: false });

    // Aplicar filtros
    if (arquivado !== undefined) {
      query = query.eq('arquivado', arquivado === 'true');
    } else {
      query = query.eq('arquivado', false); // Por padrão, não mostrar arquivadas
    }

    if (tipo_ferramenta) {
      query = query.eq('tipo_ferramenta', tipo_ferramenta);
    }

    if (busca) {
      query = query.or(`titulo.ilike.%${busca}%,observacoes.ilike.%${busca}%`);
    }

    // Limitar e paginar
    query = query.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    const { data: ferramentas, error } = await query;

    if (error) throw error;

    // Buscar dados dos criadores
    const criadoresIds = [...new Set((ferramentas || []).map(f => f.criado_por).filter(Boolean))];
    const criadoresMap = {};
    
    if (criadoresIds.length > 0) {
      const { data: criadores } = await supabaseAdmin
        .from('user_profiles')
        .select('id, nome, email, departamento, cargo')
        .in('id', criadoresIds);
      
      if (criadores) {
        criadores.forEach(c => {
          criadoresMap[c.id] = c;
        });
      }
    }

    // Buscar alertas relacionados se necessário
    let ferramentasComAlertas = [];
    if (ferramentas && ferramentas.length > 0) {
      const ferramentaIds = ferramentas.map(f => f.id);
      
      // Buscar alertas
      const { data: alertas } = await supabaseAdmin
        .from('ferramentas_qualidade_alertas')
        .select('*')
        .in('ferramenta_id', ferramentaIds);

      // Agrupar alertas por ferramenta
      const alertasPorFerramenta = {};
      if (alertas) {
        alertas.forEach(alerta => {
          if (!alertasPorFerramenta[alerta.ferramenta_id]) {
            alertasPorFerramenta[alerta.ferramenta_id] = [];
          }
          alertasPorFerramenta[alerta.ferramenta_id].push(alerta);
        });
      }

      // Combinar ferramentas com alertas e dados do criador
      ferramentasComAlertas = ferramentas.map(ferramenta => {
        // Adicionar dados do criador
        ferramenta.criado_por_user = criadoresMap[ferramenta.criado_por] || null;
        
        const alertasFerramenta = alertasPorFerramenta[ferramenta.id] || [];
        
        // Filtrar por responsável se necessário
        if (responsavel_id) {
          const alertasFiltrados = alertasFerramenta.filter(a => 
            a.responsavel_id === responsavel_id || a.superior_id === responsavel_id
          );
          if (alertasFiltrados.length === 0 && ferramenta.tipo_ferramenta !== 'plano_acao') {
            return null; // Não tem ações deste responsável
          }
          ferramenta.alertas = alertasFiltrados;
        } else {
          ferramenta.alertas = alertasFerramenta;
        }

        // Filtrar por status de alerta se necessário
        if (status_alerta) {
          const alertasComStatus = ferramenta.alertas.filter(a => a.status === status_alerta);
          if (alertasComStatus.length === 0 && ferramenta.tipo_ferramenta === 'plano_acao') {
            return null; // Não tem alertas com este status
          }
          ferramenta.alertas = alertasComStatus;
        }

        // Calcular estatísticas
        ferramenta.total_acoes = ferramenta.tipo_ferramenta === 'plano_acao' 
          ? (ferramenta.dados?.acoes?.length || 0) 
          : 0;
        ferramenta.acoes_pendentes = ferramenta.alertas.filter(a => 
          a.status === 'pendente' || a.status === 'em_alerta'
        ).length;
        ferramenta.acoes_vencidas = ferramenta.alertas.filter(a => a.status === 'vencido').length;

        return ferramenta;
      }).filter(f => f !== null);
    }

    // Contar total (para paginação)
    let countQuery = supabaseAdmin
      .from('ferramentas_qualidade')
      .select('*', { count: 'exact', head: true })
      .eq('arquivado', arquivado !== undefined ? arquivado === 'true' : false);

    if (tipo_ferramenta) {
      countQuery = countQuery.eq('tipo_ferramenta', tipo_ferramenta);
    }

    if (busca) {
      countQuery = countQuery.or(`titulo.ilike.%${busca}%,observacoes.ilike.%${busca}%`);
    }

    const { count } = await countQuery;

    res.json({
      success: true,
      ferramentas: ferramentasComAlertas,
      total: count || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('❌ Erro ao buscar ferramentas do painel:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar ferramentas: ' + error.message });
  }
});
// Endpoint para buscar ferramenta específica do painel (sem restrição de criador)
app.get('/api/ferramentas-qualidade/painel/:id', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    // Verificar permissão
    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    const isAdmin = userProfile?.role === 'admin';

    // Verificar permissão - qualquer permissão de qualidade permite visualizar o painel
    const { data: permissoes } = await supabaseAdmin
      .from('permissoes_portal')
      .select('permissao_id')
      .eq('usuario_id', userId)
      .eq('tipo', 'qualidade');

    const temPermissao = isAdmin || (permissoes && permissoes.length > 0);

    if (!temPermissao) {
      return res.status(403).json({ 
        success: false, 
        error: 'Você não tem permissão para visualizar o painel de qualidade' 
      });
    }

    const { id } = req.params;

    // Buscar ferramenta
    const { data: ferramenta, error } = await supabaseAdmin
      .from('ferramentas_qualidade')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!ferramenta) {
      return res.status(404).json({ success: false, error: 'Ferramenta não encontrada' });
    }

    // Buscar dados do criador
    if (ferramenta.criado_por) {
      const { data: criador } = await supabaseAdmin
        .from('user_profiles')
        .select('id, nome, email, departamento, cargo')
        .eq('id', ferramenta.criado_por)
        .maybeSingle();
      ferramenta.criado_por_user = criador || null;
    }

    // Buscar alertas relacionados
    const { data: alertas } = await supabaseAdmin
      .from('ferramentas_qualidade_alertas')
      .select('*')
      .eq('ferramenta_id', id);

    // Buscar dados dos responsáveis e superiores
    const responsaveisIds = [...new Set([
      ...(alertas || []).map(a => a.responsavel_id).filter(Boolean),
      ...(alertas || []).map(a => a.superior_id).filter(Boolean)
    ])];

    const responsaveisMap = {};
    if (responsaveisIds.length > 0) {
      const { data: responsaveis } = await supabaseAdmin
        .from('user_profiles')
        .select('id, nome, email')
        .in('id', responsaveisIds);
      
      if (responsaveis) {
        responsaveis.forEach(r => {
          responsaveisMap[r.id] = r;
        });
      }
    }

    // Adicionar dados dos responsáveis aos alertas
    ferramenta.alertas = (alertas || []).map(alerta => {
      return {
        ...alerta,
        responsavel: responsaveisMap[alerta.responsavel_id] || null,
        superior: responsaveisMap[alerta.superior_id] || null
      };
    });

    res.json({
      success: true,
      ferramenta
    });
  } catch (error) {
    console.error('❌ Erro ao buscar ferramenta do painel:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar ferramenta' });
  }
});

// IMPORTANTE: Rotas específicas devem vir ANTES das rotas com parâmetros dinâmicos
// Endpoint para listar alertas do usuário (DEVE VIR ANTES DE /:id)
app.get('/api/ferramentas-qualidade/alertas', async (req, res) => {
  try {
    // Tratar autenticação com try-catch
    let userId = null;
    try {
      const userResult = await getUserFromRequest(req);
      userId = userResult?.user?.id;
    } catch (authError) {
      console.warn('⚠️ Erro ao obter usuário da requisição:', authError);
      // Continuar sem usuário, retornará lista vazia
    }

    // Se não tiver usuário autenticado, retornar lista vazia
    if (!userId) {
      return res.json({
        success: true,
        alertas: []
      });
    }

    const { status } = req.query;

    try {
      // Buscar alertas do usuário
      // Usar duas queries separadas para evitar problemas com .or()
      let alertasResponsavel, alertasSuperior;
      
      try {
        [alertasResponsavel, alertasSuperior] = await Promise.all([
          supabaseAdmin
            .from('ferramentas_qualidade_alertas')
            .select('*')
            .eq('responsavel_id', userId)
            .order('prazo', { ascending: true }),
          supabaseAdmin
            .from('ferramentas_qualidade_alertas')
            .select('*')
            .eq('superior_id', userId)
            .order('prazo', { ascending: true })
        ]);
      } catch (promiseError) {
        console.error('❌ Erro no Promise.all ao buscar alertas:', promiseError);
        console.error('❌ Stack:', promiseError.stack);
        // Retornar lista vazia em caso de erro no Promise.all
        return res.json({
          success: true,
          alertas: []
        });
      }

      // Verificar erros nas queries PRIMEIRO, antes de processar dados
      if (alertasResponsavel.error || alertasSuperior.error) {
        const error = alertasResponsavel.error || alertasSuperior.error;
        console.error('❌ Erro ao buscar alertas:', error);
        console.error('❌ Código do erro:', error.code);
        console.error('❌ Mensagem do erro:', error.message);
        console.error('❌ Detalhes do erro:', error.details);
        
        // Se a tabela não existir, retornar lista vazia ao invés de erro
        if (error.code === '42P01' || 
            error.code === 'PGRST116' ||
            error.message?.includes('does not exist') ||
            error.message?.includes('relation') ||
            error.message?.includes('tabela') ||
            error.message?.includes('table')) {
          console.warn('⚠️ Tabela ferramentas_qualidade_alertas não existe ainda');
          return res.json({
            success: true,
            alertas: []
          });
        }
        // Retornar lista vazia em caso de outros erros também
        console.warn('⚠️ Retornando lista vazia devido a erro na query');
        return res.json({
          success: true,
          alertas: []
        });
      }

      // Combinar resultados e remover duplicatas
      const alertasMap = new Map();
      
      if (alertasResponsavel.data && Array.isArray(alertasResponsavel.data)) {
        alertasResponsavel.data.forEach(alerta => {
          alertasMap.set(alerta.id, alerta);
        });
      }
      
      if (alertasSuperior.data && Array.isArray(alertasSuperior.data)) {
        alertasSuperior.data.forEach(alerta => {
          alertasMap.set(alerta.id, alerta);
        });
      }
      
      const alertas = Array.from(alertasMap.values());
      
      // Ordenar por prazo (com tratamento de erros)
      try {
        alertas.sort((a, b) => {
          try {
            const prazoA = a.prazo ? new Date(a.prazo) : new Date(0);
            const prazoB = b.prazo ? new Date(b.prazo) : new Date(0);
            return prazoA - prazoB;
          } catch (err) {
            return 0; // Manter ordem original em caso de erro
          }
        });
      } catch (sortError) {
        console.warn('⚠️ Erro ao ordenar alertas:', sortError);
        // Continuar mesmo com erro na ordenação
      }

      // Se não houver alertas, retornar vazio
      if (!alertas || alertas.length === 0) {
        return res.json({
          success: true,
          alertas: []
        });
      }

      // Buscar dados adicionais das ferramentas e usuários
      let alertasCompletos = [];
      
      try {
        alertasCompletos = await Promise.all((alertas || []).map(async (alerta) => {
          try {
            const [ferramenta, responsavel, superior] = await Promise.all([
              alerta.ferramenta_id ? supabaseAdmin.from('ferramentas_qualidade').select('tipo_ferramenta, titulo').eq('id', alerta.ferramenta_id).maybeSingle() : Promise.resolve({ data: null }),
              alerta.responsavel_id ? supabaseAdmin.from('user_profiles').select('id, nome, email').eq('id', alerta.responsavel_id).maybeSingle() : Promise.resolve({ data: null }),
              alerta.superior_id ? supabaseAdmin.from('user_profiles').select('id, nome, email').eq('id', alerta.superior_id).maybeSingle() : Promise.resolve({ data: null })
            ]);

            return {
              ...alerta,
              ferramenta: ferramenta.data || {},
              responsavel: responsavel.data || {},
              superior: superior.data || null
            };
          } catch (err) {
            console.warn('⚠️ Erro ao buscar dados do alerta:', err);
            return {
              ...alerta,
              ferramenta: {},
              responsavel: {},
              superior: null
            };
          }
        }));
      } catch (enrichError) {
        console.warn('⚠️ Erro ao enriquecer dados dos alertas:', enrichError);
        // Usar alertas básicos sem dados adicionais
        alertasCompletos = alertas.map(alerta => ({
          ...alerta,
          ferramenta: {},
          responsavel: {},
          superior: null
        }));
      }

      let queryFiltered = alertasCompletos;

      if (status) {
        queryFiltered = queryFiltered.filter(a => a.status === status);
      }

      res.json({
        success: true,
        alertas: queryFiltered
      });
    } catch (queryError) {
      console.error('❌ Erro na query de alertas:', queryError);
      // Se for erro de tabela não existir, retornar vazio
      if (queryError.code === '42P01' || 
          queryError.code === 'PGRST116' ||
          queryError.message?.includes('does not exist') ||
          queryError.message?.includes('relation') ||
          queryError.message?.includes('tabela') ||
          queryError.message?.includes('table')) {
        return res.json({
          success: true,
          alertas: []
        });
      }
      // Retornar lista vazia em caso de outros erros também
      console.warn('⚠️ Retornando lista vazia devido a erro na query');
      return res.json({
        success: true,
        alertas: []
      });
    }
  } catch (error) {
    console.error('❌ Erro geral ao listar alertas:', error);
    console.error('❌ Stack:', error.stack);
    // Retornar lista vazia ao invés de erro 500
    res.json({
      success: true,
      alertas: []
    });
  }
});

// Endpoint para buscar ferramenta específica (do usuário logado)
app.get('/api/ferramentas-qualidade/:id', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    if (!userResult || !userResult.user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { id } = req.params;
    const userId = userResult.user.id;

    const { data: ferramenta, error } = await supabaseAdmin
      .from('ferramentas_qualidade')
      .select('*')
      .eq('id', id)
      .eq('criado_por', userId)
      .maybeSingle();

    if (error) throw error;
    if (!ferramenta) {
      return res.status(404).json({ success: false, error: 'Ferramenta não encontrada' });
    }

    res.json({
      success: true,
      ferramenta
    });
  } catch (error) {
    console.error('❌ Erro ao buscar ferramenta:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar ferramenta' });
  }
});

// Endpoint para salvar/atualizar ferramenta
app.post('/api/ferramentas-qualidade', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    // Se não tiver usuário autenticado, retornar erro
    if (!userId) {
      return res.status(401).json({ success: false, error: 'É necessário estar autenticado para salvar ferramentas' });
    }

    const { id, tipo_ferramenta, titulo, dados, tags, observacoes, projeto_id } = req.body;

    if (!tipo_ferramenta || !titulo || !dados) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios faltando' });
    }

    // Processar alertas para Plano de Ação
    let temPrazos = false;
    let proximoVencimento = null;
    let alertas = [];

    if (tipo_ferramenta === 'plano_acao' && dados.acoes && Array.isArray(dados.acoes)) {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      for (const acao of dados.acoes) {
        // Usar finalizacao como prazo (ou prazo se existir)
        const prazoData = acao.prazo || acao.finalizacao;
        if (prazoData && acao.responsavel_id) {
          temPrazos = true;
          const prazoDate = new Date(prazoData);
          prazoDate.setHours(0, 0, 0, 0);

          if (!proximoVencimento || prazoDate < proximoVencimento) {
            proximoVencimento = prazoDate;
          }

          // Buscar superior do responsável
          const superior = await buscarSuperiorUsuario(acao.responsavel_id);

          // Determinar status do prazo
          let status = 'pendente';
          const diasRestantes = Math.floor((prazoDate - hoje) / (1000 * 60 * 60 * 24));
          if (diasRestantes < 0) {
            status = 'vencido';
          } else if (diasRestantes <= 3) {
            status = 'em_alerta';
          }

          alertas.push({
            ferramenta_id: id || 'temp', // Será atualizado após criar a ferramenta
            acao_id: acao.id || Date.now().toString(),
            responsavel_id: acao.responsavel_id,
            superior_id: superior?.id || null,
            prazo: prazoData,
            status,
            alertado_responsavel: false,
            alertado_superior: false
          });
        }
      }
    }

    let ferramenta;

    if (id) {
      // Atualizar ferramenta existente
      const { data: ferramentaExistente } = await supabaseAdmin
        .from('ferramentas_qualidade')
        .select('id, criado_por')
        .eq('id', id)
        .maybeSingle();

      if (!ferramentaExistente || ferramentaExistente.criado_por !== userId) {
        return res.status(403).json({ success: false, error: 'Sem permissão para atualizar esta ferramenta' });
      }

      const { data, error } = await supabaseAdmin
        .from('ferramentas_qualidade')
        .update({
          titulo,
          dados,
          tags: tags || [],
          observacoes,
          tem_prazos: temPrazos,
          proximo_vencimento: proximoVencimento,
          projeto_id: projeto_id || null,
          atualizado_em: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      ferramenta = data;

      // Remover alertas antigos e criar novos
      await supabaseAdmin
        .from('ferramentas_qualidade_alertas')
        .delete()
        .eq('ferramenta_id', id);

    } else {
      // Criar nova ferramenta
      const { data, error } = await supabaseAdmin
        .from('ferramentas_qualidade')
        .insert({
          tipo_ferramenta,
          titulo,
          dados,
          criado_por: userId,
          tags: tags || [],
          observacoes,
          tem_prazos: temPrazos,
          proximo_vencimento: proximoVencimento,
          projeto_id: projeto_id || null
        })
        .select()
        .single();

      if (error) throw error;
      ferramenta = data;
    }

    // Criar alertas
    if (alertas.length > 0) {
      const alertasParaInserir = alertas.map(a => ({
        ...a,
        ferramenta_id: ferramenta.id
      }));

      try {
      const { error: alertasError } = await supabaseAdmin
        .from('ferramentas_qualidade_alertas')
        .insert(alertasParaInserir);

      if (alertasError) {
        console.warn('⚠️ Erro ao criar alertas:', alertasError);
          // Não bloquear o salvamento se falhar ao criar alertas
        }
      } catch (err) {
        console.warn('⚠️ Erro ao inserir alertas (tabela pode não existir):', err.message);
        // Não bloquear o salvamento se falhar ao criar alertas
      }
    }

    res.json({
      success: true,
      ferramenta
    });
  } catch (error) {
    console.error('❌ Erro ao salvar ferramenta:', error);
    res.status(500).json({ success: false, error: 'Erro ao salvar ferramenta' });
  }
});

// Endpoint para excluir ferramenta
app.delete('/api/ferramentas-qualidade/:id', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    if (!userResult || !userResult.user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { id } = req.params;
    const userId = userResult.user.id;

    // Verificar se a ferramenta existe e se o usuário tem permissão
    const { data: ferramenta, error: fetchError } = await supabaseAdmin
      .from('ferramentas_qualidade')
      .select('id, criado_por')
      .eq('id', id)
      .single();

    if (fetchError || !ferramenta) {
      return res.status(404).json({ success: false, error: 'Ferramenta não encontrada' });
    }

    // Verificar se o usuário é o criador ou tem permissão de admin
    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .single();

    const isAdmin = userProfile?.role === 'admin';
    const isOwner = ferramenta.criado_por === userId;

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ success: false, error: 'Você não tem permissão para excluir esta ferramenta' });
    }

    // Excluir alertas relacionados primeiro (devido à foreign key com CASCADE)
    await supabaseAdmin
      .from('ferramentas_qualidade_alertas')
      .delete()
      .eq('ferramenta_id', id);

    // Excluir a ferramenta
    const { error: deleteError } = await supabaseAdmin
      .from('ferramentas_qualidade')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    res.json({ success: true, message: 'Ferramenta excluída com sucesso' });
  } catch (error) {
    console.error('❌ Erro ao excluir ferramenta:', error);
    res.status(500).json({ success: false, error: 'Erro ao excluir ferramenta' });
  }
});

// Endpoint para arquivar ferramenta
app.put('/api/ferramentas-qualidade/:id/arquivar', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    if (!userResult || !userResult.user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { id } = req.params;
    const userId = userResult.user.id;
    const { arquivado } = req.body;

    const { data, error } = await supabaseAdmin
      .from('ferramentas_qualidade')
      .update({ arquivado: arquivado !== false })
      .eq('id', id)
      .eq('criado_por', userId)
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, error: 'Ferramenta não encontrada' });
    }

    res.json({
      success: true,
      ferramenta: data
    });
  } catch (error) {
    console.error('❌ Erro ao arquivar ferramenta:', error);
    res.status(500).json({ success: false, error: 'Erro ao arquivar ferramenta' });
  }
});

// Endpoint para atualizar status de uma ação
app.put('/api/ferramentas-qualidade/acoes/:acaoId/atualizar', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    if (!userResult || !userResult.user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const userId = userResult.user.id;
    const { acaoId } = req.params;
    const { ferramenta_id, progresso, status, obs } = req.body;

    // Verificar se o usuário é responsável por esta ação
    const { data: alerta, error: alertaError } = await supabaseAdmin
      .from('ferramentas_qualidade_alertas')
      .select('*')
      .eq('ferramenta_id', ferramenta_id)
      .eq('acao_id', acaoId)
      .eq('responsavel_id', userId)
      .single();

    if (alertaError || !alerta) {
      return res.status(403).json({ success: false, error: 'Você não tem permissão para atualizar esta ação' });
    }

    // Buscar a ferramenta
    const { data: ferramenta, error: ferramentaError } = await supabaseAdmin
      .from('ferramentas_qualidade')
      .select('dados')
      .eq('id', ferramenta_id)
      .single();

    if (ferramentaError || !ferramenta) {
      return res.status(404).json({ success: false, error: 'Ferramenta não encontrada' });
    }

    // Atualizar a ação dentro dos dados da ferramenta
    const dados = ferramenta.dados || {};
    if (dados.acoes && Array.isArray(dados.acoes)) {
      const acaoIndex = dados.acoes.findIndex(a => a.id === acaoId);
      if (acaoIndex !== -1) {
        dados.acoes[acaoIndex].progresso = progresso !== undefined ? progresso : dados.acoes[acaoIndex].progresso;
        dados.acoes[acaoIndex].status = status || dados.acoes[acaoIndex].status;
        dados.acoes[acaoIndex].obs = obs !== undefined ? obs : dados.acoes[acaoIndex].obs;

        // Se progresso for 100%, marcar como finalizado
        if (progresso === 100) {
          dados.acoes[acaoIndex].status = 'finalizado';
        }
      }
    }

    // Atualizar a ferramenta
    const { error: updateError } = await supabaseAdmin
      .from('ferramentas_qualidade')
      .update({ dados: dados })
      .eq('id', ferramenta_id);

    if (updateError) throw updateError;

    // Atualizar o status do alerta se necessário
    let novoStatusAlerta = alerta.status;
    if (status === 'finalizado' || progresso === 100) {
      novoStatusAlerta = 'finalizado';
    } else if (status) {
      novoStatusAlerta = status;
    }

    if (novoStatusAlerta !== alerta.status) {
      await supabaseAdmin
        .from('ferramentas_qualidade_alertas')
        .update({ status: novoStatusAlerta })
        .eq('id', alerta.id);
    }

    res.json({
      success: true,
      message: 'Ação atualizada com sucesso'
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar ação:', error);
    res.status(500).json({ success: false, error: 'Erro ao atualizar ação' });
  }
});

// Função para verificar e atualizar status dos alertas automaticamente
async function verificarEAtualizarAlertas() {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    // Buscar alertas pendentes ou em alerta que precisam ser atualizados
    const { data: alertas, error } = await supabaseAdmin
      .from('ferramentas_qualidade_alertas')
      .select('*')
      .in('status', ['pendente', 'em_alerta']);

    if (error) {
      // Se a tabela não existir, apenas logar e retornar
      if (error.code === '42P01' || error.code === 'PGRST116') {
        return { atualizados: 0, verificados: 0 };
      }
      throw error;
    }

    if (!alertas || alertas.length === 0) {
      return { atualizados: 0, verificados: 0 };
    }

    let atualizados = 0;
    for (const alerta of alertas) {
      const prazoDate = new Date(alerta.prazo);
      prazoDate.setHours(0, 0, 0, 0);
      const diasRestantes = Math.floor((prazoDate - hoje) / (1000 * 60 * 60 * 24));
      
      let novoStatus = alerta.status;
      
      // Atualizar status baseado em dias restantes
      if (diasRestantes < 0) {
        novoStatus = 'vencido';
      } else if (diasRestantes <= 3 && novoStatus === 'pendente') {
        novoStatus = 'em_alerta';
      }

      // Se o status mudou, atualizar
      if (novoStatus !== alerta.status) {
        const updateData = {
          status: novoStatus,
          updated_at: new Date().toISOString()
        };

        // Marcar como alertado se ainda não foi
        if (novoStatus === 'vencido' && !alerta.alertado_responsavel) {
          updateData.alertado_responsavel = true;
          updateData.data_alert_responsavel = new Date().toISOString();
        }

        if (novoStatus === 'vencido' && alerta.superior_id && !alerta.alertado_superior) {
          updateData.alertado_superior = true;
          updateData.data_alert_superior = new Date().toISOString();
        }

        const { error: updateError } = await supabaseAdmin
          .from('ferramentas_qualidade_alertas')
          .update(updateData)
          .eq('id', alerta.id);

        if (!updateError) {
        atualizados++;
        }
      }
    }

    return { atualizados, verificados: alertas.length };
  } catch (error) {
    console.error('❌ Erro ao verificar alertas:', error);
    return { atualizados: 0, verificados: 0 };
  }
}

// Verificar alertas a cada 1 hora
setInterval(async () => {
  const resultado = await verificarEAtualizarAlertas();
  if (resultado.atualizados > 0) {
    console.log(`✅ Alertas atualizados: ${resultado.atualizados} de ${resultado.verificados}`);
  }
}, 60 * 60 * 1000); // 1 hora

// Endpoint para verificar e atualizar alertas
app.post('/api/ferramentas-qualidade/alertas/verificar', async (req, res) => {
  try {
    const resultado = await verificarEAtualizarAlertas();
    res.json({
      success: true,
      alertasVerificados: resultado.verificados,
      alertasAtualizados: resultado.atualizados
    });
  } catch (error) {
    console.error('❌ Erro ao verificar alertas:', error);
    res.status(500).json({ success: false, error: 'Erro ao verificar alertas' });
  }
});

// ========== ROTAS DE INTEGRAÇÃO COM IA PARA FERRAMENTAS DE QUALIDADE ==========

// Rota para gerar análise SWOT com IA
app.post('/api/ferramentas-qualidade/ia/swot', async (req, res) => {
  try {
    if (!openai) {
      return res.status(503).json({ success: false, error: 'Serviço de IA não disponível' });
    }

    const { contexto } = req.body;
    if (!contexto) {
      return res.status(400).json({ success: false, error: 'Contexto é obrigatório' });
    }

    const prompt = `Com base no seguinte contexto/problema, gere uma análise SWOT completa com pelo menos 3 itens em cada quadrante:

Contexto: ${contexto}

Retorne APENAS um JSON válido no seguinte formato:
{
  "forcas": ["força 1", "força 2", "força 3"],
  "fraquezas": ["fraqueza 1", "fraqueza 2", "fraqueza 3"],
  "oportunidades": ["oportunidade 1", "oportunidade 2", "oportunidade 3"],
  "ameacas": ["ameaça 1", "ameaça 2", "ameaça 3"]
}
Não inclua texto adicional, apenas o JSON.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1000
    });

    const resposta = completion.choices[0].message.content.trim();
    let swot;
    
    // Tentar extrair JSON da resposta
    try {
      const jsonMatch = resposta.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        swot = JSON.parse(jsonMatch[0]);
      } else {
        swot = JSON.parse(resposta);
      }
    } catch (parseError) {
      console.error('Erro ao parsear resposta da IA:', parseError);
      console.error('Resposta recebida:', resposta);
      return res.status(500).json({ 
        success: false, 
        error: 'Erro ao processar resposta da IA. A resposta pode não estar em formato JSON válido.' 
      });
    }

    res.json({ success: true, swot });
  } catch (error) {
    console.error('❌ Erro ao gerar SWOT com IA:', error);
    console.error('❌ Stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao gerar análise SWOT: ' + (error.message || 'Erro desconhecido') 
    });
  }
});

// Rota para analisar priorização com IA (Força x Impacto)
app.post('/api/ferramentas-qualidade/ia/priorizacao', async (req, res) => {
  try {
    if (!openai) {
      return res.status(503).json({ success: false, error: 'Serviço de IA não disponível' });
    }

    const { itens } = req.body;
    if (!itens) {
      return res.status(400).json({ success: false, error: 'Itens são obrigatórios' });
    }

    const prompt = `Analise os seguintes itens e atribua uma pontuação de 1 a 5 para FORÇA (facilidade de implementação) e IMPACTO (benefício esperado):

Itens: ${itens}

Retorne APENAS um JSON válido no seguinte formato:
[
  {"forca": 3, "impacto": 4},
  {"forca": 4, "impacto": 3},
  ...
]

Onde cada objeto corresponde a um item na ordem fornecida. Força e Impacto devem ser números de 1 a 5.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 500
    });

    const resposta = completion.choices[0].message.content.trim();
    let priorizacoes;
    
    try {
      const jsonMatch = resposta.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        priorizacoes = JSON.parse(jsonMatch[0]);
      } else {
        priorizacoes = JSON.parse(resposta);
      }
    } catch (parseError) {
      console.error('Erro ao parsear resposta da IA:', parseError);
      console.error('Resposta recebida:', resposta);
      return res.status(500).json({ 
        success: false, 
        error: 'Erro ao processar resposta da IA. A resposta pode não estar em formato JSON válido.' 
      });
    }

    res.json({ success: true, priorizacoes });
  } catch (error) {
    console.error('❌ Erro ao analisar priorização com IA:', error);
    console.error('❌ Stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao analisar priorização: ' + (error.message || 'Erro desconhecido') 
    });
  }
});

// Rota para assistente geral de ferramentas de qualidade
app.post('/api/ferramentas-qualidade/ia/assistente', async (req, res) => {
  try {
    if (!openai) {
      return res.status(503).json({ success: false, error: 'Serviço de IA não disponível' });
    }

    const { ferramenta, prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt é obrigatório' });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Você é um assistente especializado em ferramentas de qualidade e melhoria contínua. Responda de forma clara, objetiva e prática.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 800
    });

    const resposta = completion.choices[0].message.content.trim();
    res.json({ success: true, resposta });
  } catch (error) {
    console.error('❌ Erro ao obter ajuda da IA:', error);
    console.error('❌ Stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao obter ajuda: ' + (error.message || 'Erro desconhecido') 
    });
  }
});

// Rota para gerar relatório completo com IA
app.post('/api/ferramentas-qualidade/ia/relatorio', async (req, res) => {
  try {
    if (!openai) {
      return res.status(503).json({ success: false, error: 'Serviço de IA não disponível' });
    }

    let userResult;
    try {
      userResult = await getUserFromRequest(req);
    } catch (authError) {
      console.warn('⚠️ Erro ao obter usuário da requisição:', authError);
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }
    
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { titulo, contexto, projeto_id } = req.body;

    // Buscar ferramentas do projeto específico ou do usuário
    let ferramentas = [];
    try {
      let query = supabaseAdmin
        .from('ferramentas_qualidade')
        .select('tipo_ferramenta, titulo, dados')
        .eq('criado_por', userId);
      
      // Se projeto_id foi fornecido, buscar apenas ferramentas desse projeto
      if (projeto_id) {
        query = query.eq('projeto_id', projeto_id);
        console.log(`📋 Buscando ferramentas do projeto: ${projeto_id}`);
      } else {
        // Buscar últimas 20 ferramentas do usuário
        query = query.order('criado_em', { ascending: false }).limit(20);
        console.log('📋 Buscando últimas ferramentas do usuário');
      }
      
      const { data, error: ferramentasError } = await query;
      
      if (!ferramentasError && data) {
        ferramentas = data;
        console.log(`✅ Encontradas ${ferramentas.length} ferramentas`);
      }
    } catch (dbError) {
      console.warn('⚠️ Erro ao buscar ferramentas para contexto:', dbError);
      // Continuar sem contexto de ferramentas
    }

    // Buscar informações do projeto se projeto_id foi fornecido
    let projetoInfo = '';
    if (projeto_id) {
      try {
        const { data: projeto, error: projetoError } = await supabaseAdmin
          .from('projetos_qualidade')
          .select('titulo, problema, descricao')
          .eq('id', projeto_id)
          .eq('criado_por', userId)
          .single();
        
        if (!projetoError && projeto) {
          projetoInfo = `
Projeto: ${projeto.titulo}
Problema: ${projeto.problema || 'Não especificado'}
${projeto.descricao ? `Descrição: ${projeto.descricao}` : ''}
`;
        }
      } catch (projError) {
        console.warn('⚠️ Erro ao buscar informações do projeto:', projError);
      }
    }

    let contextoFerramentas = '';
    if (ferramentas && ferramentas.length > 0) {
      contextoFerramentas = ferramentas.map(f => {
        let resumo = `\n- ${f.tipo_ferramenta}: ${f.titulo}`;
        if (f.dados) {
          if (f.tipo_ferramenta === 'swot' && f.dados.itens) {
            resumo += `\n  Forças: ${f.dados.itens.forcas?.length || 0}, Fraquezas: ${f.dados.itens.fraquezas?.length || 0}`;
          } else if (f.tipo_ferramenta === 'plano_acao' && f.dados.acoes) {
            resumo += `\n  Ações: ${f.dados.acoes.length}`;
          }
        }
        return resumo;
      }).join('\n');
    }

    const prompt = `Gere um relatório completo e profissional de análise de qualidade com base nas seguintes informações:

${projetoInfo ? projetoInfo + '\n' : ''}Título: ${titulo || 'Relatório de Análise'}
Contexto Adicional: ${contexto || 'Nenhum contexto adicional fornecido'}

Ferramentas Utilizadas neste Projeto:
${contextoFerramentas || 'Nenhuma ferramenta encontrada'}

O relatório deve incluir:
1. Resumo Executivo
2. Problema Identificado${projetoInfo ? ' (do projeto)' : ''}
3. Análise Realizada (com base nas ferramentas utilizadas)
4. Causas Raiz Identificadas
5. Ações Planejadas
6. Resultados Esperados
7. Próximos Passos

Formate o relatório de forma profissional, usando markdown para títulos e listas.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Você é um especialista em qualidade e melhoria contínua. Gere relatórios profissionais e estruturados.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 2000
    });

    const relatorio = completion.choices[0].message.content.trim();
    res.json({ success: true, relatorio });
  } catch (error) {
    console.error('❌ Erro ao gerar relatório com IA:', error);
    console.error('❌ Stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao gerar relatório: ' + (error.message || 'Erro desconhecido') 
    });
  }
});

// Rota para feedback da IA
app.post('/api/ferramentas-qualidade/ia/feedback', async (req, res) => {
  try {
    if (!openai) {
      return res.status(503).json({ success: false, error: 'Serviço de IA não disponível' });
    }

    let userResult;
    try {
      userResult = await getUserFromRequest(req);
    } catch (authError) {
      console.warn('⚠️ Erro ao obter usuário da requisição:', authError);
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }
    
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { feedback } = req.body;
    if (!feedback) {
      return res.status(400).json({ success: false, error: 'Feedback é obrigatório' });
    }

    // Buscar contexto das ferramentas do usuário
    let ferramentas = [];
    try {
      const { data, error: ferramentasError } = await supabaseAdmin
        .from('ferramentas_qualidade')
        .select('tipo_ferramenta, titulo, dados')
        .eq('criado_por', userId)
        .order('criado_em', { ascending: false })
        .limit(10);
      
      if (!ferramentasError && data) {
        ferramentas = data;
      }
    } catch (dbError) {
      console.warn('⚠️ Erro ao buscar ferramentas para contexto:', dbError);
      // Continuar sem contexto de ferramentas
    }

    let contextoFerramentas = '';
    if (ferramentas && ferramentas.length > 0) {
      contextoFerramentas = ferramentas.map(f => `${f.tipo_ferramenta}: ${f.titulo}`).join(', ');
    }

    const prompt = `Com base no contexto das ferramentas de qualidade utilizadas (${contextoFerramentas || 'nenhuma'}), responda à seguinte pergunta/feedback:

${feedback}

Forneça uma resposta útil, prática e baseada em melhores práticas de qualidade e melhoria contínua.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Você é um consultor especializado em qualidade e melhoria contínua. Forneça insights práticos e acionáveis.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });

    const resposta = completion.choices[0].message.content.trim();
    res.json({ success: true, resposta });
  } catch (error) {
    console.error('❌ Erro ao obter feedback da IA:', error);
    console.error('❌ Stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao obter feedback: ' + (error.message || 'Erro desconhecido') 
    });
  }
});

// ========== FIM DAS ROTAS DE FERRAMENTAS DE QUALIDADE ==========

// ========== ROTAS DE PROJETOS/ANÁLISES DE QUALIDADE ==========

// Criar novo projeto/análise
app.post('/api/projetos-qualidade', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { titulo, descricao, problema, tags } = req.body;

    if (!titulo) {
      return res.status(400).json({ success: false, error: 'Título é obrigatório' });
    }

    const { data, error } = await supabaseAdmin
      .from('projetos_qualidade')
      .insert({
        titulo,
        descricao: descricao || null,
        problema: problema || null,
        criado_por: userId,
        tags: tags || [],
        status: 'em_andamento'
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, projeto: data });
  } catch (error) {
    console.error('❌ Erro ao criar projeto:', error);
    res.status(500).json({ success: false, error: 'Erro ao criar projeto: ' + error.message });
  }
});

// Listar projetos do usuário
app.get('/api/projetos-qualidade', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { status, busca } = req.query;

    let query = supabaseAdmin
      .from('projetos_qualidade')
      .select('*')
      .eq('criado_por', userId)
      .order('criado_em', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: projetos, error } = await query;

    if (error) throw error;

    // Buscar contagem de ferramentas para cada projeto
    const projetosComFerramentas = await Promise.all(projetos.map(async (projeto) => {
      const { count } = await supabaseAdmin
        .from('ferramentas_qualidade')
        .select('*', { count: 'exact', head: true })
        .eq('projeto_id', projeto.id);

      return {
        ...projeto,
        total_ferramentas: count || 0
      };
    }));

    // Filtrar por busca se fornecido
    let projetosFiltrados = projetosComFerramentas;
    if (busca) {
      const buscaLower = busca.toLowerCase();
      projetosFiltrados = projetosComFerramentas.filter(p => 
        p.titulo.toLowerCase().includes(buscaLower) ||
        (p.descricao && p.descricao.toLowerCase().includes(buscaLower)) ||
        (p.problema && p.problema.toLowerCase().includes(buscaLower))
      );
    }

    res.json({ success: true, projetos: projetosFiltrados });
  } catch (error) {
    console.error('❌ Erro ao listar projetos:', error);
    res.status(500).json({ success: false, error: 'Erro ao listar projetos: ' + error.message });
  }
});

// Buscar projeto específico com todas as ferramentas
app.get('/api/projetos-qualidade/:id', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { id } = req.params;

    // Buscar projeto
    const { data: projeto, error: projetoError } = await supabaseAdmin
      .from('projetos_qualidade')
      .select('*')
      .eq('id', id)
      .eq('criado_por', userId)
      .single();

    if (projetoError || !projeto) {
      return res.status(404).json({ success: false, error: 'Projeto não encontrado' });
    }

    // Buscar todas as ferramentas do projeto
    const { data: ferramentas, error: ferramentasError } = await supabaseAdmin
      .from('ferramentas_qualidade')
      .select('*')
      .eq('projeto_id', id)
      .order('criado_em', { ascending: true });

    if (ferramentasError) {
      console.warn('⚠️ Erro ao buscar ferramentas:', ferramentasError);
    }

    res.json({
      success: true,
      projeto: {
        ...projeto,
        ferramentas: ferramentas || []
      }
    });
  } catch (error) {
    console.error('❌ Erro ao buscar projeto:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar projeto: ' + error.message });
  }
});

// Atualizar projeto
app.put('/api/projetos-qualidade/:id', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { id } = req.params;
    const { titulo, descricao, problema, status, tags, observacoes } = req.body;

    // Verificar se o projeto pertence ao usuário
    const { data: projetoExistente } = await supabaseAdmin
      .from('projetos_qualidade')
      .select('id, criado_por')
      .eq('id', id)
      .single();

    if (!projetoExistente || projetoExistente.criado_por !== userId) {
      return res.status(403).json({ success: false, error: 'Sem permissão para atualizar este projeto' });
    }

    const updateData = {
      atualizado_em: new Date().toISOString()
    };

    if (titulo !== undefined) updateData.titulo = titulo;
    if (descricao !== undefined) updateData.descricao = descricao;
    if (problema !== undefined) updateData.problema = problema;
    if (status !== undefined) {
      updateData.status = status;
      if (status === 'concluido') {
        updateData.concluido_em = new Date().toISOString();
      }
    }
    if (tags !== undefined) updateData.tags = tags;
    if (observacoes !== undefined) updateData.observacoes = observacoes;

    const { data, error } = await supabaseAdmin
      .from('projetos_qualidade')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, projeto: data });
  } catch (error) {
    console.error('❌ Erro ao atualizar projeto:', error);
    res.status(500).json({ success: false, error: 'Erro ao atualizar projeto: ' + error.message });
  }
});

// Deletar projeto
app.delete('/api/projetos-qualidade/:id', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { id } = req.params;

    // Verificar se o projeto pertence ao usuário
    const { data: projetoExistente } = await supabaseAdmin
      .from('projetos_qualidade')
      .select('id, criado_por')
      .eq('id', id)
      .single();

    if (!projetoExistente || projetoExistente.criado_por !== userId) {
      return res.status(403).json({ success: false, error: 'Sem permissão para deletar este projeto' });
    }

    // Deletar projeto (as ferramentas terão projeto_id = null devido ao ON DELETE SET NULL)
    const { error } = await supabaseAdmin
      .from('projetos_qualidade')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true, message: 'Projeto deletado com sucesso' });
  } catch (error) {
    console.error('❌ Erro ao deletar projeto:', error);
    res.status(500).json({ success: false, error: 'Erro ao deletar projeto: ' + error.message });
  }
});

// ========== FIM DAS ROTAS DE PROJETOS ==========

// ========== PAINEL DE QUALIDADE ==========
// Endpoint para buscar TODAS as ferramentas (com permissões)
app.get('/api/ferramentas-qualidade/painel', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    // Verificar permissão para visualizar painel
    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    const isAdmin = userProfile?.role === 'admin';

    // Verificar permissão - qualquer permissão de qualidade permite visualizar o painel
    const { data: permissoes } = await supabaseAdmin
      .from('permissoes_portal')
      .select('permissao_id')
      .eq('usuario_id', userId)
      .eq('tipo', 'qualidade');

    const temPermissao = isAdmin || (permissoes && permissoes.length > 0);

    if (!temPermissao) {
      return res.status(403).json({ 
        success: false, 
        error: 'Você não tem permissão para visualizar o painel de qualidade' 
      });
    }

    // Parâmetros de filtro
    const { 
      tipo_ferramenta, 
      arquivado, 
      responsavel_id, 
      status_alerta,
      busca,
      limit = 50,
      offset = 0
    } = req.query;

    // Construir query base
    let query = supabaseAdmin
      .from('ferramentas_qualidade')
      .select('*')
      .order('criado_em', { ascending: false });

    // Aplicar filtros
    if (arquivado !== undefined) {
      query = query.eq('arquivado', arquivado === 'true');
    } else {
      query = query.eq('arquivado', false); // Por padrão, não mostrar arquivadas
    }

    if (tipo_ferramenta) {
      query = query.eq('tipo_ferramenta', tipo_ferramenta);
    }

    if (busca) {
      query = query.or(`titulo.ilike.%${busca}%,observacoes.ilike.%${busca}%`);
    }

    // Limitar e paginar
    query = query.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    const { data: ferramentas, error } = await query;

    if (error) throw error;

    // Buscar dados dos criadores
    const criadoresIds = [...new Set((ferramentas || []).map(f => f.criado_por).filter(Boolean))];
    const criadoresMap = {};
    
    if (criadoresIds.length > 0) {
      const { data: criadores } = await supabaseAdmin
        .from('user_profiles')
        .select('id, nome, email, departamento, cargo')
        .in('id', criadoresIds);
      
      if (criadores) {
        criadores.forEach(c => {
          criadoresMap[c.id] = c;
        });
      }
    }

    // Buscar alertas relacionados se necessário
    let ferramentasComAlertas = [];
    if (ferramentas && ferramentas.length > 0) {
      const ferramentaIds = ferramentas.map(f => f.id);
      
      // Buscar alertas
      const { data: alertas } = await supabaseAdmin
        .from('ferramentas_qualidade_alertas')
        .select('*')
        .in('ferramenta_id', ferramentaIds);

      // Agrupar alertas por ferramenta
      const alertasPorFerramenta = {};
      if (alertas) {
        alertas.forEach(alerta => {
          if (!alertasPorFerramenta[alerta.ferramenta_id]) {
            alertasPorFerramenta[alerta.ferramenta_id] = [];
          }
          alertasPorFerramenta[alerta.ferramenta_id].push(alerta);
        });
      }

      // Combinar ferramentas com alertas e dados do criador
      ferramentasComAlertas = ferramentas.map(ferramenta => {
        // Adicionar dados do criador
        ferramenta.criado_por_user = criadoresMap[ferramenta.criado_por] || null;
        
        const alertasFerramenta = alertasPorFerramenta[ferramenta.id] || [];
        
        // Filtrar por responsável se necessário
        if (responsavel_id) {
          const alertasFiltrados = alertasFerramenta.filter(a => 
            a.responsavel_id === responsavel_id || a.superior_id === responsavel_id
          );
          if (alertasFiltrados.length === 0 && ferramenta.tipo_ferramenta !== 'plano_acao') {
            return null; // Não tem ações deste responsável
          }
          ferramenta.alertas = alertasFiltrados;
        } else {
          ferramenta.alertas = alertasFerramenta;
        }

        // Filtrar por status de alerta se necessário
        if (status_alerta) {
          const alertasComStatus = ferramenta.alertas.filter(a => a.status === status_alerta);
          if (alertasComStatus.length === 0 && ferramenta.tipo_ferramenta === 'plano_acao') {
            return null; // Não tem alertas com este status
          }
          ferramenta.alertas = alertasComStatus;
        }

        // Calcular estatísticas
        ferramenta.total_acoes = ferramenta.tipo_ferramenta === 'plano_acao' 
          ? (ferramenta.dados?.acoes?.length || 0) 
          : 0;
        ferramenta.acoes_pendentes = ferramenta.alertas.filter(a => 
          a.status === 'pendente' || a.status === 'em_alerta'
        ).length;
        ferramenta.acoes_vencidas = ferramenta.alertas.filter(a => a.status === 'vencido').length;

        return ferramenta;
      }).filter(f => f !== null);
    }

    // Contar total (para paginação)
    let countQuery = supabaseAdmin
      .from('ferramentas_qualidade')
      .select('*', { count: 'exact', head: true })
      .eq('arquivado', arquivado !== undefined ? arquivado === 'true' : false);

    if (tipo_ferramenta) {
      countQuery = countQuery.eq('tipo_ferramenta', tipo_ferramenta);
    }

    if (busca) {
      countQuery = countQuery.or(`titulo.ilike.%${busca}%,observacoes.ilike.%${busca}%`);
    }

    const { count } = await countQuery;

    res.json({
      success: true,
      ferramentas: ferramentasComAlertas,
      total: count || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('❌ Erro ao buscar ferramentas do painel:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar ferramentas' });
  }
});
// Endpoint para buscar ferramenta específica do painel (sem restrição de criador)
app.get('/api/ferramentas-qualidade/painel/:id', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    // Verificar permissão
    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    const isAdmin = userProfile?.role === 'admin';

    // Verificar permissão - qualquer permissão de qualidade permite visualizar o painel
    const { data: permissoes } = await supabaseAdmin
      .from('permissoes_portal')
      .select('permissao_id')
      .eq('usuario_id', userId)
      .eq('tipo', 'qualidade');

    const temPermissao = isAdmin || (permissoes && permissoes.length > 0);

    if (!temPermissao) {
      return res.status(403).json({ 
        success: false, 
        error: 'Você não tem permissão para visualizar o painel de qualidade' 
      });
    }

    const { id } = req.params;

    // Buscar ferramenta
    const { data: ferramenta, error } = await supabaseAdmin
      .from('ferramentas_qualidade')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!ferramenta) {
      return res.status(404).json({ success: false, error: 'Ferramenta não encontrada' });
    }

    // Buscar dados do criador
    if (ferramenta.criado_por) {
      const { data: criador } = await supabaseAdmin
        .from('user_profiles')
        .select('id, nome, email, departamento, cargo')
        .eq('id', ferramenta.criado_por)
        .maybeSingle();
      ferramenta.criado_por_user = criador || null;
    }

    // Buscar alertas relacionados
    const { data: alertas } = await supabaseAdmin
      .from('ferramentas_qualidade_alertas')
      .select('*')
      .eq('ferramenta_id', id);

    // Buscar dados dos responsáveis e superiores
    const responsaveisIds = [...new Set([
      ...(alertas || []).map(a => a.responsavel_id).filter(Boolean),
      ...(alertas || []).map(a => a.superior_id).filter(Boolean)
    ])];

    const responsaveisMap = {};
    if (responsaveisIds.length > 0) {
      const { data: responsaveis } = await supabaseAdmin
        .from('user_profiles')
        .select('id, nome, email')
        .in('id', responsaveisIds);
      
      if (responsaveis) {
        responsaveis.forEach(r => {
          responsaveisMap[r.id] = r;
        });
      }
    }

    // Adicionar dados dos responsáveis aos alertas
    ferramenta.alertas = (alertas || []).map(alerta => {
      return {
        ...alerta,
        responsavel: responsaveisMap[alerta.responsavel_id] || null,
        superior: responsaveisMap[alerta.superior_id] || null
      };
    });

    res.json({
      success: true,
      ferramenta
    });
  } catch (error) {
    console.error('❌ Erro ao buscar ferramenta do painel:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar ferramenta' });
  }
});

// ========== MIDDLEWARE DE ERRO ==========
app.use((err, req, res, next) => {
  console.error('❌ Erro não tratado:', err);
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    details: process.env.DEBUG_MODE ? err.message : 'Contate o administrador'
  });
});

// ========== ROTA 404 ==========
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Rota não encontrada',
    path: req.originalUrl
  });
});

// ========== INICIALIZAÇÃO DO SERVIDOR ==========
// ========== ENDPOINT DE MIGRAÇÃO PARA NORMALIZAR TIPOS DE VEÍCULO E CARROCERIA ==========
app.post('/api/migracao/normalizar-tipos', requireAuth, async (req, res) => {
  try {
    // Verificar se é admin
    const usuario = req.session?.usuario;
    if (!usuario) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    // Buscar role do usuário
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', usuario)
      .maybeSingle();

    if (profileError || !userProfile || userProfile.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Acesso negado. Apenas administradores podem executar migrações.' });
    }

    console.log('🔄 Iniciando migração de normalização de tipos de veículo e carroceria...');

    // Buscar todos os motoristas
    const { data: motoristas, error: fetchError } = await supabaseAdmin
      .from('motoristas')
      .select('id, tipo_veiculo, tipo_carroceria');

    if (fetchError) {
      throw fetchError;
    }

    let atualizados = 0;
    let erros = [];
    const atualizacoes = [];

    // Processar cada motorista
    for (const motorista of motoristas || []) {
      const atualizacao = { id: motorista.id };
      let precisaAtualizar = false;

      // Normalizar tipo_veiculo
      if (motorista.tipo_veiculo) {
        const tipoVeiculoNormalizado = normalizeTipoVeiculo(motorista.tipo_veiculo);
        if (tipoVeiculoNormalizado !== motorista.tipo_veiculo) {
          atualizacao.tipo_veiculo = tipoVeiculoNormalizado;
          precisaAtualizar = true;
        }
      }

      // Normalizar tipo_carroceria
      if (motorista.tipo_carroceria) {
        const tipoCarroceriaNormalizado = normalizeTipoCarroceria(motorista.tipo_carroceria);
        if (tipoCarroceriaNormalizado !== motorista.tipo_carroceria) {
          atualizacao.tipo_carroceria = tipoCarroceriaNormalizado;
          precisaAtualizar = true;
        }
      }

      // Se precisa atualizar, adicionar à lista
      if (precisaAtualizar) {
        atualizacoes.push(atualizacao);
      }
    }

    // Executar atualizações em lote
    console.log(`📊 ${atualizacoes.length} registros precisam ser atualizados de ${motoristas?.length || 0} total`);

    for (const atualizacao of atualizacoes) {
      try {
        const { id, ...dados } = atualizacao;
        const { error: updateError } = await supabaseAdmin
          .from('motoristas')
          .update(dados)
          .eq('id', id);

        if (updateError) {
          console.error(`❌ Erro ao atualizar motorista ${id}:`, updateError);
          erros.push({ id, erro: updateError.message });
        } else {
          atualizados++;
          console.log(`✅ Motorista ${id} atualizado:`, dados);
        }
      } catch (error) {
        console.error(`❌ Erro ao atualizar motorista ${atualizacao.id}:`, error);
        erros.push({ id: atualizacao.id, erro: error.message });
      }
    }

    console.log(`✅ Migração concluída: ${atualizados} atualizados, ${erros.length} erros`);

    res.json({
      success: true,
      total: motoristas?.length || 0,
      atualizados,
      erros: erros.length,
      detalhesErros: erros.length > 0 ? erros : undefined,
      mensagem: `Migração concluída: ${atualizados} de ${motoristas?.length || 0} registros atualizados com sucesso.`
    });

  } catch (error) {
    console.error('❌ Erro na migração:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao executar migração: ' + error.message
    });
  }
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, '0.0.0.0', async () => {
  console.log('================================');
  console.log('🎯 Servidor rodando!');
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🌐 Externo: http://SEU-IP:${PORT}`);
  console.log(`🐳 Evolution: ${EVOLUTION_CONFIG.baseUrl}`);
  console.log(`🔐 Login ativo: ${Object.keys(usuarios).join(', ')}`);
  console.log('💾 Configurações: Supabase');
  console.log('================================');
  
  try {
    const contatosRestaurados = await restaurarBackupContatos();
    if (contatosRestaurados > 0) {
      console.log(`🔄 ${contatosRestaurados} contatos restaurados do backup`);
    }
  } catch (error) {
    console.log('⚠️ Não foi possível restaurar backup');
  }
  
  // Testar configurações do Supabase
  try {
    const result = await listarConfiguracoesSimples();
    if (result.success) {
      console.log(`⚙️ ${result.data.length} configurações carregadas do Supabase`);
    } else {
      console.log('⚠️ Não foi possível carregar configurações do Supabase');
    }
  } catch (error) {
    console.log('⚠️ Erro ao testar configurações do Supabase');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🔄 Encerrando servidor...');
  db.close((err) => {
    if (err) {
      console.error('❌ Erro ao fechar banco:', err);
    } else {
      console.log('✅ Banco de dados fechado');
    }
    process.exit(0);
  });
});