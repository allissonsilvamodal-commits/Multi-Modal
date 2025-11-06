/**
 * Ferramenta de Matriz Força x Impacto
 * Analisa e prioriza itens baseado em facilidade e impacto
 */

/**
 * Gera análise de Força x Impacto com base nos itens fornecidos
 * @param {string|Array} itens - Itens a serem analisados (string ou array)
 * @returns {Promise<Object>} Objeto com análise de força e impacto
 */
async function gerarAnalise(itens) {
    if (!itens) {
        throw new Error('Itens são obrigatórios para análise de Força x Impacto');
    }

    // Converter array para string se necessário
    let itensStr = Array.isArray(itens) ? itens.join('\n') : String(itens);
    
    if (itensStr.trim() === '') {
        throw new Error('Itens não podem estar vazios');
    }

    try {
        const response = await fetch('/api/ferramentas-qualidade/ia/priorizacao', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ itens: itensStr.trim() })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao gerar análise de Força x Impacto');
        }

        return {
            success: true,
            dados: data.dados || data,
            tipo: 'forcaImpacto'
        };
    } catch (error) {
        console.error('❌ Erro ao gerar análise de Força x Impacto:', error);
        throw error;
    }
}

export { gerarAnalise };

