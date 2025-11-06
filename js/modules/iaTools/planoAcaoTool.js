/**
 * Ferramenta de Plano de Ação
 * Organiza ações com status, responsáveis e prazos
 */

/**
 * Gera plano de ação estruturado com base nas informações fornecidas
 * @param {string} contexto - Informações para criar o plano de ação
 * @returns {Promise<Object>} Objeto com plano de ação estruturado
 */
async function gerarAnalise(contexto) {
    if (!contexto || typeof contexto !== 'string' || contexto.trim() === '') {
        throw new Error('Contexto é obrigatório para plano de ação');
    }

    const prompt = `Resuma e organize as ações em um formato de plano de ação estruturado com status, responsáveis e prazos.

${contexto.trim()}

Retorne um plano de ação organizado em formato de tabela ou lista estruturada, incluindo:
- Descrição da ação
- Responsável
- Prazo
- Status
- Observações (se houver)`;

    try {
        const response = await fetch('/api/ferramentas-qualidade/ia/assistente', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ 
                ferramenta: 'planoAcao',
                prompt: prompt
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao gerar plano de ação');
        }

        return {
            success: true,
            resposta: data.resposta,
            tipo: 'planoAcao'
        };
    } catch (error) {
        console.error('❌ Erro ao gerar plano de ação:', error);
        throw error;
    }
}

export { gerarAnalise };

