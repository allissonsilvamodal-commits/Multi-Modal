# Sistema Intranet Multimodal

Plataforma corporativa para gestão operacional, comunicação com equipes de campo e integrações essenciais.

## Visão Geral

- **Foco:** centralizar cadastros, operações logísticas e notificações.
- **Arquitetura:** backend Node.js com interface web leve.
- **Integrações:** Supabase (dados e autenticação) e Evolution API (mensageria).
- **Status:** evolução contínua; detalhes completos ficam nos documentos internos.

## Funcionalidades

- Autenticação com controle de acesso por perfil.
- Cadastro de motoristas, frota e operações de coleta.
- Disparo e acompanhamento de mensagens.
- Painéis de indicadores operacionais essenciais.

## Stack Resumida

- **Servidor:** Node.js + Express.
- **Banco:** Supabase (PostgreSQL + Auth).
- **Frontend:** HTML, CSS e JavaScript vanilla.
- **Suporte:** Winston para logs e proteções padrão (Helmet, rate limiting, validações).

## Início Rápido

1. Garanta Node.js 18+, npm 8+ e contas válidas nos serviços externos.
2. Instale dependências com `npm install`.
3. Copie `.env.example` para `.env` e mantenha as chaves fora do controle de versão.
4. Execute em desenvolvimento com `npm run dev`.
5. Consulte `package.json` para scripts adicionais (build, lint, diagnósticos).

## Boas Práticas de Segurança

- Não exponha segredos em commits, tickets ou documentações públicas.
- Restrinja origens confiáveis no CORS e revise permissões periodicamente.
- Utilize HTTPS, monitore logs e rotacione credenciais externas.

## Contribuição

- Siga o fluxo Git padrão da equipe (branch feature, PR, revisão).
- Registre mudanças relevantes no documento interno de releases.

## Suporte

- Utilize os canais internos da Multimodal para dúvidas técnicas ou demandas operacionais.
