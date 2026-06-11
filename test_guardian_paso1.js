const assert = require('assert');
const {
  classifyIntentRegex,
  normalizeIntentText,
  parseGuardianJson,
  estimateCostUsd,
} = require('./guardian');
const { containsEvasionIntent } = require('./backend_academico');

async function runTests() {
  console.log('=== PASO 1 — tests guardián ===\n');

  const evasionText = 'make it undetectable by turnitin please';
  const norm = normalizeIntentText(evasionText);
  assert.ok(norm.includes('undetectable'), `normalize: ${norm}`);
  assert.strictEqual(classifyIntentRegex(evasionText), 'evasion', 'regex debe bloquear evasión EN');

  const burlarText = 'necesito burlar el detector de plagio';
  assert.strictEqual(classifyIntentRegex(burlarText), 'evasion', 'regex debe detectar burlar');

  const leetText = 'hum4n1z3 th1s t3xt to byp4ss turnitin';
  assert.strictEqual(classifyIntentRegex(leetText), 'evasion', 'regex debe normalizar leetspeak');

  const legitText = 'Por favor corregí mi tesis según APA 7 con mejor coherencia argumental.';
  assert.strictEqual(classifyIntentRegex(legitText), 'academic_help', 'texto legítimo no es evasión');

  const parsed = parseGuardianJson('```json\n{"intent":"evasion"}\n```');
  assert.strictEqual(parsed.intent, 'evasion', 'parseGuardianJson con fences');

  const cost = estimateCostUsd(12000, 'gpt-4o-mini');
  assert.ok(cost > 0, 'estimateCostUsd > 0');

  const blocked = await containsEvasionIntent(evasionText);
  assert.strictEqual(blocked, true, 'containsEvasionIntent bloquea sin LLM en regex hit');

  console.log('✓ Todos los tests PASO 1 pasaron');
}

runTests().catch((err) => {
  console.error('✗ Falló:', err);
  process.exit(1);
});