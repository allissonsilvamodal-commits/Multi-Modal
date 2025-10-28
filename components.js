// 🎨 MELHORIA: Componentes JavaScript reutilizáveis
class NotificationManager {
  constructor() {
    this.container = this.createContainer();
    this.notifications = new Map();
  }

  createContainer() {
    const container = document.createElement('div');
    container.id = 'notification-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      max-width: 400px;
    `;
    document.body.appendChild(container);
    return container;
  }

  show(message, type = 'info', duration = 5000) {
    const id = Date.now().toString();
    const notification = this.createNotification(id, message, type);
    
    this.container.appendChild(notification);
    this.notifications.set(id, notification);

    // Auto remove
    if (duration > 0) {
      setTimeout(() => this.remove(id), duration);
    }

    return id;
  }

  createNotification(id, message, type) {
    const notification = document.createElement('div');
    notification.id = `notification-${id}`;
    notification.className = `notification notification-${type}`;
    
    const icons = {
      success: 'fas fa-check-circle',
      error: 'fas fa-exclamation-circle',
      warning: 'fas fa-exclamation-triangle',
      info: 'fas fa-info-circle'
    };

    const colors = {
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6'
    };

    notification.style.cssText = `
      background: white;
      border-left: 4px solid ${colors[type]};
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      padding: 16px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 12px;
      animation: slideIn 0.3s ease-out;
      max-width: 100%;
    `;

    notification.innerHTML = `
      <i class="${icons[type]}" style="color: ${colors[type]}; font-size: 20px;"></i>
      <div style="flex: 1;">
        <div style="font-weight: 500; color: #1f2937;">${message}</div>
      </div>
      <button onclick="notificationManager.remove('${id}')" style="
        background: none;
        border: none;
        color: #6b7280;
        cursor: pointer;
        font-size: 18px;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">×</button>
    `;

    // Adicionar animação CSS se não existir
    if (!document.getElementById('notification-styles')) {
      const style = document.createElement('style');
      style.id = 'notification-styles';
      style.textContent = `
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    return notification;
  }

  remove(id) {
    const notification = this.notifications.get(id);
    if (notification) {
      notification.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
        this.notifications.delete(id);
      }, 300);
    }
  }

  clear() {
    this.notifications.forEach((notification, id) => {
      this.remove(id);
    });
  }
}

// Classe para Loading Manager
class LoadingManager {
  constructor() {
    this.activeLoadings = new Set();
    this.createOverlay();
  }

  createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 9999;
    `;
    
    overlay.innerHTML = `
      <div style="
        background: white;
        padding: 2rem;
        border-radius: 12px;
        text-align: center;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      ">
        <div class="spinner-border text-primary mb-3" role="status">
          <span class="visually-hidden">Carregando...</span>
        </div>
        <div id="loading-message">Carregando...</div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  show(message = 'Carregando...', id = 'default') {
    this.activeLoadings.add(id);
    document.getElementById('loading-message').textContent = message;
    this.overlay.style.display = 'flex';
  }

  hide(id = 'default') {
    this.activeLoadings.delete(id);
    if (this.activeLoadings.size === 0) {
      this.overlay.style.display = 'none';
    }
  }

  hideAll() {
    this.activeLoadings.clear();
    this.overlay.style.display = 'none';
  }
}

// Classe para Form Manager
class FormManager {
  constructor(formElement) {
    this.form = formElement;
    this.originalData = this.getFormData();
    this.setupValidation();
  }

  getFormData() {
    const formData = new FormData(this.form);
    const data = {};
    for (let [key, value] of formData.entries()) {
      data[key] = value;
    }
    return data;
  }

  setupValidation() {
    this.form.addEventListener('submit', (e) => {
      if (!this.validate()) {
        e.preventDefault();
        return false;
      }
    });
  }

  validate() {
    const inputs = this.form.querySelectorAll('input[required], select[required], textarea[required]');
    let isValid = true;

    inputs.forEach(input => {
      if (!input.value.trim()) {
        this.showFieldError(input, 'Este campo é obrigatório');
        isValid = false;
      } else {
        this.clearFieldError(input);
      }
    });

    return isValid;
  }

  showFieldError(input, message) {
    this.clearFieldError(input);
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'field-error';
    errorDiv.style.cssText = `
      color: #ef4444;
      font-size: 0.875rem;
      margin-top: 0.25rem;
    `;
    errorDiv.textContent = message;
    
    input.parentNode.appendChild(errorDiv);
    input.style.borderColor = '#ef4444';
  }

  clearFieldError(input) {
    const errorDiv = input.parentNode.querySelector('.field-error');
    if (errorDiv) {
      errorDiv.remove();
    }
    input.style.borderColor = '';
  }

  hasChanges() {
    const currentData = this.getFormData();
    return JSON.stringify(currentData) !== JSON.stringify(this.originalData);
  }

  reset() {
    this.form.reset();
    this.originalData = this.getFormData();
  }
}

// Instâncias globais
const notificationManager = new NotificationManager();
const loadingManager = new LoadingManager();

