const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const DIST_DIR = path.join(ROOT, 'dist_release');
const ZIP_PATH = path.join(ROOT, 'Asistente_Academico_V1.zip');

const FILES_TO_COPY = [
  'backend_academico.js',
  'revision_audit.js',
  'sessions_store.js',
  'guardian.js',
  'audit_json.js',
  'biblioteca_store.js',
  'docx_export.js',
  'pdf_export.js',
  'integrity_verify.js',
  'bunker.js',
  'test_composer_v6.js',
  'test_composer_v7.js',
  'run_all_tests.js',
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
    test: 'node run_all_tests.js',
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
  '# Dejá vacío ({}) hasta guardar en ⚙️; el servidor usa openrouter/free por defecto.',
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

  const pyScript = [
    'import zipfile',
    'from pathlib import Path',
    `root = Path(${JSON.stringify(DIST_DIR)})`,
    `zip_path = Path(${JSON.stringify(ZIP_PATH)})`,
    "with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:",
    '    for path in sorted(root.rglob("*")):',
    '        if path.is_file():',
    '            zf.write(path, path.relative_to(root).as_posix())',
    'print("ZIP creado:", zip_path)',
  ].join('\n');

  const tmpPy = path.join(ROOT, '.package_zip_tmp.py');
  fs.writeFileSync(tmpPy, pyScript, 'utf8');
  try {
    execSync(`python3 "${tmpPy}"`, { stdio: 'inherit' });
  } finally {
    if (fs.existsSync(tmpPy)) fs.unlinkSync(tmpPy);
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
  copyDir(
    publicSrc,
    path.join(DIST_DIR, 'public'),
    (name) => name.endsWith('.html') || name === 'thesis_classify.js'
  );
  console.log('  + public/ (.html + thesis_classify.js)');

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