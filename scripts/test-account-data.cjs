const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');

// Run the real storage lifecycle module against browser APIs with injected
// failures. Backend scoping is stubbed; this checks the cleanup preservation
// rules, deletion guards, and crash recovery identity used by that module.
const values = new Map();
const storage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] || null; },
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};
const exportsObject = {};
const context = {
  exports: exportsObject,
  require(name) {
    if (name === '../platform/authStorage') return { authStorage: storage, async flushAuthStorage() {} };
    if (name === './resourceCache') return resourceCache;
    assert.equal(name, './backendConfig');
    return { CUSTOM_BACKEND_STORAGE_KEY: 'lanis_custom_backend_url', async clearBackendScopedStorage() {} };
  },
  localStorage: storage,
  crypto: webcrypto,
  window: { localStorage: storage, addEventListener() {}, setTimeout, setInterval() { return 1; }, clearInterval() {} },
  navigator: {},
  console,
};
const resourceCache = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/resourceCache.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: resourceCache, AbortController });
const source = fs.readFileSync(path.join(__dirname, '../src/utils/accountDataWrites.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const lifecycle = exportsObject;

(async () => {
  const original = lifecycle.captureAccountDataGeneration();
  assert(lifecycle.canWriteAccountData(original));
  const generation = lifecycle.beginAccountDataDeletion('signed-access', 'saved-refresh');
  assert(!lifecycle.canWriteAccountData(original));
  assert(!lifecycle.canWriteAccountData(generation));
  const proof = storage.getItem(lifecycle.ACCOUNT_DATA_DELETION_RECOVERY_KEY);
  assert.deepEqual(JSON.parse(proof), { accessToken: 'signed-access', refreshToken: 'saved-refresh' });
  storage.setItem(lifecycle.ACCOUNT_DATA_GENERATION_KEY, `${generation}:deleting:1`);
  assert(!lifecycle.canWriteAccountData(generation), 'An expired lease still requires server recovery');
  storage.setItem(lifecycle.ACCOUNT_DATA_LIFECYCLE_LOCK_KEY, 'lock-owner');
  storage.setItem('lanis_custom_backend_url', 'https://custom.invalid');
  storage.setItem('profile_cache', 'private-profile');
  storage.setItem('auth_refresh_token', 'saved-refresh');
  let closedNotifications = 0;
  let unsubscribed = false;
  context.navigator.serviceWorker = {
    async getRegistration() {
      return {
        async getNotifications() {
          return [{ close() { closedNotifications += 1; } }, { close() { closedNotifications += 1; } }];
        },
        pushManager: { async getSubscription() {
          return { async unsubscribe() { unsubscribed = true; return true; } };
        } },
      };
    },
  };
  const memoryGeneration = resourceCache.resourceCacheGeneration();
  resourceCache.updateResource('private', 'cached-account-data', memoryGeneration);
  assert(await lifecycle.purgeDeletedAccountBrowserData());
  assert.equal(resourceCache.readResource('private').data, undefined, 'deletion clears the session cache');
  resourceCache.updateResource('private', 'late-account-data', memoryGeneration);
  assert.equal(resourceCache.readResource('private').data, undefined, 'old UI callbacks cannot restore deleted data');
  assert.equal(closedNotifications, 2, 'Existing OS notifications must be dismissed');
  assert(unsubscribed);
  assert.equal(storage.getItem('profile_cache'), null);
  assert.equal(storage.getItem('auth_refresh_token'), null);
  assert.equal(storage.getItem(lifecycle.ACCOUNT_DATA_DELETION_RECOVERY_KEY), proof);
  assert.equal(storage.getItem(lifecycle.ACCOUNT_DATA_LIFECYCLE_LOCK_KEY), 'lock-owner');
  assert.equal(storage.getItem('lanis_custom_backend_url'), 'https://custom.invalid');
  context.window.caches = context.caches = { async keys() { throw new Error('storage unavailable'); } };
  assert.equal(await lifecycle.purgeDeletedAccountBrowserData(), false);
  assert(lifecycle.hasAccountDataDeletionMarker());
  lifecycle.finishAccountDataDeletion(generation);
  assert.equal(storage.getItem(lifecycle.ACCOUNT_DATA_DELETION_RECOVERY_KEY), null);
  assert(!lifecycle.canWriteAccountData(generation), 'Finishing invalidates writers from the deletion epoch');
  assert(lifecycle.canWriteAccountData(lifecycle.captureAccountDataGeneration()));
  // Exercise the real login callback with the real generation lifecycle and a
  // controllable native persistence boundary.
  values.clear();
  let beforeFlush;
  const revoked = [];
  const provider = {};
  const authSource = fs.readFileSync(path.join(__dirname, '../src/contexts/AuthContext.tsx'), 'utf8')
    .replace('import.meta.env.SSR', 'true');
  vm.runInNewContext(ts.transpileModule(authSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    ...context,
    exports: provider,
    require(name) {
      if (name === 'react') return {
        createContext: () => ({ Provider: 'Provider' }),
        useState: initial => [initial, () => {}],
        useEffect() {},
        useCallback: callback => callback,
      };
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
      if (name === '../utils/accountDataWrites') return lifecycle;
      if (name === '../utils/resourceCache') return resourceCache;
      if (name === '../utils/backendConfig') return { getApiBaseUrl: () => 'https://example.invalid' };
      if (name === '../analytics/client') return { capture: async () => {}, configureAccountAnalytics() {} };
      if (name === '../platform/authStorage') return {
        authStorage: storage,
        async flushAuthStorage() { beforeFlush?.(); },
      };
      if (name === '../services/api') return { authAPI: {
        async login() {
          return { access_token: 'new-session', refresh_token: 'new-refresh', expires_in: 60,
            username: 'test-user', school_id: '1234', encryption_ready: true };
        },
        async getUserProfile() { return { success: true, data: {} }; },
        async logout(token) { revoked.push(token); },
      } };
      throw Error(`Unexpected import: ${name}`);
    },
  });
  const { login } = provider.AuthProvider({}).props.value;
  assert.equal(await login({}), true, 'login publishes against the generation created by its storage commit');
  assert.deepEqual(revoked, []);
  beforeFlush = () => lifecycle.clearSignedOutAccountData();
  assert.equal(await login({}), false, 'a sign-out during persistence still invalidates login');
  assert.deepEqual(revoked, ['new-session']);
  console.log('Account data lifecycle regression checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
