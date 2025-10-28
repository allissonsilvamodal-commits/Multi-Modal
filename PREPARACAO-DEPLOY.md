# ✅ Checklist de Preparação para Deploy

## 📋 Arquivos Preparados

- ✅ `.gitignore` - Configurado para não commitar arquivos sensíveis
- ✅ `render.yaml` - Configuração para deploy automático no Render
- ✅ `DEPLOY.md` - Guia completo de deploy
- ✅ `env.example` - Template seguro sem dados reais
- ✅ `package.json` - Scripts e dependências configuradas
- ✅ `README.md` - Documentação atualizada

## 🔐 Variáveis de Ambiente Necessárias no Render

Configure estas variáveis no painel do Render:

```env
NODE_ENV=production
PORT=10000
SESSION_SECRET=<gere_uma_chave_segura>
SUPABASE_URL=<sua_url_supabase>
SUPABASE_ANON_KEY=<sua_anon_key>
SUPABASE_SERVICE_KEY=<sua_service_key>
EVOLUTION_BASE_URL=<url_evolution_api>
```

## 📝 Próximos Passos

### 1. Fazer Commit e Push

```bash
# Adicionar todos os arquivos (exceto os ignorados)
git add .

# Verificar o que será commitado
git status

# Fazer commit
git commit -m "feat: MVP completo - sistema intranet com Supabase e Evolution API

- Sistema completo de autenticação e permissões
- Gestão de usuários e coletas
- Integração com Evolution API por usuário
- Sistema de CRM com leads
- Relatórios e dashboards modernos
- Pronto para deploy no Render"

# Push para GitHub
git push origin main
```

### 2. Deploy no Render

1. Acesse https://dashboard.render.com
2. Clique em "New +" → "Web Service"
3. Conecte seu repositório GitHub
4. Selecione o repositório
5. Configure:
   - **Name**: `intranet-multimodal`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Starter (ou superior)
6. Adicione as variáveis de ambiente listadas acima
7. Clique em "Create Web Service"

### 3. Verificação Pós-Deploy

Após o deploy:

- ✅ Verificar logs no Render
- ✅ Testar login
- ✅ Testar funcionalidades principais
- ✅ Verificar conexão com Supabase
- ✅ Verificar integração com Evolution API

## ⚠️ Lembretes Importantes

1. **NUNCA** commite:
   - Arquivo `.env`
   - Arquivos `.db` (banco de dados)
   - Chaves de API reais
   - Dados sensíveis

2. **SEMPRE** use:
   - Variáveis de ambiente no Render
   - HTTPS (automático no Render)
   - Secrets seguros para SESSION_SECRET

3. **MONITORE**:
   - Logs do Render regularmente
   - Uso de recursos
   - Status da aplicação

## 🐛 Troubleshooting

### Erro: Port already in use
- Solução: Render define PORT automaticamente, mas configure como `10000` para garantir

### Erro: Cannot connect to Supabase
- Solução: Verifique se as variáveis `SUPABASE_URL` e `SUPABASE_ANON_KEY` estão corretas

### Erro: Module not found
- Solução: Verifique se todas as dependências estão no `package.json` e no commit

### Build falha
- Solução: Verifique os logs de build no Render para identificar dependências faltando

## 📞 Suporte

- Render Docs: https://render.com/docs
- Supabase Docs: https://supabase.com/docs

---

**🎉 Pronto para deploy!**

