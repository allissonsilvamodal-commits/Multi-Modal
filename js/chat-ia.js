// ========== CHAT COM IA ==========
class ChatIA {
  constructor() {
    this.isOpen = false;
    this.historico = [];
    this.isProcessing = false;
    this.userId = null;
    this.init();
  }

  async init() {
    // Criar HTML do chat
    this.createHTML();
    
    // Event listeners
    this.setupEventListeners();
    
    // Obter ID do usuário autenticado
    await this.getUserId();
    
    // Carregar histórico do Supabase
    await this.loadHistory();
    
    // Listener para mudanças de autenticação (login/logout)
    this.setupAuthListener();
  }

  setupAuthListener() {
    if (window.supabase && window.supabase.auth && typeof window.supabase.auth.onAuthStateChange === 'function') {
      try {
        window.supabase.auth.onAuthStateChange((event, session) => {
          console.log('🔐 Mudança de autenticação detectada:', event);
          
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            // Usuário fez login ou token foi atualizado
            const newUserId = session?.user?.id;
            if (newUserId && newUserId !== this.userId) {
              console.log('🔄 Novo usuário detectado, recarregando histórico');
              this.getUserId().then(() => {
                this.loadHistory();
              });
            }
          } else if (event === 'SIGNED_OUT') {
            // Usuário fez logout
            console.log('🚪 Logout detectado, limpando histórico');
            this.userId = null;
            this.historico = [];
            this.clearHistory();
            localStorage.removeItem('chatIALastUserId');
          }
        });
        console.log('✅ Listener de autenticação configurado');
      } catch (e) {
        console.warn('⚠️ Erro ao configurar listener de autenticação:', e);
        this.retrySetupAuthListener();
      }
    } else {
      // Supabase não está disponível ainda, tentar configurar novamente
      this.retrySetupAuthListener();
    }
  }

  retrySetupAuthListener() {
    // Tentar configurar novamente após delays progressivos
    let attempts = 0;
    const maxAttempts = 5;
    
    const trySetup = () => {
      attempts++;
      
      if (window.supabase && window.supabase.auth && typeof window.supabase.auth.onAuthStateChange === 'function') {
        this.setupAuthListener();
        return;
      }
      
      if (attempts < maxAttempts) {
        // Tentar novamente com delay progressivo (1s, 2s, 3s, 5s, 10s)
        const delays = [1000, 2000, 3000, 5000, 10000];
        setTimeout(() => trySetup(), delays[attempts - 1]);
      } else {
        // Não mostrar warning após várias tentativas - é normal em páginas sem Supabase
        console.log('ℹ️ Chat funcionará sem listener de autenticação (normal em páginas sem Supabase)');
      }
    };
    
    // Primeira tentativa após 1 segundo
    setTimeout(() => trySetup(), 1000);
  }

  async getUserId() {
    try {
      // Verificar se Supabase está completamente inicializado
      if (window.supabase && window.supabase.auth && typeof window.supabase.auth.getSession === 'function') {
        const { data: session, error: sessionError } = await window.supabase.auth.getSession();
        if (!sessionError && session?.session?.user?.id) {
          const newUserId = session.session.user.id;
          
          // Verificar se o usuário mudou
          const lastUserId = localStorage.getItem('chatIALastUserId');
          if (lastUserId && lastUserId !== newUserId) {
            console.log('🔄 Usuário mudou, limpando histórico local');
            localStorage.removeItem('chatIAHistory');
            this.historico = [];
          }
          
          // Salvar userId atual
          localStorage.setItem('chatIALastUserId', newUserId);
          this.userId = newUserId;
          return newUserId;
        }
      }
    } catch (e) {
      console.warn('⚠️ Não foi possível obter ID do usuário:', e);
    }
    return null;
  }

  createHTML() {
    const chatHTML = `
      <div class="chat-ia-container">
        <button class="chat-ia-button" id="chatIABtn" title="Chat com IA">
          <i class="fas fa-robot"></i>
        </button>
        <div class="chat-ia-window" id="chatIAWindow">
          <div class="chat-ia-header">
            <h3>
              <i class="fas fa-robot"></i>
              Assistente Virtual
            </h3>
            <button class="chat-ia-close" id="chatIAClose" title="Fechar">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="chat-ia-messages" id="chatIAMessages">
            <div class="chat-ia-welcome">
              <i class="fas fa-comments"></i>
              <h4>Olá! 👋</h4>
              <p>Como posso ajudá-lo hoje?</p>
            </div>
          </div>
          <div class="chat-ia-input-container">
            <textarea 
              class="chat-ia-input" 
              id="chatIAInput" 
              placeholder="Digite sua mensagem..."
              rows="1"
            ></textarea>
            <button class="chat-ia-send" id="chatIASend" title="Enviar">
              <i class="fas fa-paper-plane"></i>
            </button>
          </div>
        </div>
      </div>
    `;

    // Adicionar ao body
    document.body.insertAdjacentHTML('beforeend', chatHTML);
    
    // Auto-resize textarea
    const input = document.getElementById('chatIAInput');
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    // Enviar com Enter (Shift+Enter para nova linha)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
  }

  setupEventListeners() {
    const btn = document.getElementById('chatIABtn');
    const closeBtn = document.getElementById('chatIAClose');
    const sendBtn = document.getElementById('chatIASend');

    btn.addEventListener('click', () => this.toggleChat());
    closeBtn.addEventListener('click', () => this.closeChat());
    sendBtn.addEventListener('click', () => this.sendMessage());
  }

  toggleChat() {
    this.isOpen = !this.isOpen;
    const window = document.getElementById('chatIAWindow');
    
    if (this.isOpen) {
      window.classList.add('active');
      document.getElementById('chatIAInput').focus();
    } else {
      window.classList.remove('active');
    }
  }

  closeChat() {
    this.isOpen = false;
    document.getElementById('chatIAWindow').classList.remove('active');
  }

  async sendMessage() {
    const input = document.getElementById('chatIAInput');
    const mensagem = input.value.trim();

    if (!mensagem || this.isProcessing) return;

    // Limpar input
    input.value = '';
    input.style.height = 'auto';

    // Adicionar mensagem do usuário
    this.addMessage('user', mensagem);

    // Mostrar indicador de digitação
    this.showTyping();

    // Processar mensagem
    this.isProcessing = true;
    document.getElementById('chatIASend').disabled = true;

    try {
      // Obter token de autenticação se disponível (opcional)
      let authToken = null;
      
      // Verificar se Supabase está completamente inicializado
      if (window.supabase && window.supabase.auth && typeof window.supabase.auth.getSession === 'function') {
        try {
          const { data: session, error: sessionError } = await window.supabase.auth.getSession();
          if (!sessionError && session?.session?.access_token) {
            authToken = session.session.access_token;
          }
        } catch (e) {
          console.warn('⚠️ Não foi possível obter token Supabase (usando sessão do servidor):', e);
        }
      }

      const headers = {
        'Content-Type': 'application/json'
      };

      // Adicionar token apenas se disponível (não obrigatório)
      // O backend aceita autenticação via sessão do servidor também
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      // Se não há token Supabase, tentar usar dados do localStorage
      if (!authToken) {
        try {
          const loggedInUserData = localStorage.getItem('loggedInUser');
          if (loggedInUserData) {
            const userData = JSON.parse(loggedInUserData);
            if (userData.authenticated && userData.email) {
              // Enviar email do usuário via header para o backend tentar autenticar
              headers['X-User-Email'] = userData.email;
            }
          }
        } catch (e) {
          console.warn('⚠️ Não foi possível obter dados do localStorage:', e);
        }
      }

      // Sempre usar credentials: 'include' para enviar cookies da sessão
      const response = await fetch('/api/chat/ia', {
        method: 'POST',
        headers: headers,
        credentials: 'include', // Importante: envia cookies da sessão do servidor
        body: JSON.stringify({
          mensagem: mensagem,
          historico: this.historico.slice(-10) // Últimas 10 mensagens para contexto
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Erro ao processar mensagem');
      }

      // Remover indicador de digitação
      this.hideTyping();

      // Adicionar resposta da IA
      if (result.resposta) {
        this.addMessage('assistant', result.resposta);
      }

    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      this.hideTyping();
      this.addMessage('assistant', 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.');
    } finally {
      this.isProcessing = false;
      document.getElementById('chatIASend').disabled = false;
      input.focus();
    }
  }

  addMessage(role, content) {
    const messagesContainer = document.getElementById('chatIAMessages');
    
    // Remover mensagem de boas-vindas se existir
    const welcome = messagesContainer.querySelector('.chat-ia-welcome');
    if (welcome) {
      welcome.remove();
    }

    // Criar elemento da mensagem
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-ia-message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'chat-ia-message-avatar';
    avatar.innerHTML = role === 'user' 
      ? '<i class="fas fa-user"></i>' 
      : '<i class="fas fa-robot"></i>';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'chat-ia-message-content';
    contentDiv.textContent = content;

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);

    // Scroll para baixo
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Salvar no histórico
    this.historico.push({ role, content });
    this.saveHistory();
  }

  showTyping() {
    const messagesContainer = document.getElementById('chatIAMessages');
    
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-ia-message assistant';
    typingDiv.id = 'chatIATyping';
    
    const avatar = document.createElement('div');
    avatar.className = 'chat-ia-message-avatar';
    avatar.innerHTML = '<i class="fas fa-robot"></i>';

    const typingContent = document.createElement('div');
    typingContent.className = 'chat-ia-message-typing';
    typingContent.innerHTML = '<span></span><span></span><span></span>';

    typingDiv.appendChild(avatar);
    typingDiv.appendChild(typingContent);
    messagesContainer.appendChild(typingDiv);

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  hideTyping() {
    const typing = document.getElementById('chatIATyping');
    if (typing) {
      typing.remove();
    }
  }

  async saveHistory() {
    // Se há usuário autenticado, NÃO salvar no localStorage
    // O histórico será salvo automaticamente no backend quando enviar mensagens
    if (this.userId) {
      // Não salvar no localStorage para evitar compartilhamento entre usuários
      return;
    }
    
    // Apenas para usuários não autenticados, manter histórico local
    try {
      localStorage.setItem('chatIAHistory', JSON.stringify(this.historico.slice(-20)));
    } catch (e) {
      console.warn('Não foi possível salvar histórico local:', e);
    }
  }

  async loadHistory() {
    // Se usuário não está autenticado, não carregar histórico compartilhado
    if (!this.userId) {
      console.log('⚠️ Usuário não autenticado, não carregando histórico');
      return;
    }
    
    // SEMPRE tentar carregar do Supabase quando houver usuário autenticado
    try {
      let authToken = null;
      
      // Verificar se Supabase está completamente inicializado
      if (window.supabase && window.supabase.auth && typeof window.supabase.auth.getSession === 'function') {
        const { data: session, error: sessionError } = await window.supabase.auth.getSession();
        if (!sessionError && session?.session?.access_token) {
          authToken = session.session.access_token;
        }
      }

      const headers = {};
      
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      } else {
        // Tentar usar dados do localStorage
        try {
          const loggedInUserData = localStorage.getItem('loggedInUser');
          if (loggedInUserData) {
            const userData = JSON.parse(loggedInUserData);
            if (userData.authenticated && userData.email) {
              headers['X-User-Email'] = userData.email;
            }
          }
        } catch (e) {
          console.warn('⚠️ Não foi possível obter dados do localStorage:', e);
        }
      }

      if (Object.keys(headers).length > 0) {
        const response = await fetch('/api/chat/ia/historico?limite=50', {
          headers: headers,
          credentials: 'include'
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.conversas && result.conversas.length > 0) {
            // Construir histórico a partir das conversas salvas
            this.historico = [];
            result.conversas.reverse().forEach(conv => {
              this.historico.push({ role: 'user', content: conv.mensagem });
              this.historico.push({ role: 'assistant', content: conv.resposta });
            });
            
            // Restaurar mensagens na UI
            this.renderHistory();
            console.log(`✅ Histórico carregado do Supabase: ${result.conversas.length} conversas`);
            return;
          } else {
            // Nenhuma conversa encontrada no Supabase, limpar histórico local
            console.log('ℹ️ Nenhuma conversa encontrada no Supabase para este usuário');
            this.historico = [];
            this.clearHistory();
            return;
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar histórico do Supabase:', e);
      // Não usar localStorage como fallback quando há usuário autenticado
      // para evitar compartilhamento de histórico entre usuários
      this.historico = [];
      return;
    }
    
    // Se chegou aqui, não há histórico (primeira vez do usuário)
    this.historico = [];
  }

  renderHistory() {
    if (this.historico.length > 0) {
      const messagesContainer = document.getElementById('chatIAMessages');
      const welcome = messagesContainer.querySelector('.chat-ia-welcome');
      if (welcome) {
        welcome.remove();
      }

      this.historico.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-ia-message ${msg.role}`;

        const avatar = document.createElement('div');
        avatar.className = 'chat-ia-message-avatar';
        avatar.innerHTML = msg.role === 'user' 
          ? '<i class="fas fa-user"></i>' 
          : '<i class="fas fa-robot"></i>';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'chat-ia-message-content';
        contentDiv.textContent = msg.content;

        messageDiv.appendChild(avatar);
        messageDiv.appendChild(contentDiv);
        messagesContainer.appendChild(messageDiv);
      });

      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  clearHistory() {
    this.historico = [];
    localStorage.removeItem('chatIAHistory');
    
    const messagesContainer = document.getElementById('chatIAMessages');
    if (messagesContainer) {
      messagesContainer.innerHTML = `
        <div class="chat-ia-welcome">
          <i class="fas fa-comments"></i>
          <h4>Olá! 👋</h4>
          <p>Como posso ajudá-lo hoje?</p>
        </div>
      `;
    }
  }
}

// Inicializar chat quando o DOM estiver pronto e Supabase disponível
let chatIAInstance = null;

function inicializarChatIA() {
  // Se já existe instância, não criar novamente
  if (chatIAInstance) {
    // Se Supabase ficou disponível depois, tentar configurar o listener novamente
    if (window.supabase && window.supabase.auth && typeof window.supabase.auth.onAuthStateChange === 'function') {
      chatIAInstance.setupAuthListener();
    }
    return true;
  }
  
  // Tentar inicializar sempre, mesmo sem Supabase
  // O chat funcionará, mas o histórico será apenas local se não houver Supabase
  try {
    chatIAInstance = new ChatIA();
    return true;
  } catch (error) {
    console.error('Erro ao inicializar Chat IA:', error);
    return false;
  }
}

// Tentar inicializar imediatamente se o DOM já estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Tentar inicializar imediatamente
    inicializarChatIA();
    
    // Se Supabase não estiver disponível ainda, tentar novamente após delays
    if (!window.supabase || !window.supabase.auth) {
      setTimeout(() => {
        if (chatIAInstance && window.supabase && window.supabase.auth) {
          // Supabase ficou disponível, atualizar o chat
          chatIAInstance.getUserId().then(() => {
            chatIAInstance.loadHistory();
          });
          chatIAInstance.setupAuthListener();
        } else {
          inicializarChatIA();
        }
      }, 1000);
      
      setTimeout(() => {
        if (chatIAInstance && window.supabase && window.supabase.auth) {
          // Supabase ficou disponível, atualizar o chat
          chatIAInstance.getUserId().then(() => {
            chatIAInstance.loadHistory();
          });
          chatIAInstance.setupAuthListener();
        } else {
          inicializarChatIA();
        }
      }, 3000);
    }
  });
} else {
  // DOM já está pronto
  inicializarChatIA();
  
  // Se Supabase não estiver disponível ainda, tentar novamente após delays
  if (!window.supabase || !window.supabase.auth) {
    setTimeout(() => {
      if (chatIAInstance && window.supabase && window.supabase.auth) {
        chatIAInstance.getUserId().then(() => {
          chatIAInstance.loadHistory();
        });
        chatIAInstance.setupAuthListener();
      }
    }, 1000);
    
    setTimeout(() => {
      if (chatIAInstance && window.supabase && window.supabase.auth) {
        chatIAInstance.getUserId().then(() => {
          chatIAInstance.loadHistory();
        });
        chatIAInstance.setupAuthListener();
      }
    }, 3000);
  }
}

// Exportar para uso global e permitir inicialização manual
window.ChatIA = ChatIA;
window.chatIAInstance = chatIAInstance;
window.inicializarChatIA = inicializarChatIA;

