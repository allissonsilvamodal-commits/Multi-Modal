require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'online', 
    message: 'Sistema Seguro de Disparos - Backend API',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Rota simples de teste
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Backend seguro funcionando!',
    supabase: process.env.SUPABASE_URL ? 'Configurado' : 'Não configurado'
  });
});

app.listen(PORT, () => {
  console.log(`🛡️  Backend seguro rodando na porta ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
});