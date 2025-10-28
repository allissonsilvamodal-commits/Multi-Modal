#!/usr/bin/env node

// Script para limpar rate limiting via terminal
const fetch = require('node-fetch');

async function limparRateLimit() {
    try {
        console.log('🧹 Limpando rate limiting...');
        
        const response = await fetch('http://localhost:5680/api/clear-rate-limit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Rate limiting limpo com sucesso!');
            console.log('📅 Timestamp:', data.timestamp);
        } else {
            console.log('❌ Erro ao limpar rate limiting:', data.error);
        }
    } catch (error) {
        console.log('❌ Erro ao conectar com o servidor:', error.message);
        console.log('💡 Certifique-se de que o servidor está rodando em http://localhost:5680');
    }
}

limparRateLimit();
