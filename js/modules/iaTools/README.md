# 🧠 Módulo de Orquestração de Ferramentas de Qualidade com IA

Este módulo centraliza e automatiza o uso da IA em todas as ferramentas de qualidade do sistema.

## 📁 Estrutura

```
js/modules/iaTools/
├── index.js              # Módulo principal de orquestração
├── swotTool.js           # Ferramenta SWOT
├── forcaImpactoTool.js   # Matriz Força x Impacto
├── ishikawaTool.js       # Diagrama de Ishikawa
├── cincoPorquesTool.js   # Técnica dos 5 Porquês
├── cincoW2HTool.js       # Ferramenta 5W2H
├── pdcaTool.js           # Ciclo PDCA
├── planoAcaoTool.js      # Plano de Ação
└── README.md             # Esta documentação
```

## 🚀 Uso Básico

### Importar o módulo

```javascript
import { executarFerramenta } from './js/modules/iaTools/index.js';
```

### Executar uma ferramenta

```javascript
// Exemplo: Análise SWOT
try {
    const resultado = await executarFerramenta(
        'swot',
        'Atraso nas entregas por falta de manutenção preventiva'
    );
    console.log(resultado);
} catch (error) {
    console.error('Erro:', error.message);
}
```

## 📋 Ferramentas Disponíveis

### 1. SWOT (`swot`)
Análise SWOT completa com Forças, Fraquezas, Oportunidades e Ameaças.

```javascript
const resultado = await executarFerramenta('swot', 'Contexto do problema');
// Retorna: { success: true, dados: {...}, tipo: 'swot' }
```

### 2. Matriz Força x Impacto (`forcaImpacto`)
Priorização de itens baseada em facilidade e impacto.

```javascript
const resultado = await executarFerramenta('forcaImpacto', [
    'Implementar sistema de rastreamento',
    'Treinar equipe',
    'Atualizar processos'
]);
// ou
const resultado = await executarFerramenta('forcaImpacto', 'Lista de itens...');
```

### 3. Ishikawa (`ishikawa`)
Identificação de causas e subcausas organizadas por categorias.

```javascript
const resultado = await executarFerramenta(
    'ishikawa',
    'Problema: Atraso nas entregas'
);
// Retorna: { success: true, resposta: '...', tipo: 'ishikawa' }
```

### 4. 5 Porquês (`cincoPorques`)
Identificação da causa raiz através de questionamentos sequenciais.

```javascript
const resultado = await executarFerramenta(
    'cincoPorques',
    'Problema: Produto com defeito'
);
```

### 5. 5W2H (`cincoW2H`)
Plano estruturado com What, Why, Where, When, Who, How e How Much.

```javascript
const resultado = await executarFerramenta(
    'cincoW2H',
    'Informações sobre o projeto...'
);
```

### 6. PDCA (`pdca`)
Ciclo de melhoria contínua estruturado.

```javascript
const resultado = await executarFerramenta(
    'pdca',
    'Ações e resultados do projeto...'
);
```

### 7. Plano de Ação (`planoAcao`)
Organização de ações com status, responsáveis e prazos.

```javascript
const resultado = await executarFerramenta(
    'planoAcao',
    'Lista de ações a serem organizadas...'
);
```

## 🔧 Funções Auxiliares

### Listar ferramentas disponíveis

```javascript
import { listarFerramentas } from './js/modules/iaTools/index.js';

const ferramentas = listarFerramentas();
console.log(ferramentas);
// [
//   { id: 'swot', nome: 'SWOT', descricao: '...' },
//   { id: 'ishikawa', nome: 'Ishikawa', descricao: '...' },
//   ...
// ]
```

### Obter informações de uma ferramenta

```javascript
import { obterInfoFerramenta } from './js/modules/iaTools/index.js';

const info = obterInfoFerramenta('swot');
console.log(info);
// { id: 'swot', nome: 'SWOT', descricao: '...' }
```

### Validar nome da ferramenta

```javascript
import { validarFerramenta } from './js/modules/iaTools/index.js';

if (validarFerramenta('swot')) {
    console.log('Ferramenta válida!');
}
```

## 📝 Exemplo Completo

```html
<!DOCTYPE html>
<html>
<head>
    <title>Exemplo de Uso - Ferramentas IA</title>
    <script type="module">
        import { executarFerramenta, listarFerramentas } from './js/modules/iaTools/index.js';

        // Listar ferramentas disponíveis
        console.log('Ferramentas disponíveis:', listarFerramentas());

        // Executar análise SWOT
        async function analisarProblema() {
            try {
                const contexto = 'Atraso nas entregas por falta de manutenção preventiva';
                const resultado = await executarFerramenta('swot', contexto);
                
                console.log('Análise SWOT:', resultado);
                
                // Usar o resultado
                if (resultado.success && resultado.dados) {
                    console.log('Forças:', resultado.dados.forcas);
                    console.log('Fraquezas:', resultado.dados.fraquezas);
                    console.log('Oportunidades:', resultado.dados.oportunidades);
                    console.log('Ameaças:', resultado.dados.ameacas);
                }
            } catch (error) {
                console.error('Erro na análise:', error.message);
            }
        }

        // Executar análise de Ishikawa
        async function analisarCausas() {
            try {
                const resultado = await executarFerramenta(
                    'ishikawa',
                    'Problema: Produto com defeito na linha de produção'
                );
                
                console.log('Análise de Causas:', resultado.resposta);
            } catch (error) {
                console.error('Erro na análise:', error.message);
            }
        }

        // Executar quando a página carregar
        window.addEventListener('DOMContentLoaded', () => {
            analisarProblema();
            analisarCausas();
        });
    </script>
</head>
<body>
    <h1>Exemplo de Uso das Ferramentas de Qualidade com IA</h1>
    <p>Abra o console do navegador para ver os resultados.</p>
</body>
</html>
```

## ⚠️ Tratamento de Erros

Todas as funções podem lançar erros. Sempre use try-catch:

```javascript
try {
    const resultado = await executarFerramenta('swot', contexto);
    // Processar resultado
} catch (error) {
    console.error('Erro:', error.message);
    // Tratar erro (exibir mensagem ao usuário, etc.)
}
```

## 🔗 Integração com o Sistema

Este módulo utiliza as rotas de IA já existentes no backend:

- `/api/ferramentas-qualidade/ia/swot` - Análise SWOT
- `/api/ferramentas-qualidade/ia/priorizacao` - Matriz Força x Impacto
- `/api/ferramentas-qualidade/ia/assistente` - Outras ferramentas (Ishikawa, 5 Porquês, etc.)

Todas as requisições incluem `credentials: 'include'` para manter a autenticação.

## 📚 Prompts Padrão

Cada ferramenta usa prompts específicos otimizados para gerar análises estruturadas:

- **SWOT**: Prompt focado em identificar os 4 quadrantes da matriz
- **Força x Impacto**: Prompt para classificação numérica (1-5) de facilidade e impacto
- **Ishikawa**: Prompt estruturado por categorias (Método, Mão de Obra, etc.)
- **5 Porquês**: Prompt sequencial para identificar causa raiz
- **5W2H**: Prompt estruturado para preencher todos os campos
- **PDCA**: Prompt organizado por etapas do ciclo
- **Plano de Ação**: Prompt focado em organização com status e prazos

