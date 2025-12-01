require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Erro: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem estar definidos no .env');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function confirmarEmailAutomaticamente(userId, email) {
  if (!userId) return false;
  
  try {
    console.log(`📧 Confirmando e-mail para: ${email || userId}`);
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { email_confirm: true }
    );
    
    if (error) {
      console.error(`❌ Erro ao confirmar e-mail para ${email}:`, error.message);
      return false;
    }
    
    console.log(`✅ E-mail confirmado para: ${email || userId}`);
    return true;
  } catch (err) {
    console.error(`❌ Erro ao confirmar e-mail para ${email}:`, err.message);
    return false;
  }
}

async function confirmarTodosUsuarios() {
  try {
    console.log('📧 Buscando todos os usuários não confirmados...\n');
    
    // Buscar todos os usuários
    let allUsers = [];
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page: page,
        perPage: 1000
      });
      
      if (listError) {
        console.error('❌ Erro ao listar usuários:', listError);
        process.exit(1);
      }
      
      if (usersData && usersData.users && usersData.users.length > 0) {
        allUsers.push(...usersData.users);
        page++;
        hasMore = usersData.users.length === 1000;
      } else {
        hasMore = false;
      }
    }
    
    console.log(`📊 Total de usuários encontrados: ${allUsers.length}`);
    
    // Filtrar usuários não confirmados
    const usuariosNaoConfirmados = allUsers.filter(u => !u.email_confirmed_at);
    
    console.log(`📧 Usuários não confirmados: ${usuariosNaoConfirmados.length}\n`);
    
    if (usuariosNaoConfirmados.length === 0) {
      console.log('✅ Todos os usuários já estão confirmados!');
      return;
    }
    
    // Confirmar cada usuário
    const resultados = {
      sucesso: [],
      erros: []
    };
    
    for (const usuario of usuariosNaoConfirmados) {
      const confirmado = await confirmarEmailAutomaticamente(usuario.id, usuario.email);
      if (confirmado) {
        resultados.sucesso.push({
          id: usuario.id,
          email: usuario.email
        });
      } else {
        resultados.erros.push({
          id: usuario.id,
          email: usuario.email
        });
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ CONFIRMAÇÃO CONCLUÍDA');
    console.log('='.repeat(60));
    console.log(`Total de usuários: ${allUsers.length}`);
    console.log(`Não confirmados: ${usuariosNaoConfirmados.length}`);
    console.log(`Confirmados com sucesso: ${resultados.sucesso.length}`);
    console.log(`Erros: ${resultados.erros.length}`);
    
    if (resultados.sucesso.length > 0) {
      console.log('\n✅ Usuários confirmados:');
      resultados.sucesso.forEach(u => console.log(`   - ${u.email}`));
    }
    
    if (resultados.erros.length > 0) {
      console.log('\n❌ Usuários com erro:');
      resultados.erros.forEach(u => console.log(`   - ${u.email}`));
    }
    
  } catch (err) {
    console.error('❌ Erro ao confirmar todos os usuários:', err);
    process.exit(1);
  }
}

confirmarTodosUsuarios();

