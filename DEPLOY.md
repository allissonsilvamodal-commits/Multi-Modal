# 🚀 Guia de Deploy - Render

Este guia explica como fazer o deploy da aplicação Intranet Multimodal no Render.

## 📋 Pré-requisitos

1. Conta no [GitHub](https://github.com)
2. Conta no [Render](https://render.com)
3. Projeto já versionado no GitHub

## 🔧 Passo 1: Preparar o Repositório

### 1.1. Commit e Push das Alterações

```bash
# Adicionar todos os arquivos
git add .

# Fazer commit
git commit -m "feat: MVP completo - sistema de intranet com Supabase e Evolution API"

# Push para o GitHub
git push origin main
```

## 🌐 Passo 2: Configurar no Render

### 2.1. Criar Novo Web Service

1. Acesse [Render Dashboard](https://dashboard.render.com)
2. Clique em **"New +"** → **"Web Service"**
3. Conecte seu repositório GitHub
4. Selecione o repositório do projeto

### 2.2. Configurar o Serviço

- **Name**: `intranet-multimodal`
- **Environment**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Plan**: Escolha o plano adequado (Starter é suficiente para começar)

### 2.3. Configurar Variáveis de Ambiente

No Render, adicione as seguintes variáveis de ambiente na seção **"Environment"**:

```env
NODE_ENV=production
PORT=10000
SESSION_SECRET=seu_session_secret_aqui
SUPABASE_URL=sua_url_do_supabase
SUPABASE_ANON_KEY=sua_anon_key
SUPABASE_SERVICE_KEY=sua_service_key
EVOLUTION_BASE_URL=url_da_evolution_api
```

**⚠️ IMPORTANTE**: 
- Use valores seguros e aleatórios para `SESSION_SECRET`
- NUNCA commite as chaves no repositório
- Use as variáveis do seu `.env` local (mas não copie o arquivo inteiro)

### 2.4. Configurar Domínio (Opcional)

1. Na página do serviço, vá em **"Settings"**
2. Em **"Custom Domain"**, adicione seu domínio
3. Configure o DNS conforme as instruções

## ✅ Passo 3: Verificar o Deploy

Após o deploy:

1. **Verificar Logs**: Acesse a aba "Logs" no Render para verificar se não há erros
2. **Testar Aplicação**: Acesse a URL fornecida pelo Render
3. **Testar Funcionalidades**:
   - Login
   - Dashboard
   - Cadastro de motoristas
   - Sistema de coletas
   - Relatórios

## 🔐 Segurança

### Variáveis Sensíveis

Nunca commite:
- `.env`
- `*.db` (bancos de dados locais)
- `sessions.db`
- Chaves de API
- Secrets de sessão

### Melhores Práticas

1. ✅ Use sempre variáveis de ambiente no Render
2. ✅ Ative HTTPS (automático no Render)
3. ✅ Mantenha as dependências atualizadas
4. ✅ Monitore os logs regularmente

## 🔄 Atualizações Futuras

Para fazer atualizações:

```bash
# Fazer alterações no código
git add .
git commit -m "descrição da alteração"
git push origin main
```

O Render fará o redeploy automaticamente!

## 🐛 Troubleshooting

### Erro: "Port already in use"
- Verifique se a variável `PORT` está configurada como `10000` no Render

### Erro: "Cannot connect to database"
- Verifique se as variáveis `SUPABASE_URL` e `SUPABASE_ANON_KEY` estão corretas
- Verifique se o Supabase está acessível publicamente

### Erro: "Module not found"
- Verifique se todas as dependências estão no `package.json`
- Verifique os logs de build no Render

## 📞 Suporte

Para mais informações:
- [Documentação Render](https://render.com/docs)
- [Documentação Supabase](https://supabase.com/docs)

---

**Desenvolvido com ❤️ para Multimodal Logística e Transporte**

