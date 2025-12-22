/**
 * Script para criar a tabela ninebox_avaliacoes no Supabase
 * Execute: node executar-criar-tabela-ninebox.js
 */

const fs = require('fs');
const path = require('path');

// Carregar configuração do Supabase
require('dotenv').config();
const supabaseConfig = {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
};

async function criarTabelaNineBox() {
    try {
        console.log('🚀 Iniciando criação da tabela ninebox_avaliacoes...\n');

        // Ler o arquivo SQL
        const sqlPath = path.join(__dirname, 'sql', 'criar-tabela-ninebox.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('📄 SQL carregado do arquivo:', sqlPath);
        console.log('\n📋 SQL a ser executado:');
        console.log('─'.repeat(80));
        console.log(sql);
        console.log('─'.repeat(80));
        console.log('\n');

        // Importar o cliente Supabase
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(
            supabaseConfig.supabaseUrl,
            supabaseConfig.supabaseServiceKey || supabaseConfig.supabaseAnonKey
        );

        // Dividir o SQL em comandos individuais (separados por ;)
        const comandos = sql
            .split(';')
            .map(cmd => cmd.trim())
            .filter(cmd => cmd.length > 0 && !cmd.startsWith('--'));

        console.log(`📊 Encontrados ${comandos.length} comandos SQL para executar\n`);

        // Executar cada comando
        for (let i = 0; i < comandos.length; i++) {
            const comando = comandos[i];
            console.log(`⏳ Executando comando ${i + 1}/${comandos.length}...`);

            try {
                // Usar RPC ou query direta dependendo do tipo de comando
                if (comando.toLowerCase().includes('create table') || 
                    comando.toLowerCase().includes('create index') ||
                    comando.toLowerCase().includes('create trigger') ||
                    comando.toLowerCase().includes('create function') ||
                    comando.toLowerCase().includes('comment on')) {
                    
                    // Para comandos DDL, usar query direta via REST API
                    const response = await fetch(`${supabaseConfig.supabaseUrl}/rest/v1/rpc/exec_sql`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'apikey': supabaseConfig.supabaseServiceKey || supabaseConfig.supabaseAnonKey,
                            'Authorization': `Bearer ${supabaseConfig.supabaseServiceKey || supabaseConfig.supabaseAnonKey}`
                        },
                        body: JSON.stringify({ sql: comando })
                    });

                    if (!response.ok) {
                        // Tentar método alternativo
                        console.log('⚠️  Método RPC não disponível, tentando método alternativo...');
                        // Para comandos DDL, pode ser necessário executar diretamente no Supabase Dashboard
                        console.log('⚠️  Este comando precisa ser executado manualmente no Supabase Dashboard:');
                        console.log(comando);
                        console.log('');
                    } else {
                        console.log('✅ Comando executado com sucesso\n');
                    }
                } else {
                    // Para outros comandos, usar o cliente Supabase
                    const { data, error } = await supabase.rpc('exec_sql', { sql: comando });
                    
                    if (error) {
                        console.error('❌ Erro ao executar comando:', error.message);
                        console.log('⚠️  Comando que falhou:');
                        console.log(comando);
                        console.log('');
                    } else {
                        console.log('✅ Comando executado com sucesso\n');
                    }
                }
            } catch (error) {
                console.error('❌ Erro ao executar comando:', error.message);
                console.log('⚠️  Comando que falhou:');
                console.log(comando.substring(0, 200) + '...');
                console.log('');
            }
        }

        console.log('\n✅ Processo concluído!');
        console.log('\n📝 IMPORTANTE:');
        console.log('   Se alguns comandos falharam, você pode executá-los manualmente:');
        console.log('   1. Acesse o Supabase Dashboard');
        console.log('   2. Vá em SQL Editor');
        console.log('   3. Cole o conteúdo do arquivo sql/criar-tabela-ninebox.sql');
        console.log('   4. Execute o SQL\n');

    } catch (error) {
        console.error('❌ Erro geral:', error);
        console.error('\n📝 Você pode executar o SQL manualmente:');
        console.error('   1. Acesse o Supabase Dashboard');
        console.error('   2. Vá em SQL Editor');
        console.error('   3. Cole o conteúdo do arquivo sql/criar-tabela-ninebox.sql');
        console.error('   4. Execute o SQL\n');
        process.exit(1);
    }
}

// Executar
if (require.main === module) {
    criarTabelaNineBox();
}

module.exports = { criarTabelaNineBox };

