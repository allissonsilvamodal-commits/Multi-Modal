/**
 * Ferramenta PDCA (Plan-Do-Check-Act)
 * Cria ciclo PDCA estruturado com base em ações e resultados
 */

/**
 * Gera análise PDCA com base nas ações e resultados fornecidos
 * @param {string} contexto - Ações e resultados para criar o ciclo PDCA
 * @returns {Promise<Object>} Objeto com análise PDCA estruturada
 */
async function gerarAnalise(contexto) {
    if (!contexto || typeof contexto !== 'string' || contexto.trim() === '') {
        throw new Error('Contexto é obrigatório para análise PDCA');
    }

    const prompt = `Crie um ciclo PDCA estruturado com base nas ações e resultados informados:

${contexto.trim()}

Retorne uma análise estruturada organizando as informações em:
- PLAN (Planejar): O que será feito e como
- DO (Fazer): Execução das ações planejadas
- CHECK (Verificar): Análise dos resultados obtidos
- ACT (Agir): Ajustes e melhorias baseados na verificação`;

    try {
        const response = await fetch('/api/ferramentas-qualidade/ia/assistente', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ 
                ferramenta: 'pdca',
                prompt: prompt
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao gerar análise PDCA');
        }

        return {
            success: true,
            resposta: data.resposta,
            tipo: 'pdca'
        };
    } catch (error) {
        console.error('❌ Erro ao gerar análise PDCA:', error);
        throw error;
    }
}

export { gerarAnalise };

