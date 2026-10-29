import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { installPkceCrypto } from '../apps/mobile/lib/pkce-crypto.js';
import { AUTH_KEYCHAIN, readAuthValue, readSecureValue } from '../apps/mobile/lib/read-secure-value.js';

test('auth key rotation prefers its namespace and preserves readable legacy credentials', async () => {
  const values = new Map([['legacy:session', 'old credential']]);
  const reads = [];
  const store = { getItemAsync: async (key, options) => {
    const name = `${options?.keychainService || 'legacy'}:${key}`;
    reads.push(name); return values.get(name) ?? null;
  } };
  assert.equal(await readAuthValue(store, 'session'), 'old credential');
  values.set(`${AUTH_KEYCHAIN.keychainService}:session`, 'new credential');
  reads.length = 0;
  assert.equal(await readAuthValue(store, 'session'), 'new credential');
  assert.equal(reads.length, 1);
  assert.equal(values.get('legacy:session'), 'old credential', 'reading does not delete credentials');
  const failure = Object.assign(new Error('Permission denied'), { code: 'ERR_AUTHENTICATION' });
  await assert.rejects(readAuthValue({getItemAsync: async () => { throw failure; }}, 'session'), error => error === failure);
});

test('invalidated encrypted values do not prevent a fresh sign-in or delete local data', async () => {
  let writes = 0;
  const store = {
    getItemAsync: async () => { throw Object.assign(new Error('Invalid ciphertext'), { code: 'ERR_DECRYPT' }); },
    deleteItemAsync: async () => { writes++; },
  };
  assert.equal(await readSecureValue(store, 'verifier'), null);
  store.getItemAsync = async () => { throw new Error("Call rejected. Caused by: Could not decrypt the value for key 'verifier'"); };
  assert.equal(await readSecureValue(store, 'verifier'), null);
  assert.equal(writes, 0);
  store.getItemAsync = async () => 'new encrypted value';
  assert.equal(await readSecureValue(store, 'verifier'), 'new encrypted value');
});

test('permission, IO and authentication errors are not silently discarded', async () => {
  for (const code of ['ERR_KEY_STORE', 'ERR_AUTHENTICATION', 'ERR_IO']) {
    const error = Object.assign(new Error('Storage unavailable'), { code });
    await assert.rejects(readSecureValue({ getItemAsync: async () => { throw error; } }, 'session'), value => value === error);
  }
});

test('mobile PKCE uses native secure random values and a real SHA-256 digest', async () => {
  let generated = 0;
  const runtime = { TextEncoder };
  assert.equal(installPkceCrypto(runtime, {
    getRandomValues(values) { generated++; return webcrypto.getRandomValues(values); },
    digest: (algorithm, data) => webcrypto.subtle.digest(algorithm, data),
  }), true);
  const values = new Uint32Array(56);
  assert.equal(runtime.crypto.getRandomValues(values), values);
  assert.equal(generated, 1);
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const digest = await runtime.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  assert.equal(Buffer.from(digest).toString('base64url'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(Buffer.from(digest).toString('hex'), createHash('sha256').update(verifier).digest('hex'));
  await assert.rejects(runtime.crypto.subtle.digest('MD5', new Uint8Array()), /SHA-256/);
  const before = runtime.crypto.subtle.digest;
  installPkceCrypto(runtime, {});
  assert.equal(runtime.crypto.subtle.digest, before, 'existing WebCrypto must be preserved');
  assert.equal(installPkceCrypto({}, {}), false, 'missing TextEncoder must fail the sign-in readiness gate');
});

test('native sign-in dependency matches the Expo SDK and exposes its module class', async () => {
  const pkg = JSON.parse(await readFile(new URL('../apps/mobile/package.json', import.meta.url)));
  const supported = JSON.parse(await readFile(new URL('../apps/mobile/node_modules/expo/bundledNativeModules.json', import.meta.url)));
  const config = JSON.parse(await readFile(new URL('../apps/mobile/node_modules/expo-web-browser/expo-module.config.json', import.meta.url)));
  assert.equal(`~${pkg.dependencies['expo-web-browser']}`, supported['expo-web-browser']);
  assert.ok(config.android.modules?.includes('expo.modules.webbrowser.WebBrowserModule'));
});
