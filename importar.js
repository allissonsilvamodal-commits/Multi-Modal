const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const csv = require('csv-parser');

const db = new sqlite3.Database('./contatos.db');

function importarCSV(caminhoArquivo) {
  console.log('📦 Iniciando importação de contatos...');
  
  const contatos = [];
  
  fs.createReadStream(caminhoArquivo)
    .pipe(csv())
    .on('data', (row) => {
      // Aceita vários formatos de CSV
      const name = row.name || row.nome || row.Nome || '';
      const number = row.number || row.numero || row.telefone || row.Telefone || '';
      const category = row.category || row.categoria || row.Categoria || 'sider';
      
      if (name && number) {
        contatos.push({ name, number, category });
      }
    })
    .on('end', () => {
      console.log(`✅ Lidos ${contatos.length} contatos do CSV`);
      inserirLote(contatos);
    })
    .on('error', (err) => {
      console.error('❌ Erro ao ler CSV:', err);
    });
}

function inserirLote(contatos) {
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    const stmt = db.prepare('INSERT OR IGNORE INTO contatos (name, number, category) VALUES (?, ?, ?)');
    
    let inseridos = 0;
    contatos.forEach((contato, index) => {
      stmt.run([contato.name, contato.number, contato.category], function(err) {
        if (err) {
          console.error('Erro ao inserir:', err);
        } else {
          inseridos++;
        }
        
        // Mostrar progresso
        if (inseridos % 500 === 0) {
          console.log(`📊 ${inseridos}/${contatos.length} contatos inseridos...`);
        }
        
        // Finalizar
        if (index === contatos.length - 1) {
          stmt.finalize(() => {
            db.run('COMMIT', () => {
              console.log(`🎉 IMPORTAÇÃO CONCLUÍDA!`);
              console.log(`✅ ${inseridos} contatos adicionados com sucesso`);
              console.log(`❌ ${contatos.length - inseridos} duplicados ignorados`);
              db.close();
            });
          });
        }
      });
    });
  });
}

// Uso: node importar.js
importarCSV('contatos.csv');