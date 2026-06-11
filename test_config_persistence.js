const assert = require('assert');

const {
  getLlmModel,
  getLlmFastModel,
  getDefaultFastModelForProvider,
  loadLlmModelsStore,
  loadLlmFastModelsStore,
} = require('./backend_academico');

function testSavedModelsOverrideDefaults() {
  const prev = {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_MODELS_JSON: process.env.LLM_MODELS_JSON,
    LLM_FAST_MODELS_JSON: process.env.LLM_FAST_MODELS_JSON,
  };

  try {
    process.env.LLM_PROVIDER = 'openrouter';
    process.env.LLM_MODEL = 'openrouter/owl-alpha';
    process.env.LLM_MODELS_JSON = JSON.stringify({
      openrouter: 'anthropic/claude-sonnet-4',
      openai: 'gpt-4o',
    });
    process.env.LLM_FAST_MODELS_JSON = JSON.stringify({
      openrouter: 'google/gemini-2.0-flash',
      openai: 'gpt-4o-mini',
    });

    assert.strictEqual(getLlmModel('openrouter'), 'anthropic/claude-sonnet-4');
    assert.strictEqual(getLlmFastModel('openrouter'), 'google/gemini-2.0-flash');
    assert.strictEqual(getLlmModel('openai'), 'gpt-4o');
    assert.strictEqual(getLlmFastModel('openai'), 'gpt-4o-mini');
    assert.deepStrictEqual(loadLlmModelsStore(), {
      openrouter: 'anthropic/claude-sonnet-4',
      openai: 'gpt-4o',
    });
    assert.deepStrictEqual(loadLlmFastModelsStore(), {
      openrouter: 'google/gemini-2.0-flash',
      openai: 'gpt-4o-mini',
    });
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function testDefaultsWhenStoreEmpty() {
  const prev = {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_MODELS_JSON: process.env.LLM_MODELS_JSON,
    LLM_FAST_MODELS_JSON: process.env.LLM_FAST_MODELS_JSON,
  };

  try {
    process.env.LLM_PROVIDER = 'openrouter';
    process.env.LLM_MODEL = 'openrouter/owl-alpha';
    process.env.LLM_MODELS_JSON = '{}';
    process.env.LLM_FAST_MODELS_JSON = '{}';

    assert.strictEqual(getLlmModel('openrouter'), 'openrouter/owl-alpha');
    assert.strictEqual(getLlmFastModel('openrouter'), 'openrouter/free');
    assert.strictEqual(getDefaultFastModelForProvider('openrouter'), 'openrouter/free');
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

console.log('=== Config persistence — modelos guardados vs defaults ===\n');
testSavedModelsOverrideDefaults();
testDefaultsWhenStoreEmpty();
console.log('✓ Tests de persistencia de modelos OK');