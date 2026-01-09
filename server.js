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
const { validate } = require('./backend/middleware/validation');
const { logger } = require('./backend/utils/logger');
const OpenAI = require('openai');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const readFile = promisify(fs.readFile);
const XLSX = require('xlsx');

// Tentar carregar ffmpeg (opcional - apenas se disponível)
let ffmpeg = null;
let ffmpegAvailable = false;
try {
  ffmpeg = require('fluent-ffmpeg');
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  if (ffmpegInstaller && ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
    ffmpegAvailable = true;
    console.log('✅ FFmpeg disponível - conversão de áudio habilitada');
  } else {
    throw new Error('FFmpeg installer path não encontrado');
  }
} catch (error) {
  console.warn('⚠️ FFmpeg não disponível - conversão de áudio desabilitada.');
  console.warn('   Motivo:', error.message || 'Dependências não instaladas');
  console.warn('   O sistema continuará funcionando normalmente.');
  console.warn('   Áudios serão enviados no formato original (WebM/OGG).');
  ffmpegAvailable = false;
}

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
        mediaSrc: ["'self'", "blob:"],
        frameSrc: ["'self'", "https://*.supabase.co", "https://docs.google.com", "https://view.officeapps.live.com"],
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
        mediaSrc: ["'self'", "blob:"],
        frameSrc: ["'self'", "https://*.supabase.co", "https://docs.google.com", "https://view.officeapps.live.com"],
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

// Upload para CSV (importação)
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

// Upload para mídia/imagens (disparos)
const uploadMedia = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    // Tipos MIME permitidos para imagens e áudio
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'audio/webm',
      'audio/ogg',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/mp4',
      'audio/aac',
      'audio/opus'
    ];
    
    // Extensões permitidas
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.webm', '.ogg', '.mp3', '.wav', '.mp4', '.aac', '.opus'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    // Verificar tipo MIME
    if (allowedMimes.includes(file.mimetype)) {
      // Verificar extensão também
      if (allowedExtensions.includes(fileExtension)) {
        cb(null, true);
      } else {
        cb(new Error('Extensão de arquivo não permitida. Apenas arquivos de imagem ou áudio são aceitos.'));
      }
    } else {
      cb(new Error('Tipo de arquivo não permitido. Apenas arquivos de imagem ou áudio são aceitos.'));
    }
  }
});

// Upload para documentos (imagens e PDFs)
const uploadDocumentos = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    // Tipos MIME permitidos para documentos (imagens e PDFs)
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'application/pdf',
      'application/x-pdf'
    ];
    
    // Extensões permitidas
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.pdf'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    // Verificar tipo MIME
    if (allowedMimes.includes(file.mimetype)) {
      // Verificar extensão também
      if (allowedExtensions.includes(fileExtension)) {
        cb(null, true);
      } else {
        cb(new Error('Extensão de arquivo não permitida. Apenas arquivos de imagem (JPG, PNG, GIF, WEBP, BMP) ou PDF são aceitos.'));
      }
    } else {
      cb(new Error('Tipo de arquivo não permitido. Apenas arquivos de imagem (JPG, PNG, GIF, WEBP, BMP) ou PDF são aceitos.'));
    }
  }
});

// 🔥 IMPORT DO SUPABASE SEGURO
const { supabase } = require('./backend/config/supabase-secure.js');
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
    
    // ✅ PRIMEIRO: Buscar na tabela user_evolution_apis (usada pelo settings.html)
    // O identificador pode ser email, ID do Supabase Auth (UUID) ou ID do user_profiles
    let userId = usuario;
    
    // Verificar se é um UUID (ID do Supabase Auth) - formato: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(usuario);
    
    if (isUUID) {
      logger.info(`🔑 Identificador é um UUID, tentando buscar diretamente: ${userId}`);
      // Se for UUID, pode ser ID do Supabase Auth ou ID do user_profiles
      // Primeiro, tentar buscar diretamente na tabela
      // Se não encontrar, tentar buscar o user_profiles pelo ID do Supabase Auth
      const { data: profileByAuthId, error: profileByAuthIdError } = await supabaseAdmin
        .from('user_profiles')
        .select('id')
        .eq('id', usuario)
        .maybeSingle();
      
      if (profileByAuthId && profileByAuthId.id) {
        logger.info(`✅ UUID corresponde ao ID do user_profiles: ${profileByAuthId.id}`);
        userId = profileByAuthId.id;
      } else {
        logger.info(`ℹ️ UUID não encontrado em user_profiles, usando diretamente como user_id`);
        // Usar o UUID diretamente - pode ser que o user_id na tabela seja o ID do Supabase Auth
      }
    } else if (usuario && typeof usuario === 'string' && usuario.includes('@')) {
      // Se o identificador for um email, buscar o ID do user_profiles
      logger.info(`📧 Identificador é um email, buscando user_profiles...`);
      const { data: profileData, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('id')
        .eq('email', usuario)
        .maybeSingle();
      
      if (profileError && profileError.code !== 'PGRST116') {
        logger.error(`❌ Erro ao buscar profile por email:`, profileError);
      }
      
      if (profileData && profileData.id) {
        userId = profileData.id;
        logger.info(`✅ ID do user_profiles encontrado: ${userId}`);
      } else {
        logger.warn(`⚠️ Profile não encontrado para email: ${usuario}`);
        // Se não encontrou o profile, retornar null - não tentar usar email como UUID
        return { error: 'Nenhuma configuração Evolution encontrada para ' + usuario };
      }
    }
    
    // Buscar na tabela user_evolution_apis usando o user_id
    logger.info(`🔍 Buscando em user_evolution_apis com user_id: ${userId}`);
    let { data: userEvolutionData, error: userEvolutionError } = await supabaseAdmin
      .from('user_evolution_apis')
      .select('*')
      .eq('user_id', userId)
      .eq('active', true)
      .maybeSingle();

    if (userEvolutionError && userEvolutionError.code !== 'PGRST116') {
      logger.error(`❌ Erro ao buscar user_evolution_apis:`, userEvolutionError);
    }
    
    // Se não encontrou, tentar buscar pelo ID do Supabase Auth diretamente (caso o user_id seja o ID do Auth)
    if (!userEvolutionData && isUUID && usuario === userId) {
      logger.info(`🔄 Tentando buscar com ID do Supabase Auth diretamente: ${usuario}`);
      const { data: configByAuthId, error: configByAuthIdError } = await supabaseAdmin
        .from('user_evolution_apis')
        .select('*')
        .eq('user_id', usuario)
        .eq('active', true)
        .maybeSingle();
      
      if (!configByAuthIdError && configByAuthId) {
        userEvolutionData = configByAuthId;
        logger.info(`✅ Config encontrada usando ID do Supabase Auth diretamente: ${userEvolutionData.instance_name}`);
      }
    }

    // Se não encontrou e o identificador original era um email, tentar buscar diretamente pelo email
    if (!userEvolutionData && usuario && typeof usuario === 'string' && usuario.includes('@')) {
      logger.info(`🔄 Tentando buscar diretamente pelo email na tabela user_evolution_apis...`);
      
      // Primeiro, tentar buscar o profile novamente com mais campos
      const { data: profileDataFull, error: profileErrorFull } = await supabaseAdmin
        .from('user_profiles')
        .select('id, email')
        .eq('email', usuario)
        .maybeSingle();
      
      if (profileDataFull && profileDataFull.id) {
        logger.info(`🔄 Tentando buscar com ID do profile: ${profileDataFull.id}`);
        const { data: configByProfileId, error: configByProfileIdError } = await supabaseAdmin
          .from('user_evolution_apis')
          .select('*')
          .eq('user_id', profileDataFull.id)
          .eq('active', true)
          .maybeSingle();
        
        if (!configByProfileIdError && configByProfileId) {
          userEvolutionData = configByProfileId;
          logger.info(`✅ Config encontrada via busca por profile ID: ${userEvolutionData.instance_name}`);
        }
      }
      
      // Se ainda não encontrou, buscar todos os registros ativos e verificar manualmente
      if (!userEvolutionData) {
        logger.info(`🔄 Buscando todas as configurações ativas para verificar manualmente...`);
        const { data: allConfigs, error: allConfigsError } = await supabaseAdmin
          .from('user_evolution_apis')
          .select('*')
          .eq('active', true);
        
        if (!allConfigsError && allConfigs && allConfigs.length > 0) {
          logger.info(`📋 Encontradas ${allConfigs.length} configurações ativas. Verificando correspondências...`);
          
          // Para cada configuração, verificar se o user_id corresponde a um profile com o email
          for (const config of allConfigs) {
            const { data: profileCheck, error: profileCheckError } = await supabaseAdmin
              .from('user_profiles')
              .select('id, email')
              .eq('id', config.user_id)
              .eq('email', usuario)
              .maybeSingle();
            
            if (!profileCheckError && profileCheck) {
              userEvolutionData = config;
              logger.info(`✅ Config encontrada via verificação manual: ${userEvolutionData.instance_name}`);
              break;
            }
          }
        }
      }
    }

    if (userEvolutionData) {
      logger.info(`✅ Config encontrada em user_evolution_apis para ${usuario}: ${userEvolutionData.instance_name}`);
      logger.info(`📋 Detalhes da config:`, {
        instance_name: userEvolutionData.instance_name,
        api_url: userEvolutionData.api_url,
        has_api_key: !!userEvolutionData.api_key,
        user_id: userEvolutionData.user_id
      });
      return {
        apiKey: userEvolutionData.api_key,
        instanceName: userEvolutionData.instance_name,
        webhookUrl: userEvolutionData.webhook_url || '',
        id: userEvolutionData.id,
        apiUrl: userEvolutionData.api_url,
        usuario: userEvolutionData.user_id
      };
    } else {
      logger.warn(`⚠️ Nenhuma configuração encontrada em user_evolution_apis para ${usuario} (user_id: ${userId})`);
    }
    
    // ✅ SEGUNDO: Buscar na tabela evolution_config (legado)
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

function normalizeEvolutionConfig(config) {
  if (!config) {
    console.log('⚠️ normalizeEvolutionConfig: config é null ou undefined');
    return null;
  }

  const apiUrl = config.apiUrl || config.api_url || EVOLUTION_CONFIG.baseUrl || process.env.EVOLUTION_BASE_URL;
  const apiKey = config.apiKey || config.api_key;
  const instanceName = config.instanceName || config.instance_name;

  console.log('🔍 normalizeEvolutionConfig - Valores extraídos:', {
    apiUrl: apiUrl ? `${apiUrl.substring(0, 30)}...` : 'N/A',
    hasApiKey: !!apiKey,
    instanceName: instanceName || 'N/A',
    rawConfig: config
  });

  if (!apiUrl || !apiKey || !instanceName) {
    console.error('❌ normalizeEvolutionConfig: Configuração incompleta', {
      hasApiUrl: !!apiUrl,
      hasApiKey: !!apiKey,
      hasInstanceName: !!instanceName
    });
    return null;
  }

  // Garantir que a URL não termina com barra
  const normalizedApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;

  return {
    apiUrl: normalizedApiUrl,
    apiKey,
    instanceName,
    webhookUrl: config.webhookUrl || config.webhook_url || '',
    source: config.source || 'user'
  };
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

// ========== MIDDLEWARE PARA HEADERS DE CACHE ==========
// IMPORTANTE: Este middleware DEVE estar ANTES de express.static
// Para garantir que os headers sejam aplicados corretamente
app.use((req, res, next) => {
  // Para arquivos HTML, forçar no-cache (sempre buscar versão mais recente)
  if (req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Last-Modified', new Date().toUTCString());
    // ETag único baseado em timestamp para forçar revalidação
    res.setHeader('ETag', `"${Date.now()}-${Math.random()}"`);
    // Header customizado para identificar versão (útil para debug)
    res.setHeader('X-Content-Version', Date.now().toString());
  }
  // Para arquivos JS e CSS, cache com revalidação (1 hora)
  else if (req.path.match(/\.(js|css)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  }
  // Para imagens e outros assets, cache mais longo (24 horas)
  else if (req.path.match(/\.(jpg|jpeg|png|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
  next();
});

// IMPORTANTE: Rotas HTML devem vir ANTES do express.static
// para evitar que arquivos estáticos interceptem as rotas

// Configurar express.static com opções que desabilitam cache automático
// Servir arquivos estáticos de public/ primeiro
app.use(express.static('public', {
  etag: false,
  lastModified: false
}));
// Manter raiz para arquivos que ainda estão lá (manifest, service-worker, etc)
app.use(express.static('.', {
  etag: false, // Desabilitar ETag padrão do Express (usamos nosso próprio)
  lastModified: false // Desabilitar Last-Modified padrão (usamos nosso próprio)
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rotas para PWA (manifest e service worker)
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

app.get('/service-worker.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'service-worker.js'));
});

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
  resave: true, // Salvar sessão mesmo se não modificada (garante persistência)
  saveUninitialized: false, // Não salvar sessões vazias
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: './',
    table: 'sessions'
  }),
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // HTTPS obrigatório em produção
    maxAge: 24 * 60 * 60 * 1000, // 24 horas
    httpOnly: true,
    sameSite: 'lax', // Permite cookies em requisições cross-site GET
    path: '/',
    // Garantir que o cookie seja enviado mesmo em requisições subsequentes
    domain: undefined // Não definir domain para funcionar em localhost e produção
  },
  // Garantir que a sessão seja salva mesmo se não modificada
  rolling: false, // Não renovar automaticamente (evita problemas)
  name: 'connect.sid' // Nome padrão do cookie de sessão
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
    // Verificar se a sessão existe e tem dados
    if (req.session) {
      // Verificar se o usuário está na sessão (pode ser string ou objeto)
      const usuarioId = req.session.usuario || req.session.userData?.id || req.session.userData?.email;
      
      if (usuarioId) {
        console.log('🔐 Usuário autenticado (sessão):', {
          usuario: req.session.usuario,
          userData: req.session.userData,
          sessionID: req.sessionID?.substring(0, 10) + '...'
        });
        return next();
      }

      // Debug: verificar o que está na sessão
      console.log('⚠️ Sessão existe mas sem usuário:', {
        temSession: !!req.session,
        temUsuario: !!req.session.usuario,
        temUserData: !!req.session.userData,
        sessionKeys: Object.keys(req.session || {}),
        sessionID: req.sessionID
      });
    } else {
      console.log('⚠️ Nenhuma sessão encontrada:', {
        sessionID: req.sessionID,
        cookies: req.headers.cookie ? 'presente' : 'ausente'
      });
    }

    // Para requisições de API (com header Authorization), tentar validar via Supabase
    const authHeader = req.headers.authorization || '';
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      const { user, error } = await getSupabaseUserFromRequest(req);
      if (user && !error) {
        req.supabaseUser = user;
        console.log('🔐 Usuário autenticado via Supabase:', user.email || user.id);
        return next();
      }
      if (error && error.status && error.status !== 401) {
        console.warn('⚠️ Erro ao validar token Supabase em requireAuth:', error.message || error);
      }
    }
  } catch (authError) {
    console.warn('⚠️ Erro inesperado no middleware requireAuth:', authError.message || authError);
  }

  console.log('❌ Acesso não autorizado');
  console.log('📋 Debug sessão:', {
    temSession: !!req.session,
    temUsuario: !!(req.session && req.session.usuario),
    usuario: req.session?.usuario,
    sessionID: req.sessionID,
    path: req.path,
    acceptsHtml: req.accepts('text/html'),
    cookies: req.headers.cookie ? 'presente' : 'ausente',
    userAgent: req.headers['user-agent']?.substring(0, 50)
  });
  
  // Se for uma requisição de página HTML, redirecionar para login
  if (req.path.endsWith('.html') || req.accepts('text/html')) {
    console.log(`🔄 Redirecionando ${req.path} para /login.html`);
    return res.redirect('/login.html');
  }
  
  // Caso contrário, retornar JSON
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

const MOTORISTA_SELECT_FIELDS = 'id, nome, status, telefone1, telefone2, estado, placa_cavalo, placa_carreta1, placa_carreta2, placa_carreta3, classe_veiculo, tipo_veiculo, tipo_carroceria, created_by_departamento, auth_user_id, created_by, usuario_id';

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
  
  // Normalizar estado - garantir que seja sempre string quando existir
  let estadoNormalizado = null;
  if (motorista.estado) {
    if (typeof motorista.estado === 'string') {
      estadoNormalizado = motorista.estado.trim().toUpperCase();
      if (estadoNormalizado.length === 0) estadoNormalizado = null;
    } else if (typeof motorista.estado === 'object' && motorista.estado !== null) {
      // Se vier como objeto, tentar extrair o valor
      estadoNormalizado = String(motorista.estado).trim().toUpperCase();
      if (estadoNormalizado.length === 0 || estadoNormalizado === '[OBJECT OBJECT]') estadoNormalizado = null;
    } else {
      estadoNormalizado = String(motorista.estado).trim().toUpperCase();
      if (estadoNormalizado.length === 0) estadoNormalizado = null;
    }
  }
  
  // Log para debug do estado
  console.log('🗺️ mapMotoristaResponse - estado:', {
    estadoOriginal: motorista.estado,
    estadoType: typeof motorista.estado,
    estadoNormalizado: estadoNormalizado,
    temEstado: !!estadoNormalizado
  });
  
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
    estado: estadoNormalizado,
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
    filial: coleta.filial || null,
    numeroColeta: coleta.numero_coleta || null,
    tiposVeiculo: coleta.tipos_veiculo || [],
    tiposCarroceria: coleta.tipos_carroceria || []
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

// Função auxiliar para confirmar automaticamente o e-mail de um usuário
async function confirmarEmailAutomaticamente(userId, email) {
  if (!userId) return;
  
  try {
    console.log(`📧 Confirmando automaticamente e-mail para: ${email || userId}`);
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { email_confirm: true }
    );
    
    if (error) {
      console.error('❌ Erro ao confirmar e-mail automaticamente:', error);
      return false;
    }
    
    console.log(`✅ E-mail confirmado automaticamente para: ${email || userId}`);
    return true;
  } catch (err) {
    console.error('❌ Erro ao confirmar e-mail:', err);
    return false;
  }
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
      
      // ✅ Confirmar automaticamente o e-mail se não estiver confirmado
      if (data.user && !data.user.email_confirmed_at) {
        console.log(`📧 E-mail não confirmado para ${data.user.email}. Confirmando automaticamente...`);
        
        try {
          const { data: updateData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
            data.user.id,
            { email_confirm: true }
          );
          
          if (updateError) {
            console.error('❌ Erro ao confirmar e-mail automaticamente:', updateError);
          } else {
            console.log(`✅ E-mail confirmado automaticamente para: ${data.user.email}`);
            // Atualizar o objeto user para refletir a confirmação
            data.user.email_confirmed_at = new Date().toISOString();
          }
        } catch (confirmError) {
          console.error('❌ Erro ao confirmar e-mail:', confirmError);
          // Continuar mesmo se houver erro na confirmação
        }
      }
      
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
    status: 'ativo', // Status já inicia como ativo - análise final será na etapa GR
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

      // Log para verificar se o estado está sendo retornado da sessão
      console.log('🔍 requireMotoristaAuth (sessão) - Motorista encontrado:', {
        id: motorista.id,
        estado: motorista.estado,
        temEstado: !!motorista.estado,
        estadoType: typeof motorista.estado
      });

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
    
    // Log para verificar se o estado está sendo retornado
    if (data) {
      console.log('🔍 requireMotoristaAuth - Motorista encontrado:', {
        id: data.id,
        estado: data.estado,
        temEstado: !!data.estado,
        estadoType: typeof data.estado
      });
    }

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
  console.log('🔐 === TENTATIVA DE LOGIN ===');
  console.log('📋 Body recebido:', { usuario: req.body?.usuario, temSenha: !!req.body?.senha });
  console.log('📋 SessionID:', req.sessionID);
  console.log('📋 Cookies recebidos:', req.headers.cookie ? 'SIM' : 'NÃO');
  
  // Validar dados de entrada
  const validation = validate('login', req.body);
  console.log('✅ Validação:', validation.isValid ? 'VÁLIDA' : 'INVÁLIDA');
  
  if (!validation.isValid) {
    console.log('❌ Erros de validação:', validation.errors);
    return res.status(400).json({ 
      success: false, 
      error: 'Dados inválidos', 
      details: validation.errors 
    });
  }

  const { usuario, senha } = validation.value;
  console.log('✅ Usuário extraído:', usuario);
  
  logger.info('Tentativa de login', { usuario, sessionID: req.sessionID });

  try {
    console.log('🔍 Tentando autenticação via Supabase...');
    // ✅ PRIMEIRO: Tentar autenticação via Supabase
    const { data: usuarios, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', usuario)
      .limit(1);

    console.log('📊 Resultado Supabase:', {
      temErro: !!error,
      erro: error?.message,
      encontrouUsuarios: usuarios?.length || 0
    });

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

      // ✅ SALVAR A SESSÃO - CRÍTICO: garantir que seja salva
      // Marcar sessão como modificada para forçar salvamento
      req.session.touch();
      
      req.session.save((err) => {
        if (err) {
          console.error('❌ Erro ao salvar sessão:', err);
          return res.status(500).json({ success: false, error: 'Erro de sessão' });
        }
        
        console.log('💾 Sessão salva com sucesso!');
        console.log('🔐 Sessão após save:', {
          usuario: req.session.usuario,
          userData: req.session.userData,
          sessionID: req.sessionID,
          cookie: req.session.cookie
        });
        
        // Verificar se realmente foi salva
        if (!req.session.usuario) {
          console.error('❌ CRÍTICO: Sessão não contém usuário após save!');
        }
        
        // Verificar se o cookie está sendo enviado
        const setCookieHeader = res.getHeader('Set-Cookie');
        console.log('🍪 Cookie sendo enviado:', setCookieHeader ? 'SIM' : 'NÃO');
        if (setCookieHeader) {
          console.log('🍪 Set-Cookie header:', Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader);
        }
        
        res.json({ 
          success: true, 
          usuario: usuarioData.id,
          nome: usuarioData.nome,
          permissoes: permissoes,
          isAdmin: usuarioData.is_admin || false,
          config: userConfig,
          source: 'supabase',
          sessionID: req.sessionID
        });
      });

      return;
    }

    // ✅ SEGUNDO: Fallback para autenticação via .env
    console.log('🔍 Tentando autenticação via .env...');
    console.log('📋 Usuários disponíveis no .env:', Object.keys(usuarios));
    logger.info('Tentando autenticação via .env', { usuario });
    
    if (usuarios[usuario] && usuarios[usuario] === senha) {
      console.log('✅ Autenticação via .env bem-sucedida!');
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

      // ✅ SALVAR A SESSÃO - CRÍTICO: garantir que seja salva
      // Marcar sessão como modificada para forçar salvamento
      req.session.touch();
      
      req.session.save((err) => {
        if (err) {
          console.error('❌ Erro ao salvar sessão:', err);
          return res.status(500).json({ success: false, error: 'Erro de sessão' });
        }
        
        console.log('💾 Sessão salva com sucesso (ENV)!');
        console.log('🔐 Sessão após save:', {
          usuario: req.session.usuario,
          userData: req.session.userData,
          sessionID: req.sessionID
        });
        
        // Verificar se realmente foi salva
        if (!req.session.usuario) {
          console.error('❌ CRÍTICO: Sessão não contém usuário após save!');
        }
        
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
    console.log('❌ Usuário não encontrado em nenhum método de autenticação');
    logger.warn('Usuário não encontrado', { usuario });
    return res.status(401).json({ success: false, error: 'Usuário não encontrado' });

  } catch (error) {
    console.error('❌ ERRO CRÍTICO NO LOGIN:', error);
    console.error('❌ Stack:', error.stack);
    logger.error('Erro no login', { error: error.message, stack: error.stack });
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor',
      message: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

// ========== ENDPOINT PARA SINCRONIZAR AUTENTICAÇÃO SUPABASE COM SESSÃO ==========
app.post('/api/auth/sync', express.json(), async (req, res) => {
  console.log('🔄 === SINCRONIZAÇÃO DE AUTENTICAÇÃO ===');
  
  try {
    // Verificar token Supabase no header
    const authHeader = req.headers.authorization || '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return res.status(401).json({ 
        success: false, 
        error: 'Token de autenticação não fornecido' 
      });
    }

    const token = authHeader.substring(7);
    console.log('🔐 Token recebido, validando...');
    
    // Validar token com Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    
    if (error || !user) {
      console.error('❌ Token inválido:', error?.message);
      return res.status(401).json({ 
        success: false, 
        error: 'Token inválido ou expirado' 
      });
    }

    console.log('✅ Usuário validado:', user.email || user.id);
    
    // Buscar dados do usuário na tabela usuarios
    const { data: usuarioData, error: usuarioError } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', user.id)
      .limit(1);

    if (usuarioError || !usuarioData || usuarioData.length === 0) {
      console.warn('⚠️ Usuário não encontrado na tabela usuarios, usando dados do Auth');
      // Se não encontrar na tabela usuarios, usar dados do Auth
      const permissoes = await carregarPermissoesUsuario(user.id);
      
      req.session.usuario = user.id;
      req.session.permissoes = permissoes || [];
      req.session.isAdmin = user.user_metadata?.role === 'admin' || false;
      req.session.userData = {
        nome: user.user_metadata?.nome || user.email?.split('@')[0] || user.id,
        email: user.email,
        departamento: user.user_metadata?.departamento || 'Operações'
      };
    } else {
      // Usar dados da tabela usuarios
      const usuario = usuarioData[0];
      const permissoes = await carregarPermissoesUsuario(usuario.id);
      const userConfig = await getEvolutionConfigByUser(usuario.id);
      
      req.session.usuario = usuario.id;
      req.session.permissoes = permissoes || [];
      req.session.isAdmin = usuario.is_admin || false;
      req.session.userData = {
        nome: usuario.nome,
        email: usuario.email,
        departamento: usuario.departamento
      };
    }

    // Salvar sessão
    req.session.touch();
    req.session.save((err) => {
      if (err) {
        console.error('❌ Erro ao salvar sessão:', err);
        return res.status(500).json({ 
          success: false, 
          error: 'Erro ao criar sessão' 
        });
      }
      
      console.log('✅ Sessão sincronizada com sucesso!');
      console.log('🔐 Sessão criada:', {
        usuario: req.session.usuario,
        userData: req.session.userData,
        sessionID: req.sessionID
      });
      
      res.json({ 
        success: true, 
        message: 'Autenticação sincronizada com sucesso',
        sessionID: req.sessionID
      });
    });

  } catch (error) {
    console.error('❌ Erro ao sincronizar autenticação:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao sincronizar autenticação' 
    });
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
          { label: 'Fazer login', value: 'login', action: 'login' },
          { label: 'Cadastrar', value: 'cadastro', action: 'cadastro' },
          { label: 'Falar com humano', value: 'humano', action: 'humano' }
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
          { label: 'Fazer login', value: 'login', action: 'login' },
          { label: 'Cadastrar', value: 'cadastro', action: 'cadastro' }
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
          reply: 'Perfeito! Informe seu telefone com DDD (ex: 11999998888). O código do país (55) será adicionado automaticamente.'
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
          { label: 'Fazer login', value: 'login', action: 'login' },
          { label: 'Cadastrar', value: 'cadastro', action: 'cadastro' },
          { label: 'Falar com humano', value: 'humano', action: 'humano' }
        ]
      });
    }

    if (chatState.mode === 'login') {
      if (chatState.step === 'awaiting_login_phone') {
        const rawDigits = inputRaw.replace(/\D/g, '');
        
        // Aceitar apenas DDD + 9 + número (11 dígitos) - o 55 será adicionado automaticamente
        let phoneWithCountryCode = rawDigits;
        
        // Se já começar com 55, remover para validar apenas o formato brasileiro
        if (rawDigits.startsWith('55') && rawDigits.length === 13) {
          phoneWithCountryCode = rawDigits.slice(2); // Remove o 55
        }
        
        // Validar formato: DDD (2 dígitos) + 9 + número (8 dígitos) = 11 dígitos
        // Também aceitar números antigos sem o 9 (10 dígitos) para compatibilidade
        const isValidFormat = /^\d{2}9\d{8}$/.test(phoneWithCountryCode) || 
                              (phoneWithCountryCode.length === 10 && /^\d{2}\d{8}$/.test(phoneWithCountryCode));
        
        if (!isValidFormat) {
          return sendMessage({
            reply: 'O telefone informado parece inválido. Informe no formato DDD + 9 + número (ex: 11999998888). O código do país (55) será adicionado automaticamente.',
            state: chatState.step,
            error: true
          });
        }

        // Adicionar 55 automaticamente se não estiver presente
        const fullPhoneNumber = rawDigits.startsWith('55') ? rawDigits : '55' + phoneWithCountryCode;
        const normalizedPhone = normalizePhone(fullPhoneNumber);

        chatState.step = 'awaiting_login_password';
        const candidateEmails = buildMotoristaEmailVariations(fullPhoneNumber || normalizedPhone);
        const phoneCandidates = Array.from(new Set([
          normalizedPhone,
          fullPhoneNumber,
          phoneWithCountryCode,
          rawDigits?.startsWith('55') && rawDigits.length > 2 ? rawDigits.slice(2) : null,
          normalizedPhone.length > 7 ? normalizedPhone.slice(-7) : null
        ].filter(Boolean)));

        chatState.data.telefone = normalizedPhone;
        chatState.data.telefoneCompleto = fullPhoneNumber;
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
        if (actionRaw === 'cadastro') {
          chatState.mode = 'signup';
          chatState.step = 'awaiting_signup_name';
          chatState.data = {};
          chatState.attempts = {};
          return sendMessage({
            state: chatState.step,
            reply: 'Vamos começar o cadastro. Qual é o seu nome completo?'
          });
        }

        if (actionRaw === 'login') {
          chatState.step = 'awaiting_login_phone';
          chatState.data = {};
          chatState.attempts = {};
          return sendMessage({
            state: chatState.step,
            reply: 'Sem problema! Informe novamente seu telefone com DDD (ex: 5511999998888).'
          });
        }

        if (actionRaw === 'humano') {
          return showHelpMessage();
        }

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
              { label: 'Fazer login', value: 'login', action: 'login' },
              { label: 'Cadastrar', value: 'cadastro', action: 'cadastro' },
              { label: 'Falar com humano', value: 'humano', action: 'humano' }
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
              
              // ✅ Confirmar automaticamente o e-mail se não estiver confirmado
              if (data.user && !data.user.email_confirmed_at) {
                await confirmarEmailAutomaticamente(data.user.id, candidateEmail);
              }
              
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
                { label: 'Tentar novamente', value: 'login', action: 'login' },
                { label: 'Quero me cadastrar', value: 'cadastro', action: 'cadastro' },
                { label: 'Falar com humano', value: 'humano', action: 'humano' }
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
      reply: 'Informe seu telefone principal no formato DDD + 9 + número (ex: 81999998888). O código do país (55) será adicionado automaticamente.'
        });
      }

      if (chatState.step === 'awaiting_signup_phone') {
    const digits = inputRaw.replace(/\D/g, '');
    
    // Aceitar apenas DDD + 9 + número (11 dígitos) - o 55 será adicionado automaticamente
    let phoneWithCountryCode = digits;
    
    // Se já começar com 55, remover para validar apenas o formato brasileiro
    if (digits.startsWith('55') && digits.length === 13) {
      phoneWithCountryCode = digits.slice(2); // Remove o 55
    }
    
    // Validar formato: DDD (2 dígitos) + 9 + número (8 dígitos) = 11 dígitos
    if (!/^\d{2}9\d{8}$/.test(phoneWithCountryCode)) {
          return sendMessage({
        reply: 'O número precisa seguir o padrão DDD + 9 + número (ex: 81999998888). O código do país (55) será adicionado automaticamente.',
            state: chatState.step,
            error: true
          });
        }

    // Adicionar 55 automaticamente se não estiver presente
    const fullPhoneNumber = digits.startsWith('55') ? digits : '55' + phoneWithCountryCode;
    const normalizedPhone = normalizePhone(fullPhoneNumber);
        const email = buildMotoristaEmail(normalizedPhone);
        try {
          const { data: existingUser } = await supabaseAdmin.auth.admin.getUserByEmail(email);
          if (existingUser && existingUser.user) {
            chatState.mode = 'login';
            chatState.step = 'awaiting_login_password';
            chatState.data.telefone = normalizedPhone;
            chatState.data.email = email;
            chatState.data.supabaseUserId = existingUser.user.id;
        chatState.data.telefoneCompleto = fullPhoneNumber;
            return sendMessage({
              state: chatState.step,
              reply: 'Encontramos um cadastro com esse telefone. Informe sua senha para entrar.',
              options: [
                { label: 'Esqueci a senha', value: 'humano', action: 'humano' }
              ]
            });
          }
        } catch (lookupError) {
          if (lookupError && lookupError.message && !lookupError.message.includes('no user found')) {
            console.error('❌ Erro ao verificar usuário existente:', lookupError);
          }
        }

    chatState.data.telefone = normalizedPhone;
    chatState.data.telefoneCompleto = fullPhoneNumber;
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
                { label: 'Esqueci a senha', value: 'humano', action: 'humano' }
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
                { label: 'Fazer login', value: 'login', action: 'login' },
                { label: 'Falar com humano', value: 'humano', action: 'humano' }
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
                { label: 'Fazer login', value: 'login', action: 'login' },
                { label: 'Falar com humano', value: 'humano', action: 'humano' }
              ]
            });
          }
          
          // ✅ Confirmar automaticamente o e-mail se não estiver confirmado
          if (signInData.user && !signInData.user.email_confirmed_at) {
            await confirmarEmailAutomaticamente(signInData.user.id, email);
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
              { label: 'Falar com humano', value: 'humano', action: 'humano' }
            ]
          });
        }
      }
    }

    return sendMessage({
      reply: 'Desculpe, não entendi. Você deseja fazer login ou se cadastrar?',
      state: 'awaiting_intent',
      options: [
      { label: 'Fazer login', value: 'login', action: 'login' },
      { label: 'Cadastrar', value: 'cadastro', action: 'cadastro' },
      { label: 'Falar com humano', value: 'humano', action: 'humano' }
      ]
    });
  } catch (error) {
    console.error('❌ Erro no fluxo de chat do motorista:', error);
    return res.status(500).json({ success: false, error: 'Erro interno ao processar sua solicitação.' });
  }
});

app.get('/api/motoristas/auth/me', async (req, res) => {
  try {
    // Permitir uso com sessão OU com token de rastreamento (para manter monitoramento após logout)
    let user = null;
    let motorista = null;
    let error = null;

    // Primeiro, tente autenticação normal
    const authResult = await requireMotoristaAuth(req);
    if (!authResult.error && authResult.motorista) {
      user = authResult.user;
      motorista = authResult.motorista;
    } else {
      error = authResult.error || null;
    }

    // Se não autenticou, tente via token de rastreamento no header Authorization: Bearer <token>
    if (!motorista) {
      try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
        if (token) {
          const payload = verifyRastreamentoToken(token);
          if (payload && payload.motoristaId && payload.coletaId) {
            motorista = { id: payload.motoristaId };
            user = { id: payload.motoristaId, email: payload.email || null };
            req.rastreamentoTokenPayload = payload;
          }
        }
      } catch (tokenErr) {
        // ignorar erro de token e seguir com erro padrão
      }
    }

    if (!motorista) {
      // Se não autenticou nem com token, retornar erro
      return res.status(error?.status || 401).json({ success: false, error: error?.message || 'Sessão expirada. Faça login novamente.' });
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

    // Verificar se já existe motorista vinculado a este usuário (prioridade 1)
    if (!motoristaSelecionado) {
      const { data: motoristaPorAuthUser, error: authUserError } = await supabaseAdmin
        .from('motoristas')
        .select('*')
        .eq('auth_user_id', user.id)
        .maybeSingle();

      if (authUserError && authUserError.code !== 'PGRST116') {
        console.error('❌ Erro ao buscar motorista por auth_user_id:', authUserError);
      } else if (motoristaPorAuthUser) {
        motoristaSelecionado = motoristaPorAuthUser;
        console.log('✅ Motorista encontrado vinculado ao usuário:', motoristaPorAuthUser.id);
      }
    }

    // Se ainda não encontrou, buscar por telefone (prioridade 2)
    if (!motoristaSelecionado) {
      const motoristasPorTelefone = await fetchMotoristasByPhone(normalizedPhone);
      const motoristaPorTelefone = motoristasPorTelefone.find(m => phonesMatch(normalizedPhone, m.telefone1, m.telefone2));

      if (motoristaPorTelefone) {
        const authUserIdExistente = motoristaPorTelefone.auth_user_id;
        
        // Verificar se o auth_user_id existe e é válido (não vazio, não null)
        const temAuthUserIdValido = authUserIdExistente && 
                                     authUserIdExistente !== '' && 
                                     authUserIdExistente !== null && 
                                     authUserIdExistente !== undefined;
        
        if (temAuthUserIdValido && authUserIdExistente !== user.id) {
          // Verificar se o usuário vinculado ainda existe
          try {
            const { data: authUserExistente, error: authError } = await supabaseAdmin.auth.admin.getUserById(authUserIdExistente);
            
            if (authError || !authUserExistente || !authUserExistente.user) {
              // O usuário vinculado não existe mais, permitir vincular ao usuário atual
              console.log('⚠️ Usuário vinculado não existe mais, permitindo re-vinculação:', {
                motoristaId: motoristaPorTelefone.id,
                authUserIdAntigo: authUserIdExistente,
                authUserIdNovo: user.id
              });
              motoristaSelecionado = motoristaPorTelefone;
            } else {
              // Verificar se o email do usuário vinculado corresponde ao email do usuário atual
              const emailVinculado = authUserExistente.user.email?.toLowerCase();
              const emailAtual = user.email?.toLowerCase();
              
              if (emailVinculado && emailAtual && emailVinculado === emailAtual) {
                // É o mesmo usuário (mesmo email), permitir atualização
                console.log('✅ Mesmo usuário detectado pelo email, permitindo atualização:', {
                  motoristaId: motoristaPorTelefone.id,
                  authUserIdAntigo: authUserIdExistente,
                  authUserIdNovo: user.id,
                  email: emailAtual
                });
                motoristaSelecionado = motoristaPorTelefone;
              } else {
                // O usuário vinculado ainda existe e é diferente, retornar erro
                console.error('❌ Conflito: telefone vinculado a outro usuário válido', {
            telefone: normalizedPhone,
            motoristaId: motoristaPorTelefone.id,
                  authUserIdExistente: authUserIdExistente,
                  emailVinculado: emailVinculado,
                  authUserIdAtual: user.id,
                  emailAtual: emailAtual
          });
          return res.status(409).json({ 
            success: false, 
            error: 'Este telefone já está vinculado a outra conta. Se você é o proprietário deste número, contate o suporte.' 
          });
        }
            }
          } catch (err) {
            // Em caso de erro ao verificar, assumir que o vínculo é inválido e permitir re-vinculação
            console.warn('⚠️ Erro ao verificar usuário vinculado, permitindo re-vinculação:', err);
        motoristaSelecionado = motoristaPorTelefone;
          }
        } else {
          // Se não tem auth_user_id válido ou é o mesmo usuário, usar este motorista
          motoristaSelecionado = motoristaPorTelefone;
          console.log('✅ Motorista encontrado por telefone:', motoristaPorTelefone.id, {
            authUserId: authUserIdExistente,
            novoAuthUserId: user.id
          });
        }
      }
    }

    // Log para debug
    if (motoristaSelecionado) {
      console.log('📋 Motorista selecionado para atualização:', {
        id: motoristaSelecionado.id,
        nome: motoristaSelecionado.nome,
        telefone: motoristaSelecionado.telefone1,
        auth_user_id: motoristaSelecionado.auth_user_id,
        auth_user_id_tipo: typeof motoristaSelecionado.auth_user_id,
        novoAuthUserId: user.id,
        telefoneNormalizado: normalizedPhone
      });
    } else {
      console.log('📝 Nenhum motorista encontrado, será criado novo registro', {
        telefoneNormalizado: normalizedPhone,
        userId: user.id
      });
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

    // Tratar estado separadamente para garantir que seja sempre salvo quando fornecido
    // IMPORTANTE: Sempre atualizar o estado se fornecido, mesmo que já exista no banco
    if (body.estado !== undefined && body.estado !== null && body.estado !== '') {
      const estadoNormalizado = body.estado.toString().trim().toUpperCase().substring(0, 2);
      if (estadoNormalizado && estadoNormalizado.length === 2) {
        payload.estado = estadoNormalizado;
        console.log('✅ Estado normalizado e adicionado ao payload:', {
          estadoOriginal: body.estado,
          estadoNormalizado: estadoNormalizado,
          motoristaId: motoristaSelecionado?.id,
          estadoAtualNoBanco: motoristaSelecionado?.estado,
          seraAtualizado: true
        });
      } else {
        console.warn('⚠️ Estado fornecido inválido (não tem 2 caracteres):', {
          estadoOriginal: body.estado,
          estadoNormalizado: estadoNormalizado,
          length: estadoNormalizado?.length
        });
      }
    } else {
      console.log('⚠️ Estado não fornecido no body:', {
        bodyKeys: Object.keys(body),
        temEstado: !!body.estado,
        estadoValue: body.estado,
        estadoType: typeof body.estado
      });
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
      // Verificar se o auth_user_id está sendo alterado e se já existe outro motorista com esse auth_user_id
      if (payload.auth_user_id && payload.auth_user_id !== motoristaSelecionado.auth_user_id) {
        const { data: motoristaComAuthUserId, error: checkError } = await supabaseAdmin
          .from('motoristas')
          .select('id, nome, telefone1')
          .eq('auth_user_id', payload.auth_user_id)
          .neq('id', motoristaSelecionado.id)
          .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
          console.error('❌ Erro ao verificar auth_user_id:', checkError);
        } else if (motoristaComAuthUserId) {
          console.error('❌ Conflito: auth_user_id já está em uso por outro motorista', {
            motoristaExistente: motoristaComAuthUserId.id,
            motoristaAtual: motoristaSelecionado.id,
            authUserId: payload.auth_user_id
          });
          return res.status(409).json({ 
            success: false, 
            error: 'Este usuário já possui um cadastro de motorista. Use o cadastro existente ou contate o suporte.'
          });
        }
      }

      // Log do payload antes de atualizar (para debug)
      console.log('📝 Atualizando motorista com payload:', {
        id: motoristaSelecionado.id,
        estado: payload.estado,
        temEstado: !!payload.estado,
        estadoOriginal: body.estado,
        estadoAtualNoBanco: motoristaSelecionado.estado,
        payloadKeys: Object.keys(payload),
        payloadCompleto: JSON.stringify(payload, null, 2)
      });
      
      // Garantir que o estado seja sempre atualizado se fornecido
      if (body.estado !== undefined && body.estado !== null && body.estado !== '') {
        const estadoNormalizado = body.estado.toString().trim().toUpperCase().substring(0, 2);
        if (estadoNormalizado && estadoNormalizado.length === 2) {
          payload.estado = estadoNormalizado;
          console.log('🔧 Forçando atualização do estado no payload:', estadoNormalizado);
        }
      }

      // Se o cadastro está sendo completado (tem todos os dados básicos), mudar status para ativo
      // A análise final será feita na etapa GR
      const cadastroCompleto = payload.nome && 
                               payload.telefone1 && 
                               payload.estado && 
                               payload.classe_veiculo && 
                               payload.tipo_veiculo && 
                               payload.tipo_carroceria;
      
      if (cadastroCompleto && motoristaSelecionado.status === 'cadastro_pendente') {
        payload.status = 'ativo';
        console.log('✅ Cadastro completo detectado, mudando status para ativo automaticamente');
      }

      const { data, error: updateError } = await supabaseAdmin
        .from('motoristas')
        .update(payload)
        .eq('id', motoristaSelecionado.id)
        .select(MOTORISTA_SELECT_FIELDS)
        .single();

      if (updateError) {
        console.error('❌ Erro ao atualizar motorista:', updateError);
        // Verificar se é erro de constraint única
        if (updateError.code === '23505' || updateError.message?.includes('duplicate') || updateError.message?.includes('unique')) {
          console.error('❌ Erro de constraint única ao atualizar:', updateError);
          return res.status(409).json({ 
            success: false, 
            error: 'Já existe um cadastro com estes dados. Se você acredita que isso é um erro, contate o suporte.',
            details: process.env.NODE_ENV === 'development' ? updateError.message : undefined
          });
        }
        throw updateError;
      }

      resultData = data;
      
      // Log após atualização para verificar se o estado foi salvo
      console.log('✅ Motorista atualizado com sucesso:', {
        id: resultData?.id,
        estado: resultData?.estado,
        temEstado: !!resultData?.estado,
        camposRetornados: Object.keys(resultData || {})
      });
    } else {
      payload.status = body.status ? body.status.trim() : 'ativo';
      
      // Log do payload antes de inserir (para debug)
      console.log('📝 Criando novo motorista com payload:', {
        estado: payload.estado,
        temEstado: !!payload.estado,
        payloadKeys: Object.keys(payload)
      });
      
      const { data, error: insertError } = await supabaseAdmin
        .from('motoristas')
        .insert(payload)
        .select(MOTORISTA_SELECT_FIELDS)
        .single();

      if (insertError) {
        // Verificar se é erro de constraint única
        if (insertError.code === '23505' || insertError.message?.includes('duplicate') || insertError.message?.includes('unique')) {
          console.error('❌ Erro de constraint única ao inserir:', insertError);
          
          // Tentar buscar o motorista existente
          const { data: motoristaExistente } = await supabaseAdmin
            .from('motoristas')
            .select('*')
            .or(`telefone1.eq.${normalizedPhone},telefone2.eq.${normalizedPhone},auth_user_id.eq.${user.id}`)
            .maybeSingle();
          
          if (motoristaExistente) {
            // Se encontrou e pertence ao mesmo usuário, atualizar
            if (motoristaExistente.auth_user_id === user.id) {
              console.log('✅ Motorista existente encontrado, atualizando...');
              const { data: updatedData, error: updateError2 } = await supabaseAdmin
                .from('motoristas')
                .update(payload)
                .eq('id', motoristaExistente.id)
                .select(MOTORISTA_SELECT_FIELDS)
                .single();
              
              if (updateError2) {
                throw updateError2;
              }
              resultData = updatedData;
            } else if (!motoristaExistente.auth_user_id) {
              // Se o motorista existe mas não tem auth_user_id, vincular ao usuário atual
              console.log('✅ Motorista existente sem vínculo, vinculando ao usuário atual...');
              const { data: updatedData, error: updateError2 } = await supabaseAdmin
                .from('motoristas')
                .update(payload)
                .eq('id', motoristaExistente.id)
                .select(MOTORISTA_SELECT_FIELDS)
                .single();
              
              if (updateError2) {
                throw updateError2;
              }
              resultData = updatedData;
            } else {
              // Motorista existe e está vinculado a outro usuário
              return res.status(409).json({ 
                success: false, 
                error: 'Já existe um cadastro com este telefone vinculado a outra conta. Se você é o proprietário deste número, contate o suporte.'
              });
            }
          } else {
            return res.status(409).json({ 
              success: false, 
              error: 'Já existe um cadastro com estes dados. Tente atualizar seu perfil existente.',
              details: process.env.NODE_ENV === 'development' ? insertError.message : undefined
            });
          }
        } else {
          throw insertError;
        }
      } else {
        resultData = data;
      }
    }

    // Log antes de retornar para verificar se o estado está na resposta
    const motoristaMapeado = mapMotoristaResponse(resultData);
    console.log('📤 Retornando resposta com motorista:', {
      motoristaId: resultData?.id,
      estadoNoBanco: resultData?.estado,
      estadoNaResposta: motoristaMapeado?.estado,
      temEstado: !!motoristaMapeado?.estado
    });
    
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        nome
      },
      motorista: motoristaMapeado
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
      console.error('❌ Erro ao buscar documentos do motorista:', docsError);
      throw docsError;
    }

    console.log('📋 Documentos encontrados para motorista', motorista.id, ':', documentos?.length || 0);
    if (documentos && documentos.length > 0) {
      console.log('📄 Documentos:', JSON.stringify(documentos.map(d => ({ id: d.id, categoria: d.categoria, nome: d.nome_arquivo })), null, 2));
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
      .select('id, cliente, origem, destino, valor, km, veiculo, status, etapa_atual, prioridade, data_recebimento, observacoes, filial, numero_coleta, tipos_veiculo, tipos_carroceria, motorista_id')
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
    let { motorista, error } = await requireMotoristaAuth(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    if (!motorista) {
      return res.json({ success: true, cadastroPendente: true, viagens: [] });
    }

    // Recarregar motorista do banco para garantir dados atualizados (especialmente o estado)
    const { data: motoristaAtualizado, error: reloadError } = await supabaseAdmin
      .from('motoristas')
      .select(MOTORISTA_SELECT_FIELDS)
      .eq('id', motorista.id)
      .single();

    if (reloadError) {
      console.warn('⚠️ Erro ao recarregar motorista, usando dados da sessão:', reloadError);
    } else if (motoristaAtualizado) {
      console.log('🔄 Motorista recarregado do banco:', {
        id: motoristaAtualizado.id,
        estado: motoristaAtualizado.estado,
        estadoType: typeof motoristaAtualizado.estado,
        estadoValue: motoristaAtualizado.estado,
        estadoString: String(motoristaAtualizado.estado),
        temEstado: !!motoristaAtualizado.estado,
        camposCompletos: Object.keys(motoristaAtualizado)
      });
      motorista = motoristaAtualizado;
    } else {
      console.warn('⚠️ Motorista não encontrado ao recarregar do banco, usando dados da sessão');
    }

    const { data: viagensData, error: viagensError } = await supabaseAdmin
      .from('coletas')
      .select('id, cliente, origem, destino, valor, km, veiculo, status, etapa_atual, prioridade, data_recebimento, observacoes, filial, numero_coleta, tipos_veiculo, tipos_carroceria')
      .eq('motorista_id', motorista.id)
      .order('data_recebimento', { ascending: true });

    if (viagensError) {
      throw viagensError;
    }

    console.log('📋 Viagens encontradas para motorista:', {
      motoristaId: motorista.id,
      totalViagens: viagensData?.length || 0,
      viagensIds: viagensData?.map(v => v.id) || [],
      viagensClientes: viagensData?.map(v => v.cliente) || []
    });

    const motoristaMapeado = mapMotoristaResponse(motorista);
    const viagensMapeadas = (viagensData || []).map(mapColetaOpportunity);
    
    console.log('📤 Retornando motorista no endpoint viagens:', {
      id: motoristaMapeado?.id,
      estado: motoristaMapeado?.estado,
      totalViagensRetornadas: viagensMapeadas.length,
      viagensIds: viagensMapeadas.map(v => v.id)
    });

    res.json({
      success: true,
      motorista: motoristaMapeado,
      viagens: viagensMapeadas
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

    // Verificar se o cadastro está completo (dados básicos)
    // Não verificar mais o status "ativo" - a análise final será feita na etapa GR
    // O motorista pode assumir viagens assim que completar o cadastro básico

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
      console.error('❌ Erro ao atualizar coleta:', updateError);
      throw updateError;
    }

    if (!coletaAtualizada) {
      console.error('❌ Coleta não foi atualizada após update');
      return res.status(500).json({ 
        success: false, 
        error: 'Erro ao atualizar a coleta. A coleta pode não existir mais.' 
      });
    }

    // Tentar inserir histórico (não crítico se falhar)
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
      // Não bloquear o fluxo se o histórico falhar
    }

    // Tentar inserir mensagem no chat (não crítico se falhar)
    try {
      await supabaseAdmin.from('chat_mensagens').insert({
        coleta_id: coletaId,
        usuario: motorista.nome || user.email || 'motorista_portal',
        mensagem: `🚚 Motorista ${motorista.nome || motorista.id} assumiu a coleta via portal. Etapa movida para GR.`,
        tipo_mensagem: 'sistema'
      });
    } catch (chatError) {
      console.warn('⚠️ Não foi possível registrar mensagem automática no chat:', chatError.message || chatError);
      // Não bloquear o fluxo se o chat falhar
    }

    // Gerar token de rastreamento persistente
    let tokenRastreamento = null;
    try {
      tokenRastreamento = await gerarTokenRastreamento(motorista.id, coletaId);
      console.log('✅ Token de rastreamento gerado ao assumir coleta:', { motoristaId: motorista.id, coletaId });
    } catch (tokenError) {
      console.warn('⚠️ Erro ao gerar token de rastreamento (não crítico):', tokenError.message || tokenError);
      // Não bloquear o fluxo se o token falhar - o sistema pode funcionar sem ele
    }

    res.json({
      success: true,
      coleta: mapColetaOpportunity(coletaAtualizada),
      motorista: mapMotoristaResponse(motorista),
      tokenRastreamento: tokenRastreamento // Token para monitoramento persistente
    });
  } catch (error) {
    console.error('❌ Erro ao assumir oportunidade de coleta:', {
      error: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      coletaId: req.params.coletaId,
      motoristaId: motorista?.id
    });
    
    // Retornar mensagens de erro mais específicas
    let errorMessage = 'Não foi possível assumir esta coleta agora. Tente novamente mais tarde.';
    let statusCode = 500;
    
    if (error.code === '23505') {
      errorMessage = 'Esta coleta já foi assumida por outro motorista.';
      statusCode = 409;
    } else if (error.code === '23503') {
      errorMessage = 'Erro de referência. A coleta ou motorista não existe mais.';
      statusCode = 404;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(statusCode).json({ 
      success: false, 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Desvincular motorista de uma coleta (apenas se etapa for GR ou anterior)
app.post('/api/motoristas/coletas/:coletaId/desvincular', async (req, res) => {
  try {
    const { user, motorista, error } = await requireMotoristaAuth(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    if (!motorista) {
      return res.status(409).json({ success: false, error: 'Motorista não encontrado.' });
    }

    const { coletaId } = req.params;

    // Buscar informações da coleta
    const { data: coleta, error: coletaError } = await supabaseAdmin
      .from('coletas')
      .select('id, motorista_id, etapa_atual, status')
      .eq('id', coletaId)
      .maybeSingle();

    if (coletaError && coletaError.code !== 'PGRST116') {
      throw coletaError;
    }

    if (!coleta) {
      return res.status(404).json({ success: false, error: 'Coleta não encontrada.' });
    }

    // Verificar se o motorista está vinculado a esta coleta
    if (!coleta.motorista_id || coleta.motorista_id !== motorista.id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Você não está vinculado a esta coleta.' 
      });
    }

    // Verificar se a etapa permite desvincular (GR ou anterior)
    // Etapas permitidas: GR, pendente, em_andamento, ou vazio/null
    const etapaAtual = (coleta.etapa_atual || '').toLowerCase().trim();
    const etapasPermitidas = ['gr', 'pendente', 'em_andamento', ''];
    const podeDesvincular = etapasPermitidas.includes(etapaAtual) || !etapaAtual;
    
    if (!podeDesvincular) {
      return res.status(400).json({ 
        success: false, 
        error: `Não é possível desvincular desta coleta. A etapa atual (${coleta.etapa_atual?.toUpperCase() || 'N/A'}) não permite desvinculação. Apenas coletas na etapa GR ou anterior podem ser desvinculadas.` 
      });
    }

    // Desvincular motorista (remover motorista_id e resetar etapa se necessário)
    const updatePayload = {
      motorista_id: null
    };

    // Se a etapa era GR, resetar para pendente
    if (etapaAtual === 'gr') {
      updatePayload.etapa_atual = null;
      // Se o status era em_andamento, voltar para pendente
      if (coleta.status && coleta.status.toLowerCase() === 'em_andamento') {
        updatePayload.status = 'pendente';
      }
    }

    const { data: coletaAtualizada, error: updateError } = await supabaseAdmin
      .from('coletas')
      .update(updatePayload)
      .eq('id', coletaId)
      .select('id, cliente, origem, destino')
      .single();

    if (updateError) {
      console.error('❌ Erro ao desvincular motorista:', updateError);
      throw updateError;
    }

    // Invalidar tokens de rastreamento para esta combinação
    try {
      await supabaseAdmin
        .from('rastreamento_tokens')
        .update({ ativo: false, invalidado_em: new Date().toISOString() })
        .eq('motorista_id', motorista.id)
        .eq('coleta_id', coletaId)
        .eq('ativo', true);
      console.log('✅ Tokens de rastreamento invalidados ao desvincular');
    } catch (tokenError) {
      console.warn('⚠️ Erro ao invalidar tokens (não crítico):', tokenError.message || tokenError);
    }

    console.log('✅ Motorista desvinculado da coleta:', {
      motoristaId: motorista.id,
      coletaId: coletaId,
      etapaAnterior: coleta.etapa_atual
    });

    res.json({
      success: true,
      message: 'Você foi desvinculado da coleta com sucesso.',
      coleta: coletaAtualizada
    });

  } catch (error) {
    console.error('❌ Erro ao desvincular motorista:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Erro ao desvincular da coleta.' 
    });
  }
});

// ========== ROTAS DE RASTREAMENTO E MONITORAMENTO ==========

// Função para gerar token de rastreamento persistente
async function gerarTokenRastreamento(motoristaId, coletaId) {
  try {
    // Gerar token único e seguro
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    // Buscar se já existe token ativo para esta combinação
    const { data: tokenExistente, error: buscaError } = await supabaseAdmin
      .from('rastreamento_tokens')
      .select('id, token_hash, ativo, expira_em')
      .eq('motorista_id', motoristaId)
      .eq('coleta_id', coletaId)
      .eq('ativo', true)
      .maybeSingle();
    
    if (buscaError && buscaError.code !== 'PGRST116') {
      console.error('❌ Erro ao buscar token existente:', buscaError);
      throw buscaError;
    }
    
    // Se já existe token ativo e não expirado, retornar o existente
    if (tokenExistente && tokenExistente.expira_em) {
      const expiraEm = new Date(tokenExistente.expira_em);
      if (expiraEm > new Date()) {
        console.log('✅ Token de rastreamento já existe e está ativo:', { motoristaId, coletaId });
        // Não podemos retornar o hash, então geramos um novo token mas mantemos o mesmo registro
        // Na prática, vamos gerar um novo token sempre, mas invalidar os antigos
      }
    }
    
    // Invalidar tokens anteriores para esta combinação
    if (tokenExistente) {
      await supabaseAdmin
        .from('rastreamento_tokens')
        .update({ ativo: false, invalidado_em: new Date().toISOString() })
        .eq('motorista_id', motoristaId)
        .eq('coleta_id', coletaId)
        .eq('ativo', true);
    }
    
    // Calcular data de expiração (30 dias a partir de agora)
    const expiraEm = new Date();
    expiraEm.setDate(expiraEm.getDate() + 30);
    
    // Inserir novo token
    const { data: novoToken, error: insertError } = await supabaseAdmin
      .from('rastreamento_tokens')
      .insert({
        motorista_id: motoristaId,
        coleta_id: coletaId,
        token_hash: tokenHash,
        expira_em: expiraEm.toISOString(),
        ativo: true,
        criado_em: new Date().toISOString()
      })
      .select('id, expira_em, criado_em')
      .single();
    
    if (insertError) {
      console.error('❌ Erro ao inserir token de rastreamento:', insertError);
      throw insertError;
    }
    
    console.log('✅ Token de rastreamento gerado:', { motoristaId, coletaId, tokenId: novoToken.id });
    
    // Retornar o token em texto claro (será armazenado no frontend)
    return token;
  } catch (error) {
    console.error('❌ Erro ao gerar token de rastreamento:', error);
    throw error;
  }
}

// Função para validar token de rastreamento
async function validarTokenRastreamento(token) {
  try {
    if (!token || typeof token !== 'string') {
      return { valido: false, error: 'Token inválido ou ausente' };
    }
    
    // Calcular hash do token recebido
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    // Buscar token no banco
    const { data: tokenData, error: buscaError } = await supabaseAdmin
      .from('rastreamento_tokens')
      .select('id, motorista_id, coleta_id, ativo, expira_em, invalidado_em')
      .eq('token_hash', tokenHash)
      .eq('ativo', true)
      .maybeSingle();
    
    if (buscaError && buscaError.code !== 'PGRST116') {
      console.error('❌ Erro ao buscar token:', buscaError);
      return { valido: false, error: 'Erro ao validar token' };
    }
    
    if (!tokenData) {
      return { valido: false, error: 'Token não encontrado ou inválido' };
    }
    
    // Verificar se token expirou
    if (tokenData.expira_em) {
      const expiraEm = new Date(tokenData.expira_em);
      if (expiraEm <= new Date()) {
        // Marcar como inativo
        await supabaseAdmin
          .from('rastreamento_tokens')
          .update({ ativo: false, invalidado_em: new Date().toISOString() })
          .eq('id', tokenData.id);
        return { valido: false, error: 'Token expirado' };
      }
    }
    
    // Verificar se foi invalidado
    if (tokenData.invalidado_em) {
      return { valido: false, error: 'Token foi invalidado' };
    }
    
    // Verificar se a coleta ainda está vinculada ao motorista
    const { data: coleta, error: coletaError } = await supabaseAdmin
      .from('coletas')
      .select('id, motorista_id, status, etapa_atual')
      .eq('id', tokenData.coleta_id)
      .maybeSingle();
    
    if (coletaError && coletaError.code !== 'PGRST116') {
      console.error('❌ Erro ao verificar coleta:', coletaError);
      return { valido: false, error: 'Erro ao verificar vínculo da coleta' };
    }
    
    if (!coleta) {
      // Coleta não existe mais, invalidar token
      await supabaseAdmin
        .from('rastreamento_tokens')
        .update({ ativo: false, invalidado_em: new Date().toISOString() })
        .eq('id', tokenData.id);
      return { valido: false, error: 'Coleta não encontrada' };
    }
    
    // Verificar se motorista ainda está vinculado à coleta
    if (coleta.motorista_id !== tokenData.motorista_id) {
      // Motorista foi desvinculado, invalidar token
      await supabaseAdmin
        .from('rastreamento_tokens')
        .update({ ativo: false, invalidado_em: new Date().toISOString() })
        .eq('id', tokenData.id);
      return { valido: false, error: 'Motorista não está mais vinculado a esta coleta' };
    }
    
    // Verificar se coleta foi finalizada
    const etapasFinalizadas = ['concluida', 'finalizada', 'cancelada'];
    if (coleta.etapa_atual && etapasFinalizadas.includes(coleta.etapa_atual.toLowerCase())) {
      // Coleta finalizada, mas não invalidamos o token ainda (pode estar em processo de finalização)
      // Retornamos válido mas com aviso
      return {
        valido: true,
        motoristaId: tokenData.motorista_id,
        coletaId: tokenData.coleta_id,
        coletaFinalizada: true
      };
    }
    
    return {
      valido: true,
      motoristaId: tokenData.motorista_id,
      coletaId: tokenData.coleta_id,
      coletaFinalizada: false
    };
  } catch (error) {
    console.error('❌ Erro ao validar token de rastreamento:', error);
    return { valido: false, error: 'Erro ao processar validação do token' };
  }
}

// Verificar se termo de rastreamento foi aceito
app.get('/api/rastreamento/verificar-termo', async (req, res) => {
  try {
    const { user, motorista, error } = await requireMotoristaAuth(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const { coletaId } = req.query;
    if (!coletaId) {
      return res.json({ termoAceito: false });
    }

    if (!motorista) {
      return res.json({ termoAceito: false });
    }

    const { data: termo, error: termoError } = await supabaseAdmin
      .from('rastreamento_termos')
      .select('id, ativo')
      .eq('motorista_id', motorista.id)
      .eq('coleta_id', coletaId)
      .eq('ativo', true)
      .order('aceito_em', { ascending: false })
      .limit(1)
      .single();

    if (termoError && termoError.code !== 'PGRST116') {
      console.error('Erro ao verificar termo:', termoError);
      return res.json({ termoAceito: false });
    }

    return res.json({ termoAceito: !!termo });
  } catch (error) {
    console.error('❌ Erro ao verificar termo:', error);
    res.json({ termoAceito: false });
  }
});

// Aceitar termo de rastreamento
app.post('/api/rastreamento/aceitar-termo', express.json(), async (req, res) => {
  try {
    const { user, motorista, error } = await requireMotoristaAuth(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const { coletaId, termoVersao, ipAddress, userAgent } = req.body;

    if (!coletaId || !termoVersao) {
      return res.status(400).json({ success: false, error: 'Dados incompletos.' });
    }

    if (!motorista) {
      return res.status(409).json({ success: false, error: 'Complete seu cadastro primeiro.' });
    }

    // Verificar apenas se o cadastro está completo (dados básicos)
    // Não verificar mais o status "ativo" - a análise final será feita na etapa GR

    // Verificar se já existe termo ativo
    const { data: termoExistente } = await supabaseAdmin
      .from('rastreamento_termos')
      .select('id')
      .eq('motorista_id', motorista.id)
      .eq('coleta_id', coletaId)
      .eq('ativo', true)
      .limit(1)
      .single();

    if (termoExistente) {
      return res.json({ success: true, message: 'Termo já aceito anteriormente.' });
    }

    // Inserir novo termo
    const { data: novoTermo, error: insertError } = await supabaseAdmin
      .from('rastreamento_termos')
      .insert({
        motorista_id: motorista.id,
        coleta_id: coletaId,
        termo_versao: termoVersao,
        ip_address: ipAddress || req.ip || 'desconhecido',
        user_agent: userAgent || req.headers['user-agent'] || 'desconhecido',
        ativo: true
      })
      .select()
      .single();

    if (insertError) {
      console.error('Erro ao inserir termo:', insertError);
      return res.status(500).json({ success: false, error: 'Não foi possível registrar o aceite do termo.' });
    }

    // Registrar evento no histórico
    await supabaseAdmin.from('rastreamento_historico').insert({
      motorista_id: motorista.id,
      coleta_id: coletaId,
      evento_tipo: 'inicio',
      descricao: 'Termo de rastreamento aceito e rastreamento iniciado'
    });

    // Gerar token de rastreamento persistente
    let tokenRastreamento = null;
    try {
      tokenRastreamento = await gerarTokenRastreamento(motorista.id, coletaId);
      console.log('✅ Token de rastreamento gerado ao aceitar termo:', { motoristaId: motorista.id, coletaId });
    } catch (tokenError) {
      console.warn('⚠️ Erro ao gerar token de rastreamento (não crítico):', tokenError.message || tokenError);
      // Não bloquear o fluxo se o token falhar
    }

    res.json({ 
      success: true, 
      termo: novoTermo,
      tokenRastreamento: tokenRastreamento // Token para monitoramento persistente
    });
  } catch (error) {
    console.error('❌ Erro ao aceitar termo:', error);
    res.status(500).json({ success: false, error: 'Erro ao processar aceite do termo.' });
  }
});

// Enviar posição GPS
app.post('/api/rastreamento/enviar-posicao', express.json(), async (req, res) => {
  try {
    let motorista = null;
    let coletaIdFromToken = null;
    let usandoToken = false;

    // Tentar autenticação via sessão primeiro
    const { user, motorista: motoristaSessao, error: authError } = await requireMotoristaAuth(req);
    
    if (authError || !motoristaSessao) {
      // Se não houver sessão, tentar autenticação via token de rastreamento
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const validacao = await validarTokenRastreamento(token);
        
        if (validacao.valido) {
          usandoToken = true;
          coletaIdFromToken = validacao.coletaId;
          
          // Buscar dados do motorista
          const { data: motoristaData, error: motoristaError } = await supabaseAdmin
            .from('motoristas')
            .select('id, nome, telefone, estado, classe_veiculo, tipo_veiculo, tipo_carroceria, placa_cavalo, status')
            .eq('id', validacao.motoristaId)
            .single();
          
          if (motoristaError || !motoristaData) {
            console.error('❌ Motorista não encontrado para token:', validacao.motoristaId);
            return res.status(404).json({ success: false, error: 'Motorista não encontrado para este token.' });
          }
          
          motorista = motoristaData;
          console.log('✅ Autenticação via token de rastreamento:', { motoristaId: motorista.id, coletaId: coletaIdFromToken });
        } else {
          console.warn('⚠️ Token de rastreamento inválido:', validacao.error);
          return res.status(401).json({ success: false, error: validacao.error || 'Token de rastreamento inválido.' });
        }
      } else {
        // Sem sessão e sem token
        return res.status(401).json({ success: false, error: 'Autenticação necessária. Faça login ou use um token de rastreamento válido.' });
      }
    } else {
      // Autenticação via sessão bem-sucedida
      motorista = motoristaSessao;
    }

    const {
      coletaId: coletaIdBody,
      latitude,
      longitude,
      precisao,
      altitude,
      velocidade,
      direcao,
      endereco,
      bateriaNivel,
      conectadoWifi,
      conectadoRedeCelular
    } = req.body;

    // Usar coletaId do token se estiver usando token, senão usar do body
    const coletaId = usandoToken ? coletaIdFromToken : coletaIdBody;

    console.log('📍 Dados recebidos do cliente:', {
      motorista_id: motorista?.id,
      coletaId: coletaId,
      latitude: latitude,
      longitude: longitude,
      hasPrecisao: !!precisao,
      usandoToken: usandoToken,
      timestamp: new Date().toISOString()
    });

    if (!motorista) {
      console.error('❌ Motorista não encontrado para enviar posição');
      return res.status(409).json({ success: false, error: 'Motorista não encontrado.' });
    }

    // Validar coordenadas
    if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
      console.error('❌ Coordenadas ausentes:', { latitude, longitude });
      return res.status(400).json({ success: false, error: 'Coordenadas inválidas (ausentes).' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      console.error('❌ Coordenadas não são números:', { latitude, longitude });
      return res.status(400).json({ success: false, error: 'Coordenadas inválidas (não são números).' });
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      console.error('❌ Coordenadas fora do range válido:', { lat, lng });
      return res.status(400).json({ success: false, error: 'Coordenadas fora do range válido.' });
    }

    // Verificar se termo está aceito (apenas se coletaId for fornecido)
    if (coletaId) {
      const { data: termo, error: termoError } = await supabaseAdmin
        .from('rastreamento_termos')
        .select('id, aceito_em, ativo')
        .eq('motorista_id', motorista.id)
        .eq('coleta_id', coletaId)
        .eq('ativo', true)
        .limit(1)
        .maybeSingle();

      if (termoError) {
        console.error('❌ Erro ao verificar termo:', termoError);
        // Continuar mesmo com erro na verificação do termo
      } else if (!termo) {
        console.warn('⚠️ Termo não aceito para coleta:', { motorista_id: motorista.id, coleta_id: coletaId });
        return res.status(403).json({ 
          success: false, 
          error: 'Termo de rastreamento não aceito para esta coleta. O motorista precisa aceitar o termo no portal.' 
        });
      } else {
        console.log('✅ Termo verificado:', { termo_id: termo.id, aceito_em: termo.aceito_em });
      }
    } else {
      console.warn('⚠️ Posição enviada sem coletaId - será salva sem vínculo com coleta');
    }

    // Inserir posição
    const timestampAtual = new Date().toISOString();
    const dadosInsercao = {
        motorista_id: motorista.id,
        coleta_id: coletaId || null,
        latitude: lat,
        longitude: lng,
        timestamp_gps: timestampAtual, // Garantir que o timestamp seja preenchido
        precisao: precisao ? (isNaN(parseFloat(precisao)) ? null : parseFloat(precisao)) : null,
        altitude: altitude ? (isNaN(parseFloat(altitude)) ? null : parseFloat(altitude)) : null,
        velocidade: velocidade ? (isNaN(parseFloat(velocidade)) ? null : parseFloat(velocidade)) : null,
        direcao: direcao ? (isNaN(parseFloat(direcao)) ? null : parseFloat(direcao)) : null,
        endereco: endereco && endereco.trim() ? endereco.trim() : null,
        bateria_nivel: bateriaNivel ? (isNaN(parseFloat(bateriaNivel)) ? null : parseFloat(bateriaNivel)) : null,
        conectado_wifi: conectadoWifi === true || conectadoWifi === 'true',
        conectado_rede_celular: conectadoRedeCelular === true || conectadoRedeCelular === 'true'
    };

    console.log('📍 Dados preparados para inserção:', {
      motorista_id: dadosInsercao.motorista_id,
      motorista_nome: motorista.nome,
      coleta_id: dadosInsercao.coleta_id,
      latitude: dadosInsercao.latitude,
      longitude: dadosInsercao.longitude,
      precisao: dadosInsercao.precisao,
      timestamp_gps: dadosInsercao.timestamp_gps
    });

    const { data: posicao, error: insertError } = await supabaseAdmin
      .from('rastreamento_posicoes')
      .insert(dadosInsercao)
      .select()
      .single();

    if (insertError) {
      console.error('❌ Erro ao inserir posição GPS:', insertError);
      console.error('❌ Código do erro:', insertError.code);
      console.error('❌ Mensagem do erro:', insertError.message);
      console.error('❌ Detalhes do erro:', insertError.details);
      console.error('❌ Dados que causaram erro:', JSON.stringify(dadosInsercao, null, 2));
      
      // Verificar se é erro de constraint ou validação
      let errorMessage = 'Erro ao salvar posição.';
      if (insertError.code === '23505') {
        errorMessage = 'Posição duplicada (já existe uma posição com os mesmos dados).';
      } else if (insertError.code === '23503') {
        errorMessage = 'Erro de referência (motorista ou coleta não encontrado).';
      } else if (insertError.message) {
        errorMessage = `Erro ao salvar posição: ${insertError.message}`;
      }
      
      return res.status(500).json({ 
        success: false, 
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? insertError.message : undefined
      });
    }

    console.log('✅ Posição GPS salva com sucesso:', {
      posicao_id: posicao.id,
      motorista_id: motorista.id,
      motorista_nome: motorista.nome,
      coleta_id: coletaId,
      latitude: posicao.latitude,
      longitude: posicao.longitude,
      timestamp_gps: posicao.timestamp_gps
    });

    res.json({ success: true, posicao });
  } catch (error) {
    console.error('❌ Erro ao enviar posição:', error);
    res.status(500).json({ success: false, error: 'Erro ao processar posição GPS.' });
  }
});

// Verificar status do rastreamento do motorista
app.get('/api/rastreamento/status/:coletaId', async (req, res) => {
  try {
    const { coletaId } = req.params;
    const { user, motorista, error } = await requireMotoristaAuth(req);
    
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    if (!motorista) {
      return res.status(409).json({ success: false, error: 'Motorista não encontrado.' });
    }

    // Verificar termo aceito
    const { data: termo } = await supabaseAdmin
      .from('rastreamento_termos')
      .select('id, aceito_em, ativo')
      .eq('motorista_id', motorista.id)
      .eq('coleta_id', coletaId)
      .eq('ativo', true)
      .maybeSingle();

    // Verificar última posição enviada
    const { data: ultimaPosicao } = await supabaseAdmin
      .from('rastreamento_posicoes')
      .select('id, timestamp_gps, latitude, longitude')
      .eq('motorista_id', motorista.id)
      .eq('coleta_id', coletaId)
      .order('timestamp_gps', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Contar total de posições
    const { count: totalPosicoes } = await supabaseAdmin
      .from('rastreamento_posicoes')
      .select('*', { count: 'exact', head: true })
      .eq('motorista_id', motorista.id)
      .eq('coleta_id', coletaId);

    res.json({
      success: true,
      termoAceito: !!termo,
      termo: termo,
      rastreamentoAtivo: !!termo && termo.ativo,
      ultimaPosicao: ultimaPosicao,
      totalPosicoes: totalPosicoes || 0,
      tempoDesdeUltimaPosicao: ultimaPosicao 
        ? Math.floor((Date.now() - new Date(ultimaPosicao.timestamp_gps).getTime()) / 1000)
        : null
    });
  } catch (error) {
    console.error('❌ Erro ao verificar status do rastreamento:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint de diagnóstico para verificar posições
app.get('/api/rastreamento/diagnostico/:coletaId', async (req, res) => {
  try {
    const { coletaId } = req.params;

    // Buscar informações da coleta
    const { data: coleta } = await supabaseAdmin
      .from('coletas')
      .select('id, motorista_id, status')
      .eq('id', coletaId)
      .maybeSingle();

    if (!coleta) {
      return res.json({ success: false, error: 'Coleta não encontrada' });
    }

    // Buscar todas as posições do motorista
    const { data: todasPosicoes } = await supabaseAdmin
      .from('rastreamento_posicoes')
      .select('id, motorista_id, coleta_id, timestamp_gps, latitude, longitude')
      .eq('motorista_id', coleta.motorista_id)
      .order('timestamp_gps', { ascending: false })
      .limit(20);

    // Verificar termo aceito
    const { data: termo } = await supabaseAdmin
      .from('rastreamento_termos')
      .select('id, aceito_em, ativo')
      .eq('motorista_id', coleta.motorista_id)
      .eq('coleta_id', coletaId)
      .eq('ativo', true)
      .maybeSingle();

    res.json({
      success: true,
      coleta: {
        id: coleta.id,
        motorista_id: coleta.motorista_id,
        status: coleta.status
      },
      termoAceito: !!termo,
      termo: termo,
      totalPosicoes: todasPosicoes?.length || 0,
      posicoes: todasPosicoes || [],
      posicoesComColetaId: todasPosicoes?.filter(p => p.coleta_id === coletaId).length || 0,
      posicoesSemColetaId: todasPosicoes?.filter(p => !p.coleta_id).length || 0,
      posicoesOutrasColetas: todasPosicoes?.filter(p => p.coleta_id && p.coleta_id !== coletaId).length || 0
    });
  } catch (error) {
    console.error('❌ Erro no diagnóstico:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obter posições de uma coleta (para monitoramento)
async function usuarioAutenticadoMonitoramento(req) {
  if (req.session && req.session.usuario) {
    console.log('✅ Usuário autenticado via sessão:', req.session.usuario);
    return true;
  }

  try {
    const { user, error } = await getUserFromRequest(req);
    if (user && !error) {
      console.log('✅ Usuário autenticado via getUserFromRequest:', user.email || user.id);
      return true;
    }
  } catch (authError) {
    console.warn('⚠️ Erro ao verificar autenticação alternativa:', authError.message || authError);
  }

  return false;
}

async function fetchPosicoesResumoPorColeta(coletaId, janelaMinutos, includeSemColeta = true) {
  const { data: coleta, error: coletaError } = await supabaseAdmin
    .from('coletas')
    .select('id, motorista_id, status')
    .eq('id', coletaId)
    .maybeSingle();

  if (coletaError) {
    throw coletaError;
  }

  if (!coleta) {
    return { coleta: null, posicoes: [], info: null };
  }

  // Tentar usar RPC primeiro, se falhar, buscar diretamente
  let posicoesRpc = null;
  let rpcError = null;
  
  try {
    const { data, error } = await supabaseAdmin.rpc('get_posicoes_resumo', {
    p_coleta_id: coletaId,
    p_include_sem_coleta: includeSemColeta,
    p_max_minutes: janelaMinutos,
    p_limit_por_motorista: 1
  });

    if (!error) {
      posicoesRpc = data;
    } else {
      rpcError = error;
      console.warn('⚠️ RPC get_posicoes_resumo não disponível, usando busca direta:', rpcError.message);
  }
  } catch (err) {
    rpcError = err;
    console.warn('⚠️ Erro ao chamar RPC get_posicoes_resumo, usando busca direta:', err.message);
  }

  let posicoes = [];

  if (posicoesRpc && !rpcError) {
    // Usar dados da RPC
    posicoes = (posicoesRpc || []).map(pos => ({
    id: pos.id,
    motorista_id: pos.motorista_id,
    coleta_id: pos.coleta_id,
    latitude: pos.latitude,
    longitude: pos.longitude,
    timestamp_gps: pos.timestamp_gps,
    velocidade: pos.velocidade,
    endereco: pos.endereco,
    motoristas: {
      id: pos.motorista_id,
      nome: pos.motorista_nome,
      telefone1: pos.motorista_telefone
    }
  }));
  } else {
    // Buscar diretamente da tabela se RPC não estiver disponível
    const tempoLimite = new Date(Date.now() - janelaMinutos * 60 * 1000).toISOString();
    let posicoesData = [];
    
    console.log('🔍 Buscando posições diretamente:', {
      coletaId,
      motoristaId: coleta.motorista_id,
      janelaMinutos,
      tempoLimite,
      agora: new Date().toISOString(),
      diferencaMinutos: Math.floor((Date.now() - new Date(tempoLimite).getTime()) / 1000 / 60)
    });
    
    // Primeiro buscar posições vinculadas à coleta
    // IMPORTANTE: buscar SEM o relacionamento primeiro para verificar se há posições
    let queryBase = supabaseAdmin
      .from('rastreamento_posicoes')
      .select('id, motorista_id, coleta_id, latitude, longitude, timestamp_gps, velocidade, endereco')
      .eq('coleta_id', coletaId)
      .gte('timestamp_gps', tempoLimite)
      .order('timestamp_gps', { ascending: false });
    
    console.log('🔍 Executando query base (sem relacionamento)...');
    const { data: posicoesBase, error: errorBase } = await queryBase;
    
    if (errorBase) {
      console.error('❌ Erro na query base:', errorBase);
      throw errorBase;
    }
    
    console.log('📊 Posições encontradas (query base):', {
      total: posicoesBase?.length || 0,
      coletaId
    });
    
    // Se não encontrou nada, pode ser que as posições sejam antigas demais
    if (!posicoesBase || posicoesBase.length === 0) {
      // Tentar buscar sem filtro de tempo para debug
      const { data: todasPosicoes, error: errorTodas } = await supabaseAdmin
        .from('rastreamento_posicoes')
        .select('id, motorista_id, coleta_id, timestamp_gps')
        .eq('coleta_id', coletaId)
        .order('timestamp_gps', { ascending: false })
        .limit(5);
      
      if (!errorTodas && todasPosicoes && todasPosicoes.length > 0) {
        console.warn('⚠️ Posições encontradas mas fora da janela de tempo:', {
          totalEncontradas: todasPosicoes.length,
          maisRecente: todasPosicoes[0].timestamp_gps,
          tempoLimite,
          diferencaHoras: Math.floor((Date.now() - new Date(todasPosicoes[0].timestamp_gps).getTime()) / 1000 / 60 / 60)
        });
      }
      
      posicoesData = [];
    } else {
      // Se encontrou posições, buscar com relacionamento
      const motoristaIds = [...new Set(posicoesBase.map(p => p.motorista_id).filter(Boolean))];
      
      if (motoristaIds.length > 0) {
        // Buscar dados dos motoristas
        const { data: motoristasData, error: motoristasError } = await supabaseAdmin
          .from('motoristas')
          .select('id, nome, telefone1')
          .in('id', motoristaIds);
        
        if (motoristasError) {
          console.warn('⚠️ Erro ao buscar motoristas (continuando sem):', motoristasError);
        }
        
        // Mapear motoristas por ID
        const motoristasMap = new Map();
        (motoristasData || []).forEach(m => motoristasMap.set(m.id, m));
        
        // Combinar posições com dados dos motoristas
        posicoesData = posicoesBase.map(pos => ({
          ...pos,
          motoristas: motoristasMap.get(pos.motorista_id) || null
        }));
      } else {
        posicoesData = posicoesBase;
      }
    }
    
    console.log('📊 Posições encontradas na query final:', {
      total: posicoesData.length,
      coletaId,
      motoristaId: coleta.motorista_id,
      temMotoristas: posicoesData.length > 0 && posicoesData[0].motoristas ? true : false
    });

    // Agrupar por motorista e pegar a mais recente de cada
    const posicoesPorMotorista = new Map();
    (posicoesData || []).forEach(pos => {
      const key = pos.motorista_id;
      if (!posicoesPorMotorista.has(key) || 
          new Date(pos.timestamp_gps) > new Date(posicoesPorMotorista.get(key).timestamp_gps)) {
        posicoesPorMotorista.set(key, pos);
      }
    });

    posicoes = Array.from(posicoesPorMotorista.values()).map(pos => ({
      id: pos.id,
      motorista_id: pos.motorista_id,
      coleta_id: pos.coleta_id,
      latitude: pos.latitude,
      longitude: pos.longitude,
      timestamp_gps: pos.timestamp_gps,
      velocidade: pos.velocidade,
      endereco: pos.endereco,
      motoristas: pos.motoristas ? {
        id: pos.motoristas.id,
        nome: pos.motoristas.nome,
        telefone1: pos.motoristas.telefone1
      } : null
    }));
  }

  console.log('📊 Resumo de posições:', {
    coletaId: coleta.id,
    motoristaId: coleta.motorista_id,
    janelaMinutos,
    totalPosicoesRetornadas: posicoes.length,
    usandoRPC: !rpcError,
    observacao: 'Posições retornadas mesmo se motorista estiver usando token de rastreamento (sem sessão ativa)'
  });

  const info = {
    coletaId: coleta.id,
    motoristaId: coleta.motorista_id,
    status: coleta.status,
    temMotoristaVinculado: !!coleta.motorista_id,
    janelaMinutos,
    totalPosicoesEncontradas: posicoes.length
  };

  return { coleta, posicoes, info };
}

app.get('/api/rastreamento/posicoes', async (req, res) => {
  try {
    // Verificar autenticação do operador (quem está visualizando), não do motorista
    // O motorista pode estar usando token de rastreamento e não ter sessão ativa
    const operadorAutenticado = await usuarioAutenticadoMonitoramento(req);
    if (!operadorAutenticado) {
      console.warn('❌ Acesso não autorizado ao endpoint de múltiplas posições - operador não autenticado');
      return res.status(401).json({ success: false, error: 'Não autenticado.' });
    }
    
    console.log('✅ Operador autenticado - buscando posições (motorista pode estar usando token de rastreamento)');

    const coletasParam = (req.query.coletas || '').toString();
    const coletaIds = coletasParam
      .split(',')
      .map(id => id.trim())
      .filter(id => id && id !== 'null' && id !== 'undefined');

    if (!coletaIds.length) {
      return res.status(400).json({ success: false, error: 'Informe ao menos uma coleta.' });
    }

    const maxMinutesParam = parseInt(req.query.maxMinutes, 10);
    const janelaMinutos = Number.isFinite(maxMinutesParam)
      ? Math.max(5, Math.min(maxMinutesParam, 1440))
      : 240;
    const includeSemColeta = req.query.includeSemColeta !== 'false';

    const resultados = [];
    for (const coletaId of coletaIds) {
      try {
        const resultado = await fetchPosicoesResumoPorColeta(coletaId, janelaMinutos, includeSemColeta);
        if (resultado.coleta) {
          resultados.push(resultado);
        }
      } catch (fetchError) {
        console.error(`❌ Erro ao buscar posições para coleta ${coletaId}:`, fetchError);
      }
    }

    if (!resultados.length) {
      return res.json({
        success: true,
        posicoes: [],
        info: {
          multi: coletaIds.length > 1,
          janelaMinutos,
          totalColetas: coletaIds.length,
          coletas: []
        }
      });
    }

    const todasPosicoes = resultados.flatMap(r => r.posicoes);
    const posicoesPorColetaMotorista = new Map();
    todasPosicoes.forEach(pos => {
      const key = `${pos.coleta_id}-${pos.motorista_id}`;
      if (!posicoesPorColetaMotorista.has(key)) {
        posicoesPorColetaMotorista.set(key, pos);
      }
    });

    res.json({
      success: true,
      posicoes: Array.from(posicoesPorColetaMotorista.values()),
      info: {
        multi: coletaIds.length > 1,
        janelaMinutos,
        totalColetas: coletaIds.length,
        coletas: resultados.map(r => r.info)
      }
    });
  } catch (error) {
    console.error('❌ Erro ao obter posições (multi):', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar posições.' });
  }
});

app.get('/api/rastreamento/posicoes/:coletaId', async (req, res) => {
  try {
    if (!(await usuarioAutenticadoMonitoramento(req))) {
      console.warn('❌ Acesso não autorizado ao endpoint de posições');
      return res.status(401).json({ success: false, error: 'Não autenticado.' });
    }

    const { coletaId } = req.params;
    const maxMinutesParam = parseInt(req.query.maxMinutes, 10);
    const janelaMinutos = Number.isFinite(maxMinutesParam)
      ? Math.max(5, Math.min(maxMinutesParam, 1440))
      : 240;
    const includeSemColeta = req.query.includeSemColeta !== 'false';

    const { coleta, posicoes, info } = await fetchPosicoesResumoPorColeta(
      coletaId,
      janelaMinutos,
      includeSemColeta
    );

    if (!coleta) {
      return res.status(404).json({ success: false, error: 'Coleta não encontrada.' });
    }

    res.json({
      success: true,
      posicoes,
      info
    });
  } catch (error) {
    console.error('❌ Erro ao obter posições:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar posições.' });
  }
});

app.post('/api/motoristas/coletas/:coletaId/documentos', uploadDocumentos.array('arquivos', 30), async (req, res) => {
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
        console.log('📋 Payload dos documentos:', JSON.stringify(motoristaDocsPayload, null, 2));
        const { data: motoristaDocsInseridos, error: motoristaDocsError } = await supabaseAdmin
          .from('motorista_documentos')
          .insert(motoristaDocsPayload)
          .select('id, categoria, motorista_id, nome_arquivo');

        if (motoristaDocsError) {
          // Se a tabela não existir, apenas logar como aviso
          if (motoristaDocsError.message?.includes('does not exist') || 
              motoristaDocsError.code === 'PGRST116' ||
              motoristaDocsError.message?.includes('motorista_documentos')) {
            console.warn('⚠️ Tabela motorista_documentos não encontrada. Documentos serão salvos apenas em anexos.');
          } else {
            console.error('❌ Erro ao inserir documentos do motorista:', motoristaDocsError);
            throw motoristaDocsError;
          }
        } else {
          console.log('✅ Documentos permanentes do motorista inseridos com sucesso:', motoristaDocsInseridos?.length || 0);
          if (motoristaDocsInseridos && motoristaDocsInseridos.length > 0) {
            console.log('📄 Documentos inseridos:', JSON.stringify(motoristaDocsInseridos, null, 2));
          }
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

// Endpoint para solicitar ativação de localização GPS
app.post('/api/coletas/:coletaId/solicitar-ativacao-localizacao', requireAuth, async (req, res) => {
  try {
    const coletaId = req.params.coletaId;
    const { motivo } = req.body;

    // Buscar a coleta e verificar motorista vinculado
    const { data: coleta, error: coletaError } = await supabaseAdmin
      .from('coletas')
      .select('id, motorista_id')
      .eq('id', coletaId)
      .single();

    if (coletaError || !coleta) {
      return res.status(404).json({ success: false, error: 'Coleta não encontrada.' });
    }

    if (!coleta.motorista_id) {
      return res.status(400).json({ success: false, error: 'Coleta não tem motorista vinculado.' });
    }

    // Obter usuário que está solicitando
    const usuario = req.session?.usuario || req.supabaseUser?.email || req.supabaseUser?.id || 'Sistema';
    
    const motivoPadrao = motivo || 'Solicitação de ativação de localização GPS para rastreamento em tempo real';
    
    console.log('📍 Criando solicitação de ativação de localização:', { coletaId, motorista_id: coleta.motorista_id, usuario });
    
    // Criar solicitação usando a tabela de solicitações com categoria 'localizacao'
    // Usaremos categoria 'outro' por enquanto, mas podemos adicionar 'localizacao' na tabela depois
    const { data: solicitacao, error: solicitacaoError } = await supabaseAdmin
      .from('solicitacoes_documentos')
      .insert({
        coleta_id: coletaId,
        motorista_id: coleta.motorista_id,
        categoria: 'outro', // Por enquanto usar 'outro', pode ser alterado depois
        motivo: `📍 LOCALIZAÇÃO GPS: ${motivoPadrao}`,
        solicitado_por: usuario,
        status: 'pendente'
      })
      .select()
      .single();

    if (solicitacaoError) {
      console.error('❌ Erro ao inserir solicitação de localização:', solicitacaoError);
      throw solicitacaoError;
    }
    
    console.log('✅ Solicitação de localização criada:', solicitacao?.id);

    res.json({ success: true, solicitacao });
  } catch (error) {
    console.error('❌ Erro ao solicitar ativação de localização:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Não foi possível criar a solicitação. Tente novamente.',
      details: error.message || error.toString()
    });
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

// ========== ENDPOINT PARA ADICIONAR COLUNA OPERACAO À TABELA ITS_DOCUMENTOS ==========
// Endpoint para executar migração de operacao em its_documentos
app.post('/api/admin/adicionar-operacao-its-documentos', requireAuth, async (req, res) => {
  try {
    // Verificar se é admin
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    const isAdmin = userProfile?.role === 'admin' || user.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Apenas administradores podem executar migrações' });
    }

    console.log('🔧 Endpoint chamado para adicionar coluna operacao à tabela its_documentos...');

    // Verificar se a coluna já existe
    const { data: its, error: verifError } = await supabaseAdmin
      .from('its_documentos')
      .select('id, area, operacao')
      .limit(1);

    if (!verifError && its && its.length > 0 && 'operacao' in its[0]) {
      console.log('✅ Coluna operacao já existe na tabela its_documentos!');
      return res.json({
        success: true,
        message: 'Coluna operacao já existe na tabela its_documentos',
        colunaExiste: true
      });
    }

    // SQL da migração
    const migrationSQL = `
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'its_documentos' 
        AND column_name = 'operacao'
    ) THEN
        ALTER TABLE its_documentos 
        ADD COLUMN operacao TEXT NULL;
        
        RAISE NOTICE 'Coluna operacao adicionada com sucesso à tabela its_documentos';
    ELSE
        RAISE NOTICE 'Coluna operacao já existe na tabela its_documentos';
    END IF;
END $$;

COMMENT ON COLUMN its_documentos.operacao IS 'Operação/Área específica da IT';

CREATE INDEX IF NOT EXISTS idx_its_documentos_operacao ON its_documentos(operacao) WHERE operacao IS NOT NULL;
    `.trim();

    // Tentar executar via RPC exec_sql
    console.log('⏳ Tentando executar migração via RPC exec_sql...');
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('exec_sql', {
      sql_query: migrationSQL
    });

    if (!rpcError) {
      console.log('✅ Migração executada com sucesso via RPC!');
      return res.json({
        success: true,
        message: 'Coluna operacao adicionada com sucesso à tabela its_documentos',
        method: 'rpc'
      });
    }

    console.log('⚠️ RPC não disponível, tentando método alternativo...');

    // Método alternativo: executar cada comando separadamente
    try {
      // 1. Adicionar coluna
      const { error: alterError } = await supabaseAdmin.rpc('exec_sql', {
        sql_query: `
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'its_documentos' AND column_name = 'operacao'
            ) THEN
              ALTER TABLE its_documentos ADD COLUMN operacao TEXT NULL;
            END IF;
          END $$;
        `
      });

      if (alterError) {
        console.warn('⚠️ Erro ao adicionar coluna (pode já existir):', alterError.message);
      }

      // 2. Adicionar comentário
      const { error: commentError } = await supabaseAdmin.rpc('exec_sql', {
        sql_query: `COMMENT ON COLUMN its_documentos.operacao IS 'Operação/Área específica da IT';`
      });

      if (commentError) {
        console.warn('⚠️ Erro ao adicionar comentário:', commentError.message);
      }

      // 3. Criar índice
      const { error: indexError } = await supabaseAdmin.rpc('exec_sql', {
        sql_query: `CREATE INDEX IF NOT EXISTS idx_its_documentos_operacao ON its_documentos(operacao) WHERE operacao IS NOT NULL;`
      });

      if (indexError) {
        console.warn('⚠️ Erro ao criar índice (pode já existir):', indexError.message);
      }

      // Verificar se a coluna foi criada
      const { data: verificacao, error: verifError2 } = await supabaseAdmin
        .from('its_documentos')
        .select('id, area, operacao')
        .limit(1);

      if (!verifError2 && verificacao && verificacao.length > 0 && 'operacao' in verificacao[0]) {
        console.log('✅ Coluna operacao criada com sucesso!');
        return res.json({
          success: true,
          message: 'Coluna operacao adicionada com sucesso à tabela its_documentos',
          method: 'alternative'
        });
      }

      throw new Error('Não foi possível verificar se a coluna foi criada');

    } catch (altError) {
      console.error('❌ Erro no método alternativo:', altError);
      throw altError;
    }

  } catch (error) {
    console.error('❌ Erro ao adicionar coluna operacao:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao adicionar coluna operacao: ' + (error.message || 'Erro desconhecido'),
      details: error.message
    });
  }
});

// ========== ENDPOINT PARA ADICIONAR COLUNA OPERACAO À TABELA CLIENTES ==========
// Endpoint para executar migração de operacao - pode ser chamado via MCP ou diretamente
app.post('/api/admin/adicionar-operacao-clientes', requireAuth, async (req, res) => {
  try {
    // Verificar se é admin
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    const isAdmin = userProfile?.role === 'admin' || user.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Apenas administradores podem executar migrações' });
    }

    console.log('🔧 Endpoint chamado para adicionar coluna operacao à tabela clientes...');

    // Verificar se a coluna já existe
    const { data: clientes, error: verifError } = await supabaseAdmin
      .from('clientes')
      .select('id, nome, filial, operacao')
      .limit(1);

    if (!verifError && clientes && clientes.length > 0 && 'operacao' in clientes[0]) {
      console.log('✅ Coluna operacao já existe na tabela clientes!');
      return res.json({
        success: true,
        message: 'Coluna operacao já existe na tabela clientes',
        colunaExiste: true
      });
    }

    // SQL da migração
    const migrationSQL = `
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'clientes' 
        AND column_name = 'operacao'
    ) THEN
        ALTER TABLE clientes 
        ADD COLUMN operacao TEXT NULL;
        
        RAISE NOTICE 'Coluna operacao adicionada com sucesso à tabela clientes';
    ELSE
        RAISE NOTICE 'Coluna operacao já existe na tabela clientes';
    END IF;
END $$;

COMMENT ON COLUMN clientes.operacao IS 'Operação/Área específica do cliente (ex: operacoes_jbo, operacoes_cabo, estoque, compras, etc.)';

CREATE INDEX IF NOT EXISTS idx_clientes_operacao ON clientes(operacao) WHERE operacao IS NOT NULL;
    `.trim();

    // Tentar executar via RPC exec_sql
    console.log('⏳ Tentando executar migração via RPC exec_sql...');
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('exec_sql', {
      sql_query: migrationSQL
    });

    if (!rpcError) {
      console.log('✅ Migração executada com sucesso via RPC!');
      return res.json({
        success: true,
        message: 'Coluna operacao adicionada com sucesso à tabela clientes',
        method: 'rpc'
      });
    }

    console.log('⚠️ RPC não disponível, tentando método alternativo...');

    // Método alternativo: executar cada comando separadamente
    try {
      // 1. Adicionar coluna
      const { error: alterError } = await supabaseAdmin.rpc('exec_sql', {
        sql_query: `
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'clientes' AND column_name = 'operacao'
            ) THEN
              ALTER TABLE clientes ADD COLUMN operacao TEXT NULL;
            END IF;
          END $$;
        `
      });

      if (alterError) {
        console.warn('⚠️ Erro ao adicionar coluna (pode já existir):', alterError.message);
      }

      // 2. Adicionar comentário
      const { error: commentError } = await supabaseAdmin.rpc('exec_sql', {
        sql_query: `COMMENT ON COLUMN clientes.operacao IS 'Operação/Área específica do cliente';`
      });

      if (commentError) {
        console.warn('⚠️ Erro ao adicionar comentário:', commentError.message);
      }

      // 3. Criar índice
      const { error: indexError } = await supabaseAdmin.rpc('exec_sql', {
        sql_query: `CREATE INDEX IF NOT EXISTS idx_clientes_operacao ON clientes(operacao) WHERE operacao IS NOT NULL;`
      });

      if (indexError) {
        console.warn('⚠️ Erro ao criar índice (pode já existir):', indexError.message);
      }

      // Verificar se a coluna foi criada
      const { data: verificacao, error: verifError2 } = await supabaseAdmin
        .from('clientes')
        .select('id, nome, filial, operacao')
        .limit(1);

      if (!verifError2 && verificacao && verificacao.length > 0 && 'operacao' in verificacao[0]) {
        console.log('✅ Coluna operacao criada com sucesso!');
        return res.json({
          success: true,
          message: 'Coluna operacao adicionada com sucesso à tabela clientes',
          method: 'alternative'
        });
      }

      throw new Error('Não foi possível verificar se a coluna foi criada');

    } catch (altError) {
      console.error('❌ Erro no método alternativo:', altError);
      throw altError;
    }

  } catch (error) {
    console.error('❌ Erro ao adicionar coluna operacao:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao adicionar coluna operacao: ' + (error.message || 'Erro desconhecido'),
      details: error.message
    });
  }
});

// ========== ENDPOINT PARA ADICIONAR COLUNA DATA_ENTREGA À TABELA COLETAS ==========
// Endpoint para executar migração de data_entrega - pode ser chamado via MCP ou diretamente
app.post('/api/admin/adicionar-data-entrega-coletas', async (req, res) => {
  try {
    console.log('🔧 Endpoint chamado para adicionar coluna data_entrega à tabela coletas...');

    // Verificar se a coluna já existe
    const { data: coletas, error: verifError } = await supabaseAdmin
      .from('coletas')
      .select('id, data_recebimento, data_entrega')
      .limit(1);

    if (!verifError && coletas && coletas.length > 0 && 'data_entrega' in coletas[0]) {
      console.log('✅ Coluna data_entrega já existe na tabela coletas!');
      return res.json({
        success: true,
        message: 'Coluna data_entrega já existe na tabela coletas',
        colunaExiste: true
      });
    }

    // SQL da migração
    const migrationSQL = `
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'coletas' 
        AND column_name = 'data_entrega'
    ) THEN
        ALTER TABLE coletas 
        ADD COLUMN data_entrega TIMESTAMPTZ NULL;
        
        RAISE NOTICE 'Coluna data_entrega adicionada com sucesso à tabela coletas';
    ELSE
        RAISE NOTICE 'Coluna data_entrega já existe na tabela coletas';
    END IF;
END $$;

COMMENT ON COLUMN coletas.data_entrega IS 'Data de entrega da coleta ao destino final';
    `.trim();

    // Tentar executar via RPC exec_sql
    console.log('⏳ Tentando executar migração via RPC exec_sql...');
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('exec_sql', {
      sql_query: migrationSQL
    });

    if (rpcError) {
      console.error('❌ Erro ao executar migração via RPC:', rpcError);
      return res.status(500).json({
        success: false,
        error: 'Não foi possível executar a migração automaticamente. Execute o SQL manualmente no Supabase Dashboard.',
        sql: migrationSQL,
        instrucoes: [
          '1. Acesse: https://supabase.com/dashboard',
          '2. Selecione seu projeto',
          '3. Vá em: SQL Editor > New Query',
          '4. Cole o SQL fornecido',
          '5. Execute (Run ou Ctrl+Enter)'
        ]
      });
    }

    // Aguardar um pouco para garantir que a alteração foi processada
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verificar se a coluna foi criada
    const { data: coletasVerif, error: verifError2 } = await supabaseAdmin
      .from('coletas')
      .select('id, data_recebimento, data_entrega')
      .limit(1);

    if (verifError2 && verifError2.message && verifError2.message.includes('data_entrega')) {
      return res.status(500).json({
        success: false,
        error: 'Migração executada mas coluna não está acessível. Verifique no Supabase Dashboard.',
        sql: migrationSQL
      });
    }

    console.log('✅ Coluna data_entrega adicionada com sucesso à tabela coletas!');

    res.json({
      success: true,
      message: 'Coluna data_entrega adicionada com sucesso à tabela coletas!',
      colunaExiste: true
    });
  } catch (error) {
    console.error('❌ Erro ao executar migração:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao executar migração: ' + error.message,
      sql: migrationSQL || 'Verifique o arquivo migration_adicionar_data_entrega_coletas.sql'
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

// Endpoint para obter dados do usuário autenticado
app.get('/api/auth/user', requireAuth, async (req, res) => {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado', user: null });
    }

    // Buscar dados completos do usuário
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, email, role, nome')
      .eq('id', user.id)
      .maybeSingle();

    const isAdmin = userProfile?.role === 'admin' || user.isAdmin === true;

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email || userProfile?.email,
        nome: userProfile?.nome,
        role: userProfile?.role || user.role,
        isAdmin: isAdmin
      }
    });
  } catch (error) {
    console.error('❌ Erro ao buscar dados do usuário:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar dados do usuário', user: null });
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
      // A tabela sessions do connect-sqlite3 pode ter diferentes estruturas
      // Primeiro verificar quais colunas existem
      const checkColumnsQuery = `PRAGMA table_info(sessions)`;
      
      await new Promise((resolveCheck, rejectCheck) => {
        db.all(checkColumnsQuery, [], (err, columns) => {
          if (err) {
            console.warn('⚠️ Erro ao verificar colunas da tabela sessions:', err);
            db.close();
            resolveCheck();
            return;
          }
          
          // Verificar quais colunas existem
          const columnNames = columns.map(col => col.name);
          const hasExpires = columnNames.includes('expires');
          const hasExpired = columnNames.includes('expired');
          
          // Construir query baseada nas colunas disponíveis
          let query = `SELECT sid, sess`;
          if (hasExpired) query += `, expired`;
          if (hasExpires) query += `, expires`;
          query += ` FROM sessions`;
          
          db.all(query, [], (err, rows) => {
            db.close();
            
            if (err) {
              console.warn('⚠️ Erro ao buscar sessões SQLite:', err);
              resolveCheck();
              return;
            }
            
            const now = Date.now();
            
            if (rows && rows.length) {
              rows.forEach(row => {
                try {
                  // Verificar se sessão está expirada baseado nas colunas disponíveis
                  let notExpired = true;
                  
                  if (hasExpires && row.expires) {
                    // Verificar coluna 'expires' (formato ISO string ou timestamp)
                    const expParsed = new Date(row.expires).getTime();
                    if (!Number.isNaN(expParsed)) {
                      notExpired = expParsed > now;
                    }
                  } else if (hasExpired && typeof row.expired === 'boolean') {
                    // Se 'expired' é false, a sessão ainda está ativa
                    notExpired = !row.expired;
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
            
            resolveCheck();
          });
        });
      });
    } catch (error) {
      console.warn('⚠️ Erro ao processar sessões SQLite:', error.message);
    }
    
    // Janela de atividade considerada "online" (2 horas)
    const janelaAtividadeMs = 2 * 60 * 60 * 1000; // 2h
    
    // 2. Contar tokens ativos do Supabase Auth (últimas 2 horas)
    try {
      const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();
      
      if (!authError && authUsers && authUsers.users) {
        const agora = Date.now();
        
        authUsers.users.forEach(user => {
          // Excluir motoristas
          if (motoristaIds.has(user.id)) {
            return;
          }
          
          // Verificar se o usuário tem última sessão recente (últimas 2h)
          if (user.last_sign_in_at) {
            const lastSignIn = new Date(user.last_sign_in_at).getTime();
            const diff = agora - lastSignIn;
            
            // Se fez login nas últimas 2 horas, considerar como ativo
            if (diff < janelaAtividadeMs) {
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
    
    // Filtrar por janela de atividade para evitar mostrar sessões antigas
    const agora = Date.now();
    const usuariosFiltrados = usuariosCompletos.filter(u => {
      if (u.last_sign_in_at) {
        const diff = agora - new Date(u.last_sign_in_at).getTime();
        return diff < janelaAtividadeMs;
      }
      // Se não temos last_sign_in_at, manter (ex.: sessão ativa sem timestamp)
      return true;
    });
    
    const totalUsuariosLogados = usuariosFiltrados.length;
    
    // 4. Sincronizar com a tabela user_presence (marcar usuários logados como online)
    try {
      const userIdsLogados = usuariosCompletos.map(u => u.id);
      if (userIdsLogados.length > 0) {
        // Marcar todos os usuários logados como online
        for (const userId of userIdsLogados) {
          try {
            const { error: presenceError } = await supabaseAdmin
              .from('user_presence')
              .upsert({
                user_id: userId,
                is_online: true,
                last_seen: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }, {
                onConflict: 'user_id'
              });
            
            if (presenceError) {
              console.warn(`⚠️ Erro ao sincronizar presença do usuário ${userId}:`, presenceError.message);
            }
          } catch (err) {
            console.warn(`⚠️ Erro ao sincronizar presença do usuário ${userId}:`, err.message);
          }
        }
        console.log(`✅ ${userIdsLogados.length} usuário(s) sincronizado(s) com user_presence`);
      }
    } catch (syncError) {
      console.warn('⚠️ Erro ao sincronizar user_presence:', syncError.message);
    }
    
    console.log(`👥 Usuários administrativos únicos logados: ${totalUsuariosLogados} (motoristas excluídos)`);
    
    res.json({
      success: true,
      count: totalUsuariosLogados,
      usuarios: usuariosFiltrados
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
    
    // Buscar contagem total de activity logs
    const { count: totalActivityLogs } = await supabaseAdmin
      .from('user_activity_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    // Buscar último login do user_profiles
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('last_login, created_at, nome, email')
      .eq('id', userId)
      .maybeSingle();
    
    // Buscar histórico de coletas - usar historico_movimentacoes que tem usuario_id
    const { data: coletasHistory, error: coletasError } = await supabaseAdmin
      .from('historico_movimentacoes')
      .select('acao, detalhes, created_at')
      .eq('usuario_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    // Buscar contagem total de coletas (usando historico_movimentacoes)
    const { count: totalColetas } = await supabaseAdmin
      .from('historico_movimentacoes')
      .select('*', { count: 'exact', head: true })
      .eq('usuario_id', userId);
    
    // Buscar disparos de mensagens
    const { data: disparos, error: disparosError } = await supabaseAdmin
      .from('disparos_log')
      .select('numero, status, created_at, mensagem_tamanho')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    // Buscar contagem total de disparos
    const { count: totalDisparos } = await supabaseAdmin
      .from('disparos_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    // Buscar uso do chat com IA
    const { data: chatIA, error: chatError } = await supabaseAdmin
      .from('chat_ia_conversas')
      .select('mensagem, resposta, pagina_origem, categoria, tokens_usados, satisfacao, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    // Buscar contagem total de chat IA
    const { count: totalChatIA } = await supabaseAdmin
      .from('chat_ia_conversas')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    // Buscar histórico de movimentações em coletas
    const { data: movimentacoes, error: movError } = await supabaseAdmin
      .from('historico_movimentacoes')
      .select('acao, detalhes, created_at')
      .eq('usuario_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    // Buscar contagem total de movimentações
    const { count: totalMovimentacoes } = await supabaseAdmin
      .from('historico_movimentacoes')
      .select('*', { count: 'exact', head: true })
      .eq('usuario_id', userId);
    
    // Buscar cadastros de motoristas realizados pelo usuário
    const { data: cadastros, error: cadastrosError } = await supabaseAdmin
      .from('motoristas')
      .select('id, nome, telefone1, cnh, tipo_veiculo, tipo_carroceria, placa_cavalo, status, data_cadastro')
      .eq('created_by', userId)
      .order('data_cadastro', { ascending: false })
      .limit(50);
    
    // Buscar contagem total de cadastros
    const { count: totalCadastros } = await supabaseAdmin
      .from('motoristas')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', userId);
    
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
        cadastros: cadastros || [],
        // Contagens totais para estatísticas
        totalActivityLogs: totalActivityLogs || 0,
        totalColetas: totalColetas || 0,
        totalDisparos: totalDisparos || 0,
        totalChatIA: totalChatIA || 0,
        totalMovimentacoes: totalMovimentacoes || 0,
        totalCadastros: totalCadastros || 0
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
    // Obter identificador do usuário (sessão ou Supabase)
    let usuarioId = req.session?.usuario;
    if (!usuarioId && req.supabaseUser) {
      // IMPORTANTE: O user_id na tabela user_evolution_apis é o ID do user_profiles,
      // não o ID do Supabase Auth. Precisamos buscar o profile primeiro.
      if (req.supabaseUser.id) {
        console.log('🔑 ID do Supabase Auth disponível:', req.supabaseUser.id);
        // Tentar buscar o user_profiles pelo ID do Supabase Auth
        const { data: profileData, error: profileError } = await supabaseAdmin
          .from('user_profiles')
          .select('id')
          .eq('id', req.supabaseUser.id)
          .maybeSingle();
        
        if (!profileError && profileData && profileData.id) {
          usuarioId = profileData.id;
          console.log('✅ ID do user_profiles encontrado:', usuarioId);
        } else {
          // Se não encontrou pelo ID, tentar pelo email
          if (req.supabaseUser.email) {
            console.log('📧 Buscando profile pelo email:', req.supabaseUser.email);
            const { data: profileByEmail, error: profileByEmailError } = await supabaseAdmin
              .from('user_profiles')
              .select('id')
              .eq('email', req.supabaseUser.email)
              .maybeSingle();
            
            if (!profileByEmailError && profileByEmail && profileByEmail.id) {
              usuarioId = profileByEmail.id;
              console.log('✅ ID do user_profiles encontrado pelo email:', usuarioId);
            } else {
              // Fallback: usar o ID do Supabase Auth diretamente (pode funcionar se for o mesmo)
              usuarioId = req.supabaseUser.id;
              console.log('⚠️ Usando ID do Supabase Auth como fallback:', usuarioId);
            }
          } else {
            usuarioId = req.supabaseUser.id;
            console.log('⚠️ Usando ID do Supabase Auth (sem email):', usuarioId);
          }
        }
      } else if (req.supabaseUser.email) {
        usuarioId = req.supabaseUser.email;
        console.log('📧 Usando email do Supabase como identificador:', usuarioId);
      }
    }
    
    if (!usuarioId) {
      return res.status(401).json({
        success: false,
        error: 'Usuário não identificado'
      });
    }
    
    const userConfig = await getEvolutionConfigByUser(usuarioId);
    
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
    // Obter identificador do usuário (sessão ou Supabase)
    let usuarioId = req.session?.usuario;
    if (!usuarioId && req.supabaseUser) {
      // IMPORTANTE: O user_id na tabela user_evolution_apis é o ID do user_profiles,
      // não o ID do Supabase Auth. Precisamos buscar o profile primeiro.
      if (req.supabaseUser.id) {
        console.log('🔑 ID do Supabase Auth disponível:', req.supabaseUser.id);
        // Tentar buscar o user_profiles pelo ID do Supabase Auth
        const { data: profileData, error: profileError } = await supabaseAdmin
          .from('user_profiles')
          .select('id')
          .eq('id', req.supabaseUser.id)
          .maybeSingle();
        
        if (!profileError && profileData && profileData.id) {
          usuarioId = profileData.id;
          console.log('✅ ID do user_profiles encontrado:', usuarioId);
        } else {
          // Se não encontrou pelo ID, tentar pelo email
          if (req.supabaseUser.email) {
            console.log('📧 Buscando profile pelo email:', req.supabaseUser.email);
            const { data: profileByEmail, error: profileByEmailError } = await supabaseAdmin
              .from('user_profiles')
              .select('id')
              .eq('email', req.supabaseUser.email)
              .maybeSingle();
            
            if (!profileByEmailError && profileByEmail && profileByEmail.id) {
              usuarioId = profileByEmail.id;
              console.log('✅ ID do user_profiles encontrado pelo email:', usuarioId);
            } else {
              // Fallback: usar o ID do Supabase Auth diretamente (pode funcionar se for o mesmo)
              usuarioId = req.supabaseUser.id;
              console.log('⚠️ Usando ID do Supabase Auth como fallback:', usuarioId);
            }
          } else {
            usuarioId = req.supabaseUser.id;
            console.log('⚠️ Usando ID do Supabase Auth (sem email):', usuarioId);
          }
        }
      } else if (req.supabaseUser.email) {
        usuarioId = req.supabaseUser.email;
        console.log('📧 Usando email do Supabase como identificador:', usuarioId);
      }
    }
    
    if (!usuarioId) {
      return res.status(401).json({
        success: false,
        error: 'Usuário não identificado'
      });
    }
    
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
    
    const result = await salvarEvolutionConfig(usuarioId, config);
    
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

app.post('/api/evolution/instance/logout', requireAuth, async (req, res) => {
  try {
    console.log('🔐 Logout Evolution - Verificando autenticação...', {
      hasSession: !!req.session?.usuario,
      hasSupabaseUser: !!req.supabaseUser,
      sessionUsuario: req.session?.usuario,
      supabaseUserEmail: req.supabaseUser?.email,
      supabaseUserId: req.supabaseUser?.id
    });
    
    // Obter identificador do usuário (sessão ou Supabase)
    let usuarioId = req.session?.usuario;
    if (!usuarioId && req.supabaseUser) {
      // IMPORTANTE: O user_id na tabela user_evolution_apis é o ID do user_profiles,
      // não o ID do Supabase Auth. Precisamos buscar o profile primeiro.
      if (req.supabaseUser.id) {
        console.log('🔑 ID do Supabase Auth disponível:', req.supabaseUser.id);
        // Tentar buscar o user_profiles pelo ID do Supabase Auth
        const { data: profileData, error: profileError } = await supabaseAdmin
          .from('user_profiles')
          .select('id')
          .eq('id', req.supabaseUser.id)
          .maybeSingle();
        
        if (!profileError && profileData && profileData.id) {
          usuarioId = profileData.id;
          console.log('✅ ID do user_profiles encontrado:', usuarioId);
        } else {
          // Se não encontrou pelo ID, tentar pelo email
          if (req.supabaseUser.email) {
            console.log('📧 Buscando profile pelo email:', req.supabaseUser.email);
            const { data: profileByEmail, error: profileByEmailError } = await supabaseAdmin
              .from('user_profiles')
              .select('id')
              .eq('email', req.supabaseUser.email)
              .maybeSingle();
            
            if (!profileByEmailError && profileByEmail && profileByEmail.id) {
              usuarioId = profileByEmail.id;
              console.log('✅ ID do user_profiles encontrado pelo email:', usuarioId);
            } else {
              // Fallback: usar o ID do Supabase Auth diretamente (pode funcionar se for o mesmo)
              usuarioId = req.supabaseUser.id;
              console.log('⚠️ Usando ID do Supabase Auth como fallback:', usuarioId);
            }
          } else {
            usuarioId = req.supabaseUser.id;
            console.log('⚠️ Usando ID do Supabase Auth (sem email):', usuarioId);
          }
        }
      } else if (req.supabaseUser.email) {
        usuarioId = req.supabaseUser.email;
        console.log('📧 Usando email do Supabase como identificador:', usuarioId);
      }
    }
    
    if (!usuarioId) {
      console.error('❌ Usuário não identificado para logout');
      return res.status(401).json({
        success: false,
        error: 'Usuário não identificado'
      });
    }
    
    console.log('🔍 Buscando configuração Evolution para:', usuarioId);
    console.log('📧 Tipo do identificador:', typeof usuarioId, (typeof usuarioId === 'string' && usuarioId.includes('@')) ? '(email)' : '(ID)');
    
    const userConfig = await getEvolutionConfigByUser(usuarioId);
    console.log('📋 Configuração retornada:', {
      hasConfig: !!userConfig,
      hasError: !!userConfig?.error,
      instanceName: userConfig?.instanceName,
      hasApiKey: !!userConfig?.apiKey,
      apiUrl: userConfig?.apiUrl,
      rawConfig: userConfig
    });
    
    const evolutionConfig = normalizeEvolutionConfig(userConfig);
    console.log('📋 Configuração normalizada:', {
      hasConfig: !!evolutionConfig,
      instanceName: evolutionConfig?.instanceName,
      hasApiKey: !!evolutionConfig?.apiKey,
      apiUrl: evolutionConfig?.apiUrl
    });

    if (!evolutionConfig) {
      console.error('❌ Configuração Evolution não encontrada ou inválida para:', usuarioId);
      console.error('❌ Detalhes da busca:', {
        usuarioId,
        userConfig,
        evolutionConfig
      });
      return res.status(404).json({
        success: false,
        error: 'Instância não configurada para este usuário. Configure sua instância em Settings > Evolution API.'
      });
    }

    const logoutUrl = `${evolutionConfig.apiUrl}/instance/logout/${encodeURIComponent(evolutionConfig.instanceName)}`;
    const response = await fetchWithTimeout(logoutUrl, {
      method: 'DELETE',
      headers: {
        apikey: evolutionConfig.apiKey,
        'Content-Type': 'application/json'
      }
    }, 15000);

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        success: false,
        error: 'Erro ao desconectar a instância',
        details: errorText || null
      });
    }

    console.log('✅ Instância Evolution desconectada:', {
      usuario: usuarioId,
      instance: evolutionConfig.instanceName
    });

    res.json({
      success: true,
      message: 'Instância desconectada com sucesso',
      instanceName: evolutionConfig.instanceName
    });
  } catch (error) {
    console.error('❌ Erro ao desconectar instância Evolution:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno ao desconectar instância'
    });
  }
});

app.get('/api/evolution/instance/qrcode', requireAuth, async (req, res) => {
  try {
    console.log('🔐 QR Code Evolution - Verificando autenticação...', {
      hasSession: !!req.session?.usuario,
      hasSupabaseUser: !!req.supabaseUser,
      sessionUsuario: req.session?.usuario,
      supabaseUserEmail: req.supabaseUser?.email,
      supabaseUserId: req.supabaseUser?.id
    });
    
    // Obter identificador do usuário (sessão ou Supabase)
    let usuarioId = req.session?.usuario;
    if (!usuarioId && req.supabaseUser) {
      // IMPORTANTE: O user_id na tabela user_evolution_apis é o ID do user_profiles,
      // não o ID do Supabase Auth. Precisamos buscar o profile primeiro.
      if (req.supabaseUser.id) {
        console.log('🔑 ID do Supabase Auth disponível:', req.supabaseUser.id);
        // Tentar buscar o user_profiles pelo ID do Supabase Auth
        const { data: profileData, error: profileError } = await supabaseAdmin
          .from('user_profiles')
          .select('id')
          .eq('id', req.supabaseUser.id)
          .maybeSingle();
        
        if (!profileError && profileData && profileData.id) {
          usuarioId = profileData.id;
          console.log('✅ ID do user_profiles encontrado:', usuarioId);
        } else {
          // Se não encontrou pelo ID, tentar pelo email
          if (req.supabaseUser.email) {
            console.log('📧 Buscando profile pelo email:', req.supabaseUser.email);
            const { data: profileByEmail, error: profileByEmailError } = await supabaseAdmin
              .from('user_profiles')
              .select('id')
              .eq('email', req.supabaseUser.email)
              .maybeSingle();
            
            if (!profileByEmailError && profileByEmail && profileByEmail.id) {
              usuarioId = profileByEmail.id;
              console.log('✅ ID do user_profiles encontrado pelo email:', usuarioId);
            } else {
              // Fallback: usar o ID do Supabase Auth diretamente (pode funcionar se for o mesmo)
              usuarioId = req.supabaseUser.id;
              console.log('⚠️ Usando ID do Supabase Auth como fallback:', usuarioId);
            }
          } else {
            usuarioId = req.supabaseUser.id;
            console.log('⚠️ Usando ID do Supabase Auth (sem email):', usuarioId);
          }
        }
      } else if (req.supabaseUser.email) {
        usuarioId = req.supabaseUser.email;
        console.log('📧 Usando email do Supabase como identificador:', usuarioId);
      }
    }
    
    if (!usuarioId) {
      console.error('❌ Usuário não identificado para QR code');
      return res.status(401).json({
        success: false,
        error: 'Usuário não identificado'
      });
    }
    
    console.log('🔍 Buscando configuração Evolution para:', usuarioId);
    console.log('📧 Tipo do identificador:', typeof usuarioId, (typeof usuarioId === 'string' && usuarioId.includes('@')) ? '(email)' : '(ID)');
    
    const userConfig = await getEvolutionConfigByUser(usuarioId);
    console.log('📋 Configuração retornada:', {
      hasConfig: !!userConfig,
      hasError: !!userConfig?.error,
      instanceName: userConfig?.instanceName,
      hasApiKey: !!userConfig?.apiKey,
      apiUrl: userConfig?.apiUrl,
      rawConfig: userConfig
    });
    
    const evolutionConfig = normalizeEvolutionConfig(userConfig);
    console.log('📋 Configuração normalizada:', {
      hasConfig: !!evolutionConfig,
      instanceName: evolutionConfig?.instanceName,
      hasApiKey: !!evolutionConfig?.apiKey,
      apiUrl: evolutionConfig?.apiUrl
    });

    if (!evolutionConfig) {
      console.error('❌ Configuração Evolution não encontrada ou inválida para:', usuarioId);
      console.error('❌ Detalhes da busca:', {
        usuarioId,
        userConfig,
        evolutionConfig
      });
      return res.status(404).json({
        success: false,
        error: 'Instância não configurada para este usuário. Configure sua instância em Settings > Evolution API.'
      });
    }

    const qrUrl = `${evolutionConfig.apiUrl}/instance/connect/${encodeURIComponent(evolutionConfig.instanceName)}`;
    const response = await fetchWithTimeout(qrUrl, {
      method: 'GET',
      headers: {
        apikey: evolutionConfig.apiKey,
        'Content-Type': 'application/json'
      }
    }, 20000);

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        success: false,
        error: 'Erro ao gerar QR code',
        details: errorText || null
      });
    }

    const data = await response.json();
    const qrValue = data?.qrcode || data?.qrCode || data?.base64 || data?.qr || data?.code || data?.data?.qrcode || data?.result?.qrcode || null;

    if (!qrValue && !data?.url) {
      return res.status(502).json({
        success: false,
        error: 'Evolution API não retornou o QR code esperado'
      });
    }

    res.json({
      success: true,
      qrcode: qrValue || data.url,
      instanceName: evolutionConfig.instanceName,
      expiresIn: data?.expiresIn || data?.expires_in || null,
      connected: data?.connected || false
    });
  } catch (error) {
    console.error('❌ Erro ao gerar QR code Evolution:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno ao gerar QR code'
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
  res.sendFile(path.join(__dirname, 'public/pages/index.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/index.html'));
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
  res.sendFile(path.join(__dirname, 'public/pages/index.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/login.html'));
});

app.get('/comercial.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/comercial.html'));
});

// ========== ROTAS PROTEGIDAS ==========
app.get('/painel.html', requireAuth, (req, res) => {
  // Headers para evitar cache em HTML
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/painel.html'));
});

app.get('/portal.html', requireAuth, (req, res) => {
  // Headers para evitar cache em HTML
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/portal.html'));
});

app.get('/coletas.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/coletas.html'));
});

app.get('/settings.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/settings.html'));
});

app.get('/relatorios.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/relatorios.html'));
});

// Rota para treinamento-disparador.html
app.get('/treinamento-disparador.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/treinamento-disparador.html'));
});

app.get('/cadastro.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/cadastro.html'));
});

app.get('/gestao-dados.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/gestao-dados.html'));
});

// Rotas para páginas do portal
app.get('/minhas-acoes.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/minhas-acoes.html'));
});

app.get('/chat-interno.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/chat-interno.html'));
});

app.get('/realizar-avaliacao.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/realizar-avaliacao.html'));
});

app.get('/motoristas-falhas.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/motoristas-falhas.html'));
});

app.get('/chamados.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/chamados.html'));
});

app.get('/crm.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/crm.html'));
});

app.get('/vendas.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/vendas.html'));
});

app.get('/monitoramento.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/monitoramento.html'));
});

app.get('/historico_coletas.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/historico_coletas.html'));
});

app.get('/monitoramento-rastreamento.html', requireAuth, (req, res) => {
  console.log('✅ Acesso autorizado a monitoramento-rastreamento.html');
  console.log('👤 Usuário:', req.session?.usuario?.email || req.session?.usuario?.nome || 'N/A');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/monitoramento-rastreamento.html'));
});

app.get('/avaliacao-360.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/avaliacao-360.html'));
});

app.get('/ninebox.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/ninebox.html'));
});

app.get('/historico-chamados.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/historico-chamados.html'));
});

app.get('/treinamentos.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/treinamentos.html'));
});

app.get('/treinamentos-documentos.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/treinamentos-documentos.html'));
});

app.get('/cadastro-clientes.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/cadastro-clientes.html'));
});

app.get('/migracao-operacao-clientes.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/migracao-operacao-clientes.html'));
});

app.get('/painel-qualidade.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/painel-qualidade.html'));
});

app.get('/ferramentas-qualidade.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/ferramentas-qualidade.html'));
});

// Rotas para páginas que podem não existir ainda (retornam 404 se não existirem)
app.get('/contas-pagar.html', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, 'public/pages/contas-pagar.html');
  if (fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(filePath);
  } else {
    res.status(404).send('Página em desenvolvimento');
  }
});

app.get('/contas-receber.html', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, 'public/pages/contas-receber.html');
  if (fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(filePath);
  } else {
    res.status(404).send('Página em desenvolvimento');
  }
});

app.get('/folha.html', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, 'public/pages/folha.html');
  if (fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(filePath);
  } else {
    res.status(404).send('Página em desenvolvimento');
  }
});

app.get('/recrutamento.html', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, 'public/pages/recrutamento.html');
  if (fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(filePath);
  } else {
    res.status(404).send('Página em desenvolvimento');
  }
});

// Rotas adicionais para outras páginas
app.get('/bi-disparos.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/bi-disparos.html'));
});

app.get('/portal-motorista.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/portal-motorista.html'));
});

app.get('/portal-emergencia.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/portal-emergencia.html'));
});

app.get('/login-motorista.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/login-motorista.html'));
});

app.get('/treinamento-ferramentas-qualidade.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/treinamento-ferramentas-qualidade.html'));
});

app.get('/treinamento-chat-interno.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/treinamento-chat-interno.html'));
});

app.get('/treinamento-cadastro-motoristas.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/treinamento-cadastro-motoristas.html'));
});

app.get('/treinamento-trocar-senha.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/treinamento-trocar-senha.html'));
});

// Rotas para páginas adicionais
app.get('/exemplo-ia-tools.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/exemplo-ia-tools.html'));
});

app.get('/instalar-app.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/instalar-app.html'));
});

app.get('/teste-sistema.html', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/pages/teste-sistema.html'));
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

// ========== ATUALIZAR API URL GLOBALMENTE ==========
app.put('/api/evolution-api/atualizar-url-global', async (req, res) => {
  try {
    // Autenticação flexível
    console.log('🔍 Iniciando autenticação para atualização global de URL...');
    console.log('📋 Headers recebidos:', {
      authorization: req.headers.authorization ? 'Presente' : 'Ausente',
      'x-user-email': req.headers['x-user-email'],
      'x-user-id': req.headers['x-user-id']
    });
    
    const userInfo = await getUserFromRequest(req);
    
    console.log('📋 Resultado getUserFromRequest:', {
      hasUserInfo: !!userInfo,
      hasUser: !!(userInfo && userInfo.user),
      hasUserId: !!(userInfo && userInfo.user && userInfo.user.id),
      hasError: !!(userInfo && userInfo.error),
      userId: userInfo?.user?.id,
      userEmail: userInfo?.user?.email,
      error: userInfo?.error
    });
    
    // Verificar se há erro ou se não tem usuário
    if (userInfo?.error || !userInfo?.user || !userInfo.user.id) {
      const errorMessage = userInfo?.error?.message || 'Não autenticado';
      console.log('❌ Autenticação falhou - retornando 401:', errorMessage);
      return res.status(401).json({
        success: false,
        error: errorMessage
      });
    }

    const userId = userInfo.user.id;
    const userEmail = userInfo.user.email;
    
    console.log('✅ Usuário autenticado:', { userId, userEmail });

    // Verificar se é admin
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (profileError || !userProfile) {
      return res.status(403).json({
        success: false,
        error: 'Erro ao verificar permissões do usuário'
      });
    }

    if (userProfile.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Apenas administradores podem atualizar a URL globalmente'
      });
    }

    const { api_url } = req.body;

    if (!api_url || typeof api_url !== 'string' || api_url.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'URL da API é obrigatória'
      });
    }

    // Validar formato da URL
    try {
      new URL(api_url);
    } catch (urlError) {
      return res.status(400).json({
        success: false,
        error: 'URL inválida. Use o formato: http://exemplo.com ou https://exemplo.com'
      });
    }

    console.log(`🔄 Atualizando API URL globalmente para: ${api_url}`);
    console.log(`👤 Solicitado por: ${userEmail} (${userId})`);

    // Buscar todas as credenciais para obter os IDs
    const { data: todasCredenciais, error: fetchError } = await supabaseAdmin
      .from('user_evolution_apis')
      .select('id');

    if (fetchError) {
      console.error('❌ Erro ao buscar credenciais:', fetchError);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar credenciais no banco de dados',
        details: fetchError.message
      });
    }

    if (!todasCredenciais || todasCredenciais.length === 0) {
      return res.json({
        success: true,
        message: 'Nenhuma credencial encontrada para atualizar',
        api_url: api_url.trim(),
        total_credenciais: 0,
        total_atualizadas: 0,
        atualizado_por: userEmail
      });
    }

    const ids = todasCredenciais.map(c => c.id);
    const totalCredenciais = ids.length;

    console.log(`📋 Encontradas ${totalCredenciais} credenciais para atualizar`);

    // Atualizar todas as credenciais usando .in() com os IDs
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('user_evolution_apis')
      .update({ 
        api_url: api_url.trim(),
        updated_at: new Date().toISOString()
      })
      .in('id', ids)
      .select('id, user_id, instance_name, api_url');

    if (updateError) {
      console.error('❌ Erro ao atualizar URLs:', updateError);
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar URLs no banco de dados',
        details: updateError.message
      });
    }

    const totalAtualizadas = updated?.length || 0;

    console.log(`✅ API URL atualizada globalmente. Total de credenciais atualizadas: ${totalAtualizadas} de ${totalCredenciais}`);

    res.json({
      success: true,
      message: `URL da API atualizada globalmente para ${totalAtualizadas} credenciais`,
      api_url: api_url.trim(),
      total_credenciais: totalCredenciais,
      total_atualizadas: totalAtualizadas,
      atualizado_por: userEmail
    });

  } catch (error) {
    console.error('❌ Erro inesperado ao atualizar URL global:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno ao atualizar URL',
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
      api_url: process.env.EVOLUTION_BASE_URL || '',
      api_key: process.env.EVOLUTION_API_KEY || '',
        instance_name: process.env.EVOLUTION_INSTANCE_NAME || '',
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
      api_url: process.env.EVOLUTION_BASE_URL || '',
      api_key: process.env.EVOLUTION_API_KEY || '',
      instance_name: process.env.EVOLUTION_INSTANCE_NAME || ''
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
app.post('/webhook/send-supabase', (req, res, next) => {
  uploadMedia.single('media')(req, res, (err) => {
    if (err) {
      console.error('❌ Erro no upload de mídia:', err.message);
      return res.status(400).json({
        success: false,
        error: err.message || 'Erro ao processar arquivo de imagem',
        details: 'Verifique se o arquivo é uma imagem válida (JPG, PNG, GIF, WEBP) e tem no máximo 10MB'
      });
    }
    next();
  });
}, async (req, res) => {
  // Inicializar variáveis no escopo do endpoint
  let userIdentity = null;
  let mediaFile = null;
  let mediaData = null;
  let number = null;
  let message = null;
  let usuario = null;
  let userId = null;
  
  // Função de limpeza definida no início para estar disponível em todo o escopo
  const cleanupFile = () => {
    // Com memoryStorage, não há arquivo no disco para deletar
    // Apenas limpar referências se necessário
    if (mediaFile) {
      console.log('🧹 Limpando referências do arquivo de mídia');
    }
  };

  try {
    // Extrair dados do body
    number = req.body?.number;
    message = req.body?.message;
    usuario = req.body?.usuario;
    userId = req.body?.userId;
    mediaFile = req.file;

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
  
  if (mediaFile) {
    const isImage = mediaFile.mimetype.startsWith('image/');
    const isAudio = mediaFile.mimetype.startsWith('audio/');
    
    if (!isImage && !isAudio) {
      cleanupFile();
      return res.status(400).json({
        success: false,
        error: 'Somente arquivos de imagem ou áudio são permitidos'
      });
    }

    const maxSize = isAudio ? 10 * 1024 * 1024 : 5 * 1024 * 1024; // Áudio pode ser maior (10MB)
    if (mediaFile.size > maxSize) {
      cleanupFile();
      return res.status(400).json({
        success: false,
        error: isAudio ? 'O áudio deve ter no máximo 10MB' : 'A imagem deve ter no máximo 5MB'
      });
    }

    try {
      // Como estamos usando memoryStorage, o arquivo está em req.file.buffer, não em req.file.path
      if (!mediaFile.buffer) {
        cleanupFile();
        return res.status(500).json({
          success: false,
          error: `Arquivo de ${isAudio ? 'áudio' : 'imagem'} não foi recebido corretamente`,
          details: 'O buffer do arquivo está vazio'
        });
      }
      
      mediaData = {
        fileName: mediaFile.originalname,
        mimetype: mediaFile.mimetype,
        base64: mediaFile.buffer.toString('base64'),
        size: mediaFile.size
      };
      
      const tipoMedia = isAudio ? 'Áudio' : 'Imagem';
      console.log(`✅ ${tipoMedia} processado:`, {
        nome: mediaData.fileName,
        tipo: mediaData.mimetype,
        tamanhoOriginal: `${Math.round(mediaData.size / 1024)}KB`,
        tamanhoBase64: `${Math.round(mediaData.base64.length / 1024)}KB`,
        isWebM: isAudio && mediaData.mimetype.includes('webm')
      });
      
      // Converter áudio para MP3 se não for MP3 (apenas se ffmpeg estiver disponível)
      if (isAudio && !mediaData.mimetype.includes('mp3') && !mediaData.mimetype.includes('mpeg') && ffmpegAvailable) {
        console.log('🔄 Convertendo áudio para MP3 para melhor compatibilidade com WhatsApp...');
        try {
          const tempInputPath = path.join(__dirname, 'temp', `input_${Date.now()}_${Math.random().toString(36).substring(7)}.${mediaData.mimetype.includes('ogg') ? 'ogg' : 'webm'}`);
          const tempOutputPath = path.join(__dirname, 'temp', `output_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
          
          // Criar diretório temp se não existir
          const tempDir = path.join(__dirname, 'temp');
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
          
          // Escrever arquivo temporário de entrada
          await writeFile(tempInputPath, mediaFile.buffer);
          
          // Converter para MP3
          await new Promise((resolve, reject) => {
            ffmpeg(tempInputPath)
              .toFormat('mp3')
              .audioCodec('libmp3lame')
              .audioBitrate(128)
              .audioChannels(1) // Mono para reduzir tamanho
              .audioFrequency(44100)
              .on('end', () => {
                console.log('✅ Conversão para MP3 concluída');
                resolve();
              })
              .on('error', (err) => {
                console.error('❌ Erro na conversão para MP3:', err.message);
                reject(err);
              })
              .save(tempOutputPath);
          });
          
          // Ler arquivo MP3 convertido
          const mp3Buffer = await readFile(tempOutputPath);
          
          // Atualizar mediaData com MP3
          mediaData = {
            fileName: mediaData.fileName.replace(/\.[^.]+$/, '.mp3'),
            mimetype: 'audio/mpeg',
            base64: mp3Buffer.toString('base64'),
            size: mp3Buffer.length
          };
          
          console.log(`✅ Áudio convertido para MP3:`, {
            tamanhoOriginal: `${Math.round(mediaFile.size / 1024)}KB`,
            tamanhoMP3: `${Math.round(mediaData.size / 1024)}KB`,
            reducao: `${Math.round((1 - mediaData.size / mediaFile.size) * 100)}%`
          });
          
          // Limpar arquivos temporários
          try {
            await unlink(tempInputPath);
            await unlink(tempOutputPath);
          } catch (cleanupErr) {
            console.warn('⚠️ Erro ao limpar arquivos temporários:', cleanupErr.message);
          }
        } catch (conversionError) {
          console.error('❌ Erro ao converter áudio para MP3:', conversionError);
          console.warn('⚠️ Continuando com formato original...');
          // Continuar com o formato original se a conversão falhar
        }
      }
    } catch (error) {
      console.error('❌ Erro ao processar imagem:', error);
      cleanupFile();
      return res.status(500).json({
        success: false,
        error: 'Falha ao processar a imagem enviada',
        details: error.message
      });
    }
  }

    // ✅ Usar userId direto do body se disponível
    userIdentity = userId;

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

    // Teste de conexão com a tabela user_evolution_apis
    console.log('🧪 Testando acesso à tabela user_evolution_apis...');
    try {
      const { data: testData, error: testError, count } = await supabaseAdmin
        .from('user_evolution_apis')
        .select('*', { count: 'exact', head: true });
      
      if (testError) {
        console.error('❌ Erro ao testar acesso à tabela:', {
          message: testError.message,
          code: testError.code,
          details: testError.details,
          hint: testError.hint
        });
      } else {
        console.log('✅ Acesso à tabela OK. Total de registros:', count);
      }
    } catch (testErr) {
      console.error('❌ Erro inesperado ao testar tabela:', testErr.message);
    }

    // Buscar credenciais da Evolution API do usuário
    console.log('🔍 Buscando credenciais para user_id:', userIdentity);
    console.log('🔗 Supabase URL:', process.env.SUPABASE_URL ? 'Configurado' : 'NÃO CONFIGURADO');
    console.log('🔑 Service Key:', serviceKey ? 'Configurado' : 'NÃO CONFIGURADO');

    let userCreds = null;
    let credsError = null;

    try {
      console.log('📡 Executando query na tabela user_evolution_apis...');
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

      if (error) {
        console.error('❌ Erro ao buscar credenciais:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
      } else {
        console.log('✅ Query executada com sucesso');
        if (userCreds) {
          console.log('✅ Credenciais encontradas:', {
            instance_name: userCreds.instance_name,
            api_url: userCreds.api_url,
            has_api_key: !!userCreds.api_key,
            active: userCreds.active
          });
        } else {
          console.log('⚠️ Nenhuma credencial ativa encontrada');
        }
      }

    if (!userCreds) {
      console.log('🔍 Tentando buscar sem filtro de active...');
        const { data: allCreds, error: allCredsError } = await supabaseAdmin
        .from('user_evolution_apis')
        .select('*')
        .eq('user_id', userIdentity);

        if (allCredsError) {
          console.error('❌ Erro ao buscar todas as credenciais:', {
            message: allCredsError.message,
            code: allCredsError.code,
            details: allCredsError.details
          });
        } else if (allCreds && allCreds.length > 0) {
          console.log('📋 Credenciais encontradas (ativas e inativas):', allCreds.map(c => ({
            instance_name: c.instance_name,
            active: c.active,
            is_valid: c.is_valid
          })));
        } else {
          console.log('⚠️ Nenhuma credencial encontrada para este usuário');
        }
      }
    } catch (queryError) {
      console.error('❌ Erro inesperado ao executar query:', {
        message: queryError.message,
        stack: queryError.stack
      });
      credsError = queryError;
    }

    console.log('📋 Resultado da busca:', {
      tem_credenciais: !!userCreds,
      erro: credsError ? {
        message: credsError.message,
        code: credsError.code
      } : null,
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
      console.log('❌ Erro da Evolution (texto):', errorText.substring(0, 500)); // Limitar log a 500 caracteres
      
      // Identificar tipo de erro
      let tipoErro = 'desconhecido';
      try {
        tipoErro = identificarTipoErro(null, response, errorText);
      } catch (identifyErr) {
        console.error('❌ Erro ao identificar tipo de erro:', identifyErr.message);
      }
      
      // Extrair mensagem de erro mais amigável se for HTML do ngrok
      let errorMessage = `❌ Erro ${response.status} do Evolution`;
      let errorDetails = errorText;
      
      if (errorText.includes('ngrok') || errorText.includes('ERR_NGROK')) {
        errorMessage = '❌ Servidor Evolution API offline (ngrok desconectado)';
        errorDetails = 'O endpoint do ngrok está offline. Verifique se o servidor Evolution está rodando e se o túnel ngrok está ativo.';
      } else if (errorText.length > 500) {
        // Se o erro for muito longo (como HTML), truncar
        errorDetails = errorText.substring(0, 500) + '... (resposta truncada)';
      }
      
      // Registrar falha no BI
      try {
        await supabaseAdmin.from('disparos_log').insert([
          {
            user_id: userCreds.user_id || userIdentity || null,
            departamento: req.session?.userData?.departamento || null,
            numero: formattedNumber,
            mensagem_tamanho: (message || '').length,
            status: 'error',
            tipo_erro: tipoErro
          }
        ]);
        console.log(`✅ Falha de disparo registrada no BI (tipo: ${tipoErro || 'desconhecido'})`);
      } catch (logErr) {
        console.error('❌ Falha ao registrar disparo (erro texto):', logErr.message, logErr);
      }
      
      cleanupFile();
      
      // Verificar se a resposta já foi enviada
      if (!res.headersSent) {
      return res.status(500).json({
        success: false,
          error: errorMessage,
          details: errorDetails,
          statusCode: response.status
      });
      } else {
        console.error('❌ Resposta já foi enviada, não é possível enviar erro');
      }
    }

  // Se chegou aqui, mediaData existe
    const isImage = mediaData.mimetype.startsWith('image/');
    const isAudio = mediaData.mimetype.startsWith('audio/');
    const rawBase64 = mediaData.base64;
    const prefixedBase64 = rawBase64.startsWith('data:') ? rawBase64 : `data:${mediaData.mimetype};base64,${rawBase64}`;
    
    // Para áudio, usar o mimetype do mediaData (já convertido para MP3 se necessário)
    let audioMimeType = mediaData.mimetype;
    
    // Se já for MP3, usar diretamente
    if (isAudio && (audioMimeType.includes('mp3') || audioMimeType.includes('mpeg'))) {
      console.log('✅ Áudio já está em formato MP3 - formato ideal para WhatsApp');
    } else if (isAudio && audioMimeType.includes('webm')) {
      // Se ainda for WebM (conversão falhou), tentar OGG como fallback
      audioMimeType = 'audio/ogg; codecs=opus';
      console.log('⚠️ Usando OGG Opus como fallback (conversão para MP3 pode ter falhado)');
    }
    
    const guessedExtension = path.extname(mediaData.fileName) || (isImage ? '.jpg' : (isAudio ? (audioMimeType.includes('mp3') || audioMimeType.includes('mpeg') ? '.mp3' : (audioMimeType.includes('ogg') ? '.ogg' : '.webm')) : ''));
    const normalizedFileName = mediaData.fileName || `arquivo${guessedExtension}`;

    const mediaAttempts = isAudio ? [
      {
        name: 'message/sendPtt',
        url: `${evolutionUrl}/message/sendPtt/${userCreds.instance_name}`,
        payload: {
          number: formattedNumber,
          audio: rawBase64,
          base64: rawBase64,
          mimetype: audioMimeType,
          ptt: false
        }
      },
      {
        name: 'message/sendAudio',
        url: `${evolutionUrl}/message/sendAudio/${userCreds.instance_name}`,
        payload: {
          number: formattedNumber,
          audio: rawBase64,
          base64: rawBase64,
          mimetype: audioMimeType,
          ptt: false
        }
      },
      {
        name: 'message/sendAudioBase64',
        url: `${evolutionUrl}/message/sendAudioBase64/${userCreds.instance_name}`,
        payload: {
          number: formattedNumber,
          audio: rawBase64,
          base64: rawBase64,
          mimetype: audioMimeType,
          ptt: false
        }
      },
      {
        name: 'message/sendMedia',
        url: `${evolutionUrl}/message/sendMedia/${userCreds.instance_name}`,
        payload: {
          number: formattedNumber,
          message: message || '',
          caption: message || '',
          mediatype: 'audio',
          mediaType: 'audio',
          fileName: normalizedFileName,
          filename: normalizedFileName,
          mimetype: audioMimeType,
          base64: rawBase64,
          media: rawBase64,
          audio: rawBase64,
          ptt: false,
          seconds: null, // Duração em segundos (será calculada se possível)
          owned: {
            type: 'audio',
            media: rawBase64,
            base64: rawBase64,
            filename: normalizedFileName,
            mimetype: audioMimeType,
            audio: rawBase64
          },
          mediaMessage: {
            mediatype: 'audio',
            media: rawBase64,
            base64: rawBase64,
            audio: rawBase64,
            fileName: normalizedFileName,
            mimetype: audioMimeType,
            caption: message || ''
          }
        }
      }
    ] : [
      {
        name: 'message/sendImage',
        url: `${evolutionUrl}/message/sendImage/${userCreds.instance_name}`,
        payload: {
          number: formattedNumber,
          caption: message,
          fileName: normalizedFileName,
          filename: normalizedFileName,
          base64: rawBase64,
          media: rawBase64
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
          media: rawBase64
        }
      },
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
          mediaData: rawBase64,
          base64: rawBase64,
          media: rawBase64
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
          media: rawBase64
        }
      },
      {
        name: 'message/sendMedia',
        url: `${evolutionUrl}/message/sendMedia/${userCreds.instance_name}`,
        payload: {
          number: formattedNumber,
          message,
          caption: message,
          mediatype: isImage ? 'image' : 'document',
          mediaType: isImage ? 'image' : 'document',
          fileName: normalizedFileName,
          filename: normalizedFileName,
          mimetype: mediaData.mimetype,
          base64: rawBase64,
          media: rawBase64, // Base64 puro sem prefixo data:
          mediaData: rawBase64,
          owned: {
            type: isImage ? 'image' : 'document',
            media: rawBase64, // Base64 puro sem prefixo data:
            base64: rawBase64,
            filename: normalizedFileName,
            mimetype: mediaData.mimetype,
            caption: message
          },
          mediaMessage: {
            mediatype: isImage ? 'image' : 'document',
            media: rawBase64,
            base64: rawBase64,
            fileName: normalizedFileName,
            mimetype: mediaData.mimetype,
            caption: message
          }
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
        if (isAudio) {
          const audioSizeKB = Math.round(mediaData.size / 1024);
          const base64SizeKB = Math.round(rawBase64.length / 1024);
          const maxSizeKB = 16 * 1024; // WhatsApp limita áudio a ~16MB
          
          console.log(`🎤 Payload de áudio:`, {
            number: formattedNumber,
            mimetypeOriginal: mediaData.mimetype,
            mimetypeEnviado: audioMimeType,
            fileName: normalizedFileName,
            tamanhoOriginal: `${audioSizeKB}KB`,
            tamanhoBase64: `${base64SizeKB}KB`,
            dentroDoLimite: audioSizeKB <= maxSizeKB,
            limiteMaximo: `${maxSizeKB}KB (16MB)`,
            hasAudio: !!attempt.payload.audio,
            hasBase64: !!attempt.payload.base64,
            hasMedia: !!attempt.payload.media,
            endpoint: attempt.name
          });
          
          if (audioSizeKB > maxSizeKB) {
            console.warn(`⚠️ Áudio muito grande (${audioSizeKB}KB). WhatsApp pode rejeitar arquivos maiores que 16MB.`);
          }
        }
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
          console.log(`📦 Resposta Evolution:`, JSON.stringify(evolutionResult, null, 2));
          
          // Verificar se realmente foi enviado (pode retornar 200 mas com erro interno)
          if (evolutionResult && evolutionResult.key && evolutionResult.key.id) {
            console.log(`✅ Mensagem de mídia enviada com sucesso! ID: ${evolutionResult.key.id}`);
          } else {
            console.warn(`⚠️ Resposta OK mas sem ID de mensagem. Resposta:`, evolutionResult);
          }
          break;
        }

      let errorText = '';
      try {
        errorText = await response.text();
        // Limitar log a 500 caracteres para evitar poluição do console
        const errorTextLog = errorText.length > 500 ? errorText.substring(0, 500) + '... (truncado)' : errorText;
        attemptLogs.push({ endpoint: attempt.name, status: response.status, body: errorTextLog });
        console.log(`⚠️ Evolution respondeu ${response.status} em ${attempt.name}:`, errorTextLog);
      } catch (textErr) {
        console.error(`❌ Erro ao ler resposta de erro de ${attempt.name}:`, textErr.message);
        errorText = `Erro ao ler resposta: ${textErr.message}`;
        attemptLogs.push({ endpoint: attempt.name, status: response.status, body: errorText });
      }

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

    console.log('📝 Tentativas Evolution:', JSON.stringify(attemptLogs, null, 2));
    cleanupFile();

    // Verificar se realmente foi enviado (precisa ter key.id na resposta)
    const realmenteEnviado = evolutionResult && evolutionResult.key && evolutionResult.key.id;
    
    if (realmenteEnviado) {
      const cooldownInfo = registerUserSend(userIdentity);
      const endpointUsado = attemptLogs.find(a => a.success)?.endpoint || null;
      
      console.log(`✅ Mídia enviada com sucesso via ${endpointUsado}`);
      console.log(`📋 Detalhes:`, {
        messageId: evolutionResult.key.id,
        fileName: mediaData.fileName,
        mimetype: mediaData.mimetype,
        isAudio: isAudio,
        isImage: isImage,
        tipoMedia: isAudio ? 'áudio' : 'imagem'
      });
      
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
        messageId: evolutionResult.key.id,
        mediaEnviada: mediaData.fileName,
        mediaType: isAudio ? 'audio' : 'image',
        endpointUsado: endpointUsado,
        cooldownTriggered: cooldownInfo.cooldownTriggered,
        cooldownUntil: cooldownInfo.cooldownUntil,
        cooldownMinutes: cooldownInfo.cooldownTriggered ? cooldownInfo.cooldownMinutes : null
      });
    } else if (evolutionResult) {
      // Resposta OK mas sem confirmação de envio
      console.warn('⚠️ Evolution retornou OK mas sem ID de mensagem. Resposta completa:', JSON.stringify(evolutionResult, null, 2));
      cleanupFile();
      return res.status(500).json({
        success: false,
        error: 'Evolution aceitou a requisição mas não confirmou o envio',
        details: 'A API retornou sucesso mas não forneceu ID de mensagem. Verifique se o áudio foi realmente enviado.',
        evolutionResponse: evolutionResult
      });
    }

  // Identificar tipo de erro
  let tipoErro = 'desconhecido';
  try {
    tipoErro = identificarTipoErro(null, lastStatus ? { status: lastStatus } : null, lastErrorText);
  } catch (identifyErr) {
    console.error('❌ Erro ao identificar tipo de erro (mídia):', identifyErr.message);
  }

  // Extrair mensagem de erro mais amigável se for HTML do ngrok
  let errorMessage = lastStatus ? `❌ Erro ${lastStatus} do Evolution` : '❌ Evolution não respondeu';
  let errorDetails = lastErrorText || 'Erro desconhecido';
  
  if (lastErrorText && (lastErrorText.includes('ngrok') || lastErrorText.includes('ERR_NGROK'))) {
    errorMessage = '❌ Servidor Evolution API offline (ngrok desconectado)';
    errorDetails = 'O endpoint do ngrok está offline. Verifique se o servidor Evolution está rodando e se o túnel ngrok está ativo.';
  } else if (lastErrorText && lastErrorText.length > 500) {
    // Se o erro for muito longo (como HTML), truncar
    errorDetails = lastErrorText.substring(0, 500) + '... (resposta truncada)';
    }

    // Registrar falha no BI
    try {
      await supabaseAdmin.from('disparos_log').insert([
        {
          user_id: userCreds.user_id || userIdentity || null,
          departamento: req.session?.userData?.departamento || null,
          numero: formattedNumber,
          mensagem_tamanho: (message || '').length,
        status: 'error',
        tipo_erro: tipoErro
        }
      ]);
    console.log(`✅ Falha de disparo registrada no BI (mídia) - tipo: ${tipoErro || 'desconhecido'}`);
    } catch (logErr) {
      console.error('❌ Falha ao registrar disparo (erro mídia):', logErr.message, logErr);
    }

  // Verificar se a resposta já foi enviada
  if (!res.headersSent) {
    return res.status(500).json({
      success: false,
      error: errorMessage,
      details: errorDetails,
      statusCode: lastStatus || null,
      tentativas: attemptLogs
    });
  } else {
    console.error('❌ Resposta já foi enviada, não é possível enviar erro');
  }

  } catch (error) {
    console.error('❌ Erro inesperado no endpoint /webhook/send-supabase:', error);
    console.error('❌ Stack trace:', error.stack);
    
    // Identificar tipo de erro (geralmente será erro de conexão em catch)
    let tipoErro = 'desconhecido';
    try {
      tipoErro = identificarTipoErro(error, null, null);
    } catch (identifyErr) {
      console.error('❌ Erro ao identificar tipo de erro:', identifyErr);
    }
    
    // Registrar falha inesperada no BI (apenas se tivermos dados mínimos)
    if (userIdentity || userId || usuario) {
    try {
      await supabaseAdmin.from('disparos_log').insert([
        {
            user_id: userIdentity || userId || null,
          departamento: req.session?.userData?.departamento || null,
          numero: (typeof number !== 'undefined') ? String(number) : null,
            mensagem_tamanho: (message || '').length || 0,
            status: 'error',
            tipo_erro: tipoErro
        }
      ]);
        console.log(`✅ Falha inesperada de disparo registrada no BI - tipo: ${tipoErro || 'desconhecido'}`);
    } catch (logErr) {
      console.error('❌ Falha ao registrar disparo (erro catch):', logErr.message, logErr);
    }
    }
    
    // Limpar arquivo se existir
    try {
    cleanupFile();
    } catch (cleanupErr) {
      console.warn('⚠️ Erro ao limpar arquivo:', cleanupErr.message);
    }
    
    // Retornar resposta de erro
    if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: '❌ Erro ao processar envio',
        details: error.message || 'Erro desconhecido',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    } else {
      console.error('❌ Resposta já foi enviada, não é possível enviar erro');
    }
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
    // 🔐 Verificar se o usuário é admin
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    // Verificar se é admin
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    
    if (profileError) {
      console.error('❌ Erro ao buscar perfil:', profileError);
      return res.status(403).json({ error: 'Erro ao verificar permissões' });
    }
    
    if (!userProfile || userProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem excluir oportunidades' });
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
app.post('/api/anexos', requireAuth, uploadDocumentos.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const { coleta_id, usuario, categoria, titulo_contrato } = req.body;
    
    if (!coleta_id) {
      return res.status(400).json({ error: 'ID da coleta é obrigatório' });
    }
    
    // Validar título do contrato se categoria for contratos
    if (categoria === 'contratos' && !titulo_contrato) {
      return res.status(400).json({ error: 'Título do contrato é obrigatório para documentos do tipo Contrato' });
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

      const insertData = {
        id: generateUUID(),
        coleta_id: coleta_id,
        nome_arquivo: req.file.originalname,
        tipo_arquivo: req.file.mimetype,
        tamanho: req.file.size,
        url: storageUrl
      };
      
      // Adicionar categoria se fornecida
      if (categoria) {
        insertData.categoria = categoria;
      }
      
      // Adicionar título do contrato se fornecida e categoria for contratos
      if (categoria === 'contratos' && titulo_contrato) {
        insertData.titulo_contrato = titulo_contrato;
      }
      
      const { data, error } = await supabase
        .from('anexos')
        .insert([insertData])
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

// Endpoint para finalizar operação (anexar canhoto e mover para finalizar_operacao)
app.post('/api/motoristas/coletas/:coletaId/finalizar-operacao', uploadDocumentos.single('canhoto'), async (req, res) => {
  try {
    const { motorista, error: authError } = await requireMotoristaAuth(req);
    if (authError) {
      return res.status(authError.status || 401).json({ success: false, error: authError.message });
    }

    if (!motorista) {
      return res.status(409).json({ success: false, error: 'Complete seu cadastro para finalizar operação.' });
    }

    const coletaId = req.params.coletaId;
    if (!coletaId) {
      return res.status(400).json({ success: false, error: 'ID da coleta é obrigatório.' });
    }

    // Buscar dados da coleta
    const { data: coleta, error: coletaError } = await supabaseAdmin
      .from('coletas')
      .select('id, motorista_id, etapa_atual, contas_pagar_tipo, cliente, origem, destino, filial, numero_coleta')
      .eq('id', coletaId)
      .single();

    if (coletaError || !coleta) {
      return res.status(404).json({ success: false, error: 'Coleta não encontrada.' });
    }

    // Verificar se o motorista está vinculado a esta coleta
    if (coleta.motorista_id !== motorista.id) {
      return res.status(403).json({ success: false, error: 'Você não tem permissão para finalizar esta operação.' });
    }

    // Verificar se há arquivo de canhoto
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'É necessário anexar o canhoto para finalizar a operação.' });
    }

    // Upload do canhoto
    const sanitizedName = sanitizeFilename(req.file.originalname || 'canhoto.jpg');
    const fileExt = path.extname(sanitizedName) || '.jpg';
    const uniqueName = `canhoto-${Date.now()}-${generateId()}${fileExt}`;
    const storagePath = `coletas/${coletaId}/anexos/${uniqueName}`;
    const uploadOptions = {
      contentType: req.file.mimetype || 'image/jpeg',
      cacheControl: '3600',
      upsert: false
    };

    const fileBuffer = req.file.buffer;
    const { error: storageError } = await supabaseAdmin.storage
      .from(ANEXOS_BUCKET)
      .upload(storagePath, fileBuffer, uploadOptions);

    if (storageError) {
      throw storageError;
    }

    const storageUrl = buildStorageUrl(ANEXOS_BUCKET, storagePath);

    // Salvar anexo no banco
    const { data: anexoData, error: anexoError } = await supabaseAdmin
      .from('anexos')
      .insert([{
        id: generateUUID(),
        coleta_id: coletaId,
        nome_arquivo: 'Canhoto - ' + (req.file.originalname || 'canhoto.jpg'),
        tipo_arquivo: req.file.mimetype || 'image/jpeg',
        tamanho: req.file.size,
        url: storageUrl
      }])
      .select()
      .single();

    if (anexoError) {
      await supabaseAdmin.storage.from(ANEXOS_BUCKET).remove([storagePath]).catch(() => {});
      throw anexoError;
    }

    // Verificar pendências de pagamento
    const contasPagarTipo = coleta.contas_pagar_tipo || '';
    const temPendenciaSaldo = contasPagarTipo.includes('saldo') && 
                              !contasPagarTipo.includes('pagamento_total') && 
                              contasPagarTipo !== 'ambos';

    // Mover coleta para etapa finalizar_operacao
    const { error: updateError } = await supabaseAdmin
      .from('coletas')
      .update({ etapa_atual: 'finalizar_operacao' })
      .eq('id', coletaId);

    if (updateError) {
      throw updateError;
    }

    // Registrar no histórico
    const identificadorColeta = coleta.filial && coleta.numero_coleta 
      ? `${coleta.filial} #${coleta.numero_coleta}` 
      : coleta.cliente || coletaId;

    await supabaseAdmin
      .from('historico_coletas')
      .insert([{
        id: generateUUID(),
        coleta_id: coletaId,
        acao: 'canhoto_anexado',
        detalhes: `Canhoto anexado pelo motorista. Operação finalizada. ${temPendenciaSaldo ? 'Aguardando pagamento do saldo.' : ''}`,
        realizado_por: motorista.nome || motorista.id,
        realizado_em: new Date().toISOString()
      }]);

    // A notificação será visível através do realtime quando a coleta for atualizada
    // Os usuários em coletas.html verão a mudança de etapa para 'finalizar_operacao'
    // e poderão verificar o histórico para ver que o canhoto foi anexado
    console.log('📋 Operação finalizada. Coleta movida para etapa finalizar_operacao. Notificação visível via realtime.');

    console.log('✅ Operação finalizada com sucesso:', {
      coletaId,
      motoristaId: motorista.id,
      temPendenciaSaldo,
      anexoId: anexoData?.id
    });

    res.json({
      success: true,
      message: temPendenciaSaldo 
        ? 'Canhoto anexado com sucesso! Aguardando pagamento do saldo para concluir a operação.'
        : 'Operação finalizada com sucesso! Aguardando validação.',
      anexo: anexoData,
      temPendenciaSaldo,
      etapa: 'finalizar_operacao'
    });

  } catch (error) {
    console.error('❌ Erro ao finalizar operação:', error);
    res.status(500).json({ success: false, error: error.message || 'Erro ao finalizar operação.' });
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
    // 🔐 Verificar se o usuário é admin
    // Primeiro, tentar verificar via sessão (mais rápido e confiável)
    let isAdmin = false;
    let userId = null;
    let userEmail = null;
    
    // Verificar sessão do Express
    if (req.session) {
      if (req.session.isAdmin === true) {
        console.log('✅ Admin verificado via sessão (isAdmin)');
        isAdmin = true;
      } else if (req.session.usuario) {
        // Tentar buscar perfil do usuário da sessão
        userId = req.session.usuario;
        console.log('🔍 Verificando admin via sessão.usuario:', userId);
        
        try {
          // Buscar na tabela usuarios (Supabase)
          const { data: usuarioData, error: usuarioError } = await supabaseAdmin
            .from('usuarios')
            .select('is_admin, id, email')
            .eq('id', userId)
            .maybeSingle();
          
          if (!usuarioError && usuarioData) {
            isAdmin = usuarioData.is_admin === true;
            userEmail = usuarioData.email;
            console.log('📊 Admin verificado via tabela usuarios:', { isAdmin, is_admin: usuarioData.is_admin });
          } else {
            // Tentar buscar em user_profiles
            const { data: userProfile, error: profileError } = await supabaseAdmin
              .from('user_profiles')
              .select('role')
              .eq('id', userId)
              .maybeSingle();
            
            if (!profileError && userProfile) {
              isAdmin = userProfile.role === 'admin';
              console.log('📊 Admin verificado via user_profiles:', { isAdmin, role: userProfile.role });
            }
          }
        } catch (err) {
          console.warn('⚠️ Erro ao verificar admin via sessão:', err.message);
        }
      }
    }
    
    // Se ainda não confirmou, verificar via getUserFromRequest (token Supabase)
    if (!isAdmin) {
      console.log('🔍 Verificando admin via getUserFromRequest...');
      const { user, error: authError } = await getUserFromRequest(req);
      
      if (authError || !user) {
        console.error('❌ Erro de autenticação:', authError);
        return res.status(401).json({ error: 'Não autenticado' });
      }
      
      userId = user.id;
      userEmail = user.email;
      console.log('👤 Usuário encontrado:', { id: userId, email: userEmail });
      
      // Verificar se é admin
      // Tentar buscar pelo ID do usuário
      let userProfile = null;
      let profileError = null;
      
      try {
        const { data, error } = await supabaseAdmin
          .from('user_profiles')
          .select('role')
          .eq('id', userId)
          .maybeSingle();
        
        userProfile = data;
        profileError = error;
        
        // Se não encontrou pelo ID, tentar buscar pelo email
        if (!userProfile && userEmail) {
          console.log('🔍 Perfil não encontrado pelo ID, tentando buscar pelo email:', userEmail);
          const { data: profileByEmail, error: emailError } = await supabaseAdmin
            .from('user_profiles')
            .select('role')
            .eq('email', userEmail)
            .maybeSingle();
          
          if (profileByEmail) {
            userProfile = profileByEmail;
            profileError = null;
            console.log('✅ Perfil encontrado pelo email');
          } else if (emailError && emailError.code !== 'PGRST116') {
            profileError = emailError;
          }
        }
        
        // Verificar se é admin
        if (userProfile) {
          isAdmin = userProfile.role === 'admin';
          console.log('📊 Verificação de admin:', { 
            role: userProfile.role, 
            isAdmin 
          });
        } else if (user.user_metadata?.role === 'admin' || user.isAdmin === true) {
          isAdmin = true;
          console.log('✅ Admin verificado via user_metadata ou isAdmin');
        }
        
      } catch (err) {
        console.error('❌ Erro ao buscar perfil do usuário:', err);
        profileError = err;
      }
      
      if (!isAdmin) {
        // Se ainda não confirmou que é admin, retornar erro
        if (profileError && profileError.code !== 'PGRST116') {
          console.error('❌ Erro ao verificar permissões:', profileError);
          return res.status(403).json({ 
            error: 'Erro ao verificar permissões',
            details: profileError.message 
          });
        }
        
        if (!userProfile) {
          console.warn('⚠️ Perfil do usuário não encontrado:', { userId, userEmail });
          return res.status(403).json({ error: 'Perfil do usuário não encontrado. Verifique se você tem permissões de administrador.' });
        }
        
        console.warn('⚠️ Usuário não é admin:', { 
          userId, 
          userEmail,
          role: userProfile.role
        });
        return res.status(403).json({ error: 'Apenas administradores podem excluir anexos' });
      }
    }
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Apenas administradores podem excluir anexos' });
    }
    
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
    
    // Usar count para obter o total real, mesmo com muitos registros
    let countQuery = supabaseAdmin.from('motoristas').select('*', { count: 'exact', head: true });
    let dataQuery = supabaseAdmin.from('motoristas').select('id, created_by, created_by_departamento, data_cadastro');
    
    // Aplicar filtros em ambas as queries
    if (inicio) {
      countQuery = countQuery.gte('data_cadastro', inicio);
      dataQuery = dataQuery.gte('data_cadastro', inicio);
    }
    if (fim) {
      countQuery = countQuery.lte('data_cadastro', fim);
      dataQuery = dataQuery.lte('data_cadastro', fim);
    }
    if (usuarioId) {
      countQuery = countQuery.eq('created_by', usuarioId);
      dataQuery = dataQuery.eq('created_by', usuarioId);
    }
    if (departamento) {
      countQuery = countQuery.eq('created_by_departamento', departamento);
      dataQuery = dataQuery.eq('created_by_departamento', departamento);
    }
    
    // Obter o count exato
    const { count: totalCount, error: countError } = await countQuery;
    if (countError) throw countError;
    
    // Obter dados para calcular usuários e departamentos (com limite maior se necessário)
    const { data: motoristas, error: dataError } = await dataQuery.limit(10000);
    if (dataError) throw dataError;
    
    const porUsuario = new Map();
    const userIds = new Set();
    (motoristas || []).forEach(m => { 
      if (m.created_by) { 
        userIds.add(m.created_by); 
        porUsuario.set(m.created_by, (porUsuario.get(m.created_by) || 0) + 1); 
      } 
    });
    
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
    
    // Usar o count exato em vez do length do array
    res.json({ 
      total: totalCount || 0, 
      usuarios: porUsuario.size, 
      departamentos: porDept.size 
    });
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
    
    // Usar count() para obter o total real sem limitação de 1000 registros
    let countQuery = supabaseAdmin.from('disparos_log').select('*', { count: 'exact', head: true });
    if (inicio) countQuery = countQuery.gte('created_at', inicio);
    if (fim) countQuery = countQuery.lte('created_at', fim);
    if (usuarioId) countQuery = countQuery.eq('user_id', usuarioId);
    if (departamento) countQuery = countQuery.eq('departamento', departamento);
    
    const { count: total, error: countError } = await countQuery;
    if (countError) throw countError;
    
    // Para usuários e departamentos, precisamos buscar os dados com paginação
    // para garantir que pegamos todos os valores únicos
    let query = supabaseAdmin.from('disparos_log').select('user_id, departamento');
    if (inicio) query = query.gte('created_at', inicio);
    if (fim) query = query.lte('created_at', fim);
    if (usuarioId) query = query.eq('user_id', usuarioId);
    if (departamento) query = query.eq('departamento', departamento);
    
    // Buscar todos os registros com paginação para garantir valores únicos corretos
    const usuariosSet = new Set();
    const departamentosSet = new Set();
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data: logs, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) throw error;
      
      if (!logs || logs.length === 0) {
        hasMore = false;
      } else {
        logs.forEach(l => {
          if (l.user_id) usuariosSet.add(l.user_id);
          if (l.departamento) departamentosSet.add(l.departamento);
        });
        
        // Se retornou menos que pageSize, não há mais páginas
        if (logs.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }
    
    // Caso não haja departamento salvo, tentar buscar via perfil
    if (!departamento && departamentosSet.size === 0 && usuariosSet.size) {
      const { data: perfis } = await supabaseAdmin
        .from('user_profiles')
        .select('id, departamento')
        .in('id', Array.from(usuariosSet));
      (perfis || []).forEach(p => { if (p.departamento) departamentosSet.add(p.departamento); });
    }
    
    res.json({ total: total || 0, usuarios: usuariosSet.size, departamentos: departamentosSet.size });
  } catch (e) {
    console.error('❌ Erro KPIs disparos:', e);
    res.status(500).json({ error: 'Erro ao carregar KPIs de disparos' });
  }
});
app.get('/api/relatorios/disparos/series', async (req, res) => {
  try {
    const { inicio, fim, usuarioId, departamento } = req.query;
    let baseQuery = supabaseAdmin.from('disparos_log').select('user_id, departamento, created_at');
    if (inicio) baseQuery = baseQuery.gte('created_at', inicio);
    if (fim) baseQuery = baseQuery.lte('created_at', fim);
    if (usuarioId) baseQuery = baseQuery.eq('user_id', usuarioId);
    if (departamento) baseQuery = baseQuery.eq('departamento', departamento);
    
    // Buscar todos os registros com paginação para garantir que pegamos todos os dados
    const allLogs = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      let query = baseQuery.range(page * pageSize, (page + 1) * pageSize - 1);
      const { data: logs, error } = await query;
      if (error) throw error;
      
      if (!logs || logs.length === 0) {
        hasMore = false;
      } else {
        allLogs.push(...logs);
        
        // Se retornou menos que pageSize, não há mais páginas
        if (logs.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }
    
    const porUsuario = new Map();
    const userIds = new Set();
    allLogs.forEach(l => { if (l.user_id) { userIds.add(l.user_id); porUsuario.set(l.user_id, (porUsuario.get(l.user_id) || 0) + 1); } });
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
    allLogs.forEach(l => {
      const dep = l.departamento || idToPerfil.get(l.user_id)?.departamento || 'Sem Dep.';
      if (departamento && dep !== departamento) return;
      porDept.set(dep, (porDept.get(dep) || 0) + 1);
    });
    const byDepartment = Array.from(porDept.entries()).map(([dep, count]) => ({ departamento: dep, count }));
    const porDia = new Map();
    allLogs.forEach(l => {
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

// ========== BI GESTÃO DE DADOS ==========
// GET - KPIs de Gestão de Dados
app.get('/api/relatorios/gestao-dados/kpis', async (req, res) => {
  try {
    const { inicio, fim, operacao } = req.query;
    
    console.log('📊 BI Gestão KPIs - Parâmetros recebidos:', { inicio, fim, operacao });
    
    let query = supabaseAdmin
      .from('gestao_dados')
      .select('*', { count: 'exact' });
    
    if (inicio && inicio.trim() !== '') query = query.gte('data', inicio);
    if (fim && fim.trim() !== '') query = query.lte('data', fim);
    if (operacao && operacao.trim() !== '') query = query.eq('operacao', operacao.trim());
    
    // Buscar todos os registros com paginação
    const allRecords = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error, count } = await query
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      if (error) {
        console.error('❌ Erro ao buscar registros gestao_dados:', error);
        throw error;
      }
      
      if (data && data.length > 0) {
        allRecords.push(...data);
        page++;
        if (data.length < pageSize) hasMore = false;
      } else {
        hasMore = false;
      }
    }
    
    console.log(`📊 BI Gestão: Total de registros encontrados: ${allRecords.length} (filtros: inicio=${inicio || 'todos'}, fim=${fim || 'todos'})`);
    
    const total = allRecords.length;
    
    // Calcular métricas
    const tiposErro = new Map();
    const operacoes = new Map();
    const responsaveis = new Map();
    const usuariosCriacao = new Map();
    let totalEditados = 0;
    let totalTempoResposta = 0;
    let registrosComTempo = 0;
    
    allRecords.forEach(record => {
      // Tipos de erro
      if (record.tipo_erro) {
        tiposErro.set(record.tipo_erro, (tiposErro.get(record.tipo_erro) || 0) + 1);
      }
      
      // Operações
      if (record.operacao) {
        operacoes.set(record.operacao, (operacoes.get(record.operacao) || 0) + 1);
      }
      
      // Responsáveis
      if (record.responsavel) {
        responsaveis.set(record.responsavel, (responsaveis.get(record.responsavel) || 0) + 1);
      }
      
      // Usuários que criaram
      const criadoPor = record.criado_por_nome || record.usuario_nome || null;
      if (criadoPor) {
        usuariosCriacao.set(criadoPor, (usuariosCriacao.get(criadoPor) || 0) + 1);
      }
      
      // Verificar se foi editado
      if (record.editado_em) {
        totalEditados++;
      }
      
      // Calcular tempo entre envio e retorno
      if (record.hora_envio && record.hora_retorno) {
        try {
          const [hEnvio, mEnvio] = record.hora_envio.split(':').map(Number);
          const [hRetorno, mRetorno] = record.hora_retorno.split(':').map(Number);
          const minutosEnvio = hEnvio * 60 + mEnvio;
          const minutosRetorno = hRetorno * 60 + mRetorno;
          let diferenca = minutosRetorno - minutosEnvio;
          if (diferenca < 0) diferenca += 24 * 60; // Se passar da meia-noite
          totalTempoResposta += diferenca;
          registrosComTempo++;
        } catch (e) {
          // Ignorar erros de parsing
        }
      }
    });
    
    const tempoMedioResposta = registrosComTempo > 0 
      ? Math.round(totalTempoResposta / registrosComTempo) 
      : 0;
    
    const taxaEdicao = total > 0 ? ((totalEditados / total) * 100).toFixed(1) : 0;
    
    // Top 5 de cada categoria
    const topTiposErro = Array.from(tiposErro.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tipo, count]) => ({ tipo, count }));
    
    const topOperacoes = Array.from(operacoes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([operacao, count]) => ({ operacao, count }));
    
    const topResponsaveis = Array.from(responsaveis.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([responsavel, count]) => ({ responsavel, count }));
    
    const topUsuariosCriacao = Array.from(usuariosCriacao.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([usuario, count]) => ({ usuario, count }));
    
    const response = {
      total,
      totalEditados,
      taxaEdicao: parseFloat(taxaEdicao),
      tempoMedioResposta,
      topTiposErro,
      topOperacoes,
      topResponsaveis,
      topUsuariosCriacao
    };
    
    console.log('📊 BI Gestão KPIs - Resposta:', JSON.stringify(response, null, 2));
    
    res.json(response);
  } catch (e) {
    console.error('❌ Erro KPIs gestão dados:', e);
    res.status(500).json({ error: 'Erro ao carregar KPIs de gestão de dados', details: e.message });
  }
});

// GET - Séries temporais de Gestão de Dados
app.get('/api/relatorios/gestao-dados/series', async (req, res) => {
  try {
    const { inicio, fim, operacao } = req.query;
    
    console.log('📈 BI Gestão Séries - Parâmetros recebidos:', { inicio, fim, operacao });
    
    let query = supabaseAdmin
      .from('gestao_dados')
      .select('data, tipo_erro, operacao, responsavel, criado_em, editado_em');
    
    if (inicio && inicio.trim() !== '') query = query.gte('data', inicio);
    if (fim && fim.trim() !== '') query = query.lte('data', fim);
    if (operacao && operacao.trim() !== '') query = query.eq('operacao', operacao.trim());
    
    // Buscar todos os registros com paginação
    const allRecords = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error } = await query
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        allRecords.push(...data);
        page++;
        if (data.length < pageSize) hasMore = false;
      } else {
        hasMore = false;
      }
    }
    
    // Agrupar por dia
    const porDia = new Map();
    const porTipoErro = new Map();
    const porOperacao = new Map();
    
    // Agrupar por data e tipo de erro (para árvore de perdas)
    const porDataETipoErro = new Map();
    
    allRecords.forEach(record => {
      // Por dia
      if (record.data) {
        const key = record.data;
        porDia.set(key, (porDia.get(key) || 0) + 1);
      }
      
      // Por tipo de erro
      if (record.tipo_erro) {
        porTipoErro.set(record.tipo_erro, (porTipoErro.get(record.tipo_erro) || 0) + 1);
      }
      
      // Por operação
      if (record.operacao) {
        porOperacao.set(record.operacao, (porOperacao.get(record.operacao) || 0) + 1);
      }
      
      // Por data e tipo de erro (para gráfico agrupado)
      if (record.data && record.tipo_erro) {
        const key = `${record.data}|${record.tipo_erro}`;
        porDataETipoErro.set(key, (porDataETipoErro.get(key) || 0) + 1);
      }
    });
    
    const byDay = Array.from(porDia.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }));
    
    const byTipoErro = Array.from(porTipoErro.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tipo, count]) => ({ tipo, count }));
    
    const byOperacao = Array.from(porOperacao.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([operacao, count]) => ({ operacao, count }));
    
    // Dados agrupados por data e tipo de erro
    const byDataETipoErro = Array.from(porDataETipoErro.entries())
      .map(([key, count]) => {
        const [data, tipoErro] = key.split('|');
        return { data, tipoErro, count };
      });
    
    const response = { byDay, byTipoErro, byOperacao, byDataETipoErro };
    console.log('📈 BI Gestão Séries - Resposta:', JSON.stringify({
      byDay: byDay.length,
      byTipoErro: byTipoErro.length,
      byOperacao: byOperacao.length
    }, null, 2));
    
    res.json(response);
  } catch (e) {
    console.error('❌ Erro séries gestão dados:', e);
    res.status(500).json({ error: 'Erro ao carregar séries de gestão de dados', details: e.message });
  }
});

// Endpoint para buscar detalhes (suporta tipo_erro, operacao, responsavel ou data)
app.get('/api/relatorios/gestao-dados/detalhes', async (req, res) => {
  try {
    const { inicio, fim, operacao, tipo_erro, responsavel, data } = req.query;
    
    // Pelo menos um filtro deve ser fornecido
    if (!tipo_erro && !operacao && !responsavel && !data) {
      return res.status(400).json({ error: 'Pelo menos um parâmetro de filtro deve ser fornecido (tipo_erro, operacao, responsavel ou data)' });
    }
    
    console.log('📋 Detalhes - Parâmetros:', { inicio, fim, operacao, tipo_erro, responsavel, data });
    
    let query = supabaseAdmin
      .from('gestao_dados')
      .select('id, data, oc, operacao, tipo_erro, motivo_devolucao, responsavel, usuario_nome, criado_por_nome, criado_em, hora_envio, hora_retorno');
    
    // Aplicar filtros
    if (tipo_erro && tipo_erro.trim() !== '') query = query.eq('tipo_erro', tipo_erro.trim());
    if (operacao && operacao.trim() !== '') query = query.eq('operacao', operacao.trim());
    if (responsavel && responsavel.trim() !== '') query = query.eq('responsavel', responsavel.trim());
    if (data && data.trim() !== '') {
      query = query.eq('data', data.trim());
    } else {
      if (inicio && inicio.trim() !== '') query = query.gte('data', inicio);
      if (fim && fim.trim() !== '') query = query.lte('data', fim);
    }
    
    // Buscar todos os registros com paginação
    const allRecords = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error } = await query
        .range(page * pageSize, (page + 1) * pageSize - 1)
        .order('data', { ascending: false });
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        allRecords.push(...data);
        page++;
        if (data.length < pageSize) hasMore = false;
      } else {
        hasMore = false;
      }
    }
    
    console.log(`📋 Detalhes - ${allRecords.length} registros encontrados`);
    
    res.json({
      success: true,
      filtros: { tipo_erro, operacao, responsavel, data, inicio, fim },
      total: allRecords.length,
      registros: allRecords
    });
  } catch (e) {
    console.error('❌ Erro ao buscar detalhes do tipo de erro:', e);
    res.status(500).json({ error: 'Erro ao buscar detalhes', details: e.message });
  }
});

// ========== QUALIDADE / TREINAMENTOS ==========
app.post('/api/treinamentos/assinaturas', express.json(), async (req, res) => {
  try {
    const { treinamento_slug, nome, cpf, assinatura_texto, user_id: userIdFromBody } = req.body || {};
    if (!treinamento_slug || !nome || !assinatura_texto) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios: treinamento_slug, nome, assinatura_texto' });
    }

    let userId = userIdFromBody || null;
    
    // Tentar obter user_id da requisição se não veio no body
    if (!userId) {
      try {
        const { user, error: authError } = await getSupabaseUserFromRequest(req);
        if (user && !authError) {
          userId = user.id;
          console.log('✅ User ID capturado da requisição para assinatura:', userId);
        } else {
          console.warn('⚠️ Não foi possível capturar user_id da requisição:', authError?.message || 'Token não fornecido');
        }
      } catch (err) {
        console.warn('⚠️ Erro ao obter usuário da requisição:', err.message);
      }
    } else {
      console.log('✅ User ID recebido no body da requisição:', userId);
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

// ========== GESTÃO DE DADOS ==========
// GET - Listar todos os lançamentos
app.get('/api/gestao-dados', async (req, res) => {
  try {
    const { user, error } = await getUserFromRequest(req);
    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
    }

    const { data, error: queryError } = await supabaseAdmin
      .from('gestao_dados')
      .select('*')
      .order('data', { ascending: false })
      .order('created_at', { ascending: false });

    if (queryError) {
      throw queryError;
    }

    return res.json({
      success: true,
      data: data || []
    });
  } catch (err) {
    console.error('❌ Erro ao listar dados de gestão:', err);
    return res.status(500).json({ success: false, error: 'Erro ao listar dados: ' + (err.message || 'Erro desconhecido') });
  }
});

// POST - Criar novo lançamento
app.post('/api/gestao-dados', express.json(), async (req, res) => {
  try {
    const { user, error } = await getUserFromRequest(req);
    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
    }

    const {
      data,
      oc,
      operacao,
      tipo_erro,
      sistema,
      motivo_devolucao,
      hora_envio,
      hora_retorno,
      responsavel,
      evidencia_url,
      usuario_id,
      usuario_nome
    } = req.body;

    // Validações
    if (!data || !oc || !operacao || !tipo_erro || !sistema || !motivo_devolucao || !hora_envio || !hora_retorno || !responsavel) {
      return res.status(400).json({
        success: false,
        error: 'Todos os campos obrigatórios devem ser preenchidos'
      });
    }

    // Converter evidencia_url para array se necessário
    let evidenciasArray = null;
    if (evidencia_url) {
      if (Array.isArray(evidencia_url)) {
        evidenciasArray = evidencia_url.filter(url => url && url.trim());
      } else if (typeof evidencia_url === 'string' && evidencia_url.trim()) {
        evidenciasArray = [evidencia_url.trim()];
      }
      // Se array estiver vazio, usar null
      if (evidenciasArray && evidenciasArray.length === 0) {
        evidenciasArray = null;
      }
    }

    const dadosInsercao = {
      data,
      oc: oc.trim(),
      operacao: operacao.trim(),
      tipo_erro: tipo_erro.trim(),
      motivo_devolucao: motivo_devolucao.trim(),
      hora_envio,
      hora_retorno,
      responsavel: responsavel.trim(),
      evidencia_url: evidenciasArray,
      usuario_id: usuario_id || user.id,
      usuario_nome: usuario_nome || user.email || 'Usuário',
      // Campos de auditoria - criação
      criado_por_id: user.id,
      criado_por_nome: user.email || user.nome || 'Usuário',
      criado_em: new Date().toISOString()
    };

    // Adicionar sistema apenas se fornecido (coluna pode não existir ainda)
    if (sistema && sistema.trim()) {
      dadosInsercao.sistema = sistema.trim();
    }

    const { data: insertedData, error: insertError } = await supabaseAdmin
      .from('gestao_dados')
      .insert([dadosInsercao])
      .select();

    if (insertError) {
      // Se o erro for sobre a coluna 'sistema' não existir, tentar novamente sem ela
      if (insertError.message && insertError.message.includes('sistema') && sistema) {
        console.warn('⚠️ Coluna "sistema" não existe, tentando inserir sem ela...');
        delete dadosInsercao.sistema;
        
        const { data: retryData, error: retryError } = await supabaseAdmin
          .from('gestao_dados')
          .insert([dadosInsercao])
          .select();
        
        if (retryError) {
          throw retryError;
        }
        
        console.log('✅ Lançamento salvo sem campo sistema (coluna não existe ainda)');
        return res.json({
          success: true,
          data: retryData[0],
          warning: 'Coluna "sistema" não existe na tabela. Execute o SQL: ALTER TABLE gestao_dados ADD COLUMN sistema VARCHAR(10);'
        });
      }
      throw insertError;
    }

    console.log('✅ Lançamento salvo com sucesso. ID:', insertedData?.[0]?.id);

    return res.json({
      success: true,
      data: insertedData[0]
    });
  } catch (err) {
    console.error('❌ Erro ao salvar lançamento:', err);
    return res.status(500).json({ success: false, error: 'Erro ao salvar lançamento: ' + (err.message || 'Erro desconhecido') });
  }
});

// PUT - Atualizar lançamento
app.put('/api/gestao-dados/:id', express.json(), async (req, res) => {
  try {
    const { user, error } = await getUserFromRequest(req);
    if (error || !user) {
      console.error('❌ Erro de autenticação:', error);
      return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
    }

    const { id } = req.params;
    console.log('📝 Tentativa de edição - ID:', id, 'Usuário:', user.id);

    if (!id) {
      return res.status(400).json({ success: false, error: 'ID é obrigatório' });
    }

    const {
      data,
      oc,
      operacao,
      tipo_erro,
      sistema,
      motivo_devolucao,
      hora_envio,
      hora_retorno,
      responsavel,
      evidencia_url
    } = req.body;

    // Validações com mensagens específicas
    const camposObrigatorios = {
      data,
      oc,
      operacao,
      tipo_erro,
      motivo_devolucao,
      hora_envio,
      hora_retorno,
      responsavel
    };
    
    // Sistema é opcional (coluna pode não existir ainda)

    const camposFaltando = Object.entries(camposObrigatorios)
      .filter(([key, value]) => !value || (typeof value === 'string' && !value.trim()))
      .map(([key]) => key);

    if (camposFaltando.length > 0) {
      console.warn('⚠️ Campos obrigatórios faltando:', camposFaltando);
      console.warn('⚠️ Valores recebidos:', camposObrigatorios);
      return res.status(400).json({
        success: false,
        error: `Campos obrigatórios faltando: ${camposFaltando.join(', ')}`
      });
    }

    // Verificar se o registro existe e pertence ao usuário
    const { data: registro, error: selectError } = await supabaseAdmin
      .from('gestao_dados')
      .select('id, usuario_id')
      .eq('id', id)
      .maybeSingle();

    if (selectError) {
      throw selectError;
    }

    if (!registro) {
      return res.status(404).json({ success: false, error: 'Registro não encontrado' });
    }

    // Verificar se o usuário é o dono do registro (ou admin)
    const isAdmin = req.session?.usuario?.isAdmin || false;
    if (registro.usuario_id !== user.id && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Você não tem permissão para editar este registro' });
    }

    // Converter evidencia_url para array se necessário
    let evidenciasArray = null;
    if (evidencia_url) {
      if (Array.isArray(evidencia_url)) {
        evidenciasArray = evidencia_url.filter(url => url && url.trim());
      } else if (typeof evidencia_url === 'string' && evidencia_url.trim()) {
        evidenciasArray = [evidencia_url.trim()];
      }
      // Se array estiver vazio, usar null
      if (evidenciasArray && evidenciasArray.length === 0) {
        evidenciasArray = null;
      }
    }

    const dadosAtualizacao = {
      data,
      oc: oc.trim(),
      operacao: operacao.trim(),
      tipo_erro: tipo_erro.trim(),
      motivo_devolucao: motivo_devolucao.trim(),
      hora_envio,
      hora_retorno,
      responsavel: responsavel.trim(),
      evidencia_url: evidenciasArray,
      // Campos de auditoria - edição
      editado_por_id: user.id,
      editado_por_nome: user.email || user.nome || 'Usuário',
      editado_em: new Date().toISOString()
    };

    // Adicionar sistema apenas se fornecido (coluna pode não existir ainda)
    if (sistema && sistema.trim()) {
      dadosAtualizacao.sistema = sistema.trim();
    }

    console.log('📤 Dados para atualização:', dadosAtualizacao);

    const { data: updatedData, error: updateError } = await supabaseAdmin
      .from('gestao_dados')
      .update(dadosAtualizacao)
      .eq('id', id)
      .select();

    if (updateError) {
      // Se o erro for sobre a coluna 'sistema' não existir, tentar novamente sem ela
      if (updateError.message && updateError.message.includes('sistema') && sistema) {
        console.warn('⚠️ Coluna "sistema" não existe, tentando atualizar sem ela...');
        delete dadosAtualizacao.sistema;
        
        const { data: retryData, error: retryError } = await supabaseAdmin
          .from('gestao_dados')
          .update(dadosAtualizacao)
          .eq('id', id)
          .select();
        
        if (retryError) {
          console.error('❌ Erro do Supabase ao atualizar:', retryError);
          throw retryError;
        }
        
        console.log('✅ Registro atualizado sem campo sistema (coluna não existe ainda)');
        return res.json({
          success: true,
          data: retryData[0],
          warning: 'Coluna "sistema" não existe na tabela. Execute o SQL: ALTER TABLE gestao_dados ADD COLUMN sistema VARCHAR(10);'
        });
      }
      console.error('❌ Erro do Supabase ao atualizar:', updateError);
      throw updateError;
    }

    if (!updatedData || updatedData.length === 0) {
      console.warn('⚠️ Nenhum registro foi atualizado');
      return res.status(404).json({ success: false, error: 'Registro não foi atualizado' });
    }

    console.log('✅ Lançamento atualizado com sucesso. ID:', id);

    return res.json({
      success: true,
      data: updatedData[0]
    });
  } catch (err) {
    console.error('❌ Erro ao atualizar lançamento:', err);
    console.error('❌ Stack trace:', err.stack);
    return res.status(500).json({ 
      success: false, 
      error: 'Erro ao atualizar lançamento: ' + (err.message || 'Erro desconhecido'),
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// POST - Upload de evidência
app.post('/api/gestao-dados/upload-evidencia', uploadDocumentos.single('evidencia'), async (req, res) => {
  try {
    const { user, error } = await getUserFromRequest(req);
    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
    }

    // Gerar nome único para o arquivo
    const timestamp = Date.now();
    const nomeArquivo = `evidencias/${user.id}/${timestamp}-${req.file.originalname}`;

    // Upload para Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('gestao-dados')
      .upload(nomeArquivo, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (uploadError) {
      console.error('❌ Erro ao fazer upload:', uploadError);
      throw uploadError;
    }

    // Obter URL pública
    const { data: publicData } = supabaseAdmin.storage
      .from('gestao-dados')
      .getPublicUrl(nomeArquivo);

    console.log('✅ Evidência enviada com sucesso:', publicData.publicUrl);

    return res.json({
      success: true,
      url: publicData.publicUrl,
      path: nomeArquivo
    });
  } catch (err) {
    console.error('❌ Erro ao fazer upload de evidência:', err);
    return res.status(500).json({ 
      success: false, 
      error: 'Erro ao fazer upload de evidência: ' + (err.message || 'Erro desconhecido') 
    });
  }
});

// POST - Adicionar coluna 'sistema' à tabela gestao_dados (apenas admin)
app.post('/api/gestao-dados/adicionar-coluna-sistema', async (req, res) => {
  try {
    const { user, error } = await getUserFromRequest(req);
    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
    }

    // Verificar se é admin
    const isAdmin = req.session?.usuario?.isAdmin || false;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Apenas administradores podem executar esta operação' });
    }

    console.log('🔧 Tentando adicionar coluna "sistema" à tabela gestao_dados...');

    // Primeiro, verificar se a coluna já existe
    const { data: testData, error: testError } = await supabaseAdmin
      .from('gestao_dados')
      .select('sistema')
      .limit(1);

    if (!testError) {
      console.log('✅ Coluna "sistema" já existe!');
      return res.json({
        success: true,
        message: 'Coluna "sistema" já existe na tabela gestao_dados',
        colunaExiste: true
      });
    }

    // Tentar criar função RPC se não existir
    console.log('📝 Tentando criar função RPC exec_sql...');
    const createFunctionSQL = `
      CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      BEGIN
        EXECUTE sql_query;
      END;
      $$;
    `;

    // Tentar executar via RPC exec_sql (se já existir)
    const alterTableSQL = `ALTER TABLE gestao_dados ADD COLUMN IF NOT EXISTS sistema VARCHAR(10);`;
    
    try {
      // Primeiro, tentar criar a função
      const { error: createFunctionError } = await supabaseAdmin.rpc('exec_sql', {
        sql_query: createFunctionSQL
      });

      if (createFunctionError && !createFunctionError.message.includes('exec_sql')) {
        console.warn('⚠️ Não foi possível criar função RPC:', createFunctionError.message);
      }

      // Agora tentar adicionar a coluna
      const { error: alterError } = await supabaseAdmin.rpc('exec_sql', {
        sql_query: alterTableSQL
      });

      if (alterError) {
        throw alterError;
      }

      console.log('✅ Coluna "sistema" adicionada com sucesso via RPC!');

      // Verificar se foi criada
      const { data: verifyData, error: verifyError } = await supabaseAdmin
        .from('gestao_dados')
        .select('sistema')
        .limit(1);

      if (verifyError && verifyError.message.includes('sistema')) {
        throw new Error('Coluna não foi criada. Execute o SQL manualmente no Supabase Dashboard.');
      }

      return res.json({
        success: true,
        message: 'Coluna "sistema" adicionada com sucesso à tabela gestao_dados',
        colunaExiste: true
      });

    } catch (rpcError) {
      console.warn('⚠️ RPC não disponível:', rpcError.message);
      console.log('📋 Fornecendo SQL para execução manual...');

      return res.json({
        success: false,
        error: 'Não foi possível executar via API. Execute o SQL manualmente no Supabase Dashboard.',
        sql: alterTableSQL,
        instrucoes: [
          '1. Acesse: https://supabase.com/dashboard',
          '2. Selecione seu projeto',
          '3. Vá em: SQL Editor > New Query',
          '4. Cole o SQL fornecido',
          '5. Execute (Run ou Ctrl+Enter)'
        ]
      });
    }

  } catch (err) {
    console.error('❌ Erro ao adicionar coluna:', err);
    return res.status(500).json({
      success: false,
      error: 'Erro ao adicionar coluna: ' + (err.message || 'Erro desconhecido'),
      sql: 'ALTER TABLE gestao_dados ADD COLUMN IF NOT EXISTS sistema VARCHAR(10);'
    });
  }
});

// POST - Adicionar colunas para chat interno (apenas admin)
app.post('/api/chat-interno/adicionar-colunas', async (req, res) => {
  try {
    const { user, error } = await getUserFromRequest(req);
    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
    }

    // Verificar se é admin (via sessão ou via user_profiles)
    let isAdmin = req.session?.usuario?.isAdmin || false;
    
    // Se não for admin via sessão, verificar no user_profiles
    if (!isAdmin && user.id) {
      const { data: userProfile } = await supabaseAdmin
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      
      isAdmin = userProfile?.role === 'admin' || false;
    }
    
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Apenas administradores podem executar esta operação' });
    }

    console.log('🔧 Tentando adicionar colunas para chat interno na tabela chat_mensagens...');

    // Verificar se as colunas já existem usando information_schema
    const { data: existingColumns, error: checkError } = await supabaseAdmin
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'chat_mensagens')
      .in('column_name', ['entregue', 'visualizada']);

    if (!checkError && existingColumns && existingColumns.length === 2) {
      console.log('✅ Colunas entregue e visualizada já existem!');
      return res.json({
        success: true,
        message: 'Colunas entregue e visualizada já existem na tabela chat_mensagens',
        colunasExistem: true
      });
    }

    console.log('📝 Colunas não encontradas. Adicionando...');

    // SQL para adicionar colunas
    const sqlCommands = [
      `ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS remetente_id UUID;`,
      `ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS destinatario_id UUID;`,
      `ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS remetente_nome TEXT;`,
      `ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS destinatario_nome TEXT;`,
      `ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS lida BOOLEAN DEFAULT false;`,
      `ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS entregue BOOLEAN DEFAULT false;`,
      `ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS visualizada BOOLEAN DEFAULT false;`,
      `CREATE INDEX IF NOT EXISTS idx_chat_mensagens_remetente ON chat_mensagens(remetente_id);`,
      `CREATE INDEX IF NOT EXISTS idx_chat_mensagens_destinatario ON chat_mensagens(destinatario_id);`,
      `CREATE INDEX IF NOT EXISTS idx_chat_mensagens_lida ON chat_mensagens(lida) WHERE lida = false;`,
      `CREATE INDEX IF NOT EXISTS idx_chat_mensagens_remetente_destinatario ON chat_mensagens(remetente_id, destinatario_id);`
    ];

    // Tentar criar função RPC se não existir
    const createFunctionSQL = `
      CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      BEGIN
        EXECUTE sql_query;
      END;
      $$;
    `;

    try {
      // Primeiro, tentar criar a função RPC
      const { error: createFunctionError } = await supabaseAdmin.rpc('exec_sql', {
        sql_query: createFunctionSQL
      });

      if (createFunctionError && !createFunctionError.message.includes('exec_sql')) {
        console.warn('⚠️ Não foi possível criar função RPC:', createFunctionError.message);
      }

      // Executar cada comando SQL
      const resultados = [];
      for (const sql of sqlCommands) {
        try {
          const { error: sqlError } = await supabaseAdmin.rpc('exec_sql', {
            sql_query: sql
          });

          if (sqlError) {
            resultados.push({ comando: sql.substring(0, 50) + '...', sucesso: false, erro: sqlError.message });
          } else {
            resultados.push({ comando: sql.substring(0, 50) + '...', sucesso: true });
          }
        } catch (err) {
          resultados.push({ comando: sql.substring(0, 50) + '...', sucesso: false, erro: err.message });
        }
      }

      const sucessos = resultados.filter(r => r.sucesso).length;
      const falhas = resultados.filter(r => !r.sucesso).length;

      if (falhas > 0) {
        console.warn('⚠️ Alguns comandos falharam:', resultados);
      }

      // Verificar se as colunas foram criadas
      const { data: verifyData, error: verifyError } = await supabaseAdmin
        .from('chat_mensagens')
        .select('remetente_id, destinatario_id, lida')
        .limit(1);

      if (verifyError && verifyError.message.includes('remetente_id')) {
        throw new Error('Colunas não foram criadas. Execute o SQL manualmente no Supabase Dashboard.');
      }

      console.log(`✅ Migração concluída: ${sucessos} comandos executados com sucesso, ${falhas} falhas`);

      return res.json({
        success: true,
        message: `Colunas para chat interno adicionadas com sucesso! ${sucessos} comandos executados.`,
        resultados,
        colunasExistem: true
      });

    } catch (rpcError) {
      console.warn('⚠️ RPC não disponível:', rpcError.message);
      console.log('📋 Fornecendo SQL para execução manual...');

      const sqlCompleto = sqlCommands.join('\n');

      return res.json({
        success: false,
        error: 'Não foi possível executar via API. Execute o SQL manualmente no Supabase Dashboard.',
        sql: sqlCompleto,
        instrucoes: [
          '1. Acesse: https://supabase.com/dashboard',
          '2. Selecione seu projeto',
          '3. Vá em: SQL Editor > New Query',
          '4. Cole o SQL fornecido',
          '5. Execute (Run ou Ctrl+Enter)'
        ]
      });
    }

  } catch (err) {
    console.error('❌ Erro ao adicionar colunas:', err);
    return res.status(500).json({
      success: false,
      error: 'Erro ao adicionar colunas: ' + (err.message || 'Erro desconhecido')
    });
  }
});

// GET - Verificar se colunas entregue e visualizada existem
app.get('/api/chat-interno/verificar-colunas', async (req, res) => {
  try {
    // Tentar fazer um SELECT simples nas colunas para verificar se existem
    // Se der erro, significa que as colunas não existem
    let entregue = false;
    let visualizada = false;

    // Verificar coluna entregue
    try {
      const { data: testEntregue, error: errorEntregue } = await supabaseAdmin
        .from('chat_mensagens')
        .select('entregue')
        .limit(1);

      if (!errorEntregue) {
        entregue = true;
      }
    } catch (err) {
      // Coluna não existe ou outro erro
      entregue = false;
    }

    // Verificar coluna visualizada
    try {
      const { data: testVisualizada, error: errorVisualizada } = await supabaseAdmin
        .from('chat_mensagens')
        .select('visualizada')
        .limit(1);

      if (!errorVisualizada) {
        visualizada = true;
      }
    } catch (err) {
      // Coluna não existe ou outro erro
      visualizada = false;
    }

    return res.json({
      success: true,
      entregue,
      visualizada,
      todasExistem: entregue && visualizada
    });

  } catch (err) {
    console.error('❌ Erro ao verificar colunas:', err);
    return res.status(500).json({
      success: false,
      error: 'Erro ao verificar colunas: ' + (err.message || 'Erro desconhecido'),
      entregue: false,
      visualizada: false
    });
  }
});

// POST - Importar CSV em massa
app.post('/api/gestao-dados/importar-csv', upload.single('csv'), async (req, res) => {
  try {
    const { user, error } = await getUserFromRequest(req);
    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Nenhum arquivo CSV enviado' });
    }

    const csvContent = req.file.buffer.toString('utf-8');
    
    // Parse CSV considerando quebras de linha dentro de campos entre aspas
    function parseCSVContent(content) {
      const lines = [];
      let currentLine = '';
      let inQuotes = false;
      
      for (let i = 0; i < content.length; i++) {
        const char = content[i];
        const nextChar = content[i + 1];
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            // Aspas duplas (escape)
            currentLine += '"';
            i++; // Pular próxima aspas
          } else {
            // Toggle aspas
            inQuotes = !inQuotes;
            currentLine += char;
          }
        } else if (char === '\n' && !inQuotes) {
          // Quebra de linha fora de aspas = nova linha
          if (currentLine.trim()) {
            lines.push(currentLine.trim());
          }
          currentLine = '';
        } else {
          currentLine += char;
        }
      }
      
      // Adicionar última linha
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
      }
      
      return lines;
    }
    
    const lines = parseCSVContent(csvContent);
    
    if (lines.length < 2) {
      return res.status(400).json({ success: false, error: 'CSV deve conter pelo menos um cabeçalho e uma linha de dados' });
    }

    // Parse do CSV (melhorado, considerando vírgulas e aspas)
    function parseCSVLine(line) {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      // Remover quebras de linha no final
      line = line.trim();
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            // Aspas duplas dentro de campo com aspas (escape)
            current += '"';
            i++;
          } else {
            // Toggle aspas
            inQuotes = !inQuotes;
            // Não adicionar as aspas ao conteúdo
          }
        } else if (char === ',' && !inQuotes) {
          // Vírgula fora de aspas = separador de campo
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      // Adicionar último campo
      result.push(current.trim());
      return result;
    }

    // Parse da primeira linha (cabeçalhos)
    const rawHeaders = parseCSVLine(lines[0]);
    const headers = rawHeaders.map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
    
    console.log('📋 Cabeçalhos brutos:', rawHeaders);
    console.log('📋 Cabeçalhos normalizados:', headers);
    
    // Função para normalizar e comparar cabeçalhos
    function normalizeHeader(header) {
      return header
        .toLowerCase()
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/[áàâãä]/g, 'a')
        .replace(/[éèêë]/g, 'e')
        .replace(/[íìîï]/g, 'i')
        .replace(/[óòôõö]/g, 'o')
        .replace(/[úùûü]/g, 'u')
        .replace(/ç/g, 'c')
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s]/g, '');
    }
    
    // Mapear cabeçalhos esperados com variações
    const headerMappings = {
      'data': ['data', 'date', 'data do lancamento', 'data do lançamento', 'data_lancamento'],
      'oc': ['oc', 'ordem de coleta', 'ordem_coleta', 'ordem coleta', 'oc-', 'oc_', 'oc numero'],
      'operação': ['operação', 'operacao', 'operacao', 'op', 'tipo operacao', 'tipo_operacao', 'operacao tipo'],
      'tipo de erro': ['tipo de erro', 'tipo erro', 'tipo_erro', 'erro', 'tipo', 'tipo erro', 'tipo_de_erro'],
      'motivo da devolução': ['motivo da devolução', 'motivo devolucao', 'motivo', 'devolucao', 'motivo da devolucao', 'motivo_devolucao', 'motivo devolução'],
      'hora envio': ['hora envio', 'hora_envio', 'hora que enviou', 'envio', 'hora envio demanda', 'hora_envio_demanda', 'hora que enviou a demanda'],
      'hora retorno': ['hora retorno', 'hora_retorno', 'hora que retornou', 'retorno', 'hora retorno demanda', 'hora_retorno_demanda', 'hora que retornou a demanda'],
      'responsável': ['responsável', 'responsavel', 'responsavel', 'resp', 'responsavel nome', 'responsavel_nome', 'responsavel_nome']
    };
    
    const headerMap = {};
    
    // Procurar cada cabeçalho esperado
    Object.keys(headerMappings).forEach(key => {
      const variations = headerMappings[key];
      for (const variation of variations) {
        const normalized = normalizeHeader(variation);
        const index = headers.findIndex(h => {
          const normalizedH = normalizeHeader(h);
          // Comparação mais flexível
          return normalizedH === normalized || 
                 normalizedH.includes(normalized) || 
                 normalized.includes(normalizedH) ||
                 normalizedH.replace(/\s/g, '') === normalized.replace(/\s/g, '');
        });
        if (index !== -1) {
          headerMap[key] = index;
          console.log(`✅ Cabeçalho "${key}" encontrado na coluna ${index} (${rawHeaders[index]})`);
          break;
        }
      }
    });

    console.log('📊 Mapeamento final:', headerMap);

    // Validar se encontrou os cabeçalhos principais
    if (headerMap['data'] === undefined || headerMap['oc'] === undefined || headerMap['operação'] === undefined) {
      const missing = [];
      if (headerMap['data'] === undefined) missing.push('Data');
      if (headerMap['oc'] === undefined) missing.push('OC');
      if (headerMap['operação'] === undefined) missing.push('Operação');
      
      return res.status(400).json({ 
        success: false, 
        error: `CSV deve conter as colunas: ${missing.join(', ')}. Cabeçalhos encontrados: ${rawHeaders.join(', ')}` 
      });
    }

    const dadosParaInserir = [];
    const erros = [];
    
    // Processar linhas de dados
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Pular linhas vazias
      
      const values = parseCSVLine(line);
      
      // Verificar se tem pelo menos os campos obrigatórios (Data, OC, Operação)
      if (values.length < 3) {
        console.warn(`Linha ${i + 1}: Poucos campos encontrados (${values.length}), pulando...`);
        continue;
      }
      
      // Garantir que temos pelo menos 8 campos (preencher com vazios se necessário)
      while (values.length < 8) {
        values.push('');
      }
      
      try {
        // Função auxiliar para obter valor do array com fallback
        function getValue(index, defaultValue = '') {
          if (index === undefined || index === null || index < 0 || index >= values.length) {
            return defaultValue;
          }
          const value = values[index];
          return value ? value.trim() : defaultValue;
        }

        let data = getValue(headerMap['data']);
        let oc = getValue(headerMap['oc']);
        const operacao = getValue(headerMap['operação']);
        const tipoErro = getValue(headerMap['tipo de erro']);
        const motivoDevolucao = getValue(headerMap['motivo da devolução']);
        let horaEnvio = getValue(headerMap['hora envio']);
        let horaRetorno = getValue(headerMap['hora retorno']);
        let responsavel = getValue(headerMap['responsável']);

        // Log para debug
        console.log(`Linha ${i + 1}:`, {
          data,
          oc,
          operacao,
          tipoErro,
          motivoDevolucao: motivoDevolucao.substring(0, 50),
          horaEnvio,
          horaRetorno,
          responsavel,
          totalValues: values.length,
          headerMap
        });

        // Adicionar prefixo "OC-" se não tiver (caso o Excel tenha removido)
        if (oc && !oc.toUpperCase().startsWith('OC')) {
          oc = `OC-${oc}`;
        }

        // Validações básicas
        if (!data || !oc || !operacao) {
          erros.push(`Linha ${i + 1}: Campos obrigatórios faltando (Data: "${data}", OC: "${oc}", Operação: "${operacao}")`);
          continue;
        }

        // Converter data do formato Excel (número serial) para YYYY-MM-DD
        function converterDataExcel(valor) {
          if (!valor || !valor.toString().trim()) {
            return null;
          }
          
          const valorStr = valor.toString().trim();
          
          // Se for um número (formato serial do Excel)
          // IMPORTANTE: Números muito grandes (> 100000) provavelmente são horas, não datas
          const numero = parseFloat(valorStr.replace(',', '.'));
          if (!isNaN(numero) && numero > 0 && numero < 100000) {
            // Excel conta dias desde 01/01/1900 (mas tem um bug, então é 30/12/1899)
            const dataBase = new Date(1899, 11, 30); // 30 de dezembro de 1899
            const dataResultado = new Date(dataBase.getTime() + numero * 24 * 60 * 60 * 1000);
            const ano = dataResultado.getFullYear();
            
            // Validar se a data faz sentido (não pode ser antes de 2000 ou depois de 2100)
            if (ano < 2000 || ano > 2100) {
              // Se a data não faz sentido, provavelmente não é uma data serial do Excel
              // Tentar outros formatos
            } else {
              const mes = String(dataResultado.getMonth() + 1).padStart(2, '0');
              const dia = String(dataResultado.getDate()).padStart(2, '0');
              return `${ano}-${mes}-${dia}`;
            }
          }
          
          // Formato "DD.mês" ou "DD.mês." (ex: "11/nov.", "24.11")
          if (valorStr.includes('.') || valorStr.includes('/')) {
            // Mapeamento de meses abreviados
            const mesesMap = {
              'jan': '01', 'fev': '02', 'mar': '03', 'abr': '04', 'mai': '05', 'jun': '06',
              'jul': '07', 'ago': '08', 'set': '09', 'out': '10', 'nov': '11', 'dez': '12',
              'jan.': '01', 'fev.': '02', 'mar.': '03', 'abr.': '04', 'mai.': '05', 'jun.': '06',
              'jul.': '07', 'ago.': '08', 'set.': '09', 'out.': '10', 'nov.': '11', 'dez.': '12'
            };
            
            // Tentar formato "DD/mês." ou "DD.mês"
            const matchMes = valorStr.match(/^(\d{1,2})[./]([a-z]{3})\.?$/i);
            if (matchMes) {
              const dia = matchMes[1].padStart(2, '0');
              const mesAbrev = matchMes[2].toLowerCase();
              const mes = mesesMap[mesAbrev] || mesesMap[mesAbrev + '.'];
              if (mes) {
                const ano = new Date().getFullYear(); // Usar ano atual
                return `${ano}-${mes}-${dia}`;
              }
            }
            
            // Tentar formato "DD.MM" ou "DD/MM" (ex: "24.11", "11/11")
            const matchNum = valorStr.match(/^(\d{1,2})[./](\d{1,2})\.?$/);
            if (matchNum) {
              const dia = matchNum[1].padStart(2, '0');
              const mes = matchNum[2].padStart(2, '0');
              const ano = new Date().getFullYear(); // Usar ano atual
              // Validar se é uma data válida
              const dataTeste = new Date(`${ano}-${mes}-${dia}`);
              if (dataTeste.getDate() == parseInt(dia) && dataTeste.getMonth() + 1 == parseInt(mes)) {
                return `${ano}-${mes}-${dia}`;
              }
            }
            
            // Formato DD/MM/YYYY ou MM/DD/YYYY
            const partes = valorStr.split(/[./]/);
            if (partes.length === 3) {
              const dia = partes[0].padStart(2, '0');
              const mes = partes[1].padStart(2, '0');
              const ano = partes[2].length === 4 ? partes[2] : `20${partes[2]}`;
              // Tentar DD/MM/YYYY primeiro
              const dataTeste = new Date(`${ano}-${mes}-${dia}`);
              if (dataTeste.getDate() == parseInt(partes[0]) && dataTeste.getMonth() + 1 == parseInt(partes[1])) {
                return `${ano}-${mes}-${dia}`;
              }
              // Se não funcionar, tentar MM/DD/YYYY
              return `${ano}-${dia}-${mes}`;
            }
          }
          
          // Se já estiver no formato YYYY-MM-DD
          if (valorStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return valorStr;
          }
          
          return null;
        }

        // Converter hora do formato Excel (decimal) para HH:MM
        function converterHoraExcel(valor) {
          if (!valor || !valor.toString().trim()) {
            return null;
          }
          
          const valorStr = valor.toString().trim();
          
          // Se for formato "10;00" (ponto e vírgula), converter para "10:00"
          if (valorStr.includes(';')) {
            return valorStr.replace(';', ':');
          }
          
          // Se já estiver no formato HH:MM
          if (valorStr.match(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)) {
            return valorStr;
          }
          
          // Converter para número (aceitar vírgula ou ponto como separador decimal)
          // Remover caracteres não numéricos exceto vírgula e ponto
          const numeroStr = valorStr.replace(/[^\d,.-]/g, '').replace(',', '.');
          const numero = parseFloat(numeroStr);
          
          if (isNaN(numero)) {
            return null;
          }
          
          // Se for um número muito grande (pode ser data+hora do Excel combinado)
          // Excel armazena data+hora como número serial onde a parte inteira é a data
          // e a parte decimal é a hora
          if (numero >= 1) {
            // Extrair apenas a parte decimal (hora)
            const parteDecimal = numero % 1;
            if (parteDecimal > 0) {
              const totalSegundos = Math.floor(parteDecimal * 24 * 60 * 60);
              const horas = Math.floor(totalSegundos / 3600);
              const minutos = Math.floor((totalSegundos % 3600) / 60);
              return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
            }
            // Se não tem parte decimal mas o número é muito grande, pode ser um erro de formatação
            // Tentar tratar como se fosse um número serial do Excel com hora zero
            // Ou pode ser que o Excel tenha salvado apenas a parte inteira
            // Nesse caso, retornar 00:00
            return '00:00';
          }
          
          // Se for um número decimal entre 0 e 1 (formato do Excel para hora pura)
          if (numero >= 0 && numero < 1) {
            // Número decimal representa fração do dia
            const totalSegundos = Math.floor(numero * 24 * 60 * 60);
            const horas = Math.floor(totalSegundos / 3600);
            const minutos = Math.floor((totalSegundos % 3600) / 60);
            return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
          }
          
          // Se for apenas número inteiro pequeno (horas)
          if (numero >= 0 && numero < 24 && numero === Math.floor(numero)) {
            return `${String(Math.floor(numero)).padStart(2, '0')}:00`;
          }
          
          return null;
        }

        // Converter data
        const dataConvertida = converterDataExcel(data);
        if (!dataConvertida) {
          erros.push(`Linha ${i + 1}: Data inválida (${data})`);
          continue;
        }
        data = dataConvertida;

        // Validar data convertida
        const dataObj = new Date(data);
        if (isNaN(dataObj.getTime())) {
          erros.push(`Linha ${i + 1}: Data inválida após conversão (${data})`);
          continue;
        }
        
        // Validar se a data faz sentido (não pode ser antes de 2000 ou depois de 2100)
        const ano = dataObj.getFullYear();
        if (ano < 2000 || ano > 2100) {
          erros.push(`Linha ${i + 1}: Data fora do intervalo válido (${data} - ano ${ano}). Verifique o formato da data.`);
          continue;
        }

        // Converter horas (opcionais)
        const horaEnvioRaw = getValue(headerMap['hora envio']);
        if (horaEnvioRaw && horaEnvioRaw.toString().trim() && horaEnvioRaw !== '0') {
          const horaEnvioConvertida = converterHoraExcel(horaEnvioRaw);
          if (horaEnvioConvertida) {
            horaEnvio = horaEnvioConvertida;
            if (i <= 2) console.log(`  ✅ Hora envio convertida: "${horaEnvioRaw}" -> "${horaEnvioConvertida}"`);
          } else {
            // Se não conseguir converter, usar valor padrão
            if (i <= 2) console.warn(`  ⚠️ Hora de envio inválida ("${horaEnvioRaw}"), usando 00:00`);
            horaEnvio = '00:00';
          }
        } else {
          horaEnvio = '00:00';
        }

        const horaRetornoRaw = getValue(headerMap['hora retorno']);
        if (horaRetornoRaw && horaRetornoRaw.toString().trim() && horaRetornoRaw !== '0') {
          const horaRetornoConvertida = converterHoraExcel(horaRetornoRaw);
          if (horaRetornoConvertida) {
            horaRetorno = horaRetornoConvertida;
            if (i <= 2) console.log(`  ✅ Hora retorno convertida: "${horaRetornoRaw}" -> "${horaRetornoConvertida}"`);
          } else {
            // Se não conseguir converter, usar valor padrão
            if (i <= 2) console.warn(`  ⚠️ Hora de retorno inválida ("${horaRetornoRaw}"), usando 00:00`);
            horaRetorno = '00:00';
          }
        } else {
          horaRetorno = '00:00';
        }

        // Buscar responsável - pode estar em diferentes posições se o CSV tiver campos extras
        // Tentar índice do mapeamento primeiro
        let responsavelRaw = getValue(headerMap['responsável']);
        
        // Se estiver vazio ou for um número grande (erro de parse), tentar pegar da última coluna
        const isNumeroGrande = responsavelRaw && /^\d{10,}$/.test(responsavelRaw.toString().trim());
        if (!responsavelRaw || !responsavelRaw.trim() || isNumeroGrande) {
          if (isNumeroGrande && i <= 2) {
            console.warn(`  ⚠️ Responsável parece ser um número grande (${responsavelRaw}), buscando em outras colunas...`);
          }
          
          // Tentar últimas 3 colunas não vazias que não sejam numéricas
          for (let idx = values.length - 1; idx >= Math.max(0, values.length - 3); idx--) {
            const val = values[idx]?.trim();
            if (val && val.length > 2) {
              // Verificar se não é um número (incluindo números grandes)
              const isNumber = /^\d+[.,]?\d*$/.test(val);
              const isNumeroMuitoGrande = /^\d{10,}$/.test(val); // Números com 10+ dígitos são provavelmente horas/datas
              
              if (!isNumber && !isNumeroMuitoGrande) {
                // Verificar se parece um nome (tem letras, não é só números)
                const temLetras = /[a-zA-ZÀ-ÿ]/.test(val);
                if (temLetras) {
                  responsavelRaw = val;
                  if (i <= 2) console.log(`  🔍 Responsável encontrado na coluna ${idx} (última não numérica): "${responsavelRaw}"`);
                  break;
                }
              }
            }
          }
        }
        
        // Validar se o responsável encontrado não é um número
        if (responsavelRaw && responsavelRaw.trim()) {
          const responsavelStr = responsavelRaw.toString().trim();
          const isNumero = /^\d+[.,]?\d*$/.test(responsavelStr);
          const isNumeroGrande = /^\d{10,}$/.test(responsavelStr);
          
          if (isNumero || isNumeroGrande) {
            if (i <= 2) console.warn(`  ⚠️ Responsável é um número (${responsavelStr}), usando "Não informado"`);
            responsavel = 'Não informado';
          } else {
            responsavel = responsavelStr;
            if (i <= 2) console.log(`  ✅ Responsável: "${responsavel}"`);
          }
        } else {
          if (i <= 2) {
            console.warn(`  ⚠️ Responsável não encontrado`);
            console.warn(`     Índice esperado: ${headerMap['responsável']}`);
            console.warn(`     Total de campos: ${values.length}`);
            console.warn(`     Últimas 3 colunas: ${values.slice(-3).map((v, idx) => `[${values.length - 3 + idx}]="${v}"`).join(', ')}`);
          }
          responsavel = 'Não informado';
        }

        dadosParaInserir.push({
          data: dataObj.toISOString().split('T')[0],
          oc: oc.substring(0, 50),
          operacao: operacao.substring(0, 100),
          tipo_erro: tipoErro || 'Erro de Tabela',
          motivo_devolucao: motivoDevolucao || 'Não informado',
          hora_envio: horaEnvio,
          hora_retorno: horaRetorno,
          responsavel: responsavel || 'Não informado',
          usuario_id: user.id,
          usuario_nome: user.email || 'Usuário',
          // Campos de auditoria - criação
          criado_por_id: user.id,
          criado_por_nome: user.email || user.nome || 'Usuário',
          criado_em: new Date().toISOString()
        });
      } catch (err) {
        erros.push(`Linha ${i + 1}: ${err.message}`);
      }
    }

    if (dadosParaInserir.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nenhum dado válido encontrado no CSV',
        erros: erros
      });
    }

    // Inserir em lotes de 100 para evitar timeout
    const batchSize = 100;
    let importados = 0;
    const errosInsercao = [];

    for (let i = 0; i < dadosParaInserir.length; i += batchSize) {
      const batch = dadosParaInserir.slice(i, i + batchSize);
      
      const { data: insertedData, error: insertError } = await supabaseAdmin
        .from('gestao_dados')
        .insert(batch)
        .select();

      if (insertError) {
        errosInsercao.push(`Erro ao inserir lote ${Math.floor(i / batchSize) + 1}: ${insertError.message}`);
      } else {
        importados += insertedData?.length || 0;
      }
    }

    console.log(`✅ CSV importado: ${importados} registro(s) inserido(s)`);

    return res.json({
      success: true,
      importados,
      total: dadosParaInserir.length,
      erros: [...erros, ...errosInsercao]
    });
  } catch (err) {
    console.error('❌ Erro ao importar CSV:', err);
    return res.status(500).json({ success: false, error: 'Erro ao importar CSV: ' + (err.message || 'Erro desconhecido') });
  }
});

// DELETE - Excluir todos os registros (apenas admin)
app.delete('/api/gestao-dados/excluir-todos', async (req, res) => {
  try {
    const { user, error } = await getUserFromRequest(req);
    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
    }

    // Verificar se é admin
    const isAdmin = req.session?.usuario?.isAdmin || false;
    
    // Verificar também no banco de dados
    let isAdminFromDb = false;
    try {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      
      if (!profileError && profile && (profile.role === 'admin' || profile.role === 'projetos')) {
        isAdminFromDb = true;
      }
    } catch (e) {
      console.warn('⚠️ Erro ao verificar role no banco:', e);
    }

    if (!isAdmin && !isAdminFromDb) {
      return res.status(403).json({ 
        success: false, 
        error: 'Apenas administradores podem excluir todos os registros' 
      });
    }

    // Contar registros antes de excluir
    const { count, error: countError } = await supabaseAdmin
      .from('gestao_dados')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      throw countError;
    }

    const totalRegistros = count || 0;

    if (totalRegistros === 0) {
      return res.json({
        success: true,
        excluidos: 0,
        message: 'Não há registros para excluir'
      });
    }

    // Excluir todos os registros
    const { error: deleteError } = await supabaseAdmin
      .from('gestao_dados')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Excluir todos (usando condição sempre verdadeira)

    if (deleteError) {
      throw deleteError;
    }

    console.log(`✅ ${totalRegistros} registro(s) excluído(s) por admin: ${user.email || user.id}`);

    return res.json({
      success: true,
      excluidos: totalRegistros,
      message: `${totalRegistros} registro(s) excluído(s) com sucesso`
    });
  } catch (err) {
    console.error('❌ Erro ao excluir todos os registros:', err);
    return res.status(500).json({ success: false, error: 'Erro ao excluir registros: ' + (err.message || 'Erro desconhecido') });
  }
});

// DELETE - Excluir lançamento
app.delete('/api/gestao-dados/:id', async (req, res) => {
  try {
    const { user, error } = await getUserFromRequest(req);
    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
    }

    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, error: 'ID é obrigatório' });
    }

    // Verificar se o registro existe e pertence ao usuário
    const { data: registro, error: selectError } = await supabaseAdmin
      .from('gestao_dados')
      .select('id, usuario_id')
      .eq('id', id)
      .maybeSingle();

    if (selectError) {
      throw selectError;
    }

    if (!registro) {
      return res.status(404).json({ success: false, error: 'Registro não encontrado' });
    }

    // Verificar se o usuário é o dono do registro (ou admin)
    const isAdmin = req.session?.usuario?.isAdmin || false;
    if (registro.usuario_id !== user.id && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Você não tem permissão para excluir este registro' });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('gestao_dados')
      .delete()
      .eq('id', id);

    if (deleteError) {
      throw deleteError;
    }

    console.log('✅ Lançamento excluído com sucesso. ID:', id);

    return res.json({
      success: true,
      message: 'Registro excluído com sucesso'
    });
  } catch (err) {
    console.error('❌ Erro ao excluir lançamento:', err);
    return res.status(500).json({ success: false, error: 'Erro ao excluir registro: ' + (err.message || 'Erro desconhecido') });
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
          .select('treinamento_slug, data_assinatura, nome, cpf, assinatura_texto')
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
    let uniq = Array.from(new Set((data || []).map(r => (r.tipo_veiculo || '').trim()).filter(Boolean)));
    
    // Normalizar variações comuns (case-insensitive)
    const tiposNormalizados = new Map();
    uniq.forEach(tipo => {
      const normalizado = tipo.toLowerCase();
      // Manter a versão com primeira letra maiúscula se existir
      if (!tiposNormalizados.has(normalizado) || tipo[0] === tipo[0].toUpperCase()) {
        tiposNormalizados.set(normalizado, tipo);
      }
    });
    
    // Garantir que tipos importantes estejam sempre presentes (mesmo que não existam no banco)
    const tiposImportantes = ['Carreta', 'Bitrem', 'Rodotrem'];
    tiposImportantes.forEach(tipo => {
      const normalizado = tipo.toLowerCase();
      if (!tiposNormalizados.has(normalizado)) {
        tiposNormalizados.set(normalizado, tipo);
      }
    });
    
    // Converter de volta para array e ordenar
    uniq = Array.from(tiposNormalizados.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
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

// ========== HELPER: IDENTIFICAR TIPO DE ERRO ==========
function identificarTipoErro(error, response, errorText) {
  // Erros de conexão (timeout, network, etc)
  if (error) {
    const errorMsg = error.message?.toLowerCase() || '';
    if (
      errorMsg.includes('timeout') ||
      errorMsg.includes('econnrefused') ||
      errorMsg.includes('enotfound') ||
      errorMsg.includes('network') ||
      errorMsg.includes('connection') ||
      errorMsg.includes('fetch failed') ||
      errorMsg.includes('aborted') ||
      error.name === 'AbortError'
    ) {
      return 'conexao';
    }
  }

  // Erros de resposta HTTP
  if (response) {
    // Status 500, 502, 503, 504 = problemas de servidor/conexão
    if ([500, 502, 503, 504].includes(response.status)) {
      return 'conexao';
    }
    // Status 404 = instância não encontrada (problema de conexão/configuração)
    if (response.status === 404) {
      return 'conexao';
    }
    // Status 401 = API key inválida (problema de configuração, não número)
    if (response.status === 401) {
      return 'conexao';
    }
  }

  // Erros de número inválido (geralmente vêm da Evolution API)
  if (errorText) {
    const errorLower = errorText.toLowerCase();
    if (
      errorLower.includes('number') ||
      errorLower.includes('número') ||
      errorLower.includes('invalid') ||
      errorLower.includes('not found') ||
      errorLower.includes('não encontrado') ||
      errorLower.includes('does not exist') ||
      errorLower.includes('não existe')
    ) {
      return 'numero_invalido';
    }
  }

  // Se não conseguir identificar, retorna null (erro desconhecido)
  return null;
}

// ========== API PARA SINCRONIZAR ERROS DA TABELA DISPAROS_LOG ==========
app.post('/api/motoristas/sincronizar-erros-disparos', express.json(), async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    console.log('🔄 Sincronizando erros da tabela disparos_log...');

    // Buscar todos os números com erro na tabela disparos_log
    // Considerar apenas erros dos últimos 30 dias para não processar dados muito antigos
    const trintaDiasAtras = new Date();
    trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);

    const { data: errosDisparos, error: erroQuery } = await supabaseAdmin
      .from('disparos_log')
      .select('numero, status, created_at, tipo_erro')
      .eq('status', 'error')
      .gte('created_at', trintaDiasAtras.toISOString());

    if (erroQuery) {
      console.error('❌ Erro ao buscar erros de disparos:', erroQuery);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar erros de disparos'
      });
    }

    if (!errosDisparos || errosDisparos.length === 0) {
      return res.json({
        success: true,
        message: 'Nenhum erro encontrado nos últimos 30 dias',
        processados: 0,
        atualizados: 0
      });
    }

    console.log(`📊 Encontrados ${errosDisparos.length} erros de disparo`);

    // Agrupar por número e pegar o erro mais recente
    const errosPorNumero = new Map();
    errosDisparos.forEach(erro => {
      // Normalizar número: remover @c.us e caracteres não numéricos
      const numeroNormalizado = erro.numero
        .replace('@c.us', '')
        .replace(/\D/g, '');
      
      if (!numeroNormalizado || numeroNormalizado.length < 10) {
        return; // Pular números inválidos
      }

      const erroExistente = errosPorNumero.get(numeroNormalizado);
      if (!erroExistente || new Date(erro.created_at) > new Date(erroExistente.created_at)) {
        errosPorNumero.set(numeroNormalizado, {
          numero: numeroNormalizado,
          created_at: erro.created_at
        });
      }
    });

    console.log(`📞 ${errosPorNumero.size} números únicos com erro`);

    let atualizados = 0;
    let naoEncontrados = 0;

    // Para cada número com erro, verificar taxa de sucesso antes de marcar
    for (const [numeroNormalizado, erroInfo] of errosPorNumero) {
      try {
        // PRIMEIRO: Verificar taxa de sucesso/erro para este número
        // Buscar TODOS os disparos (sucessos e erros) dos últimos 30 dias
        const { data: todosDisparos, error: disparosError } = await supabaseAdmin
          .from('disparos_log')
          .select('status, created_at, tipo_erro')
          .or(`numero.ilike.%${numeroNormalizado}%,numero.ilike.%55${numeroNormalizado}%,numero.ilike.%${numeroNormalizado}@c.us%,numero.ilike.%55${numeroNormalizado}@c.us%`)
          .gte('created_at', trintaDiasAtras.toISOString());

        if (disparosError) {
          console.error(`❌ Erro ao buscar disparos para ${numeroNormalizado}:`, disparosError);
        }

        // Calcular estatísticas
        let totalDisparos = 0;
        let totalSucessos = 0;
        let totalErros = 0;
        let errosConexao = 0; // Erros de conexão (devem ser ignorados)
        let errosNumeroInvalido = 0; // Erros de número inválido
        let errosRecentesNumeroInvalido = 0; // Erros de número inválido dos últimos 7 dias

        if (todosDisparos && todosDisparos.length > 0) {
          totalDisparos = todosDisparos.length;
          const seteDiasAtras = new Date();
          seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);

          todosDisparos.forEach(disparo => {
            if (disparo.status === 'success') {
              totalSucessos++;
            } else if (disparo.status === 'error') {
              totalErros++;
              
              // Separar erros de conexão de erros de número inválido
              if (disparo.tipo_erro === 'conexao') {
                errosConexao++;
                // Erros de conexão não contam para inativação
              } else if (disparo.tipo_erro === 'numero_invalido') {
                errosNumeroInvalido++;
                if (new Date(disparo.created_at) >= seteDiasAtras) {
                  errosRecentesNumeroInvalido++;
                }
              } else {
                // Se tipo_erro é null (erro antigo), assumir como número inválido para compatibilidade
                errosNumeroInvalido++;
                if (new Date(disparo.created_at) >= seteDiasAtras) {
                  errosRecentesNumeroInvalido++;
                }
              }
            }
          });
        }

        // IGNORAR erros de conexão - não devem inativar números
        if (errosConexao > 0) {
          console.log(`⏭️ Número ${numeroNormalizado} ignorado: ${errosConexao} erro(s) de conexão detectado(s) - não será marcado como erro`);
          continue; // Pular este número, erros de conexão não contam
        }

        // Calcular taxa de erro apenas para números inválidos
        const taxaErro = totalDisparos > 0 ? (errosNumeroInvalido / totalDisparos) * 100 : 0;

        // DECISÃO: Só marcar como erro se:
        // 1. Pelo menos 3 tentativas com erro de número inválido (configurável - pode ser alterado para 5)
        // 2. OU pelo menos 5 tentativas com erro de número inválido nos últimos 7 dias
        // 3. OU taxa de erro > 50% E pelo menos 3 erros de número inválido
        const TENTATIVAS_MINIMAS = 3; // Configurável: mínimo de tentativas antes de marcar (recomendado: 3-5)
        const deveMarcarComoErro = 
          errosNumeroInvalido >= TENTATIVAS_MINIMAS ||
          errosRecentesNumeroInvalido >= 5 ||
          (taxaErro > 50 && errosNumeroInvalido >= 3);

        if (!deveMarcarComoErro) {
          console.log(`⏭️ Número ${numeroNormalizado} ignorado: ${errosNumeroInvalido} erro(s) de número inválido (mínimo: ${TENTATIVAS_MINIMAS}) - ${totalSucessos} sucessos`);
          continue; // Pular este número, não atingiu o mínimo de tentativas
        }

        console.log(`⚠️ Número ${numeroNormalizado} será marcado como erro: ${errosNumeroInvalido} erro(s) de número inválido (${totalSucessos} sucessos, taxa: ${taxaErro.toFixed(1)}%)`);

        // Tentar diferentes variações do número
        const variacoes = [];
        
        // Número completo
        variacoes.push(numeroNormalizado);
        
        // Sem código do país (55) - últimos 10 ou 11 dígitos
        if (numeroNormalizado.startsWith('55') && numeroNormalizado.length > 2) {
          variacoes.push(numeroNormalizado.slice(2));
        }
        
        // Apenas últimos 8 dígitos (sem DDD)
        if (numeroNormalizado.length > 8) {
          variacoes.push(numeroNormalizado.slice(-8));
        }
        
        // Apenas últimos 9 dígitos (com DDD)
        if (numeroNormalizado.length > 9) {
          variacoes.push(numeroNormalizado.slice(-9));
        }

        let motoristasEncontrados = [];
        
        // Buscar com cada variação
        for (const variacao of variacoes) {
          if (variacao.length < 8) continue; // Pular variações muito curtas
          
          const { data: motoristas, error: motoristasError } = await supabaseAdmin
            .from('motoristas')
            .select('id, nome, telefone1, telefone2, telefone1_erro, telefone2_erro')
            .or(`telefone1.ilike.%${variacao}%,telefone2.ilike.%${variacao}%`);

          if (motoristasError) {
            console.error(`❌ Erro ao buscar motorista para ${variacao}:`, motoristasError);
            continue;
          }

          if (motoristas && motoristas.length > 0) {
            motoristasEncontrados = motoristas;
            break; // Se encontrou, não precisa tentar outras variações
          }
        }

        if (motoristasEncontrados.length === 0) {
          naoEncontrados++;
          if (naoEncontrados <= 5) { // Log apenas os primeiros 5 para não poluir
            console.log(`⚠️ Número ${numeroNormalizado} não encontrado em nenhum motorista`);
          }
          continue;
        }

        // Processar motoristas encontrados
        for (const motorista of motoristasEncontrados) {
          const updateData = {};
          const telefone1Normalizado = motorista.telefone1?.replace(/\D/g, '');
          const telefone2Normalizado = motorista.telefone2?.replace(/\D/g, '');

          // Verificar match exato ou parcial
          const telefone1Match = telefone1Normalizado && (
            telefone1Normalizado === numeroNormalizado ||
            telefone1Normalizado.endsWith(numeroNormalizado) ||
            numeroNormalizado.endsWith(telefone1Normalizado) ||
            telefone1Normalizado.includes(numeroNormalizado.slice(-8)) ||
            numeroNormalizado.includes(telefone1Normalizado.slice(-8))
          );

          const telefone2Match = telefone2Normalizado && (
            telefone2Normalizado === numeroNormalizado ||
            telefone2Normalizado.endsWith(numeroNormalizado) ||
            numeroNormalizado.endsWith(telefone2Normalizado) ||
            telefone2Normalizado.includes(numeroNormalizado.slice(-8)) ||
            numeroNormalizado.includes(telefone2Normalizado.slice(-8))
          );

          // Criar motivo detalhado com estatísticas
          const motivoDetalhado = `Número inválido: ${errosNumeroInvalido} tentativa(s) falharam (${totalSucessos} sucessos anteriores)`;

          if (telefone1Match && !motorista.telefone1_erro) {
            updateData.telefone1_erro = true;
            updateData.telefone1_erro_data = erroInfo.created_at;
            updateData.telefone1_erro_motivo = motivoDetalhado;
            console.log(`✅ Marcando telefone1 com erro: ${motorista.nome} (${motorista.telefone1}) - ${motivoDetalhado}`);
          }
          if (telefone2Match && !motorista.telefone2_erro) {
            updateData.telefone2_erro = true;
            updateData.telefone2_erro_data = erroInfo.created_at;
            updateData.telefone2_erro_motivo = motivoDetalhado;
            console.log(`✅ Marcando telefone2 com erro: ${motorista.nome} (${motorista.telefone2}) - ${motivoDetalhado}`);
          }

          // Inativar se ambos os telefones tiverem erro
          if (updateData.telefone1_erro && updateData.telefone2_erro) {
            updateData.status = 'inativo';
          } else if (updateData.telefone1_erro && motorista.telefone2_erro) {
            updateData.status = 'inativo';
          } else if (updateData.telefone2_erro && motorista.telefone1_erro) {
            updateData.status = 'inativo';
          }

          if (Object.keys(updateData).length > 0) {
            const { error: updateError } = await supabaseAdmin
              .from('motoristas')
              .update(updateData)
              .eq('id', motorista.id);
            
            if (updateError) {
              console.error(`❌ Erro ao atualizar motorista ${motorista.id}:`, updateError);
            } else {
              atualizados++;
            }
          }
        }
      } catch (error) {
        console.error(`❌ Erro ao processar número ${numeroNormalizado}:`, error);
      }
    }

    console.log(`✅ Sincronização concluída: ${atualizados} motoristas atualizados, ${naoEncontrados} números não encontrados`);

    res.json({
      success: true,
      message: 'Sincronização concluída',
      processados: errosPorNumero.size,
      atualizados: atualizados,
      naoEncontrados: naoEncontrados
    });
  } catch (error) {
    console.error('❌ Erro ao sincronizar erros de disparos:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno ao sincronizar erros'
    });
  }
});

// ========== API PARA MARCAR TELEFONE COM ERRO DE DISPARO ==========
app.post('/api/motoristas/marcar-telefone-erro', express.json(), async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { motoristaId, telefone, motivo } = req.body;

    if (!motoristaId || !telefone) {
      return res.status(400).json({
        success: false,
        error: 'motoristaId e telefone são obrigatórios'
      });
    }

    // Verificar qual telefone foi usado (telefone1 ou telefone2)
    const { data: motorista } = await supabaseAdmin
      .from('motoristas')
      .select('telefone1, telefone2, telefone1_erro, telefone2_erro, status')
      .eq('id', motoristaId)
      .single();

    if (!motorista) {
      return res.status(404).json({
        success: false,
        error: 'Motorista não encontrado'
      });
    }

    const isTelefone1 = motorista.telefone1 === telefone || motorista.telefone1?.replace(/\D/g, '') === telefone.replace(/\D/g, '');
    const isTelefone2 = motorista.telefone2 === telefone || motorista.telefone2?.replace(/\D/g, '') === telefone.replace(/\D/g, '');

    if (!isTelefone1 && !isTelefone2) {
      return res.status(400).json({
        success: false,
        error: 'Telefone não corresponde ao motorista'
      });
    }

    const updateData = {};
    if (isTelefone1) {
      updateData.telefone1_erro = true;
      updateData.telefone1_erro_data = new Date().toISOString();
      updateData.telefone1_erro_motivo = motivo || 'Erro ao enviar mensagem';
    }
    if (isTelefone2) {
      updateData.telefone2_erro = true;
      updateData.telefone2_erro_data = new Date().toISOString();
      updateData.telefone2_erro_motivo = motivo || 'Erro ao enviar mensagem';
    }

    // Inativar automaticamente o motorista quando qualquer telefone tiver erro
    // Se o motorista ainda estiver ativo, inativa automaticamente
    if (motorista.status !== 'inativo') {
      updateData.status = 'inativo';
    }

    const { error: updateError } = await supabaseAdmin
      .from('motoristas')
      .update(updateData)
      .eq('id', motoristaId);

    if (updateError) {
      console.error('❌ Erro ao marcar telefone com erro:', updateError);
      return res.status(500).json({
        success: false,
        error: `Erro ao atualizar motorista: ${updateError.message}`
      });
    }

    console.log(`✅ Telefone ${isTelefone1 ? '1' : '2'} marcado com erro para motorista ${motoristaId}`);

    res.json({
      success: true,
      message: 'Telefone marcado com erro',
      telefone: isTelefone1 ? 'telefone1' : 'telefone2',
      motoristaInativado: updateData.status === 'inativo'
    });
  } catch (error) {
    console.error('❌ Erro ao marcar telefone com erro:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno ao marcar telefone com erro'
    });
  }
});

// ========== API PARA INATIVAR TODOS OS CONTATOS COM ERRO ==========
app.post('/api/motoristas/inativar-com-erro', express.json(), async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    const userId = userResult?.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    // Buscar todos os motoristas que têm erro em qualquer telefone e ainda estão ativos
    const { data: motoristasComErro, error: selectError } = await supabaseAdmin
      .from('motoristas')
      .select('id, nome, telefone1_erro, telefone2_erro, status')
      .or('telefone1_erro.eq.true,telefone2_erro.eq.true')
      .neq('status', 'inativo');

    if (selectError) {
      console.error('❌ Erro ao buscar motoristas com erro:', selectError);
      return res.status(500).json({
        success: false,
        error: `Erro ao buscar motoristas: ${selectError.message}`
      });
    }

    if (!motoristasComErro || motoristasComErro.length === 0) {
      return res.json({
        success: true,
        message: 'Nenhum contato ativo com erro encontrado',
        totalInativados: 0
      });
    }

    // Inativar todos os motoristas encontrados
    const idsParaInativar = motoristasComErro.map(m => m.id);
    const { error: updateError } = await supabaseAdmin
      .from('motoristas')
      .update({ status: 'inativo' })
      .in('id', idsParaInativar);

    if (updateError) {
      console.error('❌ Erro ao inativar motoristas:', updateError);
      return res.status(500).json({
        success: false,
        error: `Erro ao inativar motoristas: ${updateError.message}`
      });
    }

    console.log(`✅ ${motoristasComErro.length} contato(s) inativado(s) automaticamente por terem erro`);

    res.json({
      success: true,
      message: `${motoristasComErro.length} contato(s) inativado(s) com sucesso`,
      totalInativados: motoristasComErro.length,
      detalhes: motoristasComErro.map(m => ({
        id: m.id,
        nome: m.nome,
        telefone1_erro: m.telefone1_erro,
        telefone2_erro: m.telefone2_erro
      }))
    });
  } catch (error) {
    console.error('❌ Erro ao inativar contatos com erro:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno ao inativar contatos com erro'
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

    // Buscar motorista atual para obter histórico existente
    const { data: motoristaAtual, error: errorBuscar } = await supabaseAdmin
      .from('motoristas')
      .select('id, quantidade_reprovacoes, historico_reprovacoes')
      .eq('id', motoristaId)
      .single();

    if (errorBuscar) {
      console.error('❌ Erro ao buscar motorista:', errorBuscar);
      return res.status(500).json({
        success: false,
        error: `Erro ao buscar motorista: ${errorBuscar.message}`
      });
    }

    // Preparar histórico de reprovações
    // Garantir que historico_reprovacoes seja um array válido
    let historicoAtual = [];
    if (motoristaAtual?.historico_reprovacoes) {
      if (Array.isArray(motoristaAtual.historico_reprovacoes)) {
        historicoAtual = motoristaAtual.historico_reprovacoes;
      } else if (typeof motoristaAtual.historico_reprovacoes === 'string') {
        try {
          const parsed = JSON.parse(motoristaAtual.historico_reprovacoes);
          historicoAtual = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          console.warn('⚠️ Erro ao parsear historico_reprovacoes:', e);
          historicoAtual = [];
        }
      }
    } else {
      // Se historico_reprovacoes é null ou undefined, inicializar como array vazio
      historicoAtual = [];
    }
    
    // Garantir que historicoAtual seja sempre um array
    if (!Array.isArray(historicoAtual)) {
      console.warn('⚠️ historicoAtual não é um array, convertendo...', { tipo: typeof historicoAtual, valor: historicoAtual });
      historicoAtual = [];
    }
    
    const quantidadeAtual = parseInt(motoristaAtual?.quantidade_reprovacoes) || 0;
    
    console.log('📊 Estado atual do motorista antes da reprovação:', {
      id: motoristaAtual?.id,
      nome: motoristaAtual?.nome,
      reprovado_atual: motoristaAtual?.reprovado,
      quantidade_atual: quantidadeAtual,
      historico_length: historicoAtual.length,
      historico_tipo: typeof historicoAtual,
      historico_isArray: Array.isArray(historicoAtual)
    });
    
    // Adicionar nova reprovação ao histórico
    const novaReprovacao = {
      coleta_id: coletaId,
      motivo: motivo,
      reprovado_por: usuarioNome || 'Sistema',
      data_reprovacao: new Date().toISOString()
    };
    
    const novoHistorico = [...historicoAtual, novaReprovacao];
    const novaQuantidade = quantidadeAtual + 1;
    
    console.log('📊 Histórico de reprovações:', {
      historicoAtual_length: historicoAtual.length,
      novaQuantidade: novaQuantidade,
      novoHistorico_length: novoHistorico.length
    });

    // Atualizar motorista com reprovação usando service key (ignora RLS)
    // Garantir que historico_reprovacoes seja um array JSON válido para JSONB
    // IMPORTANTE: Garantir que reprovado seja boolean true, não string
    const updateData = {
      reprovado: true, // Boolean true, não string
      motivo_reprovacao: motivo, // Mantém o último motivo para compatibilidade
      reprovado_por: usuarioNome || 'Sistema', // Mantém o último reprovador para compatibilidade
      data_reprovacao: new Date().toISOString(), // Mantém a última data para compatibilidade
      coleta_id_reprovacao: coletaId, // Mantém a última coleta para compatibilidade
      quantidade_reprovacoes: novaQuantidade, // Novo campo: contador de reprovações
      historico_reprovacoes: Array.isArray(novoHistorico) ? novoHistorico : [] // Garantir que seja array
    };
    
    // Validar que o histórico é um array válido antes de salvar
    if (!Array.isArray(updateData.historico_reprovacoes)) {
      console.error('❌ Erro: historico_reprovacoes não é um array válido:', updateData.historico_reprovacoes);
      updateData.historico_reprovacoes = [];
    }
    
    // Garantir que reprovado seja boolean true
    if (updateData.reprovado !== true) {
      console.warn('⚠️ Ajustando reprovado para boolean true');
      updateData.reprovado = true;
    }

    console.log('📝 Dados a serem atualizados:', JSON.stringify(updateData, null, 2));
    console.log('📝 Tipo de historico_reprovacoes:', typeof updateData.historico_reprovacoes, Array.isArray(updateData.historico_reprovacoes));

    const { data: dataMotorista, error: errorMotorista } = await supabaseAdmin
      .from('motoristas')
      .update(updateData)
      .eq('id', motoristaId)
      .select('*'); // Selecionar todos os campos para verificar se foi atualizado

    if (errorMotorista) {
      console.error('❌ Erro ao atualizar motorista:', errorMotorista);
      console.error('❌ Detalhes do erro:', JSON.stringify(errorMotorista, null, 2));
      return res.status(500).json({
        success: false,
        error: `Erro ao atualizar motorista: ${errorMotorista.message}`,
        details: errorMotorista
      });
    }

    if (!dataMotorista || dataMotorista.length === 0) {
      console.error('❌ Nenhum registro atualizado - motorista não encontrado ou sem permissão');
      return res.status(404).json({
        success: false,
        error: 'Motorista não encontrado ou não foi possível atualizar'
      });
    }

    // Verificar se os dados foram realmente salvos
    const motoristaAtualizado = dataMotorista[0];
    const reprovadoSalvo = motoristaAtualizado?.reprovado;
    const quantidadeSalva = motoristaAtualizado?.quantidade_reprovacoes;
    const historicoSalvo = motoristaAtualizado?.historico_reprovacoes;
    
    console.log('✅ Motorista atualizado com sucesso:', {
      id: motoristaAtualizado?.id,
      nome: motoristaAtualizado?.nome,
      reprovado: reprovadoSalvo,
      reprovado_tipo: typeof reprovadoSalvo,
      quantidade_reprovacoes: quantidadeSalva,
      historico_length: Array.isArray(historicoSalvo) ? historicoSalvo.length : 'N/A',
      historico_tipo: typeof historicoSalvo,
      motivo_reprovacao: motoristaAtualizado?.motivo_reprovacao
    });
    
    // Verificar se a atualização foi bem-sucedida
    if (reprovadoSalvo !== true && reprovadoSalvo !== 'true' && reprovadoSalvo !== 1) {
      console.warn('⚠️ ATENÇÃO: Campo reprovado não foi salvo como true:', { 
        valor: reprovadoSalvo, 
        tipo: typeof reprovadoSalvo 
      });
      
      // Tentar atualizar novamente apenas o campo reprovado
      console.log('🔄 Tentando atualizar campo reprovado novamente...');
      const { error: retryError } = await supabaseAdmin
        .from('motoristas')
        .update({ reprovado: true })
        .eq('id', motoristaId);
      
      if (retryError) {
        console.error('❌ Erro ao tentar atualizar reprovado novamente:', retryError);
      } else {
        console.log('✅ Campo reprovado atualizado com sucesso na segunda tentativa');
      }
    }
    if (quantidadeSalva !== novaQuantidade) {
      console.warn('⚠️ ATENÇÃO: quantidade_reprovacoes não corresponde:', { esperado: novaQuantidade, salvo: quantidadeSalva });
    }
    if (!Array.isArray(historicoSalvo) || historicoSalvo.length !== novoHistorico.length) {
      console.warn('⚠️ ATENÇÃO: historico_reprovacoes não foi salvo corretamente:', { 
        esperado_length: novoHistorico.length, 
        salvo_length: Array.isArray(historicoSalvo) ? historicoSalvo.length : 'N/A',
        tipo: typeof historicoSalvo
      });
    }
    
    // Buscar novamente para confirmar que foi salvo
    const { data: motoristaVerificado, error: errorVerificacao } = await supabaseAdmin
      .from('motoristas')
      .select('id, reprovado, quantidade_reprovacoes')
      .eq('id', motoristaId)
      .single();
    
    if (!errorVerificacao && motoristaVerificado) {
      console.log('✅ Verificação final do motorista:', {
        reprovado: motoristaVerificado.reprovado,
        reprovado_tipo: typeof motoristaVerificado.reprovado,
        quantidade_reprovacoes: motoristaVerificado.quantidade_reprovacoes
      });
    }

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

// ========== ENDPOINT PARA LISTAR USUÁRIOS PARA SETTINGS ==========
app.get('/api/settings/usuarios', async (req, res) => {
  try {
    // Verificar autenticação e se é admin
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

    const isAdmin = userProfile?.role === 'admin' || user.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Acesso negado. Apenas administradores podem acessar.' });
    }

    console.log('📋 Buscando usuários para Settings (admin:', user.email, ')');

    // Buscar todos os usuários usando admin (contorna RLS)
    const { data: usuarios, error: usuariosError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .order('nome');

    if (usuariosError) {
      console.error('❌ Erro ao buscar usuários:', usuariosError);
      throw usuariosError;
    }

    // Buscar IDs de motoristas na tabela motoristas
    const { data: motoristas, error: motoristasError } = await supabaseAdmin
      .from('motoristas')
      .select('auth_user_id')
      .not('auth_user_id', 'is', null);

    if (motoristasError) {
      console.warn('⚠️ Erro ao buscar motoristas:', motoristasError);
    }

    // Criar Set com IDs de motoristas para busca rápida
    const motoristaIds = new Set();
    if (motoristas && motoristas.length > 0) {
      motoristas.forEach(m => {
        if (m.auth_user_id) {
          motoristaIds.add(m.auth_user_id);
        }
      });
    }

    // Filtrar apenas usuários administrativos (excluir motoristas)
    const usuariosAdministrativos = (usuarios || []).filter(usuario => {
      // Excluir se for um motorista
      if (motoristaIds.has(usuario.id)) {
        return false;
      }
      return true;
    });

    console.log(`✅ ${usuariosAdministrativos.length} usuário(s) administrativo(s) encontrado(s) (${(usuarios || []).length - usuariosAdministrativos.length} motorista(s) excluído(s))`);

    res.json({
      success: true,
      usuarios: usuariosAdministrativos,
      total: usuariosAdministrativos.length,
      motoristasExcluidos: (usuarios || []).length - usuariosAdministrativos.length
    });
  } catch (error) {
    console.error('❌ Erro ao buscar usuários para Settings:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Erro ao buscar usuários' 
    });
  }
});

// ========== ENDPOINT PARA BUSCAR PERMISSÕES DE USUÁRIO ==========
app.get('/api/settings/permissoes/:usuarioId', async (req, res) => {
  try {
    // Verificar autenticação e se é admin
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

    const isAdmin = userProfile?.role === 'admin' || user.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Acesso negado. Apenas administradores podem acessar.' });
    }

    const { usuarioId } = req.params;
    if (!usuarioId) {
      return res.status(400).json({ success: false, error: 'ID do usuário é obrigatório' });
    }

    console.log('📋 Buscando permissões para usuário:', usuarioId);

    // Buscar permissões do portal usando admin (contorna RLS)
    const { data: permissoesPortal, error: errorPortal } = await supabaseAdmin
      .from('permissoes_portal')
      .select('tipo, permissao_id')
      .eq('usuario_id', usuarioId);

    if (errorPortal) {
      console.error('❌ Erro ao buscar permissões do portal:', errorPortal);
      throw errorPortal;
    }

    // Buscar permissões de coletas usando admin (contorna RLS)
    const { data: permissoesColetas, error: errorColetas } = await supabaseAdmin
      .from('permissoes_coletas')
      .select('etapa_id')
      .eq('usuario_id', usuarioId);

    if (errorColetas) {
      console.error('❌ Erro ao buscar permissões de coletas:', errorColetas);
      throw errorColetas;
    }

    // Buscar permissões de ITs usando admin (contorna RLS)
    // Permissões de ITs são armazenadas na tabela permissoes_portal com permissao_id começando com 'its_'
    const { data: permissoesITs, error: errorITs } = await supabaseAdmin
      .from('permissoes_portal')
      .select('permissao_id')
      .eq('usuario_id', usuarioId)
      .like('permissao_id', 'its_%');

    if (errorITs) {
      console.error('❌ Erro ao buscar permissões de ITs:', errorITs);
      throw errorITs;
    }

    console.log(`✅ Permissões encontradas: ${(permissoesPortal || []).length} portal, ${(permissoesColetas || []).length} coletas, ${(permissoesITs || []).length} ITs`);

    res.json({
      success: true,
      permissoesPortal: permissoesPortal || [],
      permissoesColetas: permissoesColetas || [],
      permissoesITs: permissoesITs || []
    });
  } catch (error) {
    console.error('❌ Erro ao buscar permissões:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Erro ao buscar permissões' 
    });
  }
});

// ========== ENDPOINT PARA SALVAR/REMOVER PERMISSÃO DO PORTAL ==========
app.post('/api/settings/permissoes/portal', async (req, res) => {
  try {
    // Verificar autenticação e se é admin
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

    const isAdmin = userProfile?.role === 'admin' || user.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Acesso negado. Apenas administradores podem alterar permissões.' });
    }

    const { usuarioId, permissaoId, permitido } = req.body;
    
    if (!usuarioId || !permissaoId || permitido === undefined) {
      return res.status(400).json({ success: false, error: 'Dados inválidos. usuarioId, permissaoId e permitido são obrigatórios.' });
    }

    console.log(`💾 ${permitido ? 'Concedendo' : 'Removendo'} permissão do portal ${permissaoId} para usuário ${usuarioId}`);

    if (permitido) {
      // Verificar se a permissão já existe
      const { data: existing, error: checkError } = await supabaseAdmin
        .from('permissoes_portal')
        .select('id')
        .eq('usuario_id', usuarioId)
        .eq('permissao_id', permissaoId)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
      }

      // Se não existe, inserir
      if (!existing) {
        const { data, error } = await supabaseAdmin
          .from('permissoes_portal')
          .insert([{
            usuario_id: usuarioId,
            tipo: 'permissao',
            permissao_id: permissaoId
          }]);

        if (error) throw error;
        console.log('✅ Permissão do portal inserida com sucesso');
        res.json({ success: true, message: 'Permissão concedida com sucesso', data });
      } else {
        console.log('⚠️ Permissão do portal já existe');
        res.json({ success: true, message: 'Permissão já existe', data: existing });
      }
    } else {
      // Remover permissão
      const { error } = await supabaseAdmin
        .from('permissoes_portal')
        .delete()
        .eq('usuario_id', usuarioId)
        .eq('permissao_id', permissaoId);

      if (error) throw error;
      console.log('✅ Permissão do portal removida com sucesso');
      res.json({ success: true, message: 'Permissão removida com sucesso' });
    }
  } catch (error) {
    console.error('❌ Erro ao salvar permissão do portal:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Erro ao salvar permissão do portal' 
    });
  }
});

// ========== ENDPOINT PARA SALVAR/REMOVER PERMISSÃO DE COLETA ==========
app.post('/api/settings/permissoes/coleta', async (req, res) => {
  try {
    // Verificar autenticação e se é admin
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

    const isAdmin = userProfile?.role === 'admin' || user.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Acesso negado. Apenas administradores podem alterar permissões.' });
    }

    const { usuarioId, etapaId, permitido } = req.body;
    
    if (!usuarioId || !etapaId || permitido === undefined) {
      return res.status(400).json({ success: false, error: 'Dados inválidos. usuarioId, etapaId e permitido são obrigatórios.' });
    }

    console.log(`💾 ${permitido ? 'Concedendo' : 'Removendo'} permissão de coleta ${etapaId} para usuário ${usuarioId}`);

    if (permitido) {
      // Verificar se a permissão já existe
      const { data: existing, error: checkError } = await supabaseAdmin
        .from('permissoes_coletas')
        .select('id')
        .eq('usuario_id', usuarioId)
        .eq('etapa_id', etapaId)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
      }

      // Se não existe, inserir
      if (!existing) {
        const { data, error } = await supabaseAdmin
          .from('permissoes_coletas')
          .insert([{
            usuario_id: usuarioId,
            etapa_id: etapaId
          }]);

        if (error) throw error;
        console.log('✅ Permissão de coleta inserida com sucesso');
        res.json({ success: true, message: 'Permissão concedida com sucesso', data });
      } else {
        console.log('⚠️ Permissão de coleta já existe');
        res.json({ success: true, message: 'Permissão já existe', data: existing });
      }
    } else {
      // Remover permissão
      const { error } = await supabaseAdmin
        .from('permissoes_coletas')
        .delete()
        .eq('usuario_id', usuarioId)
        .eq('etapa_id', etapaId);

      if (error) throw error;
      console.log('✅ Permissão de coleta removida com sucesso');
      res.json({ success: true, message: 'Permissão removida com sucesso' });
    }
  } catch (error) {
    console.error('❌ Erro ao salvar permissão de coleta:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Erro ao salvar permissão de coleta' 
    });
  }
});

// ========== ENDPOINT PARA SALVAR/REMOVER PERMISSÃO DE ITs ==========
app.post('/api/settings/permissoes/its', async (req, res) => {
  try {
    // Verificar autenticação e se é admin
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

    const isAdmin = userProfile?.role === 'admin' || user.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Acesso negado. Apenas administradores podem alterar permissões.' });
    }

    const { usuarioId, permissaoId, permitido } = req.body;
    
    if (!usuarioId || !permissaoId || permitido === undefined) {
      return res.status(400).json({ success: false, error: 'Dados inválidos. usuarioId, permissaoId e permitido são obrigatórios.' });
    }

    // Validar que a permissão é de ITs
    if (!permissaoId.startsWith('its_')) {
      return res.status(400).json({ success: false, error: 'Permissão inválida. Deve começar com "its_".' });
    }

    console.log(`💾 ${permitido ? 'Concedendo' : 'Removendo'} permissão de IT ${permissaoId} para usuário ${usuarioId}`);

    if (permitido) {
      // Verificar se a permissão já existe
      const { data: existing, error: checkError } = await supabaseAdmin
        .from('permissoes_portal')
        .select('id')
        .eq('usuario_id', usuarioId)
        .eq('permissao_id', permissaoId)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
      }

      // Se não existe, inserir
      if (!existing) {
        const { data, error } = await supabaseAdmin
          .from('permissoes_portal')
          .insert([{
            usuario_id: usuarioId,
            tipo: 'permissao',
            permissao_id: permissaoId
          }]);

        if (error) throw error;
        console.log('✅ Permissão de IT inserida com sucesso');
        res.json({ success: true, message: 'Permissão concedida com sucesso', data });
      } else {
        console.log('⚠️ Permissão de IT já existe');
        res.json({ success: true, message: 'Permissão já existe', data: existing });
      }
    } else {
      // Remover permissão
      const { error } = await supabaseAdmin
        .from('permissoes_portal')
        .delete()
        .eq('usuario_id', usuarioId)
        .eq('permissao_id', permissaoId);

      if (error) throw error;
      console.log('✅ Permissão de IT removida com sucesso');
      res.json({ success: true, message: 'Permissão removida com sucesso' });
    }
  } catch (error) {
    console.error('❌ Erro ao salvar permissão de IT:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Erro ao salvar permissão de IT' 
    });
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
    // Verificar tanto por tipo quanto por permissao_id para garantir compatibilidade
    const { data: permissoes } = await supabaseAdmin
      .from('permissoes_portal')
      .select('permissao_id, tipo')
      .eq('usuario_id', userId)
      .or('tipo.eq.qualidade,permissao_id.eq.qualidade');

    const temPermissao = isAdmin || (permissoes && permissoes.length > 0);

    if (!temPermissao) {
      console.log('❌ Usuário sem permissão de qualidade:', {
        userId,
        isAdmin,
        permissoes: permissoes || []
      });
      return res.status(403).json({ 
        success: false, 
        error: 'Você não tem permissão para visualizar o painel de qualidade' 
      });
    }

    const { id } = req.params;

    // Buscar ferramenta - SEM restrição de criador, qualquer usuário com permissão pode ver
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
        // Normalizar campos: aceitar 'acao' ou 'descricao', 'responsavel_id' ou 'responsavel'
        const acaoTexto = acao.acao || acao.descricao || '';
        const responsavelId = acao.responsavel_id || acao.responsavel;
        
        // Usar finalizacao como prazo (ou prazo se existir)
        const prazoData = acao.prazo || acao.finalizacao;
        if (prazoData && responsavelId) {
          temPrazos = true;
          const prazoDate = new Date(prazoData);
          prazoDate.setHours(0, 0, 0, 0);

          if (!proximoVencimento || prazoDate < proximoVencimento) {
            proximoVencimento = prazoDate;
          }

          // Buscar superior do responsável
          const superior = await buscarSuperiorUsuario(responsavelId);

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
            responsavel_id: responsavelId,
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

      if (!ferramentaExistente) {
        return res.status(404).json({ success: false, error: 'Ferramenta não encontrada' });
      }

      // Verificar permissão: usuário pode atualizar se for o criador, admin, ou tiver permissão de qualidade
      const { data: userProfile } = await supabaseAdmin
        .from('user_profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();

      const isAdmin = userProfile?.role === 'admin';
      
      // Verificar permissão de qualidade
      const { data: permissaoQualidade } = await supabaseAdmin
        .from('permissoes_portal')
        .select('id')
        .eq('usuario_id', userId)
        .or('permissao_id.eq.qualidade,tipo.eq.qualidade')
        .maybeSingle();

      const temPermissaoQualidade = !!permissaoQualidade || isAdmin;
      const isCriador = ferramentaExistente.criado_por === userId;

      if (!isCriador && !temPermissaoQualidade) {
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

// ========== ENDPOINTS PARA AÇÕES PENDENTES DO 5W2H ==========

// POST /api/ferramentas-qualidade/acoes-pendentes - Criar ou atualizar ação pendente
app.post('/api/ferramentas-qualidade/acoes-pendentes', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    if (!userResult || !userResult.user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { ferramenta_id, ferramenta_tipo, linha_id, responsavel_id, titulo, descricao, prazo, status, dados_linha } = req.body;

    if (!ferramenta_id || !linha_id || !responsavel_id) {
      return res.status(400).json({ success: false, error: 'Dados incompletos' });
    }

    // Verificar se já existe ação pendente para esta linha
    const { data: acaoExistente } = await supabaseAdmin
      .from('ferramentas_qualidade_alertas')
      .select('*')
      .eq('ferramenta_id', ferramenta_id)
      .eq('acao_id', linha_id.toString())
      .eq('responsavel_id', responsavel_id)
      .maybeSingle();

    const dadosAcao = {
      ferramenta_id,
      ferramenta_tipo: ferramenta_tipo || '5w2h',
      acao_id: linha_id.toString(),
      responsavel_id,
      titulo: titulo || 'Ação do 5W2H',
      descricao: descricao || '',
      prazo: prazo || null,
      status: status || 'pendente',
      dados_linha: dados_linha || {},
      concluida: false,
      created_at: acaoExistente ? acaoExistente.created_at : new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (acaoExistente) {
      // Atualizar ação existente
      const { data, error } = await supabaseAdmin
        .from('ferramentas_qualidade_alertas')
        .update({
          status: dadosAcao.status,
          dados_linha: dadosAcao.dados_linha,
          updated_at: dadosAcao.updated_at
        })
        .eq('id', acaoExistente.id)
        .select()
        .single();

      if (error) throw error;
      return res.json({ success: true, acao: data });
    } else {
      // Criar nova ação
      const { data, error } = await supabaseAdmin
        .from('ferramentas_qualidade_alertas')
        .insert(dadosAcao)
        .select()
        .single();

      if (error) {
        // Se a tabela não existir, criar estrutura básica
        if (error.code === '42P01' || error.code === 'PGRST116') {
          console.warn('⚠️ Tabela ferramentas_qualidade_alertas não existe, retornando sucesso simulado');
          return res.json({ success: true, acao: dadosAcao, warning: 'Tabela não existe ainda' });
        }
        throw error;
      }
      return res.json({ success: true, acao: data });
    }
  } catch (error) {
    console.error('❌ Erro ao criar/atualizar ação pendente:', error);
    res.status(500).json({ success: false, error: 'Erro ao criar/atualizar ação pendente' });
  }
});

// GET /api/ferramentas-qualidade/acoes-pendentes - Buscar ações pendentes
app.get('/api/ferramentas-qualidade/acoes-pendentes', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    if (!userResult || !userResult.user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { responsavel_id, ferramenta_id, linha_id } = req.query;
    const userId = userResult.user.id;

    // Se responsavel_id não for fornecido, usar o ID do usuário autenticado
    const responsavelId = responsavel_id || userId;

    let query = supabaseAdmin
      .from('ferramentas_qualidade_alertas')
      .select('*')
      .eq('responsavel_id', responsavelId)
      .eq('concluida', false)
      .order('created_at', { ascending: false });

    if (ferramenta_id) {
      query = query.eq('ferramenta_id', ferramenta_id);
    }

    if (linha_id) {
      query = query.eq('acao_id', linha_id.toString());
    }

    const { data: acoes, error } = await query;

    if (error) {
      // Se a tabela não existir, retornar lista vazia
      if (error.code === '42P01' || error.code === 'PGRST116') {
        return res.json({ success: true, acoes: [] });
      }
      throw error;
    }

    res.json({ success: true, acoes: acoes || [] });
  } catch (error) {
    console.error('❌ Erro ao buscar ações pendentes:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar ações pendentes' });
  }
});

// POST /api/ferramentas-qualidade/acoes-pendentes/:id/concluir - Confirmar conclusão
app.post('/api/ferramentas-qualidade/acoes-pendentes/:id/concluir', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    if (!userResult || !userResult.user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const userId = userResult.user.id;
    const { id } = req.params;

    // Verificar se a ação pertence ao usuário
    const { data: acao, error: acaoError } = await supabaseAdmin
      .from('ferramentas_qualidade_alertas')
      .select('*')
      .eq('id', id)
      .eq('responsavel_id', userId)
      .single();

    if (acaoError || !acao) {
      return res.status(403).json({ success: false, error: 'Ação não encontrada ou você não tem permissão' });
    }

    // Marcar como concluída
    const { data: acaoAtualizada, error: updateError } = await supabaseAdmin
      .from('ferramentas_qualidade_alertas')
      .update({
        concluida: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, acao: acaoAtualizada });
  } catch (error) {
    console.error('❌ Erro ao confirmar conclusão:', error);
    res.status(500).json({ success: false, error: 'Erro ao confirmar conclusão' });
  }
});

// PUT /api/ferramentas-qualidade/acoes-pendentes - Atualizar ação pendente
app.put('/api/ferramentas-qualidade/acoes-pendentes', async (req, res) => {
  try {
    const userResult = await getUserFromRequest(req);
    if (!userResult || !userResult.user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { id, status, dados_linha } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: 'ID da ação não fornecido' });
    }

    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (status) updateData.status = status;
    if (dados_linha) updateData.dados_linha = dados_linha;

    const { data, error } = await supabaseAdmin
      .from('ferramentas_qualidade_alertas')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, acao: data });
  } catch (error) {
    console.error('❌ Erro ao atualizar ação pendente:', error);
    res.status(500).json({ success: false, error: 'Erro ao atualizar ação pendente' });
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

    // Verificar privilégios
    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    const isAdmin = userProfile?.role === 'admin';

    const { data: permissoesQualidade } = await supabaseAdmin
      .from('permissoes_portal')
      .select('permissao_id')
      .eq('usuario_id', userId)
      .eq('tipo', 'qualidade');

    const podeVerTodos = isAdmin || (permissoesQualidade && permissoesQualidade.length > 0);

    const { status, busca } = req.query;

    let query = supabaseAdmin
      .from('projetos_qualidade')
      .select('*')
      .order('criado_em', { ascending: false });

    if (!podeVerTodos) {
      query = query.eq('criado_por', userId);
    }

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

    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    const isAdmin = userProfile?.role === 'admin';

    const { data: permissoesQualidade } = await supabaseAdmin
      .from('permissoes_portal')
      .select('permissao_id')
      .eq('usuario_id', userId)
      .eq('tipo', 'qualidade');

    const podeVerTodos = isAdmin || (permissoesQualidade && permissoesQualidade.length > 0);

    // Buscar projeto
    let projetoQuery = supabaseAdmin
      .from('projetos_qualidade')
      .select('*')
      .eq('id', id);

    if (!podeVerTodos) {
      projetoQuery = projetoQuery.eq('criado_por', userId);
    }

    const { data: projeto, error: projetoError } = await projetoQuery.single();

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
    // Verificar tanto por tipo quanto por permissao_id para garantir compatibilidade
    const { data: permissoes } = await supabaseAdmin
      .from('permissoes_portal')
      .select('permissao_id, tipo')
      .eq('usuario_id', userId)
      .or('tipo.eq.qualidade,permissao_id.eq.qualidade');

    const temPermissao = isAdmin || (permissoes && permissoes.length > 0);

    if (!temPermissao) {
      console.log('❌ Usuário sem permissão de qualidade:', {
        userId,
        isAdmin,
        permissoes: permissoes || []
      });
      return res.status(403).json({ 
        success: false, 
        error: 'Você não tem permissão para visualizar o painel de qualidade' 
      });
    }

    const { id } = req.params;

    // Buscar ferramenta - SEM restrição de criador, qualquer usuário com permissão pode ver
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
// Middleware para tratar erros do Multer (upload de arquivos)
app.use((err, req, res, next) => {
  // Erros do Multer
  if (err instanceof multer.MulterError) {
    console.error('❌ Erro do Multer:', err.message);
    return res.status(400).json({
      success: false,
      error: 'Erro no upload de arquivo',
      details: err.message
    });
  }
  
  // Erros de validação de tipo de arquivo (fileFilter)
  if (err.message && (
    err.message.includes('Tipo de arquivo não permitido') ||
    err.message.includes('Extensão de arquivo não permitida') ||
    err.message.includes('Apenas arquivos')
  )) {
    console.error('❌ Erro de validação de arquivo:', err.message);
    return res.status(400).json({
      success: false,
      error: err.message,
      details: 'Verifique o tipo e formato do arquivo enviado'
    });
  }
  
  // Outros erros
  console.error('❌ Erro não tratado:', err);
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    details: process.env.DEBUG_MODE ? err.message : 'Contate o administrador'
  });
});

// ========== FAVICON ==========
app.get('/favicon.ico', (req, res) => {
  // Retornar 204 No Content para evitar erro 404
  res.status(204).end();
});

// ========== REENVIAR E-MAIL DE CONFIRMAÇÃO ==========
app.post('/api/auth/resend-confirmation', express.json(), async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'E-mail é obrigatório' 
      });
    }
    
    console.log(`📧 Processando confirmação de e-mail para: ${email}`);
    
    // Buscar o usuário pelo e-mail
    const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) {
      console.error('❌ Erro ao listar usuários:', listError);
      return res.status(500).json({ 
        success: false, 
        error: 'Erro ao buscar usuário' 
      });
    }
    
    const user = users.users.find(u => u.email === email);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'Usuário não encontrado com este e-mail' 
      });
    }
    
    // ✅ Confirmar automaticamente o e-mail
    const confirmado = await confirmarEmailAutomaticamente(user.id, email);
    
    if (confirmado) {
      console.log(`✅ E-mail confirmado automaticamente para: ${email}`);
      return res.json({ 
        success: true, 
        message: 'E-mail confirmado automaticamente. Você já pode fazer login normalmente.' 
      });
    } else {
      return res.status(500).json({ 
        success: false, 
        error: 'Não foi possível confirmar o e-mail automaticamente. Tente fazer login normalmente.' 
      });
    }
    
  } catch (err) {
    console.error('❌ Erro ao processar requisição de confirmação de e-mail:', err);
    return res.status(500).json({ 
      success: false, 
      error: err.message || 'Erro interno ao processar requisição' 
    });
  }
});

// ========== CONFIRMAR TODOS OS USUÁRIOS NÃO CONFIRMADOS ==========
app.post('/api/auth/confirmar-todos-usuarios', express.json(), async (req, res) => {
  try {
    // Verificar se é admin (opcional - pode remover se quiser permitir para todos)
    const { user, error: userError } = await getUserFromRequest(req);
    if (userError || !user) {
      // Permitir mesmo sem autenticação para facilitar
      console.log('⚠️ Requisição sem autenticação - continuando mesmo assim');
    }
    
    console.log('📧 Buscando todos os usuários não confirmados...');
    
    // Buscar todos os usuários
    let allUsers = [];
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page: page,
        perPage: 1000
      });
      
      if (listError) {
        console.error('❌ Erro ao listar usuários:', listError);
        return res.status(500).json({ 
          success: false, 
          error: 'Erro ao buscar usuários' 
        });
      }
      
      if (usersData && usersData.users && usersData.users.length > 0) {
        allUsers.push(...usersData.users);
        page++;
        hasMore = usersData.users.length === 1000;
      } else {
        hasMore = false;
      }
    }
    
    console.log(`📊 Total de usuários encontrados: ${allUsers.length}`);
    
    // Filtrar usuários não confirmados
    const usuariosNaoConfirmados = allUsers.filter(u => !u.email_confirmed_at);
    
    console.log(`📧 Usuários não confirmados: ${usuariosNaoConfirmados.length}`);
    
    if (usuariosNaoConfirmados.length === 0) {
      return res.json({ 
        success: true, 
        message: 'Todos os usuários já estão confirmados!',
        total: allUsers.length,
        confirmados: 0
      });
    }
    
    // Confirmar cada usuário
    const resultados = {
      sucesso: [],
      erros: []
    };
    
    for (const usuario of usuariosNaoConfirmados) {
      try {
        const confirmado = await confirmarEmailAutomaticamente(usuario.id, usuario.email);
        if (confirmado) {
          resultados.sucesso.push({
            id: usuario.id,
            email: usuario.email
          });
        } else {
          resultados.erros.push({
            id: usuario.id,
            email: usuario.email,
            erro: 'Falha ao confirmar'
          });
        }
      } catch (err) {
        resultados.erros.push({
          id: usuario.id,
          email: usuario.email,
          erro: err.message || 'Erro desconhecido'
        });
      }
    }
    
    console.log(`✅ Confirmação concluída: ${resultados.sucesso.length} sucesso, ${resultados.erros.length} erros`);
    
    return res.json({ 
      success: true, 
      message: `Confirmação concluída: ${resultados.sucesso.length} usuários confirmados`,
      total: allUsers.length,
      naoConfirmados: usuariosNaoConfirmados.length,
      confirmados: resultados.sucesso.length,
      erros: resultados.erros.length,
      detalhes: {
        sucesso: resultados.sucesso,
        erros: resultados.erros
      }
    });
    
  } catch (err) {
    console.error('❌ Erro ao confirmar todos os usuários:', err);
    return res.status(500).json({ 
      success: false, 
      error: err.message || 'Erro interno ao processar requisição' 
    });
  }
});

// ========== EXCLUIR USUÁRIO DO AUTH ==========
app.delete('/api/auth/excluir-usuario/:userId', express.json(), async (req, res) => {
  try {
    // Verificar autenticação
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Não autenticado' 
      });
    }

    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'ID do usuário é obrigatório' 
      });
    }
    
    console.log(`🗑️ Excluindo usuário do Auth: ${userId} (solicitado por: ${user.email || user.id})`);
    
    // Verificar se o usuário existe antes de tentar excluir
    let userExists = false;
    try {
      const { data: userData, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (!getUserError && userData && userData.user) {
        userExists = true;
        console.log(`✅ Usuário encontrado: ${userData.user.email || userId}`);
      } else {
        console.warn(`⚠️ Usuário não encontrado ou erro ao buscar: ${getUserError?.message || 'Usuário não existe'}`);
      }
    } catch (checkError) {
      console.warn('⚠️ Erro ao verificar se usuário existe:', checkError.message);
    }
    
    // IMPORTANTE: Excluir registros relacionados ANTES de excluir do Auth
    // Isso evita erros de foreign key constraints
    console.log(`🧹 Limpando registros relacionados ao usuário ${userId}...`);
    
    const tabelasParaLimpar = [
      { tabela: 'user_evolution_apis', campo: 'user_id' },
      { tabela: 'evolution_config', campo: 'usuario_id' },
      { tabela: 'permissoes_portal', campo: 'usuario_id' },
      { tabela: 'chat_mensagens', campo: 'remetente_id' },
      { tabela: 'chat_mensagens', campo: 'destinatario_id' },
      { tabela: 'projetos_qualidade', campo: 'criado_por' },
      { tabela: 'ferramentas_qualidade', campo: 'criado_por' },
      { tabela: 'motoristas', campo: 'usuario_id' },
      { tabela: 'motoristas', campo: 'created_by' },
      { tabela: 'motoristas', campo: 'auth_user_id' },
      { tabela: 'disparos_log', campo: 'user_id' }
    ];
    
    for (const { tabela, campo } of tabelasParaLimpar) {
      try {
        const { error: deleteError } = await supabaseAdmin
          .from(tabela)
          .delete()
          .eq(campo, userId);
        
        if (deleteError) {
          console.warn(`⚠️ Erro ao excluir registros de ${tabela}.${campo}:`, deleteError.message);
        } else {
          console.log(`✅ Registros relacionados em ${tabela}.${campo} limpos`);
        }
      } catch (err) {
        console.warn(`⚠️ Erro ao limpar ${tabela}.${campo}:`, err.message);
      }
    }
    
    // Excluir do user_profiles ANTES de excluir do Auth
    try {
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .delete()
        .eq('id', userId);
      
      if (profileError) {
        console.warn('⚠️ Erro ao excluir perfil do usuário (pode não existir):', profileError.message);
      } else {
        console.log(`✅ Perfil do usuário ${userId} excluído com sucesso`);
      }
    } catch (profileErr) {
      console.warn('⚠️ Erro ao tentar excluir perfil:', profileErr.message);
    }
    
    // Agora excluir usuário do Auth usando Admin API
    // O método correto do Supabase é deleteUser
    console.log(`🗑️ Excluindo usuário ${userId} do Auth...`);
    const { data, error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    
    if (error) {
      console.error('❌ Erro ao excluir usuário do Auth:', error);
      console.error('❌ Detalhes do erro:', JSON.stringify(error, null, 2));
      
      // Melhorar mensagem de erro
      let errorMessage = error.message || 'Erro ao excluir usuário do Auth';
      if (error.message && error.message.includes('Database error')) {
        errorMessage = 'Erro ao excluir usuário: pode haver registros relacionados no banco de dados. Verifique se não há foreign keys impedindo a exclusão.';
      }
      
      return res.status(500).json({ 
        success: false, 
        error: errorMessage,
        details: error.message
      });
    }
    
    console.log(`✅ Usuário ${userId} excluído do Auth com sucesso`);
    
    return res.json({ 
      success: true, 
      message: 'Usuário excluído do Auth com sucesso',
      userId: userId
    });
    
  } catch (err) {
    console.error('❌ Erro ao excluir usuário do Auth:', err);
    console.error('❌ Stack trace:', err.stack);
    return res.status(500).json({ 
      success: false, 
      error: err.message || 'Erro interno ao processar requisição',
      details: err.stack
    });
  }
});

// ========== ATUALIZAR EMAIL DO USUÁRIO NO AUTH ==========
app.put('/api/auth/atualizar-usuario/:userId', express.json(), async (req, res) => {
  try {
    const { userId } = req.params;
    const { email } = req.body;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'ID do usuário é obrigatório' 
      });
    }
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email é obrigatório' 
      });
    }
    
    console.log(`📧 Atualizando email do usuário ${userId} para ${email}`);
    
    // Atualizar email no Auth usando Admin API
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email: email
    });
    
    if (error) {
      console.error('❌ Erro ao atualizar email do usuário no Auth:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message || 'Erro ao atualizar email do usuário no Auth' 
      });
    }
    
    console.log(`✅ Email do usuário ${userId} atualizado com sucesso`);
    
    return res.json({ 
      success: true, 
      message: 'Email atualizado com sucesso',
      userId: userId,
      email: email
    });
    
  } catch (err) {
    console.error('❌ Erro ao atualizar email do usuário no Auth:', err);
    return res.status(500).json({ 
      success: false, 
      error: err.message || 'Erro interno ao processar requisição' 
    });
  }
});

// ========== ATUALIZAR SENHA DO USUÁRIO NO AUTH ==========
app.put('/api/auth/atualizar-senha/:userId', express.json(), async (req, res) => {
  try {
    const { userId } = req.params;
    const { password } = req.body;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'ID do usuário é obrigatório' 
      });
    }
    
    if (!password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Senha é obrigatória' 
      });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'A senha deve ter no mínimo 6 caracteres' 
      });
    }
    
    console.log(`🔐 Atualizando senha do usuário ${userId}`);
    
    // Atualizar senha no Auth usando Admin API
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: password
    });
    
    if (error) {
      console.error('❌ Erro ao atualizar senha do usuário no Auth:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message || 'Erro ao atualizar senha do usuário no Auth' 
      });
    }
    
    console.log(`✅ Senha do usuário ${userId} atualizada com sucesso`);
    
    return res.json({ 
      success: true, 
      message: 'Senha atualizada com sucesso',
      userId: userId
    });
    
  } catch (err) {
    console.error('❌ Erro ao atualizar senha do usuário no Auth:', err);
    return res.status(500).json({ 
      success: false, 
      error: err.message || 'Erro interno ao processar requisição' 
    });
  }
});

// ========== CONFIRMAR TODOS OS USUÁRIOS NÃO CONFIRMADOS ==========
app.post('/api/auth/confirmar-todos-usuarios', express.json(), async (req, res) => {
  try {
    // Verificar se é admin (opcional - pode remover se quiser permitir para todos)
    const { user, error: userError } = await getUserFromRequest(req);
    if (userError || !user) {
      // Permitir mesmo sem autenticação para facilitar
      console.log('⚠️ Requisição sem autenticação - continuando mesmo assim');
    }
    
    console.log('📧 Buscando todos os usuários não confirmados...');
    
    // Buscar todos os usuários
    let allUsers = [];
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page: page,
        perPage: 1000
      });
      
      if (listError) {
        console.error('❌ Erro ao listar usuários:', listError);
        return res.status(500).json({ 
          success: false, 
          error: 'Erro ao buscar usuários' 
        });
      }
      
      if (usersData && usersData.users && usersData.users.length > 0) {
        allUsers.push(...usersData.users);
        page++;
        hasMore = usersData.users.length === 1000;
      } else {
        hasMore = false;
      }
    }
    
    console.log(`📊 Total de usuários encontrados: ${allUsers.length}`);
    
    // Filtrar usuários não confirmados
    const usuariosNaoConfirmados = allUsers.filter(u => !u.email_confirmed_at);
    
    console.log(`📧 Usuários não confirmados: ${usuariosNaoConfirmados.length}`);
    
    if (usuariosNaoConfirmados.length === 0) {
      return res.json({ 
        success: true, 
        message: 'Todos os usuários já estão confirmados!',
        total: allUsers.length,
        confirmados: 0
      });
    }
    
    // Confirmar cada usuário
    const resultados = {
      sucesso: [],
      erros: []
    };
    
    for (const usuario of usuariosNaoConfirmados) {
      try {
        const confirmado = await confirmarEmailAutomaticamente(usuario.id, usuario.email);
        if (confirmado) {
          resultados.sucesso.push({
            id: usuario.id,
            email: usuario.email
          });
        } else {
          resultados.erros.push({
            id: usuario.id,
            email: usuario.email,
            erro: 'Falha ao confirmar'
          });
        }
      } catch (err) {
        resultados.erros.push({
          id: usuario.id,
          email: usuario.email,
          erro: err.message || 'Erro desconhecido'
        });
      }
    }
    
    console.log(`✅ Confirmação concluída: ${resultados.sucesso.length} sucesso, ${resultados.erros.length} erros`);
    
    return res.json({ 
      success: true, 
      message: `Confirmação concluída: ${resultados.sucesso.length} usuários confirmados`,
      total: allUsers.length,
      naoConfirmados: usuariosNaoConfirmados.length,
      confirmados: resultados.sucesso.length,
      erros: resultados.erros.length,
      detalhes: {
        sucesso: resultados.sucesso,
        erros: resultados.erros
      }
    });
    
  } catch (err) {
    console.error('❌ Erro ao confirmar todos os usuários:', err);
    return res.status(500).json({ 
      success: false, 
      error: err.message || 'Erro interno ao processar requisição' 
    });
  }
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

// ========== ENDPOINTS PARA GERENCIAR CLIENTES ==========

// Endpoint para buscar todos os clientes
app.get('/api/clientes', requireAuth, async (req, res) => {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    // Permitir filtrar apenas ativos via query parameter (padrão: todos)
    const apenasAtivos = req.query.apenasAtivos === 'true';

    let query = supabaseAdmin
      .from('clientes')
      .select('id, nome, filial, operacao, ativo, created_at, updated_at');

    if (apenasAtivos) {
      query = query.eq('ativo', true);
    }

    const { data: clientes, error } = await query.order('nome', { ascending: true });

    if (error) throw error;

    res.json({ success: true, clientes: clientes || [] });
  } catch (error) {
    console.error('❌ Erro ao buscar clientes:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar clientes' });
  }
});

// Endpoint para gerar arquivo Excel com clientes por filial
app.get('/api/clientes/exportar-excel', requireAuth, async (req, res) => {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    // Buscar todos os clientes ativos
    const { data: clientes, error } = await supabaseAdmin
      .from('clientes')
      .select('id, nome, filial, operacao, ativo, created_at')
      .eq('ativo', true)
      .order('filial', { ascending: true })
      .order('nome', { ascending: true });

    if (error) throw error;

    // Mapear operações para nomes legíveis
    const operacoesMap = {
      'operacoes_jbo': 'Operações - Jaboatão (JBO)',
      'operacoes_cabo': 'Operações - Cabo (CABO)',
      'operacoes_sp': 'Operações - São Paulo (SP)',
      'operacoes_ba': 'Operações - Simões Filho (BA)',
      'operacoes_se': 'Operações - Aracaju (SE)',
      'operacoes_al': 'Operações - Maceió (AL)',
      'operacoes_pe': 'Operações - Recife (PE)',
      'operacoes_pb': 'Operações - João Pessoa (PB)',
      'operacoes_ce': 'Operações - Fortaleza (CE)',
      'operacoes_ambev': 'Operações - Ambev (AMBEV)',
      'operacoes_us': 'Operações - Usinas (US)',
      'operacoes_paratibe': 'Operações - Paratibe (PARATIBE)',
      'qualidade': 'Qualidade',
      'price': 'Price',
      'comercial': 'Comercial',
      'rh': 'Recursos Humanos',
      'contas_pagar': 'Contas a Pagar',
      'contas_receber': 'Contas a Receber',
      'ti': 'Tecnologia da Informação',
      'seguranca': 'Segurança do Trabalho',
      'manutencao': 'Manutenção',
      'estoque': 'Estoque',
      'compras': 'Compras',
      'cs': 'CS',
      'frota': 'Frota',
      'documentacao': 'Documentação',
      'administrativo': 'Administrativo',
      'outros': 'Outros'
    };

    // Organizar clientes por filial
    const clientesPorFilial = {};
    const filiais = ['JBO', 'CABO', 'AL', 'SP', 'BA', 'CE', 'SE', 'PB', 'PE', 'AMBEV', 'US', 'PARATIBE'];

    filiais.forEach(filial => {
      clientesPorFilial[filial] = [];
    });

    (clientes || []).forEach(cliente => {
      if (!clientesPorFilial[cliente.filial]) {
        clientesPorFilial[cliente.filial] = [];
      }
      clientesPorFilial[cliente.filial].push(cliente);
    });

    // Criar workbook Excel
    const workbook = XLSX.utils.book_new();

    // Criar planilha de resumo
    const resumoData = [
      ['Filial', 'Total de Clientes'],
      ...filiais
        .filter(filial => (clientesPorFilial[filial] || []).length > 0)
        .map(filial => [filial, (clientesPorFilial[filial] || []).length])
    ];
    const resumoSheet = XLSX.utils.aoa_to_sheet(resumoData);
    XLSX.utils.book_append_sheet(workbook, resumoSheet, 'Resumo');

    // Criar uma planilha para cada filial
    filiais.forEach(filial => {
      const clientesFilial = clientesPorFilial[filial] || [];
      
      if (clientesFilial.length > 0) {
        // Preparar dados da planilha
        const sheetData = [
          ['Nome do Cliente', 'Operação', 'Data de Cadastro']
        ];

        clientesFilial.forEach(cliente => {
          const nomeOperacao = cliente.operacao 
            ? (operacoesMap[cliente.operacao] || cliente.operacao)
            : 'Sem operação específica';
          
          const dataCadastro = cliente.created_at 
            ? new Date(cliente.created_at).toLocaleDateString('pt-BR')
            : '';

          sheetData.push([
            cliente.nome,
            nomeOperacao,
            dataCadastro
          ]);
        });

        // Criar planilha
        const sheet = XLSX.utils.aoa_to_sheet(sheetData);
        
        // Ajustar largura das colunas
        sheet['!cols'] = [
          { wch: 40 }, // Nome do Cliente
          { wch: 35 }, // Operação
          { wch: 15 }  // Data de Cadastro
        ];

        // Adicionar planilha ao workbook
        XLSX.utils.book_append_sheet(workbook, sheet, filial);
      }
    });

    // Gerar buffer do arquivo Excel
    const excelBuffer = XLSX.write(workbook, { 
      type: 'buffer', 
      bookType: 'xlsx',
      cellStyles: true
    });

    // Retornar como arquivo para download
    const fileName = `clientes-por-filial-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(excelBuffer);

  } catch (error) {
    console.error('❌ Erro ao gerar arquivo Excel:', error);
    res.status(500).json({ success: false, error: 'Erro ao gerar arquivo Excel' });
  }
});

// Endpoint para baixar modelo CSV de clientes
app.get('/api/clientes/modelo-csv', requireAuth, async (req, res) => {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    // Definir todas as filiais e operações
    const filiais = ['JBO', 'CABO', 'AL', 'SP', 'BA', 'CE', 'SE', 'PB', 'PE', 'AMBEV', 'US', 'PARATIBE'];
    
    const operacoesPorFilial = {
      'JBO': ['operacoes_jbo', 'qualidade', 'price', 'comercial', 'rh', 'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque', 'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'],
      'CABO': ['operacoes_cabo', 'qualidade', 'price', 'comercial', 'rh', 'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque', 'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'],
      'AL': ['operacoes_al', 'qualidade', 'price', 'comercial', 'rh', 'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque', 'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'],
      'SP': ['operacoes_sp', 'qualidade', 'price', 'comercial', 'rh', 'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque', 'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'],
      'BA': ['operacoes_ba', 'qualidade', 'price', 'comercial', 'rh', 'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque', 'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'],
      'CE': ['operacoes_ce', 'qualidade', 'price', 'comercial', 'rh', 'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque', 'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'],
      'SE': ['operacoes_se', 'qualidade', 'price', 'comercial', 'rh', 'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque', 'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'],
      'PB': ['operacoes_pb', 'qualidade', 'price', 'comercial', 'rh', 'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque', 'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'],
      'PE': ['operacoes_pe', 'qualidade', 'price', 'comercial', 'rh', 'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque', 'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'],
      'AMBEV': ['operacoes_ambev', 'qualidade', 'price', 'comercial', 'rh', 'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque', 'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'],
      'US': ['operacoes_us', 'qualidade', 'price', 'comercial', 'rh', 'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque', 'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'],
      'PARATIBE': ['operacoes_paratibe', 'qualidade', 'price', 'comercial', 'rh', 'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque', 'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros']
    };

    // Criar linhas do CSV
    const linhas = ['Nome,Filial,Operacao'];
    
    filiais.forEach(filial => {
      const operacoes = operacoesPorFilial[filial] || [];
      
      operacoes.forEach((operacao, index) => {
        // Criar nome de exemplo baseado na filial e operação
        const nomeExemplo = `CLIENTE EXEMPLO ${filial} - ${operacao.replace('operacoes_', '').replace('_', ' ').toUpperCase()}`;
        linhas.push(`${nomeExemplo},${filial},${operacao}`);
      });
      
      // Adicionar um exemplo sem operação para cada filial
      linhas.push(`CLIENTE EXEMPLO ${filial} - SEM OPERAÇÃO,${filial},`);
    });

    const csvContent = linhas.join('\n');

    // Retornar como arquivo para download
    const fileName = `modelo-importacao-clientes-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send('\ufeff' + csvContent); // BOM para Excel reconhecer UTF-8

  } catch (error) {
    console.error('❌ Erro ao gerar modelo CSV:', error);
    res.status(500).json({ success: false, error: 'Erro ao gerar modelo CSV' });
  }
});

// Endpoint para importar clientes via CSV
app.post('/api/clientes/importar-csv', requireAuth, upload.single('csv'), async (req, res) => {
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

    const isAdmin = userProfile?.role === 'admin' || user.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Apenas administradores podem importar clientes' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Nenhum arquivo CSV enviado' });
    }

    // Ler e processar CSV
    const csvContent = req.file.buffer.toString('utf8').replace(/^\ufeff/, ''); // Remover BOM se existir
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      return res.status(400).json({ success: false, error: 'Arquivo CSV vazio' });
    }

    // Verificar se tem cabeçalho
    const header = lines[0].toLowerCase();
    const hasHeader = header.includes('nome') && (header.includes('filial') || header.includes('filial'));
    const startLine = hasHeader ? 1 : 0;

    if (lines.length <= startLine) {
      return res.status(400).json({ success: false, error: 'Nenhum dado encontrado no CSV' });
    }

    // Mapear operações
    const operacoesValidas = [
      'operacoes_jbo', 'operacoes_cabo', 'operacoes_sp', 'operacoes_ba', 'operacoes_se',
      'operacoes_al', 'operacoes_pe', 'operacoes_pb', 'operacoes_ce', 'operacoes_ambev',
      'operacoes_us', 'operacoes_paratibe', 'qualidade', 'price', 'comercial', 'rh',
      'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque',
      'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'
    ];

    const filiaisValidas = ['JBO', 'CABO', 'AL', 'SP', 'BA', 'CE', 'SE', 'PB', 'PE', 'AMBEV', 'US', 'PARATIBE'];

    let sucessos = 0;
    let falhas = 0;
    const detalhesFalhas = [];
    const detalhesSucessos = [];

    // Processar cada linha
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        // Parse CSV (simples - pode melhorar com biblioteca)
        const columns = line.split(',').map(col => col.trim().replace(/^"|"$/g, ''));
        
        if (columns.length < 2) {
          falhas++;
          detalhesFalhas.push(`Linha ${i + 1}: Formato inválido (esperado: Nome, Filial, Operação)`);
          continue;
        }

        const nome = columns[0] || '';
        const filial = columns[1] || '';
        const operacao = columns[2] || '';

        // Validações
        if (!nome || nome.length < 2 || nome.length > 200) {
          falhas++;
          detalhesFalhas.push(`Linha ${i + 1}: Nome inválido (${nome})`);
          continue;
        }

        if (!filial || !filiaisValidas.includes(filial)) {
          falhas++;
          detalhesFalhas.push(`Linha ${i + 1}: Filial inválida (${filial})`);
          continue;
        }

        if (operacao && !operacoesValidas.includes(operacao)) {
          falhas++;
          detalhesFalhas.push(`Linha ${i + 1}: Operação inválida (${operacao})`);
          continue;
        }

        // Verificar se cliente já existe
        const { data: clienteExistente, error: checkError } = await supabaseAdmin
          .from('clientes')
          .select('id, nome, filial')
          .eq('nome', nome.trim())
          .eq('filial', filial)
          .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
          throw checkError;
        }

        if (clienteExistente) {
          // Atualizar se existir
          const { error: updateError } = await supabaseAdmin
            .from('clientes')
            .update({
              operacao: operacao && operacao.trim() !== '' ? operacao.trim() : null,
              ativo: true,
              updated_at: new Date().toISOString()
            })
            .eq('id', clienteExistente.id);

          if (updateError) throw updateError;
          sucessos++;
          detalhesSucessos.push(`${nome} (${filial}) - Atualizado`);
        } else {
          // Inserir novo
          const { error: insertError } = await supabaseAdmin
            .from('clientes')
            .insert({
              nome: nome.trim(),
              filial: filial,
              operacao: operacao && operacao.trim() !== '' ? operacao.trim() : null,
              ativo: true
            });

          if (insertError) throw insertError;
          sucessos++;
          detalhesSucessos.push(`${nome} (${filial}) - Criado`);
        }

      } catch (error) {
        falhas++;
        detalhesFalhas.push(`Linha ${i + 1}: ${error.message || 'Erro desconhecido'}`);
      }
    }

    res.json({
      success: true,
      total: lines.length - startLine,
      sucessos,
      falhas,
      detalhesSucessos: detalhesSucessos.slice(0, 10), // Limitar para não sobrecarregar
      detalhesFalhas: detalhesFalhas.slice(0, 10),
      mensagem: `Importação concluída: ${sucessos} sucesso(s), ${falhas} falha(s)`
    });

  } catch (error) {
    console.error('❌ Erro ao importar CSV:', error);
    res.status(500).json({ success: false, error: 'Erro ao importar CSV: ' + error.message });
  }
});

// Endpoint para buscar clientes por filial
app.get('/api/clientes/filial/:filial', async (req, res) => {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { filial } = req.params;

    const { data: clientes, error } = await supabaseAdmin
      .from('clientes')
      .select('id, nome, filial, operacao, ativo')
      .eq('filial', filial)
      .eq('ativo', true)
      .order('nome', { ascending: true });

    if (error) throw error;

    res.json({ success: true, clientes: clientes || [] });
  } catch (error) {
    console.error('❌ Erro ao buscar clientes por filial:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar clientes' });
  }
});

// Endpoint para sincronizar clientes do coletas.html para o banco
app.post('/api/clientes/sincronizar', async (req, res) => {
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

    const isAdmin = userProfile?.role === 'admin' || user.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Apenas administradores podem sincronizar clientes' });
    }

    const { clientesPorFilial } = req.body;

    if (!clientesPorFilial || typeof clientesPorFilial !== 'object') {
      return res.status(400).json({ success: false, error: 'Dados de clientes inválidos' });
    }

    let totalInseridos = 0;
    let totalAtualizados = 0;
    const erros = [];

    for (const [filial, clientes] of Object.entries(clientesPorFilial)) {
      if (!Array.isArray(clientes)) continue;

      for (const nomeCliente of clientes) {
        if (!nomeCliente || typeof nomeCliente !== 'string') continue;

        try {
          // Verificar se o cliente já existe
          const { data: clienteExistente, error: checkError } = await supabaseAdmin
            .from('clientes')
            .select('id, nome, filial, ativo')
            .eq('nome', nomeCliente.trim())
            .eq('filial', filial)
            .maybeSingle();

          if (checkError && checkError.code !== 'PGRST116') {
            throw checkError;
          }

          if (clienteExistente) {
            // Atualizar se estiver inativo
            if (!clienteExistente.ativo) {
              const { error: updateError } = await supabaseAdmin
                .from('clientes')
                .update({ ativo: true, updated_at: new Date().toISOString() })
                .eq('id', clienteExistente.id);

              if (updateError) throw updateError;
              totalAtualizados++;
            }
          } else {
            // Inserir novo cliente
            const { error: insertError } = await supabaseAdmin
              .from('clientes')
              .insert({
                nome: nomeCliente.trim(),
                filial: filial,
                ativo: true
              });

            if (insertError) throw insertError;
            totalInseridos++;
          }
        } catch (error) {
          erros.push({ cliente: nomeCliente, filial, error: error.message });
          console.error(`❌ Erro ao processar cliente ${nomeCliente} (${filial}):`, error);
        }
      }
    }

    res.json({
      success: true,
      message: 'Sincronização concluída',
      totalInseridos,
      totalAtualizados,
      erros: erros.length > 0 ? erros : undefined
    });
  } catch (error) {
    console.error('❌ Erro ao sincronizar clientes:', error);
    res.status(500).json({ success: false, error: 'Erro ao sincronizar clientes' });
  }
});

// Endpoint para criar novo cliente (apenas admins)
app.post('/api/clientes', async (req, res) => {
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

    const isAdmin = userProfile?.role === 'admin' || user.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Apenas administradores podem criar clientes' });
    }

    const { nome, filial, operacao, ativo = true } = req.body;

    // Validações
    if (!nome || typeof nome !== 'string' || nome.trim().length < 2 || nome.trim().length > 200) {
      return res.status(400).json({ success: false, error: 'Nome do cliente deve ter entre 2 e 200 caracteres' });
    }

    const filiaisValidas = ['JBO', 'CABO', 'AL', 'SP', 'BA', 'CE', 'SE', 'PB', 'PE', 'AMBEV', 'US', 'PARATIBE'];
    if (!filial || !filiaisValidas.includes(filial)) {
      return res.status(400).json({ success: false, error: 'Filial inválida' });
    }

    // Validar operação se fornecida (opcional)
    const operacoesValidas = [
      'operacoes_jbo', 'operacoes_cabo', 'operacoes_sp', 'operacoes_ba', 'operacoes_se',
      'operacoes_al', 'operacoes_pe', 'operacoes_pb', 'operacoes_ce', 'operacoes_ambev',
      'operacoes_us', 'operacoes_paratibe', 'qualidade', 'price', 'comercial', 'rh',
      'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque',
      'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'
    ];
    if (operacao && operacao.trim() !== '' && !operacoesValidas.includes(operacao)) {
      return res.status(400).json({ success: false, error: 'Operação inválida' });
    }

    // Verificar se já existe cliente com mesmo nome e filial
    const { data: clienteExistente, error: checkError } = await supabaseAdmin
      .from('clientes')
      .select('id')
      .eq('nome', nome.trim())
      .eq('filial', filial)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    if (clienteExistente) {
      return res.status(400).json({ success: false, error: 'Já existe um cliente com este nome nesta filial' });
    }

    // Criar cliente
    const { data: novoCliente, error } = await supabaseAdmin
      .from('clientes')
      .insert({
        nome: nome.trim(),
        filial,
        operacao: operacao && operacao.trim() !== '' ? operacao.trim() : null,
        ativo: ativo === true || ativo === 'true'
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, cliente: novoCliente });
  } catch (error) {
    console.error('❌ Erro ao criar cliente:', error);
    res.status(500).json({ success: false, error: 'Erro ao criar cliente' });
  }
});

// Endpoint para atualizar cliente (apenas admins)
app.put('/api/clientes/:id', async (req, res) => {
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

    const isAdmin = userProfile?.role === 'admin' || user.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Apenas administradores podem atualizar clientes' });
    }

    const { id } = req.params;
    const { nome, filial, operacao, ativo } = req.body;

    // Validações
    if (nome !== undefined) {
      if (typeof nome !== 'string' || nome.trim().length < 2 || nome.trim().length > 200) {
        return res.status(400).json({ success: false, error: 'Nome do cliente deve ter entre 2 e 200 caracteres' });
      }
    }

    if (filial !== undefined) {
      const filiaisValidas = ['JBO', 'CABO', 'AL', 'SP', 'BA', 'CE', 'SE', 'PB', 'PE', 'AMBEV', 'US', 'PARATIBE'];
      if (!filiaisValidas.includes(filial)) {
        return res.status(400).json({ success: false, error: 'Filial inválida' });
      }
    }

    // Validar operação se fornecida (opcional)
    if (operacao !== undefined) {
      const operacoesValidas = [
        'operacoes_jbo', 'operacoes_cabo', 'operacoes_sp', 'operacoes_ba', 'operacoes_se',
        'operacoes_al', 'operacoes_pe', 'operacoes_pb', 'operacoes_ce', 'operacoes_ambev',
        'operacoes_us', 'operacoes_paratibe', 'qualidade', 'price', 'comercial', 'rh',
        'contas_pagar', 'contas_receber', 'ti', 'seguranca', 'manutencao', 'estoque',
        'compras', 'cs', 'frota', 'documentacao', 'administrativo', 'outros'
      ];
      if (operacao && operacao.trim() !== '' && !operacoesValidas.includes(operacao)) {
        return res.status(400).json({ success: false, error: 'Operação inválida' });
      }
    }

    // Verificar se cliente existe
    const { data: clienteExistente, error: checkError } = await supabaseAdmin
      .from('clientes')
      .select('id, nome, filial')
      .eq('id', id)
      .maybeSingle();

    if (checkError) throw checkError;
    if (!clienteExistente) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }

    // Se nome ou filial mudaram, verificar duplicatas
    if ((nome !== undefined && nome.trim() !== clienteExistente.nome) || 
        (filial !== undefined && filial !== clienteExistente.filial)) {
      const nomeFinal = nome !== undefined ? nome.trim() : clienteExistente.nome;
      const filialFinal = filial !== undefined ? filial : clienteExistente.filial;

      const { data: duplicado, error: dupError } = await supabaseAdmin
        .from('clientes')
        .select('id')
        .eq('nome', nomeFinal)
        .eq('filial', filialFinal)
        .neq('id', id)
        .maybeSingle();

      if (dupError && dupError.code !== 'PGRST116') {
        throw dupError;
      }

      if (duplicado) {
        return res.status(400).json({ success: false, error: 'Já existe um cliente com este nome nesta filial' });
      }
    }

    // Preparar dados para atualização
    const dadosAtualizacao = {};
    if (nome !== undefined) dadosAtualizacao.nome = nome.trim();
    if (filial !== undefined) dadosAtualizacao.filial = filial;
    if (operacao !== undefined) dadosAtualizacao.operacao = operacao && operacao.trim() !== '' ? operacao.trim() : null;
    if (ativo !== undefined) dadosAtualizacao.ativo = ativo === true || ativo === 'true';

    // Atualizar cliente
    const { data: clienteAtualizado, error } = await supabaseAdmin
      .from('clientes')
      .update(dadosAtualizacao)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, cliente: clienteAtualizado });
  } catch (error) {
    console.error('❌ Erro ao atualizar cliente:', error);
    res.status(500).json({ success: false, error: 'Erro ao atualizar cliente' });
  }
});

// Endpoint para excluir cliente (apenas admins) - na verdade desativa
app.delete('/api/clientes/:id', async (req, res) => {
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

    const isAdmin = userProfile?.role === 'admin' || user.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Apenas administradores podem excluir clientes' });
    }

    const { id } = req.params;

    // Verificar se cliente existe
    const { data: clienteExistente, error: checkError } = await supabaseAdmin
      .from('clientes')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (checkError) throw checkError;
    if (!clienteExistente) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }

    // Desativar cliente (soft delete)
    const { data: clienteDesativado, error } = await supabaseAdmin
      .from('clientes')
      .update({ ativo: false })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, cliente: clienteDesativado });
  } catch (error) {
    console.error('❌ Erro ao excluir cliente:', error);
    res.status(500).json({ success: false, error: 'Erro ao excluir cliente' });
  }
});

// ========== ENDPOINTS PARA RELACIONAMENTO ITs E CLIENTES ==========

// Endpoint para vincular clientes a uma IT
app.post('/api/its/:itId/clientes', async (req, res) => {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { itId } = req.params;
    const { clienteIds } = req.body;

    if (!Array.isArray(clienteIds)) {
      return res.status(400).json({ success: false, error: 'clienteIds deve ser um array' });
    }

    // Verificar se a IT existe
    const { data: it, error: itError } = await supabaseAdmin
      .from('its_documentos')
      .select('id')
      .eq('id', itId)
      .maybeSingle();

    if (itError) throw itError;
    if (!it) {
      return res.status(404).json({ success: false, error: 'IT não encontrada' });
    }

    // Remover relacionamentos existentes
    const { error: deleteError } = await supabaseAdmin
      .from('its_clientes')
      .delete()
      .eq('it_id', itId);

    if (deleteError) throw deleteError;

    // Inserir novos relacionamentos
    if (clienteIds.length > 0) {
      const relacionamentos = clienteIds.map(clienteId => ({
        it_id: itId,
        cliente_id: clienteId
      }));

      const { error: insertError } = await supabaseAdmin
        .from('its_clientes')
        .insert(relacionamentos);

      if (insertError) throw insertError;
    }

    res.json({ success: true, message: 'Clientes vinculados com sucesso' });
  } catch (error) {
    console.error('❌ Erro ao vincular clientes à IT:', error);
    res.status(500).json({ success: false, error: 'Erro ao vincular clientes' });
  }
});

// Endpoint para buscar clientes vinculados a uma IT
app.get('/api/its/:itId/clientes', async (req, res) => {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { itId } = req.params;

    const { data: relacionamentos, error } = await supabaseAdmin
      .from('its_clientes')
      .select(`
        cliente_id,
        clientes:cliente_id (
          id,
          nome,
          filial
        )
      `)
      .eq('it_id', itId);

    if (error) throw error;

    const clientes = (relacionamentos || []).map(r => r.clientes).filter(Boolean);

    res.json({ success: true, clientes });
  } catch (error) {
    console.error('❌ Erro ao buscar clientes da IT:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar clientes' });
  }
});

// Endpoint para buscar ITs relacionadas a um cliente por nome (para uso em coletas)
app.get('/api/clientes/nome/:nomeCliente/its', async (req, res) => {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const { nomeCliente } = req.params;
    const { filial } = req.query; // Filial da coleta (opcional)

    // Decodificar o nome do cliente
    let nomeClienteDecodificado;
    try {
      nomeClienteDecodificado = decodeURIComponent(nomeCliente);
    } catch (decodeError) {
      console.error('❌ Erro ao decodificar nome do cliente:', decodeError);
      nomeClienteDecodificado = nomeCliente; // Usar o nome original se falhar
    }

    console.log(`🔍 Buscando ITs para cliente: "${nomeClienteDecodificado}"${filial ? ` (filial: ${filial})` : ''}`);

    // Buscar cliente pelo nome
    // Se houver filial, filtrar também por filial para evitar múltiplos resultados
    let cliente;
    let clienteError;
    
    let query = supabaseAdmin
      .from('clientes')
      .select('id, filial, operacao')
      .eq('nome', nomeClienteDecodificado)
      .eq('ativo', true);
    
    // Se foi informada uma filial, filtrar também por ela
    if (filial) {
      const filialNormalizada = filial.trim().toUpperCase();
      query = query.eq('filial', filialNormalizada);
    }
    
    // Usar .limit(1).maybeSingle() para pegar apenas um resultado
    const result = await query.limit(1).maybeSingle();
    cliente = result.data;
    clienteError = result.error;
    
    // Se não encontrou e não tinha filial, tentar case-insensitive sem filial
    if (!cliente && !clienteError && !filial) {
      console.log('⚠️ Cliente não encontrado com busca exata, tentando case-insensitive...');
      const queryCaseInsensitive = supabaseAdmin
        .from('clientes')
        .select('id, filial, operacao')
        .ilike('nome', nomeClienteDecodificado)
        .eq('ativo', true)
        .limit(1)
        .maybeSingle();
      
      const resultCaseInsensitive = await queryCaseInsensitive;
      cliente = resultCaseInsensitive.data;
      clienteError = resultCaseInsensitive.error;
    }
    
    // Se ainda não encontrou e havia filial, tentar sem filtrar por filial (mas avisar)
    if (!cliente && !clienteError && filial) {
      console.log(`⚠️ Cliente não encontrado com filial ${filial}, tentando sem filtro de filial...`);
      const querySemFilial = supabaseAdmin
        .from('clientes')
        .select('id, filial, operacao')
        .eq('nome', nomeClienteDecodificado)
        .eq('ativo', true)
        .limit(1)
        .maybeSingle();
      
      const resultSemFilial = await querySemFilial;
      cliente = resultSemFilial.data;
      clienteError = resultSemFilial.error;
      
      if (cliente && cliente.filial !== filial.trim().toUpperCase()) {
        console.log(`⚠️ Cliente encontrado mas com filial diferente: ${cliente.filial} vs ${filial}`);
      }
    }

    if (clienteError) {
      console.error('❌ Erro ao buscar cliente:', clienteError);
      throw clienteError;
    }

    if (!cliente) {
      console.log(`⚠️ Cliente "${nomeClienteDecodificado}" não encontrado ou inativo`);
      return res.json({ success: true, its: [] });
    }

    console.log(`✅ Cliente encontrado: ID=${cliente.id}, Filial=${cliente.filial}, Operação=${cliente.operacao || 'N/A'}`);

    // Se foi informada uma filial, verificar se corresponde à filial do cliente
    // (já filtramos por filial na busca, mas verificamos novamente como segurança)
    if (filial && cliente.filial) {
      const filialColeta = filial.trim().toUpperCase();
      const filialCliente = (cliente.filial || '').trim().toUpperCase();
      if (filialCliente && filialColeta !== filialCliente) {
        console.log(`⚠️ Filial da coleta (${filialColeta}) não corresponde à filial do cliente (${filialCliente})`);
        return res.json({ success: true, its: [] });
      }
    }

    // Buscar ITs relacionadas
    // Primeiro, buscar os IDs das ITs relacionadas
    const { data: relacionamentos, error: relacionamentosError } = await supabaseAdmin
      .from('its_clientes')
      .select('it_id')
      .eq('cliente_id', cliente.id);

    if (relacionamentosError) {
      console.error('❌ Erro ao buscar relacionamentos ITs-Clientes:', relacionamentosError);
      throw relacionamentosError;
    }

    console.log(`📋 Encontrados ${relacionamentos?.length || 0} relacionamentos IT-Cliente`);

    if (!relacionamentos || relacionamentos.length === 0) {
      return res.json({ success: true, its: [] });
    }

    // Extrair IDs das ITs
    const itIds = relacionamentos.map(r => r.it_id).filter(Boolean);

    if (itIds.length === 0) {
      return res.json({ success: true, its: [] });
    }

    // Buscar as ITs pelos IDs
    // Primeiro tentar buscar com operacao, se falhar, buscar sem operacao
    let itsData;
    let itsError;
    
    // Tentar buscar com operacao primeiro
    const queryComOperacao = supabaseAdmin
      .from('its_documentos')
      .select('id, nome, codigo_it, versao, versao_atual, area, operacao, url, nome_arquivo, created_at')
      .in('id', itIds);
    
    const resultComOperacao = await queryComOperacao;
    itsData = resultComOperacao.data;
    itsError = resultComOperacao.error;
    
    // Se der erro relacionado à coluna operacao, tentar sem ela
    if (itsError && (itsError.message?.includes('operacao') || itsError.message?.includes('column') || itsError.code === 'PGRST116')) {
      console.log('⚠️ Coluna operacao não encontrada, buscando sem ela...');
      const querySemOperacao = supabaseAdmin
        .from('its_documentos')
        .select('id, nome, codigo_it, versao, versao_atual, area, url, nome_arquivo, created_at')
        .in('id', itIds);
      
      const resultSemOperacao = await querySemOperacao;
      itsData = resultSemOperacao.data;
      itsError = resultSemOperacao.error;
      
      // Adicionar operacao como null para todas as ITs se a coluna não existir
      if (itsData && !itsError) {
        itsData = itsData.map(it => ({ ...it, operacao: null }));
      }
    }

    if (itsError) {
      console.error('❌ Erro ao buscar ITs:', itsError);
      throw itsError;
    }

    let its = (itsData || [])
      .filter(Boolean)
      .filter(it => it.versao_atual === true); // Apenas versões atuais

    console.log(`📄 ITs com versão atual: ${its.length}`);

    // Filtrar por operação se o cliente tiver uma operação específica
    // A IT deve ter a mesma operação do cliente OU não ter operação específica (NULL)
    if (cliente.operacao) {
      const antesFiltro = its.length;
      its = its.filter(it => 
        !it.operacao || // IT sem operação específica (válida para todas)
        it.operacao === cliente.operacao // IT com a mesma operação do cliente
      );
      console.log(`🔧 Filtro por operação "${cliente.operacao}": ${antesFiltro} → ${its.length} ITs`);
    }

    // Ordenar por data de criação (mais recentes primeiro)
    its.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    console.log(`✅ Retornando ${its.length} ITs para o cliente`);

    res.json({ success: true, its });
  } catch (error) {
    console.error('❌ Erro ao buscar ITs do cliente por nome:', error);
    console.error('❌ Stack trace:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao buscar ITs',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ========== ROTA 404 (deve ser a última rota) ==========
app.use('*', (req, res) => {
  // Ignorar requisições de favicon no 404
  if (req.originalUrl === '/favicon.ico') {
    return res.status(204).end();
  }
  res.status(404).json({ 
    error: 'Rota não encontrada',
    path: req.originalUrl
  });
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