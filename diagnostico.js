require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 5680; // Porta diferente para não conflitar

const EVOLUTION_CONFIG = {
  baseUrl: process.env.EVOLUTION_BASE_URL,
  instanceName: process.env.EVOLUTION_INSTANCE_NAME,
  apiKey: process.env.EVOLUTION_API_KEY
};

app.use(cors());
app.use(express.json());

// Rota para descobrir endpoints
app.get('/discover', async (req, res) => {
  console.log('🔍 Iniciando descoberta de endpoints...');
  
  const endpoints = [
    '/instance/fetchInstances',
    '/instance/list',
    '/instances', 
    '/api/instances',
    '/manager/instances',
    '/',
    '/status',
    '/health'
  ];

  const results = [];

  for (const endpoint of endpoints) {
    try {
      const url = `${EVOLUTION_CONFIG.baseUrl}${endpoint}`;
      console.log(`Testando: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'apikey': EVOLUTION_CONFIG.apiKey,
          'Authorization': `Bearer ${EVOLUTION_CONFIG.apiKey}`
        },
        timeout: 5000
      });

      results.push({
        endpoint: endpoint,
        url: url,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (response.ok) {
        try {
          const data = await response.json();
          results[results.length - 1].data = data;
        } catch (e) {
          results[results.length - 1].data = 'Não é JSON';
        }
      }

    } catch (error) {
      results.push({
        endpoint: endpoint,
        url: url,
        error: error.message,
        ok: false
      });
    }
  }

  res.json({
    evolutionConfig: {
      baseUrl: EVOLUTION_CONFIG.baseUrl,
      instanceName: '***' + EVOLUTION_CONFIG.instanceName?.slice(-4),
      hasApiKey: !!EVOLUTION_CONFIG.apiKey
    },
    results: results
  });
});

app.listen(PORT, () => {
  console.log(`🔍 Servidor de diagnóstico rodando na porta ${PORT}`);
  console.log(`🌐 Acesse: http://localhost:${PORT}/discover`);
});