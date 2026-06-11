const assert = require('assert');
const {
  extractAuditJSON,
  sanitizeZeroWidth,
  formatAuditProseFromJson,
} = require('./audit_json');

const dirtyOutputs = [
  'Aquí va el análisis:\n```json\n{"resumen":"Texto débil","veredicto":"apto_con_reservas","sugerencias":[{"id":"s1","quote":"cita mal","replacement":"cita bien","explanation":"APA","norm_ref":"APA 7ª","severity":"CRÍTICO"}],"checklist":["Revisar referencias"],"biblio_check":[]}\n```\nFin.',
  '{"resumen":"Ok","veredicto":"apto","sugerencias":[],"checklist":[],"biblio_check":[]}',
  'No JSON here, solo prosa de auditoría con sugerencias numeradas.',
  'prefix garbage {"resumen":"X","veredicto":"no_apto","sugerencias":[{"quote":"a","replacement":"b","explanation":"c","norm_ref":"APA","severity":"MENOR"}],"checklist":[],"biblio_check":[]} suffix',
];

function runTests() {
  console.log('=== PASO 2 — tests parseo auditoría JSON ===\n');

  const r0 = extractAuditJSON(dirtyOutputs[0]);
  assert.strictEqual(r0.auditMode, 'json');
  assert.strictEqual(r0.auditJson.sugerencias.length, 1);
  assert.ok(r0.audit.includes('Sugerencias detalladas'));

  const r1 = extractAuditJSON(dirtyOutputs[1]);
  assert.strictEqual(r1.auditMode, 'json');
  assert.strictEqual(r1.auditJson.veredicto, 'apto');

  const r2 = extractAuditJSON(dirtyOutputs[2]);
  assert.strictEqual(r2.auditMode, 'prose');
  assert.strictEqual(r2.auditJson, null);

  const r3 = extractAuditJSON(dirtyOutputs[3]);
  assert.strictEqual(r3.auditMode, 'json');
  assert.strictEqual(r3.auditJson.veredicto, 'no_apto');

  const zw = 'texto\u200Bcon\uFEFFzero';
  assert.strictEqual(sanitizeZeroWidth(zw), 'textoconzero');

  const prose = formatAuditProseFromJson(r0.auditJson);
  assert.ok(prose.includes('CRÍTICO'));

  console.log('✓ Todos los tests PASO 2 pasaron');
}

runTests();