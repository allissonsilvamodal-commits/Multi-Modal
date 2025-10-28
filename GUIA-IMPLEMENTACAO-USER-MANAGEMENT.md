# 📋 Guia de Implementação - Sistema de Gerenciamento de Usuários

## ✅ O que foi feito

### 1. Schema do Banco de Dados Criado (`sql/user-management-schema.sql`)

O arquivo SQL contém:
- ✅ Tabela `user_profiles` com campos completos
- ✅ Tabela `user_evolution_apis` para credenciais da Evolution API
- ✅ Row Level Security (RLS) implementado
- ✅ Políticas de segurança para usuários e admins
- ✅ Função automática para criar perfis (`handle_new_user`)
- ✅ Função para validar credenciais da Evolution API
- ✅ Índices para performance

## 🔧 Próximos Passos para Implementação

### Passo 1: Aplicar o Schema no Supabase

```bash
# No terminal do Supabase (Dashboard SQL Editor) ou via Supabase CLI
# Execute o arquivo: sql/user-management-schema.sql
```

### Passo 2: Atualizar `settings.html`

Adicionar nova aba para gerenciamento de Evolution API:

```html
<!-- Nova aba depois de "Configurações do Sistema" -->
<li class="nav-item">
    <a class="nav-link" data-bs-toggle="tab" href="#tabEvolutionAPI">
        <i class="fas fa-key me-2"></i>Minhas Credenciais Evolution
    </a>
</li>
```

### Passo 3: Criar Interface de Gerenciamento de API

Na nova aba, adicionar:
- Formulário para cadastrar API Key, URL e Instance Name
- Lista de credenciais cadastradas
- Botão para validar credenciais
- Indicador de status (válido/inválido)

### Passo 4: Atualizar Tab Usuários

Modificar a tab "Usuários" para:
- Listar usuários da tabela `user_profiles` (não mais `usuarios`)
- Mostrar role, departamento, status ativo
- Permitir alterar roles (apenas admin)
- Mostrar data de último login

### Passo 5: Implementar Backend

Atualizar funções JavaScript em `settings.html`:

1. **`carregarUsuarios()`** - Usar `user_profiles` em vez de `usuarios`
2. **`carregarEvolutionAPIs()`** - Nova função para carregar credenciais
3. **`salvarEvolutionAPI()`** - Nova função para salvar credenciais
4. **`validarEvolutionAPI()`** - Nova função para validar credenciais

## 🎯 Funcionalidades Implementadas

### ✅ Sistema de Autenticação
- ✅ Usa Supabase Auth nativamente
- ✅ Perfis criados automaticamente quando usuário é registrado
- ✅ Controle de sessão com 12 horas de timeout
- ✅ Logout funcional

### ✅ Controle de Autorização
- ✅ Tabela `user_profiles` com roles (admin, user, manager, operator)
- ✅ RLS implementado
- ✅ Usuários veem apenas seus dados
- ✅ Admins veem todos os dados

### ⏳ Gestão de API Evolution (Implementar)
- ⏳ Interface no `settings.html`
- ⏳ Validação de credenciais
- ⏳ Vinculação exclusiva por usuário
- ⏳ Histórico de uso

### ⏳ Atualizações no Settings.html (Implementar)
- ⏳ Nova aba "Minhas Credenciais Evolution"
- ⏳ Interface para cadastrar/editar credenciais
- ⏳ Lista de credenciais cadastradas
- ⏳ Botão para validar credenciais

## 📝 Estrutura das Tabelas

### `user_profiles`
```sql
- id (UUID) - Referência ao auth.users
- role (TEXT) - 'admin', 'user', 'manager', 'operator'
- nome (TEXT)
- departamento (TEXT)
- active (BOOLEAN)
- created_at, updated_at, last_login
- telefone, cargo, observacoes
```

### `user_evolution_apis`
```sql
- id (UUID) - Chave primária
- user_id (UUID) - Referência a user_profiles
- api_key (TEXT) - Chave da API
- api_url (TEXT) - URL da API
- instance_name (TEXT) - Nome da instância
- active (BOOLEAN) - Status ativo/inativo
- last_used (TIMESTAMP) - Último uso
- is_valid (BOOLEAN) - Credenciais válidas?
- validation_message (TEXT) - Mensagem de validação
```

## 🔐 Políticas de Segurança

### Para usuários normais:
- ✅ Podem ver apenas seu próprio perfil
- ✅ Podem atualizar apenas seu próprio perfil
- ✅ Podem ver apenas suas próprias credenciais da API
- ✅ Podem inserir/atualizar/deletar apenas suas credenciais

### Para administradores:
- ✅ Podem ver todos os perfis
- ✅ Podem gerenciar todos os perfis
- ✅ Podem ver todas as credenciais da API
- ✅ Podem gerenciar todas as credenciais da API

## 🚀 Como Usar

1. **Aplicar o schema no Supabase**
2. **Atualizar `settings.html` com novas funcionalidades**
3. **Testar login com novo usuário** (perfil será criado automaticamente)
4. **Cadastrar credenciais da Evolution API**
5. **Validar credenciais**

## 📌 Notas Importantes

- O sistema atual ainda usa a tabela `usuarios` antiga
- Após aplicar o schema, precisará migrar dados da tabela `usuarios` para `user_profiles`
- O registro de usuários deve ser feito via Supabase Auth, não manualmente
- As credenciais da Evolution API são privadas por usuário (RLS)

## ⚠️ Alerta

Este sistema NÃO integra ainda com o sistema atual de login. A integração completa requer:

1. Atualizar `login.html` para criar perfis automaticamente
2. Atualizar `settings.html` com nova interface
3. Migrar dados da tabela `usuarios` antiga
4. Atualizar `painel.html` para usar credenciais por usuário
