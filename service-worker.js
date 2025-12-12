// Service Worker para Portal do Motorista
// Permite rastreamento em background quando o app está instalado

const CACHE_NAME = 'portal-motorista-v1';
const ROUTE_API = '/api/rastreamento/enviar-posicao';
const INTERVAL_TRACKING = 5 * 60 * 1000; // 5 minutos (300000ms)

// Instalar service worker
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker instalado');
  self.skipWaiting(); // Ativar imediatamente
});

// Ativar service worker
self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker ativado');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Interceptar requisições de rede
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  
  // Não fazer cache de requisições de API
  if (event.request.url.includes('/api/')) {
    return;
  }

  // Não fazer cache de requisições que não sejam GET
  // Métodos como HEAD, POST, PUT, DELETE não podem ser armazenados no cache
  if (event.request.method !== 'GET') {
    return;
  }

  // Verificar se a requisição é same-origin (mesmo domínio)
  // Service Worker só deve interceptar requisições do mesmo domínio
  // Requisições externas (como Google Fonts) devem ser deixadas para o navegador
  const isSameOrigin = requestUrl.origin === self.location.origin;
  
  // Se não for same-origin, não interceptar - deixar o navegador lidar normalmente
  if (!isSameOrigin) {
    return;
  }

  // Cache de recursos estáticos (apenas same-origin)
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).then((fetchResponse) => {
        // Não fazer cache de HTML dinâmico
        if (event.request.destination === 'document') {
          return fetchResponse;
        }
        
        // Fazer cache apenas de recursos estáticos com status 200
        // E apenas se a resposta for clonável
        if (fetchResponse && 
            fetchResponse.status === 200 && 
            fetchResponse.type === 'basic' &&
            event.request.method === 'GET') {
          try {
            const responseToCache = fetchResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache).catch((error) => {
                console.warn('⚠️ Erro ao fazer cache:', error);
                // Não bloquear a requisição se o cache falhar
              });
            });
          } catch (error) {
            console.warn('⚠️ Erro ao clonar resposta para cache:', error);
            // Continuar mesmo se não conseguir fazer cache
          }
        }
        return fetchResponse;
      }).catch((error) => {
        // Se o fetch falhar, retornar erro
        console.warn('⚠️ Erro ao fazer fetch:', error);
        throw error;
      });
    })
  );
});

// Receber mensagens do cliente (página web)
self.addEventListener('message', (event) => {
  console.log('📨 Mensagem recebida no Service Worker:', event.data);

  if (event.data && event.data.type === 'START_TRACKING') {
    const { coletaId, sessionToken, trackingToken } = event.data;
    console.log('🚀 Iniciando rastreamento em background para coleta:', coletaId);
    iniciarRastreamentoBackground(coletaId, sessionToken, trackingToken);
  }

  if (event.data && event.data.type === 'STOP_TRACKING') {
    console.log('🛑 Parando rastreamento em background');
    pararRastreamentoBackground();
  }

  if (event.data && event.data.type === 'SEND_POSITION') {
    const { coletaId, position, sessionToken, trackingToken } = event.data;
    enviarPosicaoBackground(coletaId, position, sessionToken, trackingToken);
  }

  if (event.data && event.data.type === 'POSITION_RESPONSE') {
    // Cliente enviou posição em resposta à solicitação
    const { coletaId, position, sessionToken, trackingToken } = event.data;
    if (coletaId && position) {
      enviarPosicaoBackground(coletaId, position, sessionToken, trackingToken);
    }
  }

  if (event.data && event.data.type === 'UPDATE_TRACKING_TOKEN') {
    // Atualizar token de rastreamento persistente
    const { coletaId, trackingToken } = event.data;
    if (coletaId === currentColetaId) {
      currentTrackingToken = trackingToken;
      console.log('✅ Token de rastreamento atualizado no Service Worker');
    }
  }
});

// Variáveis para rastreamento em background
let trackingInterval = null;
let currentColetaId = null;
let currentSessionToken = null;
let currentTrackingToken = null; // Token de rastreamento persistente
let retryCount = 0;
const MAX_RETRIES = 3;

// Função para iniciar rastreamento em background
function iniciarRastreamentoBackground(coletaId, sessionToken, trackingToken = null) {
  if (trackingInterval) {
    clearInterval(trackingInterval);
  }

  currentColetaId = coletaId;
  currentSessionToken = sessionToken;
  currentTrackingToken = trackingToken;
  retryCount = 0;

  // Enviar posição imediatamente
  obterEEnviarPosicao(coletaId, sessionToken, trackingToken);

  // Configurar intervalo para enviar posição periodicamente
  trackingInterval = setInterval(() => {
    obterEEnviarPosicao(coletaId, sessionToken, currentTrackingToken);
  }, INTERVAL_TRACKING);

  console.log('✅ Rastreamento em background iniciado:', {
    coletaId,
    temSessionToken: !!sessionToken,
    temTrackingToken: !!trackingToken
  });
}

