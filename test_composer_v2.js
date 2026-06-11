const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createSession,
  addChapter,
  deleteSession,
  getSession,
  renameChapter,
  reorderChapters,
} = require('./sessions_store');
const {
  buildSessionExportText,
  assembleSessionBlocks,
  getFragmentHeadingLevel,
} = require('./docx_export');
const {
  extractAuditJSON,
  quoteExistsInOriginal,
  filterAcceptedSuggestions,
} = require('./audit_json');
const {
  verifyRewriteIntegrity,
  sanitizeOptimizedText,
} = require('./integrity_verify');
const { exportPdfEntregable } = require('./pdf_export');

function runTests() {
  console.log('=== Composer v2 — tests A → C → B ===\n');

  const session = createSession({ name: 'Ensayo continuo' });
  addChapter(session.id, {
    originalText: 'Primer párrafo del documento con una idea central.',
    audit: 'Auditoría 1',
    optimizedText: 'Primer párrafo optimizado del documento con una idea central.',
  });
  addChapter(session.id, {
    originalText: 'Segundo párrafo que continúa la misma línea argumental.',
    audit: 'Auditoría 2',
    optimizedText: 'Segundo párrafo optimizado que continúa la misma línea argumental.',
  });
  addChapter(session.id, {
    originalText: 'Tercer párrafo de cierre.',
    audit: 'Auditoría 3',
    optimizedText: 'Tercer párrafo optimizado de cierre.',
  });

  const reloaded = require('./sessions_store').getSession(session.id);
  const exportText = buildSessionExportText(reloaded);
  assert.ok(!exportText.includes('Capítulo 1:'), 'sin encabezados automáticos');
  assert.ok(!exportText.includes('---'), 'sin separadores ---');
  assert.ok(exportText.includes('Primer párrafo optimizado'), 'fragmento 1 presente');
  assert.ok(exportText.includes('Tercer párrafo optimizado'), 'fragmento 3 presente');

  addChapter(session.id, {
    originalText: 'Inicio del marco teórico con varias fuentes.',
    audit: 'Auditoría marco',
    optimizedText: 'Inicio del marco teórico optimizado con varias fuentes.',
    isChapterStart: true,
    chapterTitle: 'Marco Teórico',
  });

  const withChapter = require('./sessions_store').getSession(session.id);
  const blocks = assembleSessionBlocks(withChapter.chapters);
  const headings = blocks.segments.filter((s) => s.type === 'heading');
  assert.strictEqual(headings.length, 1, 'un solo encabezado marcado');
  assert.strictEqual(headings[0].title, 'Marco Teórico');
  assert.strictEqual(headings[0].level, 1, 'isChapterStart legacy -> headingLevel 1');
  assert.strictEqual(getFragmentHeadingLevel(withChapter.chapters.find((ch) => ch.isChapterStart)), 1);

  addChapter(session.id, {
    originalText: 'Sección metodológica con detalle de muestra.',
    audit: 'Auditoría método',
    optimizedText: 'Sección metodológica optimizada con detalle de muestra.',
    headingLevel: 2,
    chapterTitle: 'Diseño Metodológico',
    modelUsed: 'nemotron-3-ultra-550b-a55b:free',
  });

  const withSubchapter = getSession(session.id);
  const subBlocks = assembleSessionBlocks(withSubchapter.chapters);
  const subHeadings = subBlocks.segments.filter((s) => s.type === 'heading');
  assert.strictEqual(subHeadings.length, 2, 'capítulo + subtítulo');
  assert.strictEqual(subHeadings[1].level, 2);
  assert.strictEqual(subHeadings[1].title, 'Diseño Metodológico');
  const subExport = buildSessionExportText(withSubchapter);
  assert.ok(subExport.includes('Diseño Metodológico'), 'subtítulo presente en export');
  assert.ok(!subExport.includes('nemotron'), 'modelUsed no contamina export');
  const subChapter = withSubchapter.chapters.find((ch) => ch.chapterTitle === 'Diseño Metodológico');
  assert.strictEqual(subChapter.modelUsed, 'nemotron-3-ultra-550b-a55b:free');

  const original = 'Según (García, 2019), la Ley N° 24521 regula el 45% de los casos.';
  const auditRaw = JSON.stringify({
    resumen: 'Hay un posible error de cita.',
    veredicto: 'apto_con_reservas',
    sugerencias: [{
      id: 's1',
      quote: '(García, 2019)',
      replacement: '(García, 2018)',
      explanation: 'Año incorrecto',
      norm_ref: 'APA 7ª',
      severity: 'IMPORTANTE',
    }],
    checklist: [],
    biblio_check: [],
  });

  const audit = extractAuditJSON(auditRaw, original);
  assert.strictEqual(audit.auditJson.sugerencias[0].quote_verified, true);

  const fakeQuoteAudit = extractAuditJSON(JSON.stringify({
    resumen: 'x',
    veredicto: 'apto',
    sugerencias: [{
      id: 's9',
      quote: 'texto que no existe en el original',
      replacement: 'otro',
      explanation: 'test',
      norm_ref: 'APA',
      severity: 'MENOR',
    }],
    checklist: [],
    biblio_check: [],
  }), original);
  assert.strictEqual(fakeQuoteAudit.auditJson.sugerencias[0].quote_verified, false);
  assert.strictEqual(quoteExistsInOriginal('(García, 2019)', original), true);

  const filtered = filterAcceptedSuggestions(audit.auditJson, ['s1']);
  assert.strictEqual(filtered.sugerencias.length, 1);

  const integrityOk = verifyRewriteIntegrity(original, original);
  assert.strictEqual(integrityOk.ok, true);

  const mutated = 'Según García (2020), la Ley N° 99999 regula el 45% de los casos.';
  const integrityFail = verifyRewriteIntegrity(original, mutated);
  assert.strictEqual(integrityFail.ok, false);
  assert.ok(integrityFail.citas_alteradas.length >= 1 || integrityFail.datos_alterados.length >= 1);

  const sanitized = sanitizeOptimizedText('texto\u200Bcon\u0430homoglyph');
  assert.ok(!sanitized.includes('\u200B'));

  deleteSession(session.id);
  console.log('✓ Tests Composer v2 (A+C lógica) OK');
}

