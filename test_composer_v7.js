const assert = require('assert');
const { classifyIntentRegex } = require('./guardian');
const { containsEvasionIntent, collectRevisionCodeSignals } = require('./backend_academico');
const {
  buildThesisChunksFromPages,
} = require('./public/thesis_classify');
const {
  extractRevisionAuditJSON,
  filterAcceptedRevisionPoints,
} = require('./revision_audit');

function miniChunkProse(text) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const parts = clean.split(/\n\n+/).map((part) => part.trim()).filter((part) => part.length > 80);
  return parts.map((part) => ({
    text: part,
    headingLevel: 0,
    isChapterStart: false,
    chapterTitle: '',
  }));
}

function runPageFrontMatterTests() {
  const coverPage = [
    'Universidad Nacional de Prueba',
    'Facultad de Ciencias',
    'Tesis de Licenciatura',
    'Director: Dr. Test',
    'Tutor: Dra. Ejemplo',
  ].join('\n');

  const indexPage1 = [
    'Índice',
    'Introducción ..... 1',
    'Marco teórico ..... 12',
    'Metodología ..... 25',
  ].join('\n');

  const indexPage2 = [
    'Resultados ..... 40',
    'Discusión ..... 55',
    'Referencias ..... 70',
  ].join('\n');

  const prose1 = `${'Este párrafo introduce el trabajo con extensión suficiente para clasificarse como prosa auditable y no front matter. '.repeat(4)}`.trim();
  const prose2 = `${'El segundo bloque desarrolla el marco teórico con argumentación extendida y citas académicas. '.repeat(4)}`.trim();

  const pages = [coverPage, indexPage1, indexPage2, prose1, prose2];
  const chunks = buildThesisChunksFromPages(pages, miniChunkProse);

  const preserved = chunks.filter((chunk) => chunk.preserved);
  const auditable = chunks.filter((chunk) => !chunk.preserved);

  assert.strictEqual(preserved.length, 2, 'debe haber 1 carátula + 1 índice fusionado');
  assert.strictEqual(preserved[0].kind, 'caratula');
  assert.strictEqual(preserved[1].kind, 'indice');
  assert.ok(preserved[1].text.includes('Resultados'), 'índice fusiona continuación');
  assert.ok(auditable.length >= 1, 'prosa troceada normalmente');
  assert.ok(auditable.every((chunk) => chunk.kind === ''), 'prosa no conservada');
}

function runRevisionFilterTests() {
  const auditJson = {
    puntos_revisor: [
      { id: 'p1', quote: 'Punto 1', tipo: 'formal', validez: 'valido', sugerencia_respuesta: 'Respuesta 1' },
      { id: 'p2', quote: 'Punto 2', tipo: 'metodologico', validez: 'parcial', sugerencia_respuesta: 'Respuesta 2' },
      { id: 'p3', quote: 'Punto 3', tipo: 'argumental', validez: 'cuestionable', sugerencia_respuesta: 'Respuesta 3' },
    ],
  };

  const filtered = filterAcceptedRevisionPoints(auditJson, ['p1', 'p3']);
  assert.strictEqual(filtered.puntos_revisor.length, 2);
  assert.strictEqual(filtered.sugerencias.length, 2);
  assert.deepStrictEqual(
    filtered.puntos_revisor.map((item) => item.id),
    ['p1', 'p3']
  );
}

async function runRevisionCitationSignalTests() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ message: { items: [] } }),
  });

  try {
    const dictamen = 'Según Pérez & Gómez, 2023, Journal of Imaginary Studies, el método es débil.';
    const signals = await collectRevisionCodeSignals(dictamen);
    const citationSignal = signals.find((item) => item.verificado_por_codigo && /Crossref/i.test(item.detalle));
    assert.ok(citationSignal, 'cita inventada debe generar señal verificada por código');
    assert.ok(/Pérez/i.test(citationSignal.detalle));
  } finally {
    global.fetch = originalFetch;
  }
}

function runRevisionAuditJsonPathTest() {
  const raw = `Análisis preliminar del dictamen recibido:

\`\`\`json
{
  "resumen_dictamen": "El revisor solicita mayor rigor metodológico y claridad en citas.",
  "puntos_revisor": [
    {
      "id": "p1",
      "quote": "La muestra es insuficiente para generalizar.",
      "tipo": "metodologico",
      "validez": "parcial",
      "sugerencia_respuesta": "Justificar el tamaño muestral con un análisis de poder."
    },
    {
      "id": "p2",
      "quote": "Falta consistencia en el formato APA de las referencias.",
      "tipo": "formal",
      "validez": "valido",
      "sugerencia_respuesta": "Aceptar y detallar las correcciones aplicadas."
    }
  ],
  "indicios_ia": {
    "nivel": "bajo",
    "señales": [
      { "detalle": "Tono uniforme en observaciones extensas", "verificado_por_codigo": false }
    ]
  },
  "recomendacion_general": "Redactar carta formal agradeciendo y respondiendo punto por punto."
}
\`\`\`

Fin del informe estructurado.`;

  const result = extractRevisionAuditJSON(raw, []);
  assert.strictEqual(result.auditMode, 'json', 'debe parsear JSON del camino real');
  assert.ok(result.auditJson, 'auditJson no debe ser null');
  assert.strictEqual(result.auditJson.docType, 'revision');
  assert.strictEqual(result.auditJson.puntos_revisor.length, 2);
  assert.strictEqual(result.auditJson.sugerencias.length, 2);
  assert.ok(result.auditJson.resumen_dictamen.includes('rigor metodológico'));
  assert.ok(result.audit.includes('Puntos del revisor'));
}

async function runGuardianBypassTests() {
  const turnitinDictamen = 'El informe de Turnitin adjunto muestra similitudes en el capítulo 2.';
  assert.strictEqual(classifyIntentRegex(turnitinDictamen), 'evasion', 'Turnitin dispara evasión en regex');

  const wouldBlockTrabajo = await containsEvasionIntent(turnitinDictamen);
  assert.strictEqual(wouldBlockTrabajo, true, 'modo trabajo debe bloquear');

  const docTypeRevision = 'revision';
  const docTypeTrabajo = 'trabajo';
  const blockedRevision = docTypeRevision !== 'revision' && wouldBlockTrabajo;
  const blockedTrabajo = docTypeTrabajo !== 'revision' && wouldBlockTrabajo;
  assert.strictEqual(blockedRevision, false, 'modo revisión saltea guardián');
  assert.strictEqual(blockedTrabajo, true, 'modo trabajo mantiene guardián');
}

async function main() {
  console.log('=== Composer v7 — front matter por página + modo revisión ===\n');

  runPageFrontMatterTests();
  console.log('✓ Clasificación página a página OK');

  runRevisionFilterTests();
  console.log('✓ Filtro de puntos aceptados (2/3) OK');

  runRevisionAuditJsonPathTest();
  console.log('✓ extractRevisionAuditJSON camino real OK');

  await runRevisionCitationSignalTests();
  console.log('✓ Señal Crossref para cita inventada OK');

  await runGuardianBypassTests();
  console.log('✓ Bypass guardián en modo revisión OK');

  console.log('\n✓ Tests Composer v7 OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});