// Invalidated ciphertext is not a usable credential. Treat just that value as
// absent; do not wipe the keychain, local account data, or swallow other errors.
export const AUTH_KEYCHAIN = Object.freeze({ keychainService: 'north.auth.v1' });
export async function readSecureValue(store, key, options) {
  try { return await store.getItemAsync(key, options); }
  catch (error) {
    if (error?.code === 'ERR_DECRYPT' || error?.code === 'ERR_SECURESTORE_DECRYPT' ||
        error?.message?.includes('Could not decrypt the value for key')) return null;
    throw error;
  }
}

export async function readAuthValue(store, key) {
  const current = await readSecureValue(store, key, AUTH_KEYCHAIN);
  return current ?? readSecureValue(store, key);
}
