require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Variáveis de ambiente SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function verificarClientes() {
  try {
    console.log('🔍 Consultando banco de dados...\n');

    // Buscar alguns registros para análise
    const { data: clientes, error } = await supabaseAdmin
      .from('clientes')
      .select('id, cnpj, tipo_produto, atualizado_por, razao_social, nome')
      .limit(20);

    if (error) {
      console.error('❌ Erro ao buscar clientes:', error);
      return;
    }

    console.log(`📊 Total de registros consultados: ${clientes.length}\n`);

    // Identificar registros com problema
    const clientesComProblema = clientes.filter(c => {
      const tipoProduto = (c.tipo_produto || '').toString().trim();
      const atualizadoPor = (c.atualizado_por || '').toString().trim();
      
      // Se tipo_produto contém @ (é um email) ou tem mais de 30 caracteres (provavelmente é um nome)
      const tipoProdutoPareceNome = tipoProduto.includes('@') || 
                                    (tipoProduto.length > 30 && !tipoProduto.match(/^(Cimento|Areia|Aço|Madeira|Tijolo|Concreto|Argamassa|Pedra|Brita)/i));
      
      return tipoProdutoPareceNome && atualizadoPor && !atualizadoPor.includes('@');
    });

    console.log('='.repeat(80));
    console.log('📋 AMOSTRA DE DADOS (primeiros 5 registros):');
    console.log('='.repeat(80));
    
    clientes.slice(0, 5).forEach((c, index) => {
      console.log(`\nRegistro ${index + 1}:`);
      console.log(`  ID: ${c.id}`);
      console.log(`  CNPJ: ${c.cnpj || '-'}`);
      console.log(`  Razão Social: ${c.razao_social || c.nome || '-'}`);
      console.log(`  Tipo Produto: ${c.tipo_produto || '-'}`);
      console.log(`  Atualizado Por: ${c.atualizado_por || '-'}`);
      
      const tipoProduto = (c.tipo_produto || '').toString().trim();
      const atualizadoPor = (c.atualizado_por || '').toString().trim();
      
      if (tipoProduto.includes('@') || (tipoProduto.length > 30 && !atualizadoPor.includes('@'))) {
        console.log(`  ⚠️ PROBLEMA DETECTADO: tipo_produto parece ser um nome/email!`);
      }
    });

    if (clientesComProblema.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log(`⚠️ REGISTROS COM PROBLEMA DETECTADOS: ${clientesComProblema.length}`);
      console.log('='.repeat(80));
      
      clientesComProblema.slice(0, 10).forEach((c, index) => {
        console.log(`\nProblema ${index + 1}:`);
        console.log(`  ID: ${c.id}`);
        console.log(`  CNPJ: ${c.cnpj || '-'}`);
        console.log(`  Razão Social: ${c.razao_social || c.nome || '-'}`);
        console.log(`  Tipo Produto (ATUAL - parece nome): ${c.tipo_produto}`);
        console.log(`  Atualizado Por (ATUAL - pode ser tipo produto): ${c.atualizado_por}`);
        console.log(`  🔄 DEVERIA SER:`);
        console.log(`     Tipo Produto: ${c.atualizado_por}`);
        console.log(`     Atualizado Por: ${c.tipo_produto}`);
      });

      console.log('\n' + '='.repeat(80));
      console.log('💡 Para corrigir, execute:');
      console.log('   POST /api/admin/corrigir-tipo-produto-clientes');
      console.log('   Body: { "executarCorrecao": true }');
      console.log('='.repeat(80));
    } else {
      console.log('\n✅ Nenhum problema detectado nos registros consultados.');
    }

    // Estatísticas gerais
    const totalComTipoProduto = clientes.filter(c => c.tipo_produto && c.tipo_produto.trim()).length;
    const totalComAtualizadoPor = clientes.filter(c => c.atualizado_por && c.atualizado_por.trim()).length;
    const totalComEmailEmTipoProduto = clientes.filter(c => c.tipo_produto && c.tipo_produto.includes('@')).length;

    console.log('\n' + '='.repeat(80));
    console.log('📊 ESTATÍSTICAS:');
    console.log('='.repeat(80));
    console.log(`  Total consultado: ${clientes.length}`);
    console.log(`  Com tipo_produto preenchido: ${totalComTipoProduto}`);
    console.log(`  Com atualizado_por preenchido: ${totalComAtualizadoPor}`);
    console.log(`  Com email em tipo_produto: ${totalComEmailEmTipoProduto}`);
    console.log(`  Com problema detectado: ${clientesComProblema.length}`);

  } catch (error) {
    console.error('❌ Erro:', error);
  }
}

verificarClientes();

