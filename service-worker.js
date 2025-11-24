// Service Worker para Portal do Motorista
// Permite rastreamento em background quando o app está instalado

const CACHE_NAME = 'portal-motorista-v1';
const ROUTE_API = '/api/rastreamento/enviar-posicao';
const INTERVAL_TRACKING = 30000; // 30 segundos

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
  // Não fazer cache de requisições de API
  if (event.request.url.includes('/api/')) {
    return;
  }

  // Cache de recursos estáticos
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).then((fetchResponse) => {
        // Não fazer cache de HTML dinâmico
        if (event.request.destination === 'document') {
          return fetchResponse;
        }
        // Fazer cache de recursos estáticos
        if (fetchResponse && fetchResponse.status === 200) {
          const responseToCache = fetchResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return fetchResponse;
      });
    })
  );
});

// Receber mensagens do cliente (página web)
self.addEventListener('message', (event) => {
  console.log('📨 Mensagem recebida no Service Worker:', event.data);

  if (event.data && event.data.type === 'START_TRACKING') {
    const { coletaId, sessionToken } = event.data;
    console.log('🚀 Iniciando rastreamento em background para coleta:', coletaId);
    iniciarRastreamentoBackground(coletaId, sessionToken);
  }

  if (event.data && event.data.type === 'STOP_TRACKING') {
    console.log('🛑 Parando rastreamento em background');
    pararRastreamentoBackground();
  }

  if (event.data && event.data.type === 'SEND_POSITION') {
    const { coletaId, position, sessionToken } = event.data;
    enviarPosicaoBackground(coletaId, position, sessionToken);
  }

  if (event.data && event.data.type === 'POSITION_RESPONSE') {
    // Cliente enviou posição em resposta à solicitação
    const { coletaId, position, sessionToken } = event.data;
    if (coletaId && position && sessionToken) {
      enviarPosicaoBackground(coletaId, position, sessionToken);
    }
  }
});

// Variáveis para rastreamento em background
let trackingInterval = null;
let currentColetaId = null;
let currentSessionToken = null;

// Função para iniciar rastreamento em background
function iniciarRastreamentoBackground(coletaId, sessionToken) {
  if (trackingInterval) {
    clearInterval(trackingInterval);
  }

  currentColetaId = coletaId;
  currentSessionToken = sessionToken;

  // Enviar posição imediatamente
  obterEEnviarPosicao(coletaId, sessionToken);

  // Configurar intervalo para enviar posição periodicamente
  trackingInterval = setInterval(() => {
    obterEEnviarPosicao(coletaId, sessionToken);
  }, INTERVAL_TRACKING);

  console.log('✅ Rastreamento em background iniciado');
}

// Função para parar rastreamento em background
function pararRastreamentoBackground() {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
  currentColetaId = null;
  currentSessionToken = null;
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
function obterEEnviarPosicao(coletaId, sessionToken) {
  // Service Workers não têm acesso direto a navigator.geolocation
  // Precisamos solicitar a posição do cliente (página web)
  solicitarPosicaoDoCliente();
}

// Função para enviar posição em background
async function enviarPosicaoBackground(coletaId, dadosPosicao, sessionToken) {
  if (!sessionToken) {
    console.error('❌ Token de sessão não disponível');
    return;
  }

  try {
    const response = await fetch(ROUTE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify(dadosPosicao)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('❌ Erro ao enviar posição:', {
        status: response.status,
        error: errorData.error || 'Erro desconhecido'
      });
      return;
    }

    const result = await response.json();
    console.log('✅ Posição enviada com sucesso em background:', {
      coletaId: coletaId,
      timestamp: new Date().toISOString()
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
  }
}

// Notificar quando o service worker está pronto
self.addEventListener('sync', (event) => {
  console.log('🔄 Background sync:', event.tag);
  if (event.tag === 'send-position' && currentColetaId && currentSessionToken) {
    event.waitUntil(obterEEnviarPosicao(currentColetaId, currentSessionToken));
  }
});

// Lidar com notificações push (futuro)
self.addEventListener('push', (event) => {
  console.log('📬 Push notification recebida:', event);
  // Implementar notificações push se necessário
});

