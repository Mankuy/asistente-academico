const { execSync } = require('child_process');
const path = require('path');

const ROOT = __dirname;
const TEST_FILES = [
  'test_guardian_paso1.js',
  'test_audit_paso2.js',
  'test_paso3_modules.js',
  'test_paso4_modules.js',
  'test_composer_v2.js',
  'test_composer_v6.js',
  'test_composer_v7.js',
  'test_config_persistence.js',
];

for (const fileName of TEST_FILES) {
  const filePath = path.join(ROOT, fileName);
  console.log(`\n>>> ${fileName}`);
  execSync(`node "${filePath}"`, { stdio: 'inherit', cwd: ROOT });
}

console.log('\n✓ Todos los tests encadenados OK');