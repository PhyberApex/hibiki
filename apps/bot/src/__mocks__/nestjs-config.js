/** Jest mock for @nestjs/config so tests run without resolving the real package (pnpm). */
function getNested(obj, path) {
  const parts = path.split('.');
  let v = obj;
  for (const p of parts) {
    v = v != null ? v[p] : undefined;
  }
  return v;
}

class ConfigService {
  constructor(internal = {}) {
    this._internal = internal;
  }
  get(key, defaultValue) {
    const v = getNested(this._internal, key);
    return v !== undefined && v !== null ? v : defaultValue;
  }
  getOrThrow() {
    return undefined;
  }
}
module.exports = { ConfigService };
