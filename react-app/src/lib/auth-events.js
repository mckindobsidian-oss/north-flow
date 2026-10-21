/**
 * Turn Supabase auth events into the one account transition the app needs.
 * `undefined` means the event does not change the signed-in user.
 */
export function authEventUser(event, session) {
  if (event === "SIGNED_OUT") return null;
  if (["SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) {
    return session?.user || null;
  }
  return undefined;
}

/**
 * Restore the identity that this device already authenticated while Supabase
 * refreshes its persisted session. The server remains the authorization
 * boundary; this only prevents an offline boot from rendering a signed-in
 * account as "device only".
 */
export function cachedSessionUser(profile, session) {
  if (!profile) return null;
  return {
    ...profile,
    id: session?.id || "",
    authLinked: Boolean(session?.authLinked && session?.id),
  };
}
