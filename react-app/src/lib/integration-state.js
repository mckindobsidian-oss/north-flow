// Failed probes are not evidence that a grant was created or revoked.
export function reconcileIntegration(previous, status) {
  if (!status || status.error || status.unavailable) return previous;
  if (status.connected !== true) return { connected: false, email: null, events: [], fetchedAt: 0 };
  return { ...previous, connected: true, email: status.email ?? previous.email ?? null };
}
