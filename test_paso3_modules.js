const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  rebuildBibliotecaIndex,
  searchBibliotecaLocal,
  tokenize,
  BIBLIOTECA_DIR,
} = require('./biblioteca_store');
const { splitBodyAndReferences } = require('./docx_export');

async function runTests() {
  console.log('=== PASO 3 — tests módulos ===\n');

  const samplePath = path.join(BIBLIOTECA_DIR, 'muestra_apa.txt');
  fs.mkdirSync(BIBLIOTECA_DIR, { recursive: true });
  fs.writeFileSync(samplePath, 'La metodología cualitativa (Smith, 2020) enfatiza triangulación y rigor analítico en ciencias sociales.', 'utf8');

  const index = await rebuildBibliotecaIndex();
  assert.ok(index.chunks.length >= 1, 'index chunks');

  const hits = searchBibliotecaLocal('Smith 2020 metodología');
  assert.ok(hits.length >= 1, 'bm25 hits');
  assert.ok(hits[0].source.includes('muestra_apa.txt'));

  const tokens = tokenize('Triangulación académica');
  assert.ok(tokens.includes('triangulacion'));

  const split = splitBodyAndReferences('Cuerpo del texto\n\n### Referencias Bibliográficas\nSmith, J. (2020).');
  assert.ok(split.body.includes('Cuerpo'));
  assert.ok(split.references.includes('Smith'));

  console.log('✓ Tests PASO 3 módulos OK');
}

runTests().catch((err) => {
  console.error('✗', err);
  process.exit(1);
});