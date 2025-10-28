# Sistema de Etiquetas para Coletas - Implementação Completa

## ✅ IMPLEMENTADO

### 1. **Banco de Dados** ✅
- **Tabela criada:** `etiquetas_coletas`
- **Tabela criada:** `coleta_etiquetas`
- **Campo adicionado:** `etiquetas` (JSONB) na tabela `coletas`
- **Migração aplicada:** ✅

### 2. **Settings.html** ✅
- **Aba "Etiquetas"** criada
- **Modal de criação** funcionando
- **Funções JavaScript:**
  - `carregarEtiquetas()` - Lista todas as etiquetas
  - `abrirModalNovaEtiqueta()` - Abre modal para criar
  - `salvarNovaEtiqueta()` - Salva nova etiqueta no Supabase
  - `excluirEtiqueta()` - Remove etiqueta
  - Input de cor com color picker
  - Input de descrição

## ⏳ FALTA IMPLEMENTAR

### 3. **coletas.html - Integração de Etiquetas**

**O que precisa ser feito:**

#### A. **Carregar Etiquetas Disponíveis**
```javascript
let etiquetasDisponiveis = [];

async function carregarEtiquetasDisponiveis() {
    const { data } = await supabase
        .from('etiquetas_coletas')
        .select('*')
        .eq('ativo', true);
    etiquetasDisponiveis = data || [];
}
```

#### B. **Seção de Etiquetas nos Cards**
Adicionar na renderização dos cards (após a linha 3830):
```html
<div class="etiquetas-container">
    <div class="etiquetas-header">
        <span><i class="fas fa-tags"></i> Etiquetas</span>
        <button onclick="abrirModalEtiquetas('${coleta.id}')">Gerenciar</button>
    </div>
    <div id="etiquetas-${coleta.id}" class="etiquetas-list">
        <!-- Etiquetas serão carregadas aqui -->
    </div>
</div>
```

#### C. **Modal de Seleção de Etiquetas**
Criar modal para adicionar/remover etiquetas de uma coleta específica.

#### D. **Funções de Gerenciamento**
- `abrirModalEtiquetas(coletaId)` - Abre modal com etiquetas
- `adicionarEtiquetaAColeta(coletaId, etiquetaId)` 
- `removerEtiquetaDaColeta(coletaId, etiquetaId)`
- `renderizarEtiquetasColeta(coletaId)` - Exibe etiquetas no card

## 📝 COMO USAR (Após Implementação Completa)

### Para Admin (Settings):
1. Ir em Settings > Etiquetas
2. Clicar em "Criar Nova Etiqueta"
3. Preencher:
   - **Nome:** "Adiantamento de Frete"
   - **Cor:** Selecionar cor (ex: azul #2196F3)
   - **Descrição:** "Para coletas que precisam de adiantamento"
4. Salvar

### Para Usuários (Coletas):
1. Abrir um card de coleta
2. Clicar em "Gerenciar" nas etiquetas
3. Selecionar etiquetas relevantes
4. As etiquetas aparecerão no card com a cor definida
5. Todos verão visualmente o status da coleta

## 🎯 PRÓXIMO PASSO

**Implementar no coletas.html:**
1. Carregar etiquetas ao inicializar
2. Renderizar etiquetas nos cards
3. Criar modal para gerenciar etiquetas
4. Adicionar/remover etiquetas das coletas

