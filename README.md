# 🚀 Sistema Intranet Multimodal

Sistema completo de intranet corporativa com integração Supabase e Evolution API para gestão de motoristas e disparo de mensagens WhatsApp.

## 🔧 Correções Realizadas

### Problemas Corrigidos

1. **Código Duplicado Removido**
   - ✅ Removido código duplicado no `server.js` (linhas 1921-2058)
   - ✅ Removido schemas duplicados no `validation.js`
   - ✅ Removido configuração duplicada no `logger.js`

2. **Scripts Corrigidos**
   - ✅ Removido script `supabase` que referenciava arquivo inexistente
   - ✅ Adicionado script `diagnostico` para verificação da aplicação

3. **Configurações Melhoradas**
   - ✅ Arquivo `env.example` atualizado com instruções detalhadas
   - ✅ Script de diagnóstico criado (`diagnostico.js`)

4. **Estrutura Otimizada**
   - ✅ Código limpo e organizado
   - ✅ Sem erros de linting
   - ✅ Documentação atualizada

### Como Executar o Diagnóstico

```bash
# Verificar status da aplicação
npm run diagnostico
```

Este comando verifica:
- ✅ Arquivos essenciais
- ✅ Configurações de ambiente
- ✅ Dependências instaladas
- ✅ Banco de dados
- ✅ Logs e backups

## ✨ Funcionalidades

- 🔐 **Autenticação Segura** com Supabase
- 👥 **Gestão de Usuários** e permissões
- 🚛 **Cadastro de Motoristas** completo
- 📱 **Sistema de Disparos** WhatsApp via Evolution API
- 📊 **Relatórios** e dashboards
- 🚗 **Gestão de Frota** e manutenções
- 📋 **Sistema de Coletas**
- ⚙️ **Configurações** centralizadas

## 🛠️ Tecnologias

- **Backend:** Node.js + Express
- **Frontend:** HTML5 + CSS3 + JavaScript (Vanilla)
- **Banco de Dados:** Supabase (PostgreSQL)
- **Autenticação:** Supabase Auth + JWT
- **API WhatsApp:** Evolution API
- **Cache:** Node-Cache
- **Logs:** Winston
- **Validação:** Joi
- **Segurança:** Helmet + Rate Limiting

## 🚀 Instalação

### Pré-requisitos

- Node.js 18+
- npm 8+
- Conta Supabase
- Evolution API configurada

### 1. Clone o repositório

```bash
git clone https://github.com/multimodal/intranet.git
cd intranet
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure as variáveis de ambiente

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas configurações:

```env
# Supabase
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua_chave_anonima

# Evolution API
EVOLUTION_BASE_URL=http://localhost:8080
EVOLUTION_INSTANCE_NAME=sua_instancia
EVOLUTION_API_KEY=sua_api_key

# Servidor
PORT=5680
SESSION_SECRET=seu_secret_super_seguro
DEBUG_MODE=false

# CORS
ALLOWED_ORIGINS=http://localhost:5680,http://127.0.0.1:5680

# Usuários
USUARIOS=admin:admin123,usuario1:senha123
```

### 4. Configure o Supabase

Execute os scripts SQL no Supabase para criar as tabelas:

```sql
-- Tabela de usuários
CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha TEXT NOT NULL,
  departamento TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de motoristas
CREATE TABLE motoristas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone1 TEXT NOT NULL,
  telefone2 TEXT,
  estado TEXT,
  cnh TEXT,
  categoria_cnh TEXT,
  classe_veiculo TEXT NOT NULL,
  tipo_veiculo TEXT,
  tipo_carroceria TEXT,
  placa_cavalo TEXT,
  placa_carreta1 TEXT,
  placa_carreta2 TEXT,
  status TEXT DEFAULT 'ativo',
  data_cadastro TIMESTAMP DEFAULT NOW(),
  data_atualizacao TIMESTAMP DEFAULT NOW(),
  usuario_id TEXT REFERENCES usuarios(id)
);

-- Tabela de configurações Evolution
CREATE TABLE evolution_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id TEXT REFERENCES usuarios(id),
  api_key TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  webhook_url TEXT,
  api_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de coletas
