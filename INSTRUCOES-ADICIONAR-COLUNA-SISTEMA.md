# Instruções para Adicionar Coluna "sistema" na Tabela gestao_dados

## Problema
A coluna `sistema` não existe na tabela `gestao_dados` do Supabase, causando erro 500 ao tentar salvar lançamentos.

## Solução

### Opção 1: Via Supabase Dashboard (Recomendado)

1. Acesse o [Supabase Dashboard](https://supabase.com/dashboard)
2. Selecione seu projeto
3. Vá em **SQL Editor** (no menu lateral)
4. Clique em **New Query**
5. Cole o seguinte SQL:

```sql
ALTER TABLE gestao_dados
ADD COLUMN IF NOT EXISTS sistema VARCHAR(10);
```

6. Clique em **Run** ou pressione `Ctrl+Enter`
7. Aguarde a confirmação de sucesso

### Opção 2: Via Arquivo SQL

O arquivo `sql/adicionar-coluna-sistema-gestao-dados.sql` contém o SQL necessário.

Você pode executá-lo via:
- Supabase SQL Editor
- psql (se tiver acesso direto ao banco)
- Qualquer cliente SQL compatível com PostgreSQL

## Verificação

Após executar o SQL, você pode verificar se a coluna foi criada:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'gestao_dados' AND column_name = 'sistema';
```

## Nota

O backend foi atualizado para ser mais tolerante: se a coluna não existir, o sistema tentará salvar sem o campo `sistema` e mostrará um aviso. No entanto, é recomendado adicionar a coluna para funcionalidade completa.

