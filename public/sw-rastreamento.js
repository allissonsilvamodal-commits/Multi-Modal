// Service Worker para rastreamento GPS em background
// Este Service Worker continua enviando localização mesmo quando a aba está fechada

const CACHE_NAME = 'rastreamento-gps-v1';
const INTERVALO_ENVIO_MS = 2 * 60 * 1000; // 2 minutos
const DB_NAME = 'rastreamento-db';
const DB_VERSION = 2; // Aumentado para criar índice coletaId
const STORE_NAME = 'posicoes-pendentes';

let rastreamentoAtivo = false;
let coletaId = null;
let tokenRastreamento = null;
let intervaloEnvio = null;
let intervaloIndexedDB = null; // Intervalo para enviar posições do IndexedDB
let ultimaPosicao = null;
let db = null;

// Inicializar IndexedDB para armazenar posições pendentes
function abrirDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('coletaId', 'coletaId', { unique: false });
            } else {
                // Se o store já existe, verificar se o índice coletaId existe
                const transaction = event.target.transaction;
                const store = transaction.objectStore(STORE_NAME);
                if (!store.indexNames.contains('coletaId')) {
                    store.createIndex('coletaId', 'coletaId', { unique: false });
                }
            }
        };
    });
}

// Instalar Service Worker
self.addEventListener('install', (event) => {
    console.log('[SW] Service Worker instalado');
    self.skipWaiting();
});

// Ativar Service Worker
self.addEventListener('activate', (event) => {
    console.log('[SW] Service Worker ativado');
    event.waitUntil(self.clients.claim());
});

// Receber mensagens do cliente (página)
self.addEventListener('message', (event) => {
    console.log('[SW] Mensagem recebida:', event.data);
    
    if (event.data.type === 'INICIAR_RASTREAMENTO') {
        coletaId = event.data.coletaId;
        tokenRastreamento = event.data.tokenRastreamento;
        rastreamentoAtivo = true;
        iniciarRastreamento();
    } else if (event.data.type === 'PARAR_RASTREAMENTO') {
        pararRastreamento();
    } else if (event.data.type === 'ATUALIZAR_TOKEN') {
        tokenRastreamento = event.data.tokenRastreamento;
    } else if (event.data.type === 'NOVA_POSICAO_INDEXEDDB') {
        // Cliente notificou que há nova posição no IndexedDB
        // Tentar enviar posições pendentes
        if (rastreamentoAtivo) {
            enviarPosicoesPendentes();
        }
    }
});

// Iniciar rastreamento GPS
function iniciarRastreamento() {
    console.log('[SW] Iniciando rastreamento GPS');
    
    if (!coletaId || !tokenRastreamento) {
        console.error('[SW] Dados insuficientes para rastreamento');
        return;
    }

    // Inicializar IndexedDB
    abrirDB().then(() => {
        console.log('[SW] IndexedDB inicializado');
    }).catch(error => {
        console.error('[SW] Erro ao inicializar IndexedDB:', error);
    });

    // Obter posição inicial
    obterEEnviarPosicao();

    // Configurar intervalo para envio periódico
    intervaloEnvio = setInterval(() => {
        if (rastreamentoAtivo) {
            obterEEnviarPosicao();
        }
    }, INTERVALO_ENVIO_MS);

    // Configurar intervalo adicional para tentar enviar posições do IndexedDB
    // Isso garante que mesmo sem cliente ativo, tentamos enviar posições armazenadas
    intervaloIndexedDB = setInterval(async () => {
        if (rastreamentoAtivo && coletaId && tokenRastreamento) {
            const clientes = await self.clients.matchAll({ includeUncontrolled: true });
            // Se não há cliente ativo, tentar enviar posições do IndexedDB
            if (clientes.length === 0) {
                console.log('[SW] Nenhum cliente ativo, tentando enviar posições do IndexedDB');
                await enviarPosicoesPendentes();
            }
        }
    }, INTERVALO_ENVIO_MS * 2); // A cada 4 minutos quando não há cliente

    // Notificar cliente que rastreamento iniciou
    enviarMensagemParaCliente({
        type: 'RASTREAMENTO_INICIADO',
        message: 'Rastreamento GPS iniciado em background'
    });
}

// Parar rastreamento
function pararRastreamento() {
    console.log('[SW] Parando rastreamento GPS');
    rastreamentoAtivo = false;
    
    if (watchId !== null) {
        // watchId seria usado se tivéssemos acesso ao navigator.geolocation aqui
        // Mas Service Workers não têm acesso direto, então usamos o intervalo
        watchId = null;
    }
    
    if (intervaloEnvio !== null) {
        clearInterval(intervaloEnvio);
        intervaloEnvio = null;
    }
    
    if (intervaloIndexedDB !== null) {
        clearInterval(intervaloIndexedDB);
        intervaloIndexedDB = null;
    }

    // Notificar cliente
    enviarMensagemParaCliente({
        type: 'RASTREAMENTO_PARADO',
        message: 'Rastreamento GPS parado'
    });
}