CREATE TABLE coletas (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  descricao TEXT,
  status TEXT DEFAULT 'pendente',
  usuario_criador TEXT REFERENCES usuarios(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 5. Execute o sistema

```bash
# Desenvolvimento
npm run dev

# Produção
npm start
```

## 🐳 Docker

### Usando Docker Compose

```bash
# Desenvolvimento
docker-compose up -d

# Com Evolution API
docker-compose --profile evolution up -d
```

### Build manual

```bash
docker build -t intranet-multimodal .
docker run -p 5680:5680 intranet-multimodal
```

## 📁 Estrutura do Projeto

```
intranet/
├── 📁 js/                    # JavaScript do frontend
├── 📁 logs/                  # Logs da aplicação
├── 📁 uploads/               # Arquivos enviados
├── 📄 server.js              # Servidor principal
├── 📄 supabase-secure.js     # Configuração Supabase
├── 📄 auth-middleware.js     # Middleware de autenticação
├── 📄 validation.js          # Validação de dados
├── 📄 logger.js              # Sistema de logs
├── 📄 cache.js               # Sistema de cache
├── 📄 monitoring.js           # Monitoramento
├── 📄 components.js          # Componentes frontend
├── 📄 package.json           # Dependências
├── 📄 Dockerfile             # Container Docker
├── 📄 docker-compose.yml     # Orquestração Docker
└── 📄 README.md              # Este arquivo
```

## 🔧 Scripts Disponíveis

```bash
npm start          # Inicia o servidor
npm run dev        # Modo desenvolvimento com nodemon
npm test           # Executa testes
npm run lint       # Verifica código
npm run lint:fix   # Corrige problemas de código
npm run build      # Build completo
```

## 🔒 Segurança

- ✅ Autenticação JWT
- ✅ Rate Limiting
- ✅ Helmet para headers de segurança
- ✅ Validação de dados com Joi
- ✅ Sanitização de inputs
- ✅ Logs de segurança
- ✅ CORS configurado
- ✅ Variáveis de ambiente protegidas

## 📊 Monitoramento

- **Health Check:** `/health`
- **Métricas:** `/metrics`
- **Status:** `/status`
- **Logs:** Diretório `logs/`

## 🚀 Deploy

### Heroku

```bash
# Instalar Heroku CLI
npm install -g heroku

# Login
heroku login

# Criar app
heroku create intranet-multimodal

# Configurar variáveis
heroku config:set SUPABASE_URL=...
heroku config:set SUPABASE_ANON_KEY=...

# Deploy
git push heroku main
```

### VPS/Dedicado

```bash
# Instalar PM2
npm install -g pm2

# Iniciar aplicação
pm2 start server.js --name intranet

# Configurar auto-restart
pm2 startup
pm2 save
```

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/nova-funcionalidade`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova funcionalidade'`)
4. Push para a branch (`git push origin feature/nova-funcionalidade`)
5. Abra um Pull Request

## 📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para detalhes.

## 📞 Suporte

- 📧 Email: suporte@multimodal.com.br
- 🐛 Issues: [GitHub Issues](https://github.com/multimodal/intranet/issues)
- 📖 Documentação: [Wiki](https://github.com/multimodal/intranet/wiki)

## 🔄 Changelog

### v2.0.0
- ✅ Sistema de autenticação seguro
- ✅ Integração completa com Supabase
- ✅ Cache e performance otimizada
- ✅ Monitoramento e logs estruturados
- ✅ Validação robusta de dados
- ✅ Componentes reutilizáveis
- ✅ Docker e containerização
- ✅ Documentação completa

### v1.0.0
- ✅ Sistema básico de disparos
- ✅ Cadastro de motoristas
- ✅ Integração Evolution API
- ✅ Interface responsiva

Sistema completo de intranet corporativa com integração Supabase e Evolution API para gestão de motoristas e disparo de mensagens WhatsApp.

## ✨ Funcionalidades

- 🔐 **Autenticação Segura** com Supabase
- 👥 **Gestão de Usuários** e permissões
- 🚛 **Cadastro de Motoristas** completo
- 📱 **Sistema de Disparos** WhatsApp via Evolution API
- 📊 **Relatórios** e dashboards
- 🚗 **Gestão de Frota** e manutenções
- 📋 **Sistema de Coletas**
- ⚙️ **Configurações** centralizadas

## 🛠️ Tecnologias

- **Backend:** Node.js + Express
- **Frontend:** HTML5 + CSS3 + JavaScript (Vanilla)
- **Banco de Dados:** Supabase (PostgreSQL)
- **Autenticação:** Supabase Auth + JWT
- **API WhatsApp:** Evolution API
- **Cache:** Node-Cache
- **Logs:** Winston
- **Validação:** Joi
- **Segurança:** Helmet + Rate Limiting

## 🚀 Instalação

### Pré-requisitos

- Node.js 18+
- npm 8+
- Conta Supabase
- Evolution API configurada

### 1. Clone o repositório

```bash
git clone https://github.com/multimodal/intranet.git
cd intranet
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure as variáveis de ambiente

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas configurações:

```env
# Supabase
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua_chave_anonima

# Evolution API
EVOLUTION_BASE_URL=http://localhost:8080
EVOLUTION_INSTANCE_NAME=sua_instancia
EVOLUTION_API_KEY=sua_api_key

# Servidor
PORT=5680
SESSION_SECRET=seu_secret_super_seguro
DEBUG_MODE=false

# CORS
ALLOWED_ORIGINS=http://localhost:5680,http://127.0.0.1:5680

# Usuários
USUARIOS=admin:admin123,usuario1:senha123
```

### 4. Configure o Supabase

Execute os scripts SQL no Supabase para criar as tabelas:

```sql
-- Tabela de usuários
CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha TEXT NOT NULL,
  departamento TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de motoristas
CREATE TABLE motoristas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone1 TEXT NOT NULL,
  telefone2 TEXT,
  estado TEXT,
  cnh TEXT,
  categoria_cnh TEXT,
  classe_veiculo TEXT NOT NULL,
  tipo_veiculo TEXT,
  tipo_carroceria TEXT,
  placa_cavalo TEXT,
  placa_carreta1 TEXT,
  placa_carreta2 TEXT,
  status TEXT DEFAULT 'ativo',
  data_cadastro TIMESTAMP DEFAULT NOW(),
  data_atualizacao TIMESTAMP DEFAULT NOW(),
  usuario_id TEXT REFERENCES usuarios(id)
);

-- Tabela de configurações Evolution
CREATE TABLE evolution_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id TEXT REFERENCES usuarios(id),
  api_key TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  webhook_url TEXT,
  api_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de coletas
CREATE TABLE coletas (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  descricao TEXT,
  status TEXT DEFAULT 'pendente',
  usuario_criador TEXT REFERENCES usuarios(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 5. Execute o sistema

```bash
# Desenvolvimento
npm run dev

# Produção
npm start
```

## 🐳 Docker

### Usando Docker Compose

```bash
# Desenvolvimento
docker-compose up -d

# Com Evolution API
docker-compose --profile evolution up -d
```

### Build manual

```bash
docker build -t intranet-multimodal .
docker run -p 5680:5680 intranet-multimodal
```

## 📁 Estrutura do Projeto

```
intranet/
├── 📁 js/                    # JavaScript do frontend
├── 📁 logs/                  # Logs da aplicação
├── 📁 uploads/               # Arquivos enviados
├── 📄 server.js              # Servidor principal
├── 📄 supabase-secure.js     # Configuração Supabase
├── 📄 auth-middleware.js     # Middleware de autenticação
├── 📄 validation.js          # Validação de dados
├── 📄 logger.js              # Sistema de logs
├── 📄 cache.js               # Sistema de cache
├── 📄 monitoring.js           # Monitoramento
├── 📄 components.js          # Componentes frontend
├── 📄 package.json           # Dependências
├── 📄 Dockerfile             # Container Docker
├── 📄 docker-compose.yml     # Orquestração Docker
└── 📄 README.md              # Este arquivo
```

## 🔧 Scripts Disponíveis

```bash
npm start          # Inicia o servidor
npm run dev        # Modo desenvolvimento com nodemon
npm test           # Executa testes
npm run lint       # Verifica código
npm run lint:fix   # Corrige problemas de código
npm run build      # Build completo
```

## 🔒 Segurança

- ✅ Autenticação JWT
- ✅ Rate Limiting
- ✅ Helmet para headers de segurança
- ✅ Validação de dados com Joi
- ✅ Sanitização de inputs
- ✅ Logs de segurança
- ✅ CORS configurado
- ✅ Variáveis de ambiente protegidas

## 📊 Monitoramento

- **Health Check:** `/health`
- **Métricas:** `/metrics`
- **Status:** `/status`
- **Logs:** Diretório `logs/`

## 🚀 Deploy

### Heroku

```bash
# Instalar Heroku CLI
npm install -g heroku

# Login
heroku login

# Criar app
heroku create intranet-multimodal

# Configurar variáveis
heroku config:set SUPABASE_URL=...
heroku config:set SUPABASE_ANON_KEY=...

# Deploy
git push heroku main
```

### VPS/Dedicado

```bash
# Instalar PM2
npm install -g pm2

# Iniciar aplicação
pm2 start server.js --name intranet

# Configurar auto-restart
pm2 startup
pm2 save
```

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/nova-funcionalidade`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova funcionalidade'`)
4. Push para a branch (`git push origin feature/nova-funcionalidade`)
5. Abra um Pull Request

## 📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para detalhes.

## 📞 Suporte

- 📧 Email: suporte@multimodal.com.br
- 🐛 Issues: [GitHub Issues](https://github.com/multimodal/intranet/issues)
- 📖 Documentação: [Wiki](https://github.com/multimodal/intranet/wiki)

## 🔄 Changelog

### v2.0.0
- ✅ Sistema de autenticação seguro
- ✅ Integração completa com Supabase
- ✅ Cache e performance otimizada
- ✅ Monitoramento e logs estruturados
- ✅ Validação robusta de dados
- ✅ Componentes reutilizáveis
- ✅ Docker e containerização
- ✅ Documentação completa

### v1.0.0
- ✅ Sistema básico de disparos
- ✅ Cadastro de motoristas
- ✅ Integração Evolution API
- ✅ Interface responsiva
