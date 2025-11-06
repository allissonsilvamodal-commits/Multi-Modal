/**
 * Ferramenta 5W2H
 * Estrutura plano de ação com What, Why, Where, When, Who, How e How Much
 */

/**
 * Gera análise 5W2H com base nas informações fornecidas
 * @param {string} contexto - Informações para montar o plano 5W2H
 * @returns {Promise<Object>} Objeto com análise 5W2H estruturada
 */
async function gerarAnalise(contexto) {
    if (!contexto || typeof contexto !== 'string' || contexto.trim() === '') {
        throw new Error('Contexto é obrigatório para análise 5W2H');
    }

    const prompt = `Com base nas informações a seguir, monte um plano 5W2H completo com: What (O quê), Why (Por quê), Where (Onde), When (Quando), Who (Quem), How (Como) e How Much (Quanto custa).

${contexto.trim()}

Retorne uma análise estruturada preenchendo todos os campos do 5W2H.`;

    try {
        const response = await fetch('/api/ferramentas-qualidade/ia/assistente', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ 
                ferramenta: 'cincoW2H',
                prompt: prompt
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao gerar análise 5W2H');
        }

        return {
            success: true,
            resposta: data.resposta,
            tipo: 'cincoW2H'
        };
    } catch (error) {
        console.error('❌ Erro ao gerar análise 5W2H:', error);
        throw error;
    }
}

export { gerarAnalise };

