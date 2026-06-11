const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function isBunkerMode() {
  const raw = String(process.env.BUNKER_MODE || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function isLocalhostEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'string') return false;

  try {
    const parsed = new URL(endpoint.trim());
    const host = parsed.hostname.toLowerCase();
    if (LOCAL_HOSTNAMES.has(host)) return true;
    if (host.endsWith('.localhost')) return true;
    return false;
  } catch {
    return false;
  }
}

function assertBunkerAllowsEndpoint(endpoint) {
  if (!isBunkerMode()) return;
  if (!isLocalhostEndpoint(endpoint)) {
    const err = new Error('Modo Búnker activo: solo se permiten endpoints en localhost');
    err.code = 'BUNKER_BLOCKED';
    throw err;
  }
}

module.exports = {
  isBunkerMode,
  isLocalhostEndpoint,
  assertBunkerAllowsEndpoint,
};