// Obter e enviar posição GPS
async function obterEEnviarPosicao() {
    if (!rastreamentoAtivo || !coletaId || !tokenRastreamento) {
        return;
    }

    try {
        // Service Workers não têm acesso direto ao navigator.geolocation
        // Então vamos pedir ao cliente (página) para obter a posição
        const clientes = await self.clients.matchAll({ includeUncontrolled: true });
        
        if (clientes.length > 0) {
            // Pedir ao cliente para obter a posição
            clientes.forEach(cliente => {
                cliente.postMessage({
                    type: 'OBTER_POSICAO_GPS',
                    coletaId: coletaId
                });
            });
        } else {
            // Se não há cliente ativo, usar posições do IndexedDB
            console.log('[SW] Nenhum cliente ativo, tentando enviar posições do IndexedDB');
            await enviarPosicoesPendentes();
        }
    } catch (error) {
        console.error('[SW] Erro ao obter posição:', error);
        // Em caso de erro, tentar enviar posições pendentes
        await enviarPosicoesPendentes();
    }
}

// Receber posição do cliente
self.addEventListener('message', (event) => {
    if (event.data.type === 'POSICAO_GPS') {
        ultimaPosicao = event.data.position;
        enviarPosicaoParaServidor(event.data.position);
    }
});

// Enviar posição para o servidor
async function enviarPosicaoParaServidor(position) {
    if (!position || !position.coords || !coletaId || !tokenRastreamento) {
        console.warn('[SW] Dados insuficientes para enviar posição');
        return;
    }

    const { latitude, longitude, accuracy } = position.coords;

    // Validar coordenadas
    if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        console.error('[SW] Coordenadas inválidas');
        return;
    }

    const dadosPosicao = {
        coletaId: coletaId,
        latitude: parseFloat(latitude.toFixed(6)),
        longitude: parseFloat(longitude.toFixed(6)),
        precisao: accuracy ? parseFloat(accuracy.toFixed(2)) : null,
        velocidade: position.coords.speed ? parseFloat((position.coords.speed * 3.6).toFixed(2)) : null,
        direcao: position.coords.heading ? parseFloat(position.coords.heading.toFixed(2)) : null
    };

    try {
        const response = await fetch('/api/rastreamento/enviar-posicao', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenRastreamento}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(dadosPosicao)
        });

        if (response.ok) {
            console.log('[SW] Posição enviada com sucesso');
            ultimaPosicao = position; // Atualizar última posição conhecida
            
            // Notificar cliente
            enviarMensagemParaCliente({
                type: 'POSICAO_ENVIADA',
                timestamp: new Date().toISOString()
            });
        } else {
            const errorData = await response.json().catch(() => ({}));
            console.error('[SW] Erro ao enviar posição:', response.status, errorData);
            
            // Salvar posição no IndexedDB para tentar novamente depois
            await salvarPosicaoPendente(dadosPosicao);
            
            // Se for erro de autenticação, tentar revalidar token
            if (response.status === 401 || response.status === 403) {
                enviarMensagemParaCliente({
                    type: 'TOKEN_INVALIDO',
                    message: 'Token de rastreamento inválido'
                });
            }
            
            // Lançar erro para que o chamador saiba que falhou
            throw new Error(`Erro HTTP ${response.status}`);
        }
    } catch (error) {
        console.error('[SW] Erro na requisição:', error);
        
        // Salvar posição no IndexedDB para tentar novamente depois
        await salvarPosicaoPendente(dadosPosicao);
        
        // Usar Background Sync para tentar novamente quando houver conexão
        if ('sync' in self.registration) {
            try {
                await self.registration.sync.register('rastreamento-sync');
            } catch (syncError) {
                console.error('[SW] Erro ao registrar sync:', syncError);
            }
        }
        
        // Re-lançar erro para tratamento no chamador
        throw error;
    }
}

