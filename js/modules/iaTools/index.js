/**
 * Módulo de Orquestração de Ferramentas de Qualidade com IA
 * Centraliza todas as ferramentas de qualidade e suas análises via IA
 */

import { gerarAnalise as swotAnalise } from './swotTool.js';
import { gerarAnalise as forcaImpactoAnalise } from './forcaImpactoTool.js';
import { gerarAnalise as ishikawaAnalise } from './ishikawaTool.js';
import { gerarAnalise as cincoPorquesAnalise } from './cincoPorquesTool.js';
import { gerarAnalise as cincoW2HAnalise } from './cincoW2HTool.js';
import { gerarAnalise as pdcaAnalise } from './pdcaTool.js';
import { gerarAnalise as planoAcaoAnalise } from './planoAcaoTool.js';

/**
 * Mapeamento de todas as ferramentas disponíveis
 */
const ferramentasIA = {
    swot: {
        nome: 'SWOT',
        descricao: 'Análise SWOT (Forças, Fraquezas, Oportunidades e Ameaças)',
        gerarAnalise: swotAnalise
    },
    forcaImpacto: {
        nome: 'Matriz Força x Impacto',
        descricao: 'Priorização baseada em facilidade e impacto',
        gerarAnalise: forcaImpactoAnalise
    },
    ishikawa: {
        nome: 'Ishikawa',
        descricao: 'Diagrama de Causa e Efeito (Espinha de Peixe)',
        gerarAnalise: ishikawaAnalise
    },
    cincoPorques: {
        nome: '5 Porquês',
        descricao: 'Identificação da causa raiz através de questionamentos',
        gerarAnalise: cincoPorquesAnalise
    },
    cincoW2H: {
        nome: '5W2H',
        descricao: 'Plano estruturado com What, Why, Where, When, Who, How e How Much',
        gerarAnalise: cincoW2HAnalise
    },
    pdca: {
        nome: 'PDCA',
        descricao: 'Ciclo de melhoria contínua (Plan-Do-Check-Act)',
        gerarAnalise: pdcaAnalise
    },
    planoAcao: {
        nome: 'Plano de Ação',
        descricao: 'Organização de ações com status, responsáveis e prazos',
        gerarAnalise: planoAcaoAnalise
    }
};

/**
 * Lista de nomes válidos das ferramentas
 */
const ferramentasValidas = Object.keys(ferramentasIA);

/**
 * Valida se o nome da ferramenta é válido
 * @param {string} ferramenta - Nome da ferramenta
 * @returns {boolean} True se válida, false caso contrário
 */
function validarFerramenta(ferramenta) {
    return ferramentasValidas.includes(ferramenta);
}

/**
 * Executa uma ferramenta de qualidade específica com IA
 * @param {string} ferramenta - Nome da ferramenta (swot, ishikawa, etc.)
 * @param {string|Array} contexto - Contexto/dados para análise
 * @returns {Promise<Object>} Resultado da análise da IA
 * @throws {Error} Se a ferramenta for inválida ou ocorrer erro na análise
 */
async function executarFerramenta(ferramenta, contexto) {
    // Validar nome da ferramenta
    if (!ferramenta || typeof ferramenta !== 'string') {
        throw new Error('Nome da ferramenta é obrigatório');
    }

    // Normalizar: remover espaços e tentar encontrar a ferramenta
    const ferramentaNormalizada = ferramenta.trim();
    
    // Mapeamento de variações de nomes para nomes canônicos
    const mapeamentoNomes = {
        'forcaimpacto': 'forcaImpacto',
        'forca-impacto': 'forcaImpacto',
        'forca_impacto': 'forcaImpacto',
        'cinco-porques': 'cincoPorques',
        '5porques': 'cincoPorques',
        'cinco-porquês': 'cincoPorques',
        'cinco-w2h': 'cincoW2H',
        '5w2h': 'cincoW2H',
        'plano-acao': 'planoAcao',
        'plano-acão': 'planoAcao'
    };
    
    // Primeiro tentar usar o nome diretamente (caso seja camelCase)
    let nomeFinal = ferramentaNormalizada;
    
    // Se não encontrar, tentar mapear usando lowercase
    if (!validarFerramenta(nomeFinal)) {
        const nomeLower = ferramentaNormalizada.toLowerCase();
        nomeFinal = mapeamentoNomes[nomeLower] || ferramentaNormalizada;
    }

    if (!validarFerramenta(nomeFinal)) {
        const ferramentasDisponiveis = ferramentasValidas.join(', ');
        throw new Error(
            `Ferramenta "${ferramenta}" não encontrada. ` +
            `Ferramentas disponíveis: ${ferramentasDisponiveis}`
        );
    }

    // Validar contexto
    if (!contexto) {
        throw new Error('Contexto é obrigatório para análise');
    }

    // Obter função de análise da ferramenta
    const ferramentaInfo = ferramentasIA[nomeFinal];
    
    if (!ferramentaInfo || typeof ferramentaInfo.gerarAnalise !== 'function') {
        throw new Error(`Ferramenta "${ferramenta}" não possui função de análise configurada`);
    }

    try {
        console.log(`🔧 Executando ferramenta: ${ferramentaInfo.nome}`);
        console.log(`📋 Contexto: ${typeof contexto === 'string' ? contexto.substring(0, 100) + '...' : 'Array de itens'}`);

        // Executar análise
        const resultado = await ferramentaInfo.gerarAnalise(contexto);

        console.log(`✅ Análise concluída: ${ferramentaInfo.nome}`);
        return resultado;
    } catch (error) {
        console.error(`❌ Erro ao executar ferramenta ${ferramentaInfo.nome}:`, error);
        throw new Error(`Erro ao executar ${ferramentaInfo.nome}: ${error.message}`);
    }
}

/**
 * Lista todas as ferramentas disponíveis
 * @returns {Array} Array com informações de todas as ferramentas
 */
function listarFerramentas() {
    return ferramentasValidas.map(chave => ({
        id: chave,
        nome: ferramentasIA[chave].nome,
        descricao: ferramentasIA[chave].descricao
    }));
}

/**
 * Obtém informações sobre uma ferramenta específica
 * @param {string} ferramenta - Nome da ferramenta
 * @returns {Object|null} Informações da ferramenta ou null se não encontrada
 */
function obterInfoFerramenta(ferramenta) {
    if (!validarFerramenta(ferramenta)) {
        return null;
    }

    const ferramentaInfo = ferramentasIA[ferramenta];
    return {
        id: ferramenta,
        nome: ferramentaInfo.nome,
        descricao: ferramentaInfo.descricao
    };
}

// Exportações
export {
    executarFerramenta,
    listarFerramentas,
    obterInfoFerramenta,
    validarFerramenta,
    ferramentasIA,
    ferramentasValidas
};

// Exportação padrão para compatibilidade
export default {
    executarFerramenta,
    listarFerramentas,
    obterInfoFerramenta,
    validarFerramenta,
    ferramentasIA,
    ferramentasValidas
};

