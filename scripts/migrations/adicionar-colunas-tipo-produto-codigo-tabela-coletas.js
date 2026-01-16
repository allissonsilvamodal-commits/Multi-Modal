/**
 * Migração: Adicionar colunas tipo_produto e codigo_tabela à tabela coletas
 * 
 * Esta migração adiciona os campos tipo_produto e codigo_tabela à tabela coletas
 * para armazenar informações do tipo de produto e código da tabela de preços.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Erro: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem estar definidos no .env');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function adicionarColunasColetas() {
  try {
    console.log('🔄 Iniciando migração: Adicionar colunas tipo_produto e codigo_tabela à tabela coletas...');

    // Verificar se as colunas já existem
    const { data: testData, error: testError } = await supabaseAdmin
      .from('coletas')
      .select('tipo_produto, codigo_tabela')
      .limit(1);

    if (!testError) {
      console.log('✅ As colunas tipo_produto e codigo_tabela já existem na tabela coletas.');
      return { success: true, message: 'Colunas já existem' };
    }

    // SQL para adicionar as colunas
    const sqlCommands = [
      `ALTER TABLE coletas ADD COLUMN IF NOT EXISTS tipo_produto TEXT;`,
      `ALTER TABLE coletas ADD COLUMN IF NOT EXISTS codigo_tabela TEXT;`,
      `COMMENT ON COLUMN coletas.tipo_produto IS 'Tipo de produto da coleta (preenchido automaticamente do cadastro de clientes)';`,
      `COMMENT ON COLUMN coletas.codigo_tabela IS 'Código da tabela de preços (preenchido automaticamente do cadastro de clientes)';`
    ];

    // Tentar usar RPC se disponível
    try {
      // Criar função RPC temporária se não existir
      const createFunctionSQL = `
        CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
        RETURNS void
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        BEGIN
          EXECUTE sql_query;
        END;
        $$;
      `;

      const { error: createFunctionError } = await supabaseAdmin.rpc('exec_sql', {
        sql_query: createFunctionSQL
      });

      if (createFunctionError && !createFunctionError.message.includes('exec_sql')) {
        console.warn('⚠️ Não foi possível criar função RPC:', createFunctionError.message);
      }

      // Executar cada comando SQL
      const resultados = [];
      for (const sql of sqlCommands) {
        try {
          const { error: sqlError } = await supabaseAdmin.rpc('exec_sql', {
            sql_query: sql
          });

          if (sqlError) {
            resultados.push({ comando: sql.substring(0, 50) + '...', sucesso: false, erro: sqlError.message });
          } else {
            resultados.push({ comando: sql.substring(0, 50) + '...', sucesso: true });
          }
        } catch (err) {
          resultados.push({ comando: sql.substring(0, 50) + '...', sucesso: false, erro: err.message });
        }
      }

      const sucessos = resultados.filter(r => r.sucesso).length;
      const falhas = resultados.filter(r => !r.sucesso).length;

      if (falhas > 0) {
        console.warn('⚠️ Alguns comandos falharam:', resultados);
      }

      // Verificar se as colunas foram criadas
      const { data: verifyData, error: verifyError } = await supabaseAdmin
        .from('coletas')
        .select('tipo_produto, codigo_tabela')
        .limit(1);

      if (verifyError && verifyError.message.includes('tipo_produto')) {
        throw new Error('Colunas não foram criadas. Execute o SQL manualmente no Supabase Dashboard.');
      }

      console.log(`✅ Migração concluída: ${sucessos} comandos executados com sucesso, ${falhas} falhas`);

      return {
        success: true,
        message: `Colunas tipo_produto e codigo_tabela adicionadas com sucesso! ${sucessos} comandos executados.`,
        resultados,
        colunasExistem: true
      };

    } catch (rpcError) {
      console.warn('⚠️ RPC não disponível:', rpcError.message);
      console.log('📋 Fornecendo SQL para execução manual...');

      const sqlCompleto = sqlCommands.join('\n');

      console.log('\n📝 Execute o seguinte SQL no Supabase Dashboard:');
      console.log('='.repeat(80));
      console.log(sqlCompleto);
      console.log('='.repeat(80));
      console.log('\n📋 Instruções:');
      console.log('1. Acesse: https://supabase.com/dashboard');
      console.log('2. Selecione seu projeto');
      console.log('3. Vá em SQL Editor');
      console.log('4. Cole e execute o SQL acima');

      return {
        success: false,
        error: 'Não foi possível executar via API. Execute o SQL manualmente no Supabase Dashboard.',
        sql: sqlCompleto,
        instrucoes: [
          '1. Acesse: https://supabase.com/dashboard',
          '2. Selecione seu projeto',
          '3. Vá em SQL Editor',
          '4. Cole e execute o SQL fornecido'
        ]
      };
    }

  } catch (error) {
    console.error('❌ Erro na migração:', error);
    throw error;
  }
}

// Executar migração se chamado diretamente
if (require.main === module) {
  adicionarColunasColetas()
    .then(result => {
      console.log('\n✅ Resultado:', result);
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n❌ Erro fatal:', error);
      process.exit(1);
    });
}

module.exports = { adicionarColunasColetas };

