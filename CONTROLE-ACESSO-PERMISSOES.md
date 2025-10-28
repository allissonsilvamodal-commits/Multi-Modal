# Sistema de Controle de Acesso por Permissões

## ✅ Implementação Concluída

Sistema completo de controle de acesso que garante que os usuários só acessem as páginas para as quais têm permissão, conforme configurado em `settings.html`.

---

## 🎯 Como Funciona

### 1. **Configuração de Permissões**

Na página `Settings > Permissões`:
- Selecione um usuário
- Ative/desative as permissões desejadas com os switches:
  - **Operações** (painel)
  - **Cadastro** (cadastro)
  - **Relatórios** (relatorios)
  - **Monitoramento** (monitoramento)
  - **Comercial** (comercial)
  - **Vendas** (vendas)
  - **CRM** (crm)
  - **Coletas** (coletas)

### 2. **Verificação Automática**

Todas as páginas verificam as permissões ao carregar:

1. Usuário tenta acessar uma página
2. Sistema verifica se o usuário é **admin** (admins têm acesso total)
3. Se não for admin, consulta as permissões em `permissoes_portal`
4. Se não tiver permissão, redireciona para o portal com mensagem

### 3. **Páginas Protegidas**

As seguintes páginas exigem permissão:
- ✅ `painel.html` → precisa de permissão `operacoes`
- ✅ `cadastro.html` → precisa de permissão `cadastro`
- ✅ `coletas.html` → precisa de permissão `coletas`
- ✅ `relatorios.html` → precisa de permissão `relatorios`
- ✅ `comercial.html` → precisa de permissão `comercial`
- ✅ `vendas.html` → precisa de permissão `vendas`
- ✅ `crm.html` → precisa de permissão `crm`
- ✅ `monitoramento.html` → precisa de permissão `monitoramento`

---

## 📁 Arquivos Modificados

### 1. **js/permissions.js** (NOVO)
Sistema centralizado de verificação de permissões:
- `verificarPermissaoPagina(pageName)` - Verifica se tem permissão
- `verificarEAplicarPermissao(pageName)` - Verifica e redireciona se não tiver
- `paginaDisponivel(pageName)` - Retorna true/false

### 2. **Páginas HTML Atualizadas**
Todas as páginas principais agora verificam permissões antes de carregar:

#### painel.html
```javascript
const temPermissao = await verificarEAplicarPermissao('painel');
if (!temPermissao) return;
```

#### coletas.html
```javascript
const temPermissao = await verificarEAplicarPermissao('coletas');
if (!temPermissao) return;
```

#### cadastro.html
```javascript
const temPermissao = await verificarEAplicarPermissao('cadastro');
if (!temPermissao) return;
```

#### relatorios.html
```javascript
const temPermissao = await verificarEAplicarPermissao('relatorios');
if (!temPermissao) return;
```

#### comercial.html
```javascript
const temPermissao = await verificarEAplicarPermissao('comercial');
if (!temPermissao) return;
```

#### vendas.html
```javascript
const temPermissao = await verificarEAplicarPermissao('vendas');
if (!temPermissao) return;
```

---

## 🔐 Regras de Segurança

### Admin vs Usuário Comum
- **Admin**: Acesso total a todas as páginas (bypass automático)
- **Usuário**: Somente páginas com permissão ativa

### Comportamento ao Não Ter Permissão
1. Mensagem amigável: "Acesso Negado - Você não tem permissão para acessar esta página"
2. Redirecionamento automático para `portal.html`
3. Log detalhado no console do navegador

### Segurança no Backend
- Permissões são consultadas diretamente no Supabase
- Cache de permissões é evitado (consulta sempre no banco)
- Erros resultam em negação de acesso (fail-secure)

---

## 📋 Exemplo de Uso

### Configurar Permissões para um Usuário

1. Acesse `Settings > Permissões`
2. Selecione o usuário desejado
3. Ative as permissões necessárias:
   - ✅ Operações → permite acesso ao Painel
   - ✅ Cadastro → permite acesso ao Cadastro
   - ✅ Relatórios → permite acesso aos Relatórios
   - etc.

### Resultado
O usuário só poderá acessar as páginas com permissão ativa. Tentativas de acesso a outras páginas resultarão em redirecionamento.

---

## 🎯 Mapeamento de Permissões

| Página | ID de Permissão | Descrição |
|--------|-----------------|-----------|
| painel.html | `operacoes` | Painel de disparo |
| cadastro.html | `cadastro` | Cadastro de motoristas |
| coletas.html | `coletas` | Sistema de coletas |
| relatorios.html | `relatorios` | Relatórios |
| comercial.html | `comercial` | Área comercial |
| vendas.html | `vendas` | Vendas |
| crm.html | `crm` | CRM |
| monitoramento.html | `monitoramento` | Monitoramento |

---

## 🚀 Fluxo de Verificação

```
1. Usuário acessa painel.html
2. verificarEAplicarPermissao('painel') é chamado
3. Sistema busca user_id do localStorage
4. Consulta permissoes_portal no Supabase
5. Verifica se 'operacoes' está na lista de permissões
6a. ✅ Se tiver: página carrega normalmente
6b. ❌ Se não tiver: redireciona para portal.html com mensagem
```

---

## ✅ Benefícios

1. **Segurança**: Usuários só acessam o que têm autorização
2. **Simplicidade**: Configuração centralizada em Settings
3. **Flexibilidade**: Permissões granulares por usuário
4. **Manutenibilidade**: Código centralizado em permissions.js
5. **Auditoria**: Logs detalhados de tentativas de acesso

---

**Data de Implementação**: 27/10/2025  
**Status**: ✅ Implementado e Funcionando

