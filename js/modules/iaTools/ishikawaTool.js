/**
 * Ferramenta de Diagrama de Ishikawa (Espinha de Peixe)
 * Identifica causas e subcausas organizadas por categorias
 */

/**
 * Gera análise de Ishikawa com base no problema fornecido
 * @param {string} contexto - Problema a ser analisado
 * @returns {Promise<Object>} Objeto com análise de causas estruturada
 */
async function gerarAnalise(contexto) {
    if (!contexto || typeof contexto !== 'string' || contexto.trim() === '') {
        throw new Error('Contexto é obrigatório para análise de Ishikawa');
    }

    const prompt = `Liste as possíveis causas e subcausas do problema informado, organizadas por: Método, Mão de Obra, Máquina, Material, Medida e Meio Ambiente.

Problema: ${contexto.trim()}

Retorne uma análise estruturada identificando causas principais e subcausas em cada categoria.`;

    try {
        const response = await fetch('/api/ferramentas-qualidade/ia/assistente', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ 
                ferramenta: 'ishikawa',
                prompt: prompt
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao gerar análise de Ishikawa');
        }

        return {
            success: true,
            resposta: data.resposta,
            tipo: 'ishikawa'
        };
    } catch (error) {
        console.error('❌ Erro ao gerar análise de Ishikawa:', error);
        throw error;
    }
}

export { gerarAnalise };

