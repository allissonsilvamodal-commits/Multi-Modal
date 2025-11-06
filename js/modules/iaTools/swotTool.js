/**
 * Ferramenta de Análise SWOT
 * Gera análise SWOT completa usando IA
 */

/**
 * Gera análise SWOT com base no contexto fornecido
 * @param {string} contexto - Contexto/problema a ser analisado
 * @returns {Promise<Object>} Objeto com análise SWOT estruturada
 */
async function gerarAnalise(contexto) {
    if (!contexto || typeof contexto !== 'string' || contexto.trim() === '') {
        throw new Error('Contexto é obrigatório para análise SWOT');
    }

    try {
        const response = await fetch('/api/ferramentas-qualidade/ia/swot', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ contexto: contexto.trim() })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao gerar análise SWOT');
        }

        return {
            success: true,
            dados: data.dados || data,
            tipo: 'swot'
        };
    } catch (error) {
        console.error('❌ Erro ao gerar análise SWOT:', error);
        throw error;
    }
}

export { gerarAnalise };