// Função para parar rastreamento em background
function pararRastreamentoBackground() {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
  currentColetaId = null;
  currentSessionToken = null;
  currentTrackingToken = null;
  retryCount = 0;
  console.log('🛑 Rastreamento em background parado');
}

// Função para solicitar posição do cliente (página web)
function solicitarPosicaoDoCliente() {
  // Enviar mensagem para todos os clientes solicitando posição
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
    if (clients.length === 0) {
      console.warn('⚠️ Nenhum cliente conectado para solicitar posição');
      return;
    }
    
    clients.forEach((client) => {
      client.postMessage({
        type: 'REQUEST_POSITION',
        timestamp: Date.now()
      });
    });
  });
}

// Função para obter e enviar posição (solicita do cliente)
function obterEEnviarPosicao(coletaId, sessionToken, trackingToken = null) {
  // Service Workers não têm acesso direto a navigator.geolocation
  // Precisamos solicitar a posição do cliente (página web)
  solicitarPosicaoDoCliente().catch((error) => {
    console.warn('⚠️ Erro ao solicitar posição do cliente:', error);
    // Se não houver cliente conectado, tentar novamente após um delay
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      setTimeout(() => {
        obterEEnviarPosicao(coletaId, sessionToken, trackingToken);
      }, 5000); // Tentar novamente após 5 segundos
    } else {
      console.error('❌ Máximo de tentativas atingido para solicitar posição');
      retryCount = 0; // Resetar contador após máximo de tentativas
    }
  });
}

// Função para enviar posição em background
async function enviarPosicaoBackground(coletaId, dadosPosicao, sessionToken, trackingToken = null) {
  // Usar token de rastreamento persistente se disponível, senão usar token de sessão
  const authToken = trackingToken || sessionToken;
  
  if (!authToken) {
    console.error('❌ Nenhum token disponível para enviar posição');
    // Tentar usar token de rastreamento armazenado se disponível
    if (currentTrackingToken) {
      console.log('🔄 Tentando usar token de rastreamento armazenado...');
      return enviarPosicaoBackground(coletaId, dadosPosicao, null, currentTrackingToken);
    }
    return;
  }

  try {
    const response = await fetch(ROUTE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(dadosPosicao)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      // Se for erro 401 e tivermos token de rastreamento, tentar usar ele
      if (response.status === 401 && trackingToken && sessionToken) {
        console.warn('⚠️ Sessão expirada, tentando usar token de rastreamento persistente...');
        return enviarPosicaoBackground(coletaId, dadosPosicao, null, trackingToken);
      }
      
      // Se for erro 401 e não tivermos token de rastreamento, tentar obter do cliente
      if (response.status === 401 && !trackingToken) {
        console.warn('⚠️ Sessão expirada, solicitando token de rastreamento do cliente...');
        self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            client.postMessage({
              type: 'REQUEST_TRACKING_TOKEN',
              coletaId: coletaId
            });
          });
        });
      }
      
      console.error('❌ Erro ao enviar posição:', {
        status: response.status,
        error: errorData.error || 'Erro desconhecido',
        usandoTrackingToken: !!trackingToken
      });
      return;
    }

    const result = await response.json();
    retryCount = 0; // Resetar contador em caso de sucesso
    
    console.log('✅ Posição enviada com sucesso em background:', {
      coletaId: coletaId,
      timestamp: new Date().toISOString(),
      usandoTrackingToken: !!trackingToken
    });

    // Notificar cliente sobre sucesso
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'POSITION_SENT',
          coletaId: coletaId,
          timestamp: new Date().toISOString()
        });
      });
    });
  } catch (error) {
    console.error('❌ Erro ao enviar posição em background:', error);
    
    // Em caso de erro de rede, tentar novamente após um delay
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      setTimeout(() => {
        enviarPosicaoBackground(coletaId, dadosPosicao, sessionToken, trackingToken);
      }, 10000); // Tentar novamente após 10 segundos
    } else {
      console.error('❌ Máximo de tentativas atingido para enviar posição');
      retryCount = 0;
    }
  }
}

// Notificar quando o service worker está pronto
self.addEventListener('sync', (event) => {
  console.log('🔄 Background sync:', event.tag);
  if (event.tag === 'send-position' && currentColetaId) {
    event.waitUntil(obterEEnviarPosicao(currentColetaId, currentSessionToken, currentTrackingToken));
  }
});

// Registrar periodic background sync (se suportado)
if ('periodicSync' in self.registration) {
  self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'tracking-sync' && currentColetaId) {
      console.log('🔄 Periodic sync para rastreamento');
      event.waitUntil(obterEEnviarPosicao(currentColetaId, currentSessionToken, currentTrackingToken));
    }
  });
}

// Lidar com notificações push (futuro)
self.addEventListener('push', (event) => {
  console.log('📬 Push notification recebida:', event);
  // Implementar notificações push se necessário
});

