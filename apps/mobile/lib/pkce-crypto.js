// Only bridge the WebCrypto operations Supabase PKCE needs. Never replace a
// platform implementation or fall back to Math.random / a plain challenge.
export function installPkceCrypto(runtime, nativeCrypto) {
  const crypto = runtime.crypto || (runtime.crypto = {});
  if (!crypto.getRandomValues) crypto.getRandomValues = values => nativeCrypto.getRandomValues(values);
  if (!crypto.subtle) crypto.subtle = {};
  if (!crypto.subtle.digest) crypto.subtle.digest = async (algorithm, data) => {
    if ((typeof algorithm === 'string' ? algorithm : algorithm?.name) !== 'SHA-256') {
      throw new Error('Only SHA-256 is supported by the native PKCE bridge.');
    }
    return nativeCrypto.digest('SHA-256', data);
  };
  return typeof runtime.TextEncoder === 'function';
}
