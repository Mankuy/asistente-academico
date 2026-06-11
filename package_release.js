const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const DIST_DIR = path.join(ROOT, 'dist_release');
const ZIP_PATH = path.join(ROOT, 'Asistente_Academico_V1.zip');

const FILES_TO_COPY = [
  'backend_academico.js',
  'sessions_store.js',
  'guardian.js',
  'audit_json.js',
  'biblioteca_store.js',
  'docx_export.js',
  'pdf_export.js',
  'integrity_verify.js',
  'bunker.js',
  'package.json',
  'iniciar_asistente.bat',
  'Dockerfile',
  'docker-compose.yml',
];

const ENV_EXAMPLE = [
  '# Proveedor activo',
  'LLM_PROVIDER=openrouter',
  'LLM_MODEL=openrouter/owl-alpha',
  'PORT=4000',
  '',
  '# Banco de keys y modelos (JSON). Se completa desde ⚙️ en la interfaz.',
  'LLM_KEYS_JSON={}',
  'LLM_MODELS_JSON={}',
  'LLM_FAST_MODELS_JSON={}',
  'LLM_BASE_URLS_JSON={}',
  'COST_CONFIRM_THRESHOLD_USD=0.10',
  'BUNKER_MODE=false',
  'BIND_HOST=127.0.0.1',
  '',
  '# Legacy (opcional):',
  '# LLM_API_KEY=',
  '# LLM_BASE_URL=',
  '# OPENROUTER_API_KEY=',
  '# OPENROUTER_MODEL=openrouter/owl-alpha',
  '',
].join('\n');

function removeDir(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function copyDir(src, dest, filterFn = null) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, filterFn);
    } else if (!filterFn || filterFn(entry.name, srcPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function toWindowsPath(unixPath) {
  if (process.platform === 'win32') {
    return unixPath;
  }

  try {
    return execSync(`wslpath -w "${unixPath}"`, { encoding: 'utf8' }).trim();
  } catch {
    return unixPath;
  }
}

function createZipArchive() {
  if (fs.existsSync(ZIP_PATH)) {
    fs.unlinkSync(ZIP_PATH);
  }

  const distWin = toWindowsPath(DIST_DIR).replace(/'/g, "''");
  const zipWin = toWindowsPath(ZIP_PATH).replace(/'/g, "''");
  const psCommand = `Compress-Archive -Path '${distWin}\\*' -DestinationPath '${zipWin}' -Force`;
  const shell = process.platform === 'win32' ? 'powershell' : 'powershell.exe';

  try {
    execSync(`${shell} -NoProfile -Command "${psCommand}"`, { stdio: 'inherit' });
    return;
  } catch (powershellError) {
    try {
      execSync(`cd "${ROOT}" && zip -r "${ZIP_PATH}" dist_release`, { stdio: 'inherit' });
      return;
    } catch (zipError) {
      throw new Error(`${powershellError.message} | ${zipError.message}`);
    }
  }
}

function createRelease() {
  console.log('Preparando release en dist_release/ ...');
  removeDir(DIST_DIR);
  fs.mkdirSync(DIST_DIR, { recursive: true });

  for (const fileName of FILES_TO_COPY) {
    const src = path.join(ROOT, fileName);
    if (!fs.existsSync(src)) {
      throw new Error(`Archivo requerido no encontrado: ${fileName}`);
    }
    fs.copyFileSync(src, path.join(DIST_DIR, fileName));
    console.log(`  + ${fileName}`);
  }

  const publicSrc = path.join(ROOT, 'public');
  if (!fs.existsSync(publicSrc)) {
    throw new Error('Carpeta public/ no encontrada');
  }
  copyDir(publicSrc, path.join(DIST_DIR, 'public'), (name) => name.endsWith('.html'));
  console.log('  + public/ (archivos .html)');

  fs.writeFileSync(path.join(DIST_DIR, '.env.example'), ENV_EXAMPLE, 'utf8');
  console.log('  + .env.example');

  try {
    createZipArchive();
    console.log(`\nRelease lista: ${ZIP_PATH}`);
  } catch (error) {
    console.warn('\nNo se pudo generar el ZIP automaticamente.');
    console.warn('Podes comprimir manualmente la carpeta dist_release/.');
    console.warn(error.message);
  }

  console.log('\nContenido de dist_release/ listo para distribuir.');
}

createRelease();