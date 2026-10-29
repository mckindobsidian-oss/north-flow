/** The web callback forwards only a one-use PKCE code to a local app. */
export function desktopOAuthDestination(search) {
  try {
    const params = new URLSearchParams(search);
    const url = new URL(params.get("desktopAuth") || "");
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password
      || !/^\/north-auth\/[a-f0-9-]{36}$/.test(url.pathname) || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

export async function desktopGoogleSignIn(client) {
  const native = globalThis.__TAURI__;
  if (!native?.core?.invoke || !native.event?.listen) throw new Error("Desktop sign-in is unavailable. Please restart North.");
  const nonce = crypto.randomUUID();
  let unlisten;
  let timeout;
  try {
    let resolveReturn, rejectReturn;
    const returned = new Promise((resolve, reject) => {
      resolveReturn = resolve; rejectReturn = reject;
    });
    returned.catch(() => {});
    unlisten = await native.event.listen("north-oauth-return", (event) => {
      if (event.payload?.nonce !== nonce) return;
      if (event.payload.error) rejectReturn(new Error("Google sign-in was cancelled. Please try again."));
      else resolveReturn(event.payload.code);
    });
    timeout = setTimeout(() => rejectReturn(new Error("Sign-in timed out. Please try again.")), 300000);
    const callback = await native.core.invoke("begin_google_auth", { nonce });
    // Return directly to the native nonce-bound listener. This also works
    // before the website is deployed and keeps the PKCE code on this device.
    if (!desktopOAuthDestination(`desktopAuth=${encodeURIComponent(callback)}`)) {
      throw new Error("North could not create a secure local sign-in callback.");
    }
    const { data, error } = await client.auth.signInWithOAuth({ provider: "google", options: { skipBrowserRedirect: true, redirectTo: callback } });
    if (error) throw error;
    await native.core.invoke("open_google_auth", { url: data.url });
    const code = await returned;
    const result = await client.auth.exchangeCodeForSession(code);
    if (result.error) throw result.error;
  } finally {
    clearTimeout(timeout);
    unlisten?.();
  }
}