// Exportar para uso global
window.NotificationManager = NotificationManager;
window.LoadingManager = LoadingManager;
window.FormManager = FormManager;
window.notificationManager = notificationManager;
window.loadingManager = loadingManager;
class NotificationManager {
  constructor() {
    this.container = this.createContainer();
    this.notifications = new Map();
  }

  createContainer() {
    const container = document.createElement('div');
    container.id = 'notification-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      max-width: 400px;
    `;
    document.body.appendChild(container);
    return container;
  }

  show(message, type = 'info', duration = 5000) {
    const id = Date.now().toString();
    const notification = this.createNotification(id, message, type);
    
    this.container.appendChild(notification);
    this.notifications.set(id, notification);

    // Auto remove
    if (duration > 0) {
      setTimeout(() => this.remove(id), duration);
    }

    return id;
  }

  createNotification(id, message, type) {
    const notification = document.createElement('div');
    notification.id = `notification-${id}`;
    notification.className = `notification notification-${type}`;
    
    const icons = {
      success: 'fas fa-check-circle',
      error: 'fas fa-exclamation-circle',
      warning: 'fas fa-exclamation-triangle',
      info: 'fas fa-info-circle'
    };

    const colors = {
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6'
    };

    notification.style.cssText = `
      background: white;
      border-left: 4px solid ${colors[type]};
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      padding: 16px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 12px;
      animation: slideIn 0.3s ease-out;
      max-width: 100%;
    `;

    notification.innerHTML = `
      <i class="${icons[type]}" style="color: ${colors[type]}; font-size: 20px;"></i>
      <div style="flex: 1;">
        <div style="font-weight: 500; color: #1f2937;">${message}</div>
      </div>
      <button onclick="notificationManager.remove('${id}')" style="
        background: none;
        border: none;
        color: #6b7280;
        cursor: pointer;
        font-size: 18px;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">×</button>
    `;

    // Adicionar animação CSS se não existir
    if (!document.getElementById('notification-styles')) {
      const style = document.createElement('style');
      style.id = 'notification-styles';
      style.textContent = `
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    return notification;
  }

  remove(id) {
    const notification = this.notifications.get(id);
    if (notification) {
      notification.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
        this.notifications.delete(id);
      }, 300);
    }
  }

  clear() {
    this.notifications.forEach((notification, id) => {
      this.remove(id);
    });
  }
}

// Classe para Loading Manager
class LoadingManager {
  constructor() {
    this.activeLoadings = new Set();
    this.createOverlay();
  }

  createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 9999;
    `;
    
    overlay.innerHTML = `
      <div style="
        background: white;
        padding: 2rem;
        border-radius: 12px;
        text-align: center;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      ">
        <div class="spinner-border text-primary mb-3" role="status">
          <span class="visually-hidden">Carregando...</span>
        </div>
        <div id="loading-message">Carregando...</div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  show(message = 'Carregando...', id = 'default') {
    this.activeLoadings.add(id);
    document.getElementById('loading-message').textContent = message;
    this.overlay.style.display = 'flex';
  }

  hide(id = 'default') {
    this.activeLoadings.delete(id);
    if (this.activeLoadings.size === 0) {
      this.overlay.style.display = 'none';
    }
  }

  hideAll() {
    this.activeLoadings.clear();
    this.overlay.style.display = 'none';
  }
}

// Classe para Form Manager
class FormManager {
  constructor(formElement) {
    this.form = formElement;
    this.originalData = this.getFormData();
    this.setupValidation();
  }

  getFormData() {
    const formData = new FormData(this.form);
    const data = {};
    for (let [key, value] of formData.entries()) {
      data[key] = value;
    }
    return data;
  }

  setupValidation() {
    this.form.addEventListener('submit', (e) => {
      if (!this.validate()) {
        e.preventDefault();
        return false;
      }
    });
  }

  validate() {
    const inputs = this.form.querySelectorAll('input[required], select[required], textarea[required]');
    let isValid = true;

    inputs.forEach(input => {
      if (!input.value.trim()) {
        this.showFieldError(input, 'Este campo é obrigatório');
        isValid = false;
      } else {
        this.clearFieldError(input);
      }
    });

    return isValid;
  }

  showFieldError(input, message) {
    this.clearFieldError(input);
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'field-error';
    errorDiv.style.cssText = `
      color: #ef4444;
      font-size: 0.875rem;
      margin-top: 0.25rem;
    `;
    errorDiv.textContent = message;
    
    input.parentNode.appendChild(errorDiv);
    input.style.borderColor = '#ef4444';
  }

  clearFieldError(input) {
    const errorDiv = input.parentNode.querySelector('.field-error');
    if (errorDiv) {
      errorDiv.remove();
    }
    input.style.borderColor = '';
  }

  hasChanges() {
    const currentData = this.getFormData();
    return JSON.stringify(currentData) !== JSON.stringify(this.originalData);
  }

  reset() {
    this.form.reset();
    this.originalData = this.getFormData();
  }
}

// Instâncias globais
const notificationManager = new NotificationManager();
const loadingManager = new LoadingManager();

// Exportar para uso global
window.NotificationManager = NotificationManager;
window.LoadingManager = LoadingManager;
window.FormManager = FormManager;
window.notificationManager = notificationManager;
window.loadingManager = loadingManager;
