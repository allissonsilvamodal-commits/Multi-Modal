# 🔐 Variáveis de Ambiente para Render

## 📋 Lista Completa de Variáveis Obrigatórias

Configure estas variáveis no painel do Render na seção **"Environment"**:

### ✅ Variáveis OBRIGATÓRIAS:

```env
NODE_ENV=production
PORT=10000
SESSION_SECRET=<GERE_UMA_CHAVE_SEGURA>
SUPABASE_URL=<SUA_URL_SUPABASE>
SUPABASE_SERVICE_KEY=<SUA_SERVICE_KEY>
SUPABASE_ANON_KEY=<SUA_ANON_KEY>
EVOLUTION_BASE_URL=<URL_EVOLUTION_API>
```

---

## 📝 Como Obter Cada Variável

### 1. **NODE_ENV**
```
Valor: production
```
Definir como `production` para ambiente de produção.

---

### 2. **PORT**
```
Valor: 10000
```
**⚠️ IMPORTANTE:** O Render define automaticamente a porta via `$PORT`, mas configure como `10000` para garantir compatibilidade.

---

### 3. **SESSION_SECRET** 🔒

**Gere uma chave segura:**

**No Windows (PowerShell):**
```powershell
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 64 | % {[char]$_})
```

**No Linux/Mac:**
```bash
openssl rand -base64 32
```

**Ou use um gerador online:**
- https://randomkeygen.com/
- Use uma chave de 64 caracteres ou mais

**Exemplo:**
```
SESSION_SECRET=A7f8kL9mN2pQ4rS6tU8vW0xY2zA4bC6dE8fG0hI2jK4lM6nO8pQ0rS2tU4vW6xY8z
```

---

### 4. **SUPABASE_URL** 🌐

1. Acesse https://app.supabase.com
2. Selecione seu projeto
3. Vá em **Settings** → **API**
4. Copie o campo **"Project URL"**

**Formato:**
```
https://xxxxxxxxxxxxx.supabase.co
```

**Do seu .env local, copie o valor de:**
```
SUPABASE_URL=https://ssicipijonlducmcjgty.supabase.co
```

---

### 5. **SUPABASE_SERVICE_KEY** 🔑

1. No Supabase, vá em **Settings** → **API**
2. Role até **"Project API keys"**
3. Copie a chave **"service_role"** (⚠️ CUIDADO: esta chave tem privilégios elevados!)

**Do seu .env local, copie o valor de:**
```
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

### 6. **SUPABASE_ANON_KEY** 🔑

1. No Supabase, vá em **Settings** → **API**
2. Role até **"Project API keys"**
3. Copie a chave **"anon"** ou **"public"**

**Do seu .env local, copie o valor de:**
```
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

### 7. **EVOLUTION_BASE_URL** 📱

**Do seu .env local, copie o valor de:**
```
EVOLUTION_BASE_URL=https://b1336382a159.ngrok-free.app
```

**⚠️ NOTA:** Se você estiver usando ngrok, certifique-se de que:
- O ngrok está configurado como um túnel permanente ou
- Você tem uma URL fixa da Evolution API

Para produção, recomenda-se usar uma URL fixa, não ngrok.

---

## ❌ Variáveis NÃO Necessárias

Estas variáveis **NÃO** precisam ser configuradas no Render:

- `USUARIOS` - Os usuários são gerenciados via Supabase Auth
- `ADMIN_API_KEY`, `JBO_API_KEY`, etc. - As credenciais da Evolution API são gerenciadas pelo sistema via interface Settings
- Qualquer variável relacionada a usuários específicos ou webhooks locais

---

## 📋 Checklist de Configuração no Render

Após criar o Web Service no Render:

1. ✅ Vá em **"Environment"** (aba lateral)
2. ✅ Clique em **"Add Environment Variable"**
3. ✅ Adicione cada variável uma por uma:

   ```
   NODE_ENV = production
   PORT = 10000
   SESSION_SECRET = [sua chave gerada]
   SUPABASE_URL = [sua URL do Supabase]
   SUPABASE_SERVICE_KEY = [sua service key]
   SUPABASE_ANON_KEY = [sua anon key]
   EVOLUTION_BASE_URL = [URL da Evolution API]
   ```

4. ✅ Clique em **"Save Changes"**
5. ✅ O serviço será reiniciado automaticamente

---

## 🔒 Segurança

### ⚠️ IMPORTANTE:

- ✅ **NUNCA** compartilhe as chaves do Supabase
- ✅ **NUNCA** commite o `.env` no repositório
- ✅ **USE** variáveis de ambiente no Render (não valores hardcoded)
- ✅ **GERE** um `SESSION_SECRET` único e seguro para produção
- ✅ **REVISE** as permissões das chaves do Supabase regularmente

### 🛡️ Dicas:

- A `SUPABASE_SERVICE_KEY` tem privilégios elevados - mantenha segura
- Use diferentes chaves para desenvolvimento e produção (se possível)
- Monitore os logs do Render para verificar se há erros de conexão

---

## 🧪 Teste Após Configurar

Após configurar as variáveis:

1. Verifique os logs do Render para confirmar que o servidor iniciou
2. Acesse a URL do serviço (fornecida pelo Render)
3. Teste o login
4. Verifique se consegue acessar as páginas principais
5. Teste uma funcionalidade que usa Supabase (ex: cadastro de motoristas)

---

## 📞 Problemas Comuns

### ❌ Erro: "Cannot connect to Supabase"
**Solução:** Verifique se `SUPABASE_URL` e `SUPABASE_ANON_KEY` estão corretas

### ❌ Erro: "Port already in use"
**Solução:** Certifique-se de que `PORT=10000` está configurado

### ❌ Erro: "Session secret must be provided"
**Solução:** Verifique se `SESSION_SECRET` foi configurado e não está vazio

### ❌ Erro: "Evolution API connection failed"
**Solução:** Verifique se `EVOLUTION_BASE_URL` está acessível e correta

---

**🎉 Pronto! Com essas variáveis configuradas, seu sistema estará funcionando no Render!**

