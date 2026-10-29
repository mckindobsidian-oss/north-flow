import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { AUTH_KEYCHAIN, readAuthValue, readSecureValue } from './read-secure-value.js';
let writes = Promise.resolve();
function serial(task) { const result=writes.catch(()=>{}).then(task); writes=result; return result; }
// Chunks fit iOS Keychain limits too. Publish a generation only after every
// chunk is durable, so interrupted writes leave the previous session readable.
export const secureSession = {
  getItem(key) { return serial(async () => {
    const meta = JSON.parse(await readAuthValue(SecureStore, key) || 'null');
    if (!meta) return null;
    const parts = await Promise.all(Array.from({ length: meta.count }, (_, i) => readAuthValue(SecureStore, `${key}.${meta.id}.${i}`)));
    return parts.every((p) => p !== null) ? parts.join('') : null;
  }); },
  setItem(key, value) {
    return serial(async () => {
      const old = JSON.parse(await readAuthValue(SecureStore, key) || 'null');
      const id = Crypto.randomUUID(); const count = Math.ceil(value.length / 1500);
      for (let i = 0; i < count; i++) {
        const partKey = `${key}.${id}.${i}`; const part = value.slice(i * 1500, (i + 1) * 1500);
        await SecureStore.setItemAsync(partKey, part, AUTH_KEYCHAIN);
        if (await readSecureValue(SecureStore, partKey, AUTH_KEYCHAIN) !== part) {
          throw new Error('Secure storage could not verify this sign-in. No credentials were saved in plain text.');
        }
      }
      await SecureStore.setItemAsync(key, JSON.stringify({ id, count }), AUTH_KEYCHAIN);
      if (old && old.id !== id) for (let i = 0; i < old.count; i++) {
        await SecureStore.deleteItemAsync(`${key}.${old.id}.${i}`, AUTH_KEYCHAIN);
        await SecureStore.deleteItemAsync(`${key}.${old.id}.${i}`);
      }
      // Retire only this migrated manifest after the new encrypted generation
      // is published; otherwise a later logout could resurrect the old token.
      await SecureStore.deleteItemAsync(key);
    });
  },
  removeItem(key) { return serial(async () => {
    const old = JSON.parse(await readAuthValue(SecureStore, key) || 'null');
    await SecureStore.deleteItemAsync(key, AUTH_KEYCHAIN);
    await SecureStore.deleteItemAsync(key);
    if (old) for (let i = 0; i < old.count; i++) {
      await SecureStore.deleteItemAsync(`${key}.${old.id}.${i}`, AUTH_KEYCHAIN);
      await SecureStore.deleteItemAsync(`${key}.${old.id}.${i}`);
    }
  }); },
};
