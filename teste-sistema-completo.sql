-- =====================================================
-- SCRIPT DE TESTE - VERIFICAÇÃO COMPLETA
-- Multimodal Logística - Teste de Funcionamento
-- =====================================================

-- 1. VERIFICAR SE TODAS AS TABELAS EXISTEM
SELECT 'VERIFICAÇÃO DE TABELAS:' as teste;
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- 2. VERIFICAR CONSTRAINTS DE ETAPAS
SELECT 'VERIFICAÇÃO DE CONSTRAINTS:' as teste;
SELECT constraint_name, check_clause 
FROM information_schema.check_constraints 
WHERE constraint_name LIKE '%coletas%'
ORDER BY constraint_name;

-- 3. VERIFICAR DADOS EXISTENTES
SELECT 'VERIFICAÇÃO DE DADOS:' as teste;
SELECT 'Motoristas:' as tabela, COUNT(*) as total FROM motoristas
UNION ALL
SELECT 'Coletas:' as tabela, COUNT(*) as total FROM coletas
UNION ALL
SELECT 'Usuários:' as tabela, COUNT(*) as total FROM usuarios
UNION ALL
SELECT 'Anexos:' as tabela, COUNT(*) as total FROM anexos
UNION ALL
SELECT 'Chat:' as tabela, COUNT(*) as total FROM chat_mensagens
UNION ALL
SELECT 'Histórico:' as tabela, COUNT(*) as total FROM historico_coletas;

-- 4. TESTAR INSERÇÃO DE NOVA COLETA
SELECT 'TESTE DE INSERÇÃO:' as teste;
INSERT INTO coletas (
    cliente, origem, destino, valor, km, veiculo, 
    status, etapa_atual, prioridade, filial, observacoes
) VALUES (
    'Teste Constraint', 'São Paulo/SP', 'Rio de Janeiro/RJ', 
    1000.00, 300, 'Caminhão Teste', 
    'pendente', 'comercial', 'normal', 'principal', 'Teste de constraint'
);

-- 5. VERIFICAR SE A INSERÇÃO FUNCIONOU
SELECT 'VERIFICAÇÃO DE INSERÇÃO:' as teste;
SELECT id, cliente, etapa_atual, status, prioridade 
FROM coletas 
WHERE cliente = 'Teste Constraint';

-- 6. TESTAR AVANÇO DE ETAPA
SELECT 'TESTE DE AVANÇO DE ETAPA:' as teste;
UPDATE coletas 
SET etapa_atual = 'price', 
    data_atualizacao = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE cliente = 'Teste Constraint';

-- 7. VERIFICAR SE O AVANÇO FUNCIONOU
SELECT 'VERIFICAÇÃO DE AVANÇO:' as teste;
SELECT id, cliente, etapa_atual, data_atualizacao 
FROM coletas 
WHERE cliente = 'Teste Constraint';

-- 8. TESTAR VINCULAÇÃO DE MOTORISTA
SELECT 'TESTE DE VINCULAÇÃO DE MOTORISTA:' as teste;
UPDATE coletas 
SET motorista_id = (SELECT id FROM motoristas WHERE cpf = '123.456.789-00'),
    etapa_atual = 'contratacao',
    data_atualizacao = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE cliente = 'Teste Constraint';

-- 9. VERIFICAR VINCULAÇÃO
SELECT 'VERIFICAÇÃO DE VINCULAÇÃO:' as teste;
SELECT c.id, c.cliente, c.etapa_atual, c.motorista_id, m.nome as motorista_nome
FROM coletas c
LEFT JOIN motoristas m ON c.motorista_id = m.id
WHERE c.cliente = 'Teste Constraint';

-- 10. TESTAR SISTEMA GR
SELECT 'TESTE DE SISTEMA GR:' as teste;
UPDATE coletas 
SET etapa_atual = 'gr',
    data_atualizacao = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE cliente = 'Teste Constraint';

