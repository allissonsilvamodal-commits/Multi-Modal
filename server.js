require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { validate } = require('./validation');
const { logger } = require('./logger');

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

// Rate limiting para prevenir ataques (mais permissivo para desenvolvimento)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 1000, // máximo 1000 requests por IP por janela (aumentado de 100)
  message: {
    error: 'Muitas tentativas de acesso. Tente novamente em 15 minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Pular rate limiting para desenvolvimento local
    return req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  }
});

app.use(limiter);

// Rate limiting específico para login (mais permissivo)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20, // máximo 20 tentativas de login por IP (aumentado de 5)
  message: {
    error: 'Muitas tentativas de login. Tente novamente em 15 minutos.'
  },
  skipSuccessfulRequests: true,
  skip: (req) => {
    // Pular rate limiting para desenvolvimento local
    return req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  }
});

// Configuração do Multer para uploads (armazenamento em memória)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

// 🔥 IMPORT DO SUPABASE SEGURO
const { supabase } = require('./supabase-secure.js');
const { createClient } = require('@supabase/supabase-js');

// 🔒 Criar cliente Supabase com SERVICE_KEY para bypass de RLS
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Log para debug
console.log('🔑 Service Key configurada:', !!process.env.SUPABASE_SERVICE_KEY);
console.log('🔑 Service Role Key configurada:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('🔑 Anon Key configurada:', !!process.env.SUPABASE_ANON_KEY);

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

// ========== MIDDLEWARES ==========
const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
  process.env.ALLOWED_ORIGINS.split(',') : 
  [];

app.use(cors({
  origin: ['http://localhost:5680', 'http://127.0.0.1:5680'],
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

app.use(session({
  secret: process.env.SESSION_SECRET || 'segredo-muito-secreto-2025',
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: './',
    table: 'sessions'
  }),
  cookie: { 
    secure: false,
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
  const usuariosEnv = process.env.USUARIOS || 'admin:admin123';
  
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
    return { error: { status: 401, message: 'Sessão não encontrada. Faça login com sua conta Google.' } };
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

app.get('/api/motoristas/auth/me', async (req, res) => {
  try {
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    console.log('🆔 Supabase user autenticado:', {
      id: user.id,
      email: user.email,
      metadata: user.user_metadata
    });

    const { data: existingMotorista, error: motoristaError } = await supabaseAdmin
      .from('motoristas')
      .select(MOTORISTA_SELECT_FIELDS)
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (motoristaError) {
      console.error('❌ Erro ao buscar motorista por auth_user_id:', motoristaError);
    }

    if (motoristaError && motoristaError.code !== 'PGRST116') {
      throw motoristaError;
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        nome: user.user_metadata?.full_name || user.user_metadata?.name || user.email
      },
      motorista: existingMotorista ? mapMotoristaResponse(existingMotorista) : null
    });
  } catch (error) {
    console.error('❌ Erro ao carregar sessão do motorista:', error);
    res.status(500).json({ success: false, error: 'Erro ao validar sessão. Tente novamente.' });
  }
});

app.post('/api/motoristas/auth/profile', express.json(), async (req, res) => {
  try {
    const { user, error } = await getSupabaseUserFromRequest(req);
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

    const { data: motoristaByAuth, error: motoristaByAuthError } = await supabaseAdmin
      .from('motoristas')
      .select(MOTORISTA_SELECT_FIELDS)
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (motoristaByAuthError && motoristaByAuthError.code !== 'PGRST116') {
      throw motoristaByAuthError;
    }

    let motoristaSelecionado = motoristaByAuth || null;

    const motoristasPorTelefone = await fetchMotoristasByPhone(normalizedPhone);
    const motoristaPorTelefone = motoristasPorTelefone.find(m => phonesMatch(normalizedPhone, m.telefone1, m.telefone2));

    if (!motoristaSelecionado && motoristaPorTelefone) {
      if (motoristaPorTelefone.auth_user_id && motoristaPorTelefone.auth_user_id !== user.id) {
        return res.status(409).json({ success: false, error: 'Este telefone já está vinculado a outra conta. Contate a central.' });
      }
      motoristaSelecionado = motoristaPorTelefone;
    }

    const payload = {
      nome,
      telefone1: normalizedPhone,
      auth_user_id: user.id,
      created_by_departamento: body.departamento || motoristaSelecionado?.created_by_departamento || 'Portal Motorista',
      created_by: motoristaSelecionado?.created_by || user.id,
      usuario_id: motoristaSelecionado?.usuario_id || user.id
    };

    if (normalizedPhone2) {
      payload.telefone2 = normalizedPhone2;
    } else if (body.telefoneSecundario === '') {
      payload.telefone2 = null;
    }

    const optionalFields = {
      placa_cavalo: body.placaCavalo ? normalizePlate(body.placaCavalo) : null,
      placa_carreta1: body.placaCarreta1 ? normalizePlate(body.placaCarreta1) : null,
      placa_carreta2: body.placaCarreta2 ? normalizePlate(body.placaCarreta2) : null,
      placa_carreta3: body.placaCarreta3 ? normalizePlate(body.placaCarreta3) : null,
      classe_veiculo: body.classeVeiculo ? body.classeVeiculo.trim() : null,
      tipo_veiculo: body.tipoVeiculo ? body.tipoVeiculo.trim() : null,
      tipo_carroceria: body.tipoCarroceria ? body.tipoCarroceria.trim() : null,
      cidade: body.cidade ? body.cidade.trim() : null,
      estado: body.estado ? body.estado.trim() : null,
      empresa: body.empresa ? body.empresa.trim() : null
    };

    Object.entries(optionalFields).forEach(([key, value]) => {
      if (value) {
        payload[key] = value;
      }
    });

    if (!payload.classe_veiculo) {
      payload.classe_veiculo = motoristaSelecionado?.classe_veiculo || 'Não informado';
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
    res.status(500).json({ success: false, error: 'Erro ao salvar dados do motorista. Tente novamente.' });
  }
});

app.get('/api/motoristas/documentos/status', async (req, res) => {
  try {
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const { data: motorista, error: motoristaError } = await supabaseAdmin
      .from('motoristas')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (motoristaError && motoristaError.code !== 'PGRST116') {
      throw motoristaError;
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
    const { error } = await getSupabaseUserFromRequest(req);
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
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const { data: motorista, error: motoristaError } = await supabaseAdmin
      .from('motoristas')
      .select(MOTORISTA_SELECT_FIELDS)
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (motoristaError && motoristaError.code !== 'PGRST116') {
      throw motoristaError;
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
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const coletaId = req.params.coletaId;
    if (!coletaId) {
      return res.status(400).json({ success: false, error: 'Identificador da coleta é obrigatório.' });
    }

    const { data: motorista, error: motoristaError } = await supabaseAdmin
      .from('motoristas')
      .select(MOTORISTA_SELECT_FIELDS)
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (motoristaError && motoristaError.code !== 'PGRST116') {
      throw motoristaError;
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
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const coletaId = req.params.coletaId;
    if (!coletaId) {
      return res.status(400).json({ success: false, error: 'Identificador da coleta é obrigatório.' });
    }

    const { data: motorista, error: motoristaError } = await supabaseAdmin
      .from('motoristas')
      .select('id, nome')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (motoristaError && motoristaError.code !== 'PGRST116') {
      throw motoristaError;
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
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const { data: motorista, error: motoristaError } = await supabaseAdmin
      .from('motoristas')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (motoristaError && motoristaError.code !== 'PGRST116') {
      throw motoristaError;
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
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (error) {
      return res.status(error.status || 401).json({ success: false, error: error.message });
    }

    const solicitacaoId = req.params.solicitacaoId;

    const { data: motorista, error: motoristaError } = await supabaseAdmin
      .from('motoristas')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (motoristaError && motoristaError.code !== 'PGRST116') {
      throw motoristaError;
    }

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

app.get('/api/auth/status', async (req, res) => {
  const autenticado = !!(req.session && req.session.usuario);
  
  console.log('🔍 Verificando status de autenticação...');
  console.log('📋 Sessão completa:', req.session);
  
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
      permissoes: req.session.permissoes
    });
    
    res.json({ 
      autenticado: true,
      usuario: req.session.usuario,
      permissoes: req.session.permissoes || [],
      isAdmin: req.session.isAdmin || false,
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
    const db = new sqlite3.Database('./sessions.db');

    // Buscar sem filtro de data; filtramos em JS por segurança
    const query = `SELECT sid, sess, expire, expired, expires FROM sessions`;

    db.all(query, [], (err, rows) => {
      db.close();

      if (err) {
        console.error('❌ Erro ao buscar sessões ativas:', err);
        return res.json({
          success: true,
          count: 0,
          error: 'Erro ao buscar sessões'
        });
      }

      let count = 0;
      const now = Date.now();

      if (rows && rows.length) {
        rows.forEach(row => {
          try {
            // Colunas possíveis de expiração (stores variam): expire/expired em ms epoch, ou expires como ISO
            const expireMs = typeof row.expire === 'number' ? row.expire
              : (typeof row.expired === 'number' ? row.expired : null);

            let notExpired = true;
            if (expireMs !== null) {
              notExpired = expireMs > now;
            } else if (row.expires) {
              // Tentar tratar como string/ISO
              const expParsed = new Date(row.expires).getTime();
              if (!Number.isNaN(expParsed)) {
                notExpired = expParsed > now;
              }
            }

            // Tentar extrair dados da sessão
            const sessData = typeof row.sess === 'string' ? JSON.parse(row.sess) : row.sess;
            if (notExpired && sessData && sessData.usuario) {
              count++;
            }
          } catch (parseError) {
            console.warn('⚠️ Erro ao processar sessão:', parseError.message);
          }
        });
      }

      console.log(`📊 Sessões ativas encontradas: ${count}`);

      res.json({
        success: true,
        count
      });
    });
  } catch (error) {
    console.error('❌ Erro ao contar sessões ativas:', error);
    res.json({
      success: true,
      count: 0,
      error: error.message
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
    
    // Verificar se a Evolution API está respondendo
    const evolutionUrl = `${config.api_url}/instance/connectionState/${config.instance_name}`;
    console.log('🌐 Testando Evolution API:', evolutionUrl);
    
    try {
      const response = await fetch(evolutionUrl, {
        method: 'GET',
        headers: {
          'apikey': config.api_key,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });
      
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
    
    // Enviar mensagem via Evolution API
    const sendUrl = `${config.api_url}/message/sendText/${config.instance_name}`;
    console.log('🌐 Enviando para:', sendUrl);
    
    const response = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'apikey': config.api_key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        number: number,
        text: text
      }),
      timeout: 10000
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Mensagem enviada com sucesso:', data);
      
      // Registrar disparo anônimo (sem auth) no Supabase
      try {
        const { supabase } = require('./supabase-secure');
        await supabase.from('disparos_log').insert([{
          user_id: null,
          departamento: null,
          numero: number,
          mensagem_tamanho: (text || '').length,
          status: 'success'
        }]);
      } catch (logErr) {
        console.warn('⚠️ Falha ao registrar disparo (send):', logErr.message);
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
        const { supabase } = require('./supabase-secure');
        await supabase.from('disparos_log').insert([{
          user_id: usuario,
          departamento: req.session?.userData?.departamento || null,
          numero: formattedNumber,
          mensagem_tamanho: (message || '').length,
          status: 'success'
        }]);
      } catch (logErr) {
        console.warn('⚠️ Falha ao registrar disparo (send-auth):', logErr.message);
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

    if (!mediaData) {
      const textUrl = `${evolutionUrl}/message/sendText/${userCreds.instance_name}`;
      console.log('🌐 URL da requisição:', textUrl);

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
        cleanupFile();

        res.json({
          success: true,
          message: '✅ Mensagem enviada com sucesso!',
          usuario: usuario,
          instancia: userCreds.instance_name,
          messageId: result.key?.id,
          mediaEnviada: null
        });
        return;
      }

      const errorText = await response.text();
      console.log('❌ Erro da Evolution (texto):', errorText);
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
      return res.json({
        success: true,
        message: '✅ Mensagem enviada com sucesso!',
        usuario: usuario,
        instancia: userCreds.instance_name,
        messageId: evolutionResult.key?.id,
        mediaEnviada: mediaData.fileName,
        endpointUsado: attemptLogs.find(a => a.success)?.endpoint || null
      });
    }

    return res.status(500).json({
      success: false,
      error: lastStatus ? `❌ Erro ${lastStatus} do Evolution` : '❌ Evolution não respondeu',
      details: lastErrorText,
      tentativas: attemptLogs
    });

  } catch (error) {
    console.log('❌ Erro:', error.message);
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
    res.json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY
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