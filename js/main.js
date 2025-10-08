// main.js - Configurações principais
import { initCategories } from './categories.js';
import { initContacts } from './contacts.js';
import { initMessages } from './messages.js';

document.addEventListener('DOMContentLoaded', function() {
  initCategories();
  initContacts();
  initMessages();
  console.log('🚀 Aplicação carregada!');
});