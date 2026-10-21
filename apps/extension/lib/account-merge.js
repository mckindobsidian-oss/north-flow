/**
 * NORTH extension — merging the account's profile document into device state (PURE).
 *
 * WHY THIS FILE IS SEPARATE
 * This is the boundary where the extension stops being a standalone blocker and
 * becomes another client of the NORTH account. Getting it wrong is expensive in
 * both directions: too eager and the extension overwrites the user's rules with
 * a stale local list, too timid and a rule they added in North Guard never
 * reaches the browser. It is pure so `tests/extension.test.mjs` can pin every
 * one of those cases without a browser.
 *
 * THE THREE-WAY SPLIT, AND WHY
 *  - **Account-owned** (`rules`, `schedules`, `settings`): the web app is the
 *    control center, so the account's copy wins. Rules that exist only on this
 *    device survive, because a phone-only rule must not vanish just because a
 *    desktop pushed last.
 *  - **Account-owned when running** (`focus`): the running Focus Mode window is
 *    the one piece of the blocking state that has to travel, because Focus Mode
 *    started in North must actually block sites in this browser. It is adopted
 *    while it is live, and cleared when the account says the session is over —
 *    but only if this device did not start its own session.
 *  - **Device-owned** (`unblocks`): temporary unblocks never travel. They are
 *    deliberate, expiring local pauses; letting them sync would let one device
 *    pause another's enforcement for a reason that has already lapsed.
 */

import { normalizeState } from "./blocking.js";

/** Where the live focus window came from — the account, or this browser. */
export const FOCUS_SOURCE = { account: "account", local: "local" };

/**
 * Apply the account's settings document to the local blocking state.
 *
 * @param {object} state          the local state (already normalized, or not)
 * @param {object} settings       `profiles.settings` as stored server-side
 * @param {object} [opts]
 * @param {number} [opts.now]     evaluation time (injectable for tests)
 * @param {string|null} [opts.focusSource]  where the *current* focus came from
 * @returns {{ state: object, focusSource: string|null, adoptedFocus: boolean }}
 */
export function applyAccountBlocking(state, settings, { now = Date.now(), focusSource = null } = {}) {
  const incoming = settings?.blocking;
  const merged = normalizeState(state);

  if (!incoming || !Array.isArray(incoming.rules)) {
    // No blocking document at all (a profile row written before this field
    // existed): still honour a focus window if one was sent, and change nothing
    // else — rules are the user's, and an absent document is not "no rules".
    const focused = adoptFocus(merged, settings, now, focusSource);
    return { ...focused };
  }

  const withRules = normalizeState({
    ...merged,
    rules: incoming.rules,
    usageLimits: Array.isArray(incoming.usageLimits) ? incoming.usageLimits : merged.usageLimits,
    schedules: Array.isArray(incoming.schedules) ? incoming.schedules : merged.schedules,
    settings: {
      ...merged.settings,
      ...(incoming.settings || {}),
      ...(typeof settings.blockDuringFocus === "boolean" ? { blockDuringFocus: settings.blockDuringFocus } : {}),
      ...(typeof settings.allowTemporaryUnblock === "boolean" ? { allowTemporaryUnblock: settings.allowTemporaryUnblock } : {}),
      ...(Number.isFinite(settings.tempUnblockMinutes) ? { tempUnblockMinutes: settings.tempUnblockMinutes } : {}),
    },
    // Temporary unblocks are device state and are never overwritten by a pull.
    unblocks: merged.unblocks,
  });

  const focused = adoptFocus(withRules, settings, now, focusSource);
  return { state: focused.state, focusSource: focused.focusSource, adoptedFocus: focused.adoptedFocus };
}

/**
 * Adopt / clear the account's running focus window.
 *
 *  - Account window still running  → adopt it (the later end time wins, so a
 *    local session never gets cut short by an account one).
 *  - Account window over, and this device was running the account's session
 *    → clear it, which is what "Focus Mode ended" means for blocking.
 *  - Account window over, but this device started its own session
 *    → leave it alone; a popup-started session is not cancelled by a pull.
 */
export function adoptFocus(state, settings, now = Date.now(), focusSource = null) {
  const incoming = settings?.blocking?.focus || null;
  if (incoming && Number(incoming.endAt) > now) {
    const localActive = state.focus && Number(state.focus.endAt) > now;
    const keepLocal = localActive && Number(state.focus.endAt) >= Number(incoming.endAt);
    return {
      state: keepLocal ? state : normalizeState({ ...state, focus: incoming }),
      focusSource: keepLocal ? FOCUS_SOURCE.local : FOCUS_SOURCE.account,
      adoptedFocus: !keepLocal,
    };
  }
  if (focusSource === FOCUS_SOURCE.account) {
    return { state: normalizeState({ ...state, focus: null }), focusSource: null, adoptedFocus: false };
  }
  return { state, focusSource, adoptedFocus: false };
}

/**
 * The account document this device writes back: rules, schedules and settings.
 *
 * Deliberately excludes the focus window. Two writers (the web timer and this
 * browser) racing over one field would make Focus Mode unreliable, so the web
 * app stays the single publisher of the window and the extension is purely its
 * consumer — it enforces the session rather than announcing one.
 */
export function blockingToSettings(state) {
  const s = normalizeState(state);
  const settings = {
    blockDuringFocus: s.settings.blockDuringFocus,
    allowTemporaryUnblock: s.settings.allowTemporaryUnblock,
    tempUnblockMinutes: s.settings.tempUnblockMinutes,
  };
  return {
    ...settings,
    blocking: {
      rules: s.rules.map((r) => ({
        id: r.id, kind: r.kind, target: r.target, label: r.label || "",
        enabled: r.enabled, when: r.when, scheduleIds: r.scheduleIds || [],
      })),
      usageLimits: s.usageLimits,
      schedules: s.schedules.map((sched) => ({
        id: sched.id, name: sched.name, days: sched.days,
        start: sched.start, end: sched.end, enabled: sched.enabled,
      })),
      settings,
    },
  };
}