function runComposerV4FragmentTests() {
  console.log('\n=== Composer v4 — fragmentos (reorder / rename) ===\n');

  const session = createSession({ name: 'Reorden v4' });
  addChapter(session.id, {
    originalText: 'Texto del fragmento uno.',
    audit: 'Auditoría 1',
    optimizedText: 'Texto optimizado del fragmento uno.',
  });
  addChapter(session.id, {
    originalText: 'Texto del fragmento dos.',
    audit: 'Auditoría 2',
    optimizedText: 'Texto optimizado del fragmento dos.',
  });
  addChapter(session.id, {
    originalText: 'Texto del fragmento tres.',
    audit: 'Auditoría 3',
    optimizedText: 'Texto optimizado del fragmento tres.',
  });

  const loaded = getSession(session.id);
  const [ch1, ch2, ch3] = [...loaded.chapters].sort((a, b) => a.index - b.index);
  const exportBeforeReorder = buildSessionExportText(loaded);

  const reordered = reorderChapters(session.id, [ch3.id, ch1.id, ch2.id]);
  const exportAfterReorder = buildSessionExportText(reordered);
  const idxOne = exportAfterReorder.indexOf('fragmento uno');
  const idxTwo = exportAfterReorder.indexOf('fragmento dos');
  const idxThree = exportAfterReorder.indexOf('fragmento tres');

  assert.ok(idxThree < idxOne, 'fragmento 3 queda antes del 1');
  assert.ok(idxOne < idxTwo, 'fragmento 1 queda antes del 2');
  assert.notStrictEqual(exportAfterReorder, exportBeforeReorder, 'el export cambia tras reordenar');

  const exportBeforeRename = buildSessionExportText(reordered);
  const renamed = renameChapter(session.id, ch2.id, 'Borrador intro renombrado');
  const renamedChapter = renamed.chapters.find((ch) => ch.id === ch2.id);
  assert.strictEqual(renamedChapter.title, 'Borrador intro renombrado');
  const exportAfterRename = buildSessionExportText(renamed);
  assert.strictEqual(exportAfterRename, exportBeforeRename, 'rename no altera el texto exportado');

  const snapshot = JSON.stringify(getSession(session.id).chapters.map((ch) => ({
    id: ch.id,
    index: ch.index,
    title: ch.title,
    optimizedText: ch.optimizedText,
  })));

  let rejected = false;
  try {
    reorderChapters(session.id, [ch1.id, ch2.id, 'id-inventado']);
  } catch (err) {
    rejected = true;
  }
  assert.strictEqual(rejected, true, 'reorder con ID inventado rechazado');

  const unchanged = JSON.stringify(getSession(session.id).chapters.map((ch) => ({
    id: ch.id,
    index: ch.index,
    title: ch.title,
    optimizedText: ch.optimizedText,
  })));
  assert.strictEqual(unchanged, snapshot, 'reorder inválido no muta la sesión');

  deleteSession(session.id);
  console.log('✓ Tests Composer v4 (reorder/rename) OK');
}

async function runPdfSmoke() {
  const session = createSession({ name: 'PDF smoke' });
  addChapter(session.id, {
    originalText: 'Párrafo con tilde: introducción académica.',
    audit: 'ok',
    optimizedText: 'Párrafo optimizado con tilde: introducción académica.\n\n### Referencias Bibliográficas\nGarcía, A. (2020). Título. Editorial.',
  });

  const fullSession = require('./sessions_store').getSession(session.id);
  const result = await exportPdfEntregable({
    session: fullSession,
    norma: 'APA 7ª ed.',
    title: 'Prueba PDF',
    author: 'Autor Prueba',
    sessionName: 'PDF smoke',
  });

  assert.ok(fs.existsSync(result.filePath), 'pdf file exists');
  assert.ok(result.bytes > 500, 'pdf has content');
  fs.unlinkSync(result.filePath);
  deleteSession(session.id);
  console.log('✓ Test export PDF smoke OK');
}

runTests();
runComposerV4FragmentTests();
runPdfSmoke().catch((err) => {
  console.error('✗', err);
  process.exit(1);
});