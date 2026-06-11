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
  'iniciar_asistente.bat',
  'Dockerfile',
  'docker-compose.yml',
];

const PACKAGE_JSON_RELEASE = {
  name: 'backend-academico',
  version: '1.0.0',
  main: 'backend_academico.js',
  dependencies: {
    docx: '^9.5.0',
    express: '^4.18.2',
    helmet: '^7.1.0',
    joi: '^17.11.0',
    pdfkit: '^0.17.2',
  },
  scripts: {
    start: 'node backend_academico.js',
    test: 'node test_guardian_paso1.js && node test_audit_paso2.js && node test_paso3_modules.js && node test_paso4_modules.js && node test_composer_v2.js',
  },
};

const ENV_EXAMPLE = [
  '# ── Servidor ──',
  'PORT=4000',
  'BIND_HOST=127.0.0.1',
  '',
  '# ── Proveedor LLM activo (BYOK — Bring Your Own Key) ──',
  'LLM_PROVIDER=openrouter',
  'LLM_MODEL=openrouter/owl-alpha',
  '',
  '# Banco de keys, modelos y URLs por proveedor (JSON).',
  '# Se completa desde ⚙️ en la interfaz; no pegues keys reales en este archivo de ejemplo.',
  'LLM_KEYS_JSON={}',
  'LLM_MODELS_JSON={}',
  'LLM_FAST_MODELS_JSON={}',
  'LLM_BASE_URLS_JSON={}',
  '',
  '# ── Presupuestador (guardián de costo) ──',
  '# Si la estimación supera este umbral (USD), el frontend pide confirmación.',
  'COST_CONFIRM_THRESHOLD_USD=0.10',
  '',
  '# ── Modo Búnker (local-first estricto) ──',
  '# true = solo endpoints localhost; sin Crossref ni LLM remoto.',
  'BUNKER_MODE=false',
  '',
  '# ── Legacy / alias (opcional; la UI los sincroniza) ──',
  '# LLM_API_KEY=',
  '# LLM_BASE_URL=',
  '# OPENROUTER_API_KEY=',
  '# OPENROUTER_MODEL=openrouter/owl-alpha',
  '# OPENROUTER_HTTP_REFERER=http://localhost:4000',
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

  fs.writeFileSync(
    path.join(DIST_DIR, 'package.json'),
    `${JSON.stringify(PACKAGE_JSON_RELEASE, null, 2)}\n`,
    'utf8'
  );
  console.log('  + package.json (generado para release)');

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