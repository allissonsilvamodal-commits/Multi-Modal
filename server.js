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
const { validate } = require('./validation');
const { logger } = require('./logger');

const app = express();
const PORT = process.env.PORT || 5680;

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

// Configuração do Multer para uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
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
function requireAuth(req, res, next) {
  if (req.session && req.session.usuario) {
    console.log('🔐 Usuário autenticado:', req.session.usuario);
    next();
  } else {
    console.log('❌ Acesso não autorizado');
    res.status(401).json({ error: 'Não autenticado' });
  }
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
app.post('/webhook/send-supabase', async (req, res) => {
  const { number, message, usuario, userId } = req.body;
  
  console.log('📤 Nova requisição de envio via Supabase:');
  console.log('👤 Usuário:', usuario);
  console.log('🆔 User ID (direto):', userId);
  console.log('🔢 Número:', number);
  
  if ((!usuario && !userId) || !number || !message) {
    return res.status(400).json({ 
      success: false, 
      error: 'User ID (ou email), número e mensagem são obrigatórios' 
    });
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
    
    // ✅ Usar bypass RLS com service role
    // Para isso, vamos usar o método direto sem RLS
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
    
    // Se não encontrou, tentar sem filtro de active para debug
    if (!userCreds) {
      console.log('🔍 Tentando buscar sem filtro de active...');
      const { data: allCreds, error: allError } = await supabaseAdmin
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
      
      // Verificar se existem credenciais inativas
      const { data: credenciaisInativas } = await supabaseAdmin
        .from('user_evolution_apis')
        .select('*')
        .eq('user_id', userIdentity);
      
      console.log('📊 Credenciais do usuário (ativas e inativas):', credenciaisInativas);
      
      // Listar TODAS as credenciais para debug
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
    
    // Validar credenciais
    if (!userCreds.api_key || !userCreds.api_url || !userCreds.instance_name) {
      return res.status(500).json({ 
        success: false, 
        error: `Configuração incompleta para ${usuario}`,
        solution: 'Complete todas as informações das credenciais'
      });
    }
    
    // Enviar mensagem via Evolution API
    const formattedNumber = formatNumberForEvolution(number);
    console.log('🔢 Número formatado:', formattedNumber);
    
    const evolutionUrl = userCreds.api_url;
    const url = `${evolutionUrl}/message/sendText/${userCreds.instance_name}`;
    
    console.log('🌐 URL da requisição:', url);
    
    const response = await fetch(url, {
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
      
      res.json({ 
        success: true, 
        message: '✅ Mensagem enviada com sucesso!',
        usuario: usuario,
        instancia: userCreds.instance_name,
        messageId: result.key?.id
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
    console.log('❌ Erro:', error.message);
    res.status(500).json({ 
      success: false, 
      error: '❌ Erro ao processar envio',
      details: error.message
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

    // Salvar informações do anexo no Supabase
    const { data, error } = await supabase
      .from('anexos')
      .insert([{
        coleta_id: coleta_id,
        nome_arquivo: req.file.originalname,
        caminho_arquivo: req.file.path,
        tamanho_arquivo: req.file.size,
        tipo_arquivo: req.file.mimetype,
        usuario_upload: usuario || req.session.usuario
      }])
      .select();

    if (error) throw error;

    console.log('✅ Anexo salvo:', data[0].id);
    res.json({ success: true, anexo: data[0] });

  } catch (error) {
    console.error('❌ Erro no upload:', error);
    res.status(500).json({ error: 'Erro ao fazer upload do arquivo' });
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

    // Verificar se o arquivo existe
    if (!fs.existsSync(data.caminho_arquivo)) {
      return res.status(404).json({ error: 'Arquivo não encontrado no servidor' });
    }

    res.download(data.caminho_arquivo, data.nome_arquivo);

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
      .eq('coleta_id', coleta_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, anexos: data || [] });

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

    // Excluir arquivo físico
    if (fs.existsSync(anexo.caminho_arquivo)) {
      fs.unlinkSync(anexo.caminho_arquivo);
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