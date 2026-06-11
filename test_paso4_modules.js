const assert = require('assert');
const {
  isBunkerMode,
  isLocalhostEndpoint,
  assertBunkerAllowsEndpoint,
} = require('./bunker');
const {
  searchAcademicData,
  isBunkerMode: isBunkerFromBackend,
  isLocalhostEndpoint: isLocalFromBackend,
  recordSuggestUsage,
} = require('./backend_academico');
const { estimateStageCostUsd } = require('./guardian');
const {
  createSession,
  recordSessionUsage,
  getSession,
  deleteSession,
} = require('./sessions_store');

async function runTests() {
  console.log('=== PASO 4 — tests manifiesto soberano ===\n');

  const prevBunker = process.env.BUNKER_MODE;
  const prevProvider = process.env.LLM_PROVIDER;
  const prevBind = process.env.BIND_HOST;

  try {
    assert.strictEqual(isLocalhostEndpoint('http://localhost:11434/v1/chat/completions'), true);
    assert.strictEqual(isLocalhostEndpoint('http://127.0.0.1:8080/v1/chat/completions'), true);
    assert.strictEqual(isLocalhostEndpoint('https://api.openai.com/v1/chat/completions'), false);

    process.env.BUNKER_MODE = 'true';
    assert.strictEqual(isBunkerMode(), true);
    assert.strictEqual(isBunkerFromBackend(), true);

    let blocked = false;
    try {
      assertBunkerAllowsEndpoint('https://api.openai.com/v1/chat/completions');
    } catch (err) {
      blocked = err.code === 'BUNKER_BLOCKED';
    }
    assert.strictEqual(blocked, true, 'Búnker debe bloquear endpoints remotos');

    const crossref = await searchAcademicData('Smith, 2020');
    assert.strictEqual(crossref, '', 'Crossref desactivado en Modo Búnker');

    const auditCost = estimateStageCostUsd(5000, 'gpt-4o-mini', 'audit');
    const rewriteCost = estimateStageCostUsd(5000, 'gpt-4o-mini', 'rewrite');
    assert.ok(auditCost > 0 && rewriteCost > 0, 'estimateStageCostUsd por etapa');

    const session = createSession({ name: 'Test PASO 4', seedText: 'Ensayo de prueba' });
    const usage = recordSessionUsage(session.id, {
      stage: 'audit',
      costUsd: 0.0123,
      charCount: 1200,
      model: 'gpt-4o-mini',
    });
    assert.strictEqual(usage.totalRequests, 1);
    assert.ok(usage.totalCostUsd >= 0.0123);

    const reloaded = getSession(session.id);
    assert.ok(reloaded.usage, 'usage persistido en JSON de sesión');

    const recorded = recordSuggestUsage(session.id, 'full', 800, 'gpt-4o-mini', 1);
    assert.ok(recorded.totalRequests >= 2, 'recordSuggestUsage acumula');

    deleteSession(session.id);

    process.env.BIND_HOST = '127.0.0.1';
    const { getBindHost } = require('./backend_academico');
    assert.strictEqual(getBindHost(), '127.0.0.1');

    console.log('✓ Todos los tests PASO 4 pasaron');
  } finally {
    if (prevBunker === undefined) delete process.env.BUNKER_MODE;
    else process.env.BUNKER_MODE = prevBunker;
    if (prevProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = prevProvider;
    if (prevBind === undefined) delete process.env.BIND_HOST;
    else process.env.BIND_HOST = prevBind;
  }
}

runTests().catch((err) => {
  console.error('✗ Falló:', err);
  process.exit(1);
});