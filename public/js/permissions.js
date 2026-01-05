// ========== SISTEMA DE VERIFICAÇÃO DE PERMISSÕES ==========
// Este arquivo implementa o controle de acesso baseado em permissões
// Definidas na tabela permissoes_portal do Supabase

// Variável global para o Supabase (compartilhada entre pages)
if (!window.supabaseClient) {
    window.supabaseClient = null;
}

/**
 * Verifica se o usuário atual é admin
 * @returns {Object|false} - Dados do usuário se for admin, false caso contrário
 */
function isUserAdmin() {
    try {
        const loggedInUserData = localStorage.getItem('loggedInUser');
        if (!loggedInUserData) {
            // ✅ SEGURANÇA: Logs condicionais apenas em desenvolvimento
            if (window.DEBUG || window.location.hostname === 'localhost') {
                console.log('❌ Nenhum usuário logado');
            }
            return false;
        }
        
        const userData = JSON.parse(loggedInUserData);
        
        // Verificação rigorosa de admin
        const isAdmin = (userData.isAdmin === true || userData.role === 'admin');
        
        // ✅ SEGURANÇA: Não logar dados de usuário em produção
        if (window.DEBUG || window.location.hostname === 'localhost') {
            console.log('👤 Verificando se é admin:', {
                email: userData.email,
                isAdmin: userData.isAdmin,
                role: userData.role,
                isAdminCheck: isAdmin
            });
        }
        
        if (isAdmin) {
            if (window.DEBUG || window.location.hostname === 'localhost') {
                console.log('✅ Usuário é ADMIN');
            }
            return userData;
        }
        
        return false;
    } catch (error) {
        console.error('❌ Erro ao verificar se é admin:', error);
        return false;
    }
}

/**
 * Inicializa o cliente Supabase
 */
async function initSupabaseForPermissions() {
    // Se já existe um cliente compartilhado, usar ele
    if (window.supabaseClient) {
        console.log('✅ Usando Supabase já inicializado');
        return window.supabaseClient;
    }
    
    try {
        const response = await fetch('/api/supabase-config');
        if (!response.ok) throw new Error('Erro ao buscar configurações');
        
        const config = await response.json();
        
        // Verificar se window.supabase existe (library carregada)
        if (typeof window.supabase === 'undefined') {
            console.error('❌ Biblioteca @supabase/supabase-js não carregada');
            return null;
        }
        
        window.supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        
        console.log('✅ Supabase inicializado para verificações de permissões');
        return window.supabaseClient;
    } catch (error) {
        console.error('❌ Erro ao inicializar Supabase:', error);
        return null;
    }
}

/**
 * Verifica se o usuário tem permissão para acessar uma página específica
 * @param {string} pageName - Nome da página (ex: 'painel', 'coletas', 'cadastro', 'relatorios')
 * @returns {Promise<boolean>} - true se tem permissão, false caso contrário
 */
