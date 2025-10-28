# =====================================================
# GUIA SUPABASE LOCAL - EXTENSÃO VSCODE
# Multimodal Logística - Configuração Completa
# =====================================================

## 🚀 **COMO USAR A EXTENSÃO SUPABASE:**

### 1. **Configurar Conexão:**
```bash
# No VS Code, abra o Command Palette (Ctrl+Shift+P)
# Digite: "Supabase: Start Local Development"
# Ou use o ícone do Supabase na barra lateral
```

### 2. **Conectar ao Projeto:**
- Clique no ícone do Supabase na barra lateral
- Selecione "Link Project"
- Cole sua URL do Supabase: `https://ssicipijonlducmcjgty.supabase.co`
- Cole sua chave anon: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

### 3. **Executar Script de Configuração:**
```bash
# No VS Code, abra o arquivo supabase-local-setup.sql
# Clique com botão direito → "Run Query"
# Ou use Ctrl+Shift+P → "Supabase: Run SQL Query"
```

## 🔧 **CONFIGURAÇÕES DO PROJETO:**

### **Arquivo .env (já configurado):**
```env
SUPABASE_URL=https://ssicipijonlducmcjgty.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### **Estrutura Criada:**
- ✅ **motoristas** - Cadastro de motoristas
- ✅ **coletas** - Sistema de coletas com etapas corretas
- ✅ **anexos** - Arquivos anexados
- ✅ **chat_mensagens** - Chat por coleta
- ✅ **historico_coletas** - Histórico de movimentações
- ✅ **usuarios** - Usuários do sistema
- ✅ **permissoes_*** - Sistema de permissões
- ✅ **configuracoes_sistema** - Configurações gerais

## 🎯 **ETAPAS CORRETAS DO SISTEMA:**

1. **comercial** ← Primeira etapa
2. **price**
3. **cs**
4. **contratacao** ← Requer motorista vinculado
5. **gr** ← Requer aprovação/reprovação
6. **documentacao**
7. **controladoria**
8. **contas_pagar**
9. **contas_receber**
10. **monitoramento** ← Última etapa

## 🚀 **PRÓXIMOS PASSOS:**

### 1. **Executar o Script:**
- Abra `supabase-local-setup.sql` no VS Code
- Execute o script completo
- Verifique se todas as tabelas foram criadas

### 2. **Testar o Sistema:**
- Acesse `coletas.html`
- Teste criação de coletas
- Teste avanço de etapas
- Teste sistema de motoristas
- Teste sistema GR

### 3. **Verificar Funcionamento:**
- Login deve funcionar
- Coletas devem ser criadas
- Etapas devem avançar corretamente
- Validações devem funcionar

## 💡 **DICAS IMPORTANTES:**

- **Backup**: Sempre faça backup antes de alterações
- **Testes**: Teste localmente antes de aplicar em produção
- **Constraints**: As constraints estão configuradas corretamente
- **Índices**: Performance otimizada com índices

## 🔍 **VERIFICAÇÕES:**

```sql
-- Verificar se as tabelas foram criadas
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Verificar constraints de etapas
SELECT constraint_name, check_clause 
FROM information_schema.check_constraints 
WHERE constraint_name = 'coletas_etapa_atual_check';

-- Verificar dados de exemplo
SELECT COUNT(*) FROM coletas;
SELECT COUNT(*) FROM motoristas;
SELECT COUNT(*) FROM usuarios;
```

## ✅ **RESULTADO ESPERADO:**

Após executar o script, você terá:
- ✅ Todas as tabelas criadas
- ✅ Constraints funcionando
- ✅ Dados de exemplo inseridos
- ✅ Sistema de coletas 100% funcional
- ✅ Validações de etapas corretas
- ✅ Sistema de motoristas operacional
- ✅ Sistema GR funcionando