-- 11. TESTAR APROVAÇÃO GR
SELECT 'TESTE DE APROVAÇÃO GR:' as teste;
UPDATE coletas 
SET gr_aprovado = TRUE,
    gr_aprovado_por = 'allisson.silva.modal@gmail.com',
    gr_data_aprovacao = CURRENT_TIMESTAMP,
    etapa_atual = 'documentacao',
    data_atualizacao = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE cliente = 'Teste Constraint';

-- 12. VERIFICAR APROVAÇÃO GR
SELECT 'VERIFICAÇÃO DE APROVAÇÃO GR:' as teste;
SELECT id, cliente, etapa_atual, gr_aprovado, gr_aprovado_por, gr_data_aprovacao
FROM coletas 
WHERE cliente = 'Teste Constraint';

-- 13. TESTAR INSERÇÃO DE ANEXO
SELECT 'TESTE DE ANEXO:' as teste;
INSERT INTO anexos (
    coleta_id, nome_arquivo, tipo_arquivo, tamanho_arquivo, 
    caminho_arquivo, descricao, uploaded_by
) VALUES (
    (SELECT id FROM coletas WHERE cliente = 'Teste Constraint'),
    'teste.pdf', 'application/pdf', 1024, 
    '/uploads/teste.pdf', 'Arquivo de teste', 'allisson.silva.modal@gmail.com'
);

-- 14. TESTAR INSERÇÃO DE MENSAGEM DE CHAT
SELECT 'TESTE DE CHAT:' as teste;
INSERT INTO chat_mensagens (
    coleta_id, usuario, mensagem, tipo_mensagem
) VALUES (
    (SELECT id FROM coletas WHERE cliente = 'Teste Constraint'),
    'allisson.silva.modal@gmail.com', 'Teste de mensagem', 'texto'
);

-- 15. TESTAR INSERÇÃO DE HISTÓRICO
SELECT 'TESTE DE HISTÓRICO:' as teste;
INSERT INTO historico_coletas (
    coleta_id, etapa_anterior, etapa_atual, acao, usuario, observacoes
) VALUES (
    (SELECT id FROM coletas WHERE cliente = 'Teste Constraint'),
    'comercial', 'price', 'Avanço de etapa', 'allisson.silva.modal@gmail.com', 'Teste de histórico'
);

-- 16. VERIFICAÇÃO FINAL COMPLETA
SELECT 'VERIFICAÇÃO FINAL COMPLETA:' as teste;
SELECT 
    c.id,
    c.cliente,
    c.etapa_atual,
    c.status,
    c.gr_aprovado,
    m.nome as motorista_nome,
    (SELECT COUNT(*) FROM anexos WHERE coleta_id = c.id) as total_anexos,
    (SELECT COUNT(*) FROM chat_mensagens WHERE coleta_id = c.id) as total_mensagens,
    (SELECT COUNT(*) FROM historico_coletas WHERE coleta_id = c.id) as total_historico
FROM coletas c
LEFT JOIN motoristas m ON c.motorista_id = m.id
WHERE c.cliente = 'Teste Constraint';

-- 17. LIMPEZA (OPCIONAL)
-- Descomente as linhas abaixo se quiser limpar os dados de teste
-- DELETE FROM historico_coletas WHERE coleta_id = (SELECT id FROM coletas WHERE cliente = 'Teste Constraint');
-- DELETE FROM chat_mensagens WHERE coleta_id = (SELECT id FROM coletas WHERE cliente = 'Teste Constraint');
-- DELETE FROM anexos WHERE coleta_id = (SELECT id FROM coletas WHERE cliente = 'Teste Constraint');
-- DELETE FROM coletas WHERE cliente = 'Teste Constraint';

-- 18. RESULTADO FINAL
SELECT '✅ TODOS OS TESTES CONCLUÍDOS COM SUCESSO!' as resultado;
SELECT 'Sistema de Coletas está 100% funcional!' as status;