async function verificarPermissaoPagina(pageName) {
    try {
        // ✅ SEGURANÇA: Logs condicionais apenas em desenvolvimento
        if (window.DEBUG || window.location.hostname === 'localhost') {
            console.log(`🔐 Verificando permissão para página: ${pageName}`);
        }
        
        // Buscar usuário logado
        const loggedInUserData = localStorage.getItem('loggedInUser');
        if (!loggedInUserData) {
            if (window.DEBUG || window.location.hostname === 'localhost') {
                console.log('❌ Nenhum usuário logado encontrado');
            }
            return false;
        }
        
        const userData = JSON.parse(loggedInUserData);
        
        // ✅ SEGURANÇA: Não logar dados de usuário em produção
        if (window.DEBUG || window.location.hostname === 'localhost') {
            console.log('👤 Usuário verificando permissão:', userData.email);
            console.log('📊 Dados do usuário:', {
                id: userData.id,
                email: userData.email,
                isAdmin: userData.isAdmin,
                role: userData.role
            });
        }
        
        // ✅ Se for ADMIN, permite acesso a tudo
        const isAdminCheck = (userData.isAdmin === true) || (userData.role === 'admin');
        
        if (isAdminCheck) {
            // ✅ SEGURANÇA: Logs condicionais apenas em desenvolvimento
            if (window.DEBUG || window.location.hostname === 'localhost') {
                console.log('✅ Usuário é ADMIN, permissão concedida para:', pageName);
            }
            return true;
        }
        
        // ✅ SEGURANÇA: Logs condicionais apenas em desenvolvimento
        if (window.DEBUG || window.location.hostname === 'localhost') {
            console.log('⚠️ Usuário NÃO é admin, verificando permissões específicas...');
        }
        
        // Inicializar Supabase
        const client = await initSupabaseForPermissions();
        if (!client) {
            console.error('❌ Supabase não disponível');
            return false; // Por segurança, nega acesso se Supabase não estiver disponível
        }
        
        console.log('📡 Buscando permissões do usuário no Supabase...');
        console.log('🔍 ID do usuário sendo usado na busca:', userData.id);
        
        // Buscar permissões do usuário - tentar com o ID do auth primeiro
        let { data, error } = await client
            .from('permissoes_portal')
            .select('permissao_id, tipo, usuario_id')
            .eq('usuario_id', userData.id);
        
        // Se não encontrar permissões, tentar buscar pelo email (caso o ID seja diferente)
        if ((!data || data.length === 0) && userData.email) {
            console.log('⚠️ Nenhuma permissão encontrada com o ID do auth, tentando buscar pelo email...');
            
            // Buscar o ID correto na tabela user_profiles pelo email
            const { data: profileData, error: profileError } = await client
                .from('user_profiles')
                .select('id')
                .eq('email', userData.email)
                .maybeSingle();
            
            if (!profileError && profileData && profileData.id) {
                console.log('✅ ID encontrado na tabela user_profiles:', profileData.id);
                
                // Buscar permissões com o ID correto
                const { data: permData, error: permError } = await client
                    .from('permissoes_portal')
                    .select('permissao_id, tipo, usuario_id')
                    .eq('usuario_id', profileData.id);
                
                if (!permError) {
                    data = permData;
                    error = null;
                    console.log('✅ Permissões encontradas com o ID correto:', data);
                }
            }
        }
        
        if (error) {
            console.error('❌ Erro ao buscar permissões:', error);
            return false; // Por segurança, nega acesso em caso de erro
        }
        
        console.log('📋 Permissões encontradas:', data);
        
        // Extrair apenas os IDs de permissão (independente do tipo)
        const permissoes = (data || []).map(p => p.permissao_id);
        console.log('📋 IDs de permissões do usuário:', permissoes);
        
        // Mapear nomes de páginas para IDs de permissão
        const pagePermissionsMap = {
            // Operações
            'painel': 'painel',
            'operacoes': 'operacoes', // Alias para compatibilidade
            'coletas': 'coletas',
            'historico-coletas': 'historico-coletas',
            'monitoramento': 'monitoramento',
            
            // Comercial
            'comercial': 'comercial',
            'crm': 'crm',
            'vendas': 'vendas',
            
            // Gestão
            'cadastro': 'cadastro',
            'relatorios': 'relatorios',
            'gestao-dados': 'gestao-dados',
            
            // Financeiro
            'contas-pagar': 'contas-pagar',
            'contas-receber': 'contas-receber',
            
            // Recursos Humanos
            'folha': 'folha',
            'recrutamento': 'recrutamento',
            
            // Qualidade
            'qualidade': 'qualidade',
            'treinamentos': 'qualidade',
            'treinamentos-documentos': 'qualidade',
            
            // Configurações
            'settings': 'configuracoes'
        };
        
        const requiredPermission = pagePermissionsMap[pageName];
        console.log(`🔍 Permissão requerida para ${pageName}:`, requiredPermission);
        console.log(`📋 Mapeamento completo:`, pagePermissionsMap);
        
        if (!requiredPermission) {
            console.log(`⚠️ Página ${pageName} não tem mapeamento de permissão definido`);
            console.log(`📋 Páginas disponíveis no mapeamento:`, Object.keys(pagePermissionsMap));
            // Para páginas sem mapeamento definido, NEGA acesso por segurança
            console.log('❌ Acesso negado: página sem mapeamento de permissão');
            return false;
        }
        
        const temPermissao = permissoes.includes(requiredPermission);
        console.log(`🔑 Usuário tem a permissão '${requiredPermission}' para ${pageName}:`, temPermissao);
        console.log(`📝 Resumo: permissoes[${permissoes.length}] = [${permissoes.join(', ')}] inclui '${requiredPermission}'?`, temPermissao);
        
        if (!temPermissao) {
            console.log(`❌ PERMISSÃO NEGADA para ${pageName}`);
            console.log(`   - Permissão requerida: ${requiredPermission}`);
            console.log(`   - Permissões do usuário: [${permissoes.join(', ')}]`);
            console.log(`   - ID do usuário: ${userData.id}`);
            console.log(`   - Email do usuário: ${userData.email}`);
        } else {
            console.log(`✅ PERMISSÃO CONCEDIDA para ${pageName}`);
        }
        
        return temPermissao;
        
    } catch (error) {
        console.error('❌ Erro ao verificar permissão:', error);
        return false; // Por segurança, nega acesso em caso de erro
    }
}

/**
 * Verifica permissão e redireciona o usuário se não tiver acesso
 * @param {string} pageName - Nome da página
 */
async function verificarEAplicarPermissao(pageName) {
    console.log(`🔐 VERIFICAR EA APLICAR PERMISSÃO para ${pageName}`);
    
    const temPermissao = await verificarPermissaoPagina(pageName);
    console.log(`📊 RESULTADO DA VERIFICAÇÃO: ${temPermissao}`);
    
    if (!temPermissao) {
        console.log(`❌ Acesso negado para ${pageName}`);
        console.log(`❌ Redirecionando para portal.html`);
        
        // Mostrar mensagem de erro amigável
        alert(`Acesso Negado\n\nVocê não tem permissão para acessar esta página. Por favor, entre em contato com o administrador para solicitar acesso.\n\nPágina: ${pageName}`);
        
        // Redirecionar para portal
        window.location.href = 'portal.html';
        
        return false;
    }
    
    console.log(`✅ Acesso permitido para ${pageName}`);
    return true;
}

/**
 * Página disponível para o usuário
 * @param {string} pageName - Nome da página
 * @returns {Promise<boolean>}
 */
async function paginaDisponivel(pageName) {
    return await verificarPermissaoPagina(pageName);
}

// Exportar funções para uso global
window.verificarPermissaoPagina = verificarPermissaoPagina;
window.verificarEAplicarPermissao = verificarEAplicarPermissao;
window.paginaDisponivel = paginaDisponivel;
window.isUserAdmin = isUserAdmin;

console.log('✅ Sistema de verificação de permissões carregado');

