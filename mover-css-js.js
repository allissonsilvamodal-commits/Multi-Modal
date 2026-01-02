const fs = require('fs');
const path = require('path');

const workspaceDir = __dirname;

console.log('📁 Diretório:', workspaceDir);

// Mover CSS
const cssSource = path.join(workspaceDir, 'css');
const cssDest = path.join(workspaceDir, 'public', 'css');

if (fs.existsSync(cssSource)) {
    console.log('📦 Movendo CSS...');
    const files = fs.readdirSync(cssSource);
    files.forEach(file => {
        const source = path.join(cssSource, file);
        const dest = path.join(cssDest, file);
        try {
            fs.renameSync(source, dest);
            console.log(`  ✅ ${file} → public/css/`);
        } catch (error) {
            console.log(`  ❌ Erro ao mover ${file}: ${error.message}`);
        }
    });
    try {
        fs.rmdirSync(cssSource);
        console.log('  ✅ Pasta css/ removida');
    } catch (error) {
        console.log(`  ⚠️  Não foi possível remover pasta css/: ${error.message}`);
    }
} else {
    console.log('⚠️  Pasta css/ não encontrada');
}

// Mover JS
const jsSource = path.join(workspaceDir, 'js');
const jsDest = path.join(workspaceDir, 'public', 'js');

if (fs.existsSync(jsSource)) {
    console.log('\n📦 Movendo JS...');
    const files = fs.readdirSync(jsSource);
    files.forEach(file => {
        const source = path.join(jsSource, file);
        const dest = path.join(jsDest, file);
        
        // Se for um arquivo, mover
        if (fs.statSync(source).isFile()) {
            try {
                fs.renameSync(source, dest);
                console.log(`  ✅ ${file} → public/js/`);
            } catch (error) {
                console.log(`  ❌ Erro ao mover ${file}: ${error.message}`);
            }
        } else if (fs.statSync(source).isDirectory() && file === 'modules') {
            // Se for a pasta modules, mover conteúdo
            const modulesSource = path.join(jsSource, 'modules');
            const modulesDest = path.join(jsDest, 'modules');
            
            if (fs.existsSync(modulesDest)) {
                // Se já existe, mover conteúdo
                const moduleFiles = fs.readdirSync(modulesSource);
                moduleFiles.forEach(moduleFile => {
                    const modSource = path.join(modulesSource, moduleFile);
                    const modDest = path.join(modulesDest, moduleFile);
                    try {
                        if (fs.statSync(modSource).isDirectory()) {
                            // Se for diretório, copiar recursivamente
                            copyRecursiveSync(modSource, modDest);
                            deleteRecursiveSync(modSource);
                        } else {
                            fs.renameSync(modSource, modDest);
                        }
                        console.log(`  ✅ modules/${moduleFile} → public/js/modules/`);
                    } catch (error) {
                        console.log(`  ❌ Erro ao mover modules/${moduleFile}: ${error.message}`);
                    }
                });
                try {
                    fs.rmdirSync(modulesSource);
                } catch (error) {
                    // Ignorar se não conseguir remover
                }
            } else {
                // Se não existe, mover a pasta inteira
                try {
                    fs.renameSync(modulesSource, modulesDest);
                    console.log(`  ✅ modules/ → public/js/modules/`);
                } catch (error) {
                    console.log(`  ❌ Erro ao mover modules/: ${error.message}`);
                }
            }
        }
    });
    
    // Tentar remover pasta js se estiver vazia
    try {
        const remaining = fs.readdirSync(jsSource);
        if (remaining.length === 0) {
            fs.rmdirSync(jsSource);
            console.log('  ✅ Pasta js/ removida');
        } else {
            console.log(`  ⚠️  Pasta js/ ainda contém: ${remaining.join(', ')}`);
        }
    } catch (error) {
        console.log(`  ⚠️  Não foi possível remover pasta js/: ${error.message}`);
    }
} else {
    console.log('⚠️  Pasta js/ não encontrada');
}

console.log('\n✅ Concluído!');

// Funções auxiliares
function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    
    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach(childItemName => {
            copyRecursiveSync(
                path.join(src, childItemName),
                path.join(dest, childItemName)
            );
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

function deleteRecursiveSync(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.readdirSync(dirPath).forEach((file) => {
            const curPath = path.join(dirPath, file);
            if (fs.statSync(curPath).isDirectory()) {
                deleteRecursiveSync(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(dirPath);
    }
}

