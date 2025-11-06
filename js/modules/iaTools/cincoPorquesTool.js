/**
 * Ferramenta dos 5 Porquês
 * Identifica a causa raiz através de questionamentos sequenciais
 */

/**
 * Gera análise dos 5 Porquês com base no problema fornecido
 * @param {string} contexto - Problema a ser analisado
 * @returns {Promise<Object>} Objeto com análise dos 5 Porquês
 */
async function gerarAnalise(contexto) {
    if (!contexto || typeof contexto !== 'string' || contexto.trim() === '') {
        throw new Error('Contexto é obrigatório para análise dos 5 Porquês');
    }

    const prompt = `Aplique a técnica dos 5 Porquês ao problema informado e identifique a causa raiz.

Problema: ${contexto.trim()}

Retorne uma análise estruturada mostrando cada "porquê" sequencialmente até chegar à causa raiz.`;

    try {
        const response = await fetch('/api/ferramentas-qualidade/ia/assistente', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ 
                ferramenta: 'cincoPorques',
                prompt: prompt
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao gerar análise dos 5 Porquês');
        }

        return {
            success: true,
            resposta: data.resposta,
            tipo: 'cincoPorques'
        };
    } catch (error) {
        console.error('❌ Erro ao gerar análise dos 5 Porquês:', error);
        throw error;
    }
}

export { gerarAnalise };

