const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createSession,
  addChapter,
  deleteSession,
  buildSessionContextForLlm,
  sessionHasPreservedCover,
  isPreservedFragment,
} = require('./sessions_store');
const {
  buildSessionExportText,
  assembleSessionBlocks,
  exportDocxEntregable,
} = require('./docx_export');
const {
  classifyPreservedKind,
  isIndexChunk,
  isCoverChunk,
} = require('./public/thesis_classify');

function runClassificationTests() {
  const indexText = [
    'Índice',
    'Introducción ..... 1',
    'Marco teórico ..... 12',
    'Metodología ..... 25',
  ].join('\n');
  assert.strictEqual(isIndexChunk(indexText), true);
  const indexKind = classifyPreservedKind({ text: indexText }, 1);
  assert.strictEqual(indexKind.kind, 'indice');
  assert.strictEqual(indexKind.preserved, true);

  const coverText = [
    'Universidad de la República',
    'Facultad de Psicología',
    'Tesis de Licenciatura',
    'Tutor: Dr. Juan Pérez',
    'Director: Dra. Ana Gómez',
  ].join('\n');
  assert.strictEqual(isCoverChunk(coverText, true), true);
  const coverKind = classifyPreservedKind({ text: coverText }, 0);
  assert.strictEqual(coverKind.kind, 'caratula');
  assert.strictEqual(coverKind.preserved, true);

  const prose = 'Este párrafo desarrolla un argumento académico con suficiente extensión para no ser front matter.';
  const proseKind = classifyPreservedKind({ text: prose }, 2);
  assert.strictEqual(proseKind.preserved, false);
  assert.strictEqual(proseKind.kind, '');
}

function runPreservedSessionTests() {
  const session = createSession({ name: 'v6 preserved' });
  const preservedBody = 'Línea 1 carátula\nLínea 2 carátula\n';
  addChapter(session.id, {
    originalText: preservedBody,
    audit: '',
    optimizedText: preservedBody,
    preserved: true,
    kind: 'caratula',
    title: 'Carátula',
  });
  addChapter(session.id, {
    originalText: 'Primer fragmento auditable con contenido.',
    audit: 'Auditoría 1',
    optimizedText: 'Primer fragmento auditable optimizado.',
  });
  addChapter(session.id, {
    originalText: 'Segundo fragmento auditable con contenido.',
    audit: 'Auditoría 2',
    optimizedText: 'Segundo fragmento auditable optimizado.',
  });

  const reloaded = require('./sessions_store').getSession(session.id);
  const preservedChapter = reloaded.chapters.find((ch) => ch.preserved);
  assert.ok(preservedChapter, 'fragmento conservado guardado');
  assert.strictEqual(preservedChapter.optimizedText, preservedBody);
  assert.strictEqual(preservedChapter.audit, '');
  assert.strictEqual(isPreservedFragment(preservedChapter), true);
  assert.strictEqual(sessionHasPreservedCover(reloaded.chapters), true);

  const exportText = buildSessionExportText(reloaded);
  assert.ok(exportText.includes('Línea 1 carátula'), 'conservado presente en export');
  assert.ok(exportText.includes('Línea 2 carátula'), 'saltos de línea del conservado preservados');
  assert.ok(exportText.indexOf('Línea 1 carátula') < exportText.indexOf('Primer fragmento auditable optimizado'), 'orden conservado');

  const blocks = assembleSessionBlocks(reloaded.chapters);
  const verbatim = blocks.segments.find((segment) => segment.type === 'body_verbatim');
  assert.ok(verbatim, 'segmento verbatim generado');
  assert.strictEqual(verbatim.text, preservedBody);

  const context = buildSessionContextForLlm(reloaded);
  assert.strictEqual(context.previousChapters.length, 2, 'contexto excluye conservados');
  assert.ok(context.previousChapters.every((item) => !item.title.includes('Carátula')));

  deleteSession(session.id);
}

async function runDocxSkipCoverSmoke() {
  const session = createSession({ name: 'v6 cover skip', norma: 'APA 7ª ed.' });
  addChapter(session.id, {
    originalText: 'Universidad X\nFacultad Y\nTesis\nTutor: A',
    audit: '',
    optimizedText: 'Universidad X\nFacultad Y\nTesis\nTutor: A',
    preserved: true,
    kind: 'caratula',
    title: 'Carátula',
  });
  addChapter(session.id, {
    originalText: 'Cuerpo del trabajo con argumento.',
    audit: 'Auditoría',
    optimizedText: 'Cuerpo del trabajo optimizado.',
  });

  const reloaded = require('./sessions_store').getSession(session.id);
  assert.strictEqual(sessionHasPreservedCover(reloaded.chapters), true);

  const result = await exportDocxEntregable({
    session: reloaded,
    norma: 'APA 7ª ed.',
    title: 'Título autogenerado que no debe duplicar portada',
    author: 'Autor Test',
    sessionName: reloaded.name,
  });

  assert.ok(result.bytes > 0, 'docx generado');
  assert.ok(fs.existsSync(result.filePath), 'archivo docx existe');
  fs.unlinkSync(result.filePath);
  deleteSession(session.id);
}

async function main() {
  console.log('=== Composer v6 — fragmentos conservados ===\n');
  runClassificationTests();
  console.log('✓ Clasificación determinista OK');
  runPreservedSessionTests();
  console.log('✓ Modelo + ensamblado + contexto LLM OK');
  await runDocxSkipCoverSmoke();
  console.log('✓ Export DOCX con carátula conservada OK');
  console.log('\n✓ Tests Composer v6 OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});