// Salvar posição pendente no IndexedDB
async function salvarPosicaoPendente(dadosPosicao) {
    try {
        if (!db) {
            await abrirDB();
        }
        
        if (!db) {
            console.error('[SW] Não foi possível abrir IndexedDB para salvar posição pendente');
            return;
        }
        
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        await new Promise((resolve, reject) => {
            const request = store.add({
                ...dadosPosicao,
                tokenRastreamento: tokenRastreamento,
                timestamp: new Date().toISOString(),
                tentativas: 0
            });
            
            request.onsuccess = () => {
                console.log('[SW] Posição salva no IndexedDB para envio posterior');
                resolve();
            };
            
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[SW] Erro ao salvar posição pendente:', error);
    }
}

// Enviar posições pendentes do IndexedDB
async function enviarPosicoesPendentes() {
    try {
        if (!db) {
            await abrirDB();
        }
        
        if (!db) {
            console.error('[SW] Não foi possível abrir IndexedDB');
            return;
        }
        
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        // Tentar usar índice coletaId, se não existir, buscar todas e filtrar
        let request;
        let usarIndice = false;
        try {
            if (store.indexNames.contains('coletaId')) {
                const index = store.index('coletaId');
                request = index.getAll(coletaId);
                usarIndice = true;
            } else {
                // Fallback: buscar todas e filtrar
                request = store.getAll();
                usarIndice = false;
            }
        } catch (error) {
            // Se houver erro ao acessar o índice, buscar todas
            console.warn('[SW] Erro ao acessar índice coletaId, usando fallback:', error);
            request = store.getAll();
            usarIndice = false;
        }
        
        return new Promise((resolve, reject) => {
            request.onsuccess = async () => {
                let posicoes = request.result;
                
                // Se não usamos o índice, filtrar por coletaId
                if (!usarIndice) {
                    posicoes = posicoes.filter(p => p.coletaId === coletaId);
                }
                
                if (posicoes.length === 0) {
                    console.log('[SW] Nenhuma posição pendente no IndexedDB para esta coleta');
                    resolve();
                    return;
                }
                
                console.log(`[SW] Encontradas ${posicoes.length} posições pendentes no IndexedDB para coleta ${coletaId}`);
                
                // Ordenar por timestamp (mais antigas primeiro)
                posicoes.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                
                // Enviar até 10 posições por vez para não sobrecarregar
                const posicoesParaEnviar = posicoes.slice(0, 10);
                
                for (const posicao of posicoesParaEnviar) {
                    // Usar token da posição se disponível, senão usar o token atual
                    const tokenParaUsar = posicao.tokenRastreamento || tokenRastreamento;
                    
                    if (!tokenParaUsar) {
                        console.warn('[SW] Posição sem token, pulando');
                        continue;
                    }
                    
                    // Criar objeto position simulado
                    const positionSimulado = {
                        coords: {
                            latitude: posicao.latitude,
                            longitude: posicao.longitude,
                            accuracy: posicao.precisao,
                            speed: posicao.velocidade ? posicao.velocidade / 3.6 : null,
                            heading: posicao.direcao
                        }
                    };
                    
                    // Atualizar token temporariamente para esta posição
                    const tokenOriginal = tokenRastreamento;
                    tokenRastreamento = tokenParaUsar;
                    
                    try {
                        await enviarPosicaoParaServidor(positionSimulado);
                        
                        // Remover posição após envio bem-sucedido
                        const deleteTransaction = db.transaction([STORE_NAME], 'readwrite');
                        const deleteStore = deleteTransaction.objectStore(STORE_NAME);
                        await new Promise((resolveDelete, rejectDelete) => {
                            const deleteRequest = deleteStore.delete(posicao.id);
                            deleteRequest.onsuccess = () => {
                                console.log('[SW] Posição removida do IndexedDB após envio bem-sucedido');
                                resolveDelete();
                            };
                            deleteRequest.onerror = () => rejectDelete(deleteRequest.error);
                        });
                    } catch (error) {
                        console.error('[SW] Erro ao enviar posição do IndexedDB:', error);
                        // Incrementar tentativas
                        posicao.tentativas = (posicao.tentativas || 0) + 1;
                        
                        // Se exceder 5 tentativas, remover a posição (provavelmente muito antiga)
                        if (posicao.tentativas >= 5) {
                            const deleteTransaction = db.transaction([STORE_NAME], 'readwrite');
                            const deleteStore = deleteTransaction.objectStore(STORE_NAME);
                            await new Promise((resolveDelete) => {
                                const deleteRequest = deleteStore.delete(posicao.id);
                                deleteRequest.onsuccess = () => {
                                    console.log('[SW] Posição removida após muitas tentativas');
                                    resolveDelete();
                                };
                                deleteRequest.onerror = () => resolveDelete();
                            });
                        }
                    } finally {
                        // Restaurar token original
                        tokenRastreamento = tokenOriginal;
                    }
                }
                
                resolve();
            };
            
            request.onerror = () => {
                console.error('[SW] Erro ao buscar posições pendentes:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('[SW] Erro ao enviar posições pendentes:', error);
    }
}

// Background Sync - tentar enviar posições pendentes quando houver conexão
self.addEventListener('sync', (event) => {
    if (event.tag === 'rastreamento-sync') {
        console.log('[SW] Background sync acionado');
        event.waitUntil(async () => {
            await enviarPosicoesPendentes();
            await obterEEnviarPosicao();
        });
    }
});

// Inicializar DB quando Service Worker é ativado
self.addEventListener('activate', async (event) => {
    event.waitUntil(async () => {
        await abrirDB();
        await self.clients.claim();
    });
});

// Enviar mensagem para todos os clientes
async function enviarMensagemParaCliente(mensagem) {
    const clientes = await self.clients.matchAll();
    clientes.forEach(cliente => {
        cliente.postMessage(mensagem);
    });
}

// Manter Service Worker ativo
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

console.log('[SW] Service Worker de rastreamento carregado');

