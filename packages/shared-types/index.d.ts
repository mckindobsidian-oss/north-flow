/**
 * NORTH — shared domain types.
 *
 * Canonical shapes for the data that flows between every client (web,
 * extension, desktop, mobile) and the future Supabase backend. JS consumers
 * get the same contracts as JSDoc typedefs in ./index.js; TS consumers use
 * these interfaces directly.
 */

export type TaskPriority = "low" | "medium" | "high";
export type TaskCategory = "Personal" | "Work" | "Study" | "Health";
export type BoardColId = "todo" | "doing" | "done";

/** A single task. Cards on kanban boards ARE tasks (boardId/colId set). */
export interface Task {
  id: string;
  title: string;
  due?: string; // "YYYY-MM-DD" (local) — empty when unscheduled
  pri: TaskPriority;
  cat: TaskCategory;
  completed: boolean;
  at: number; // created timestamp (ms)
  boardId?: string; // set when the task is a card on a board
  colId?: BoardColId;
  // Future (Phase P2+): description, due time, recurrence rule, estimated
  // focus sessions + completed-session linkage.
}

/** A kanban board (To do / Doing / Done columns). */
export interface BoardCol {
  id: BoardColId;
  name: string;
}
export interface Board {
  id: string;
  name: string;
  cols: BoardCol[];
}

export interface UserRecord {
  pw?: string; // PLAIN-TEXT LEGACY ONLY — removed when Supabase auth lands
  name: string;
  tasks: Task[];
  apps: TrackedApp[];
  friends: string[];
  pm: PomodoroProfile;
}

export interface PomodoroProfile {
  w: number; // focus minutes
  sb: number; // short break minutes
  lb: number; // long break minutes
  sound?: boolean;
  notify?: boolean;
}

export type FocusPhase = "focus" | "shortBreak" | "longBreak";

/** Raw per-session record — source of truth for counts/history/analytics. */
export interface FocusSessionRecord {
  id: string;
  type: FocusPhase;
  start: number; // epoch ms
  end: number;
  planned: number; // planned seconds
  actual: number; // actually focused seconds (honest, never inflated)
  completed: boolean;
}

/** App the user tracks (limits are manual until the desktop client lands). */
export interface TrackedApp {
  id: string;
  name: string;
  icon: string;
  limit: number; // daily minute limit
  used: number;
  blocked: boolean; // enforced by desktop/extension clients, NOT the web page
  lastD: string; // "YYYY-MM-DD" the usage was last seen
}

export interface LeaderboardEntry {
  name: string;
  fm: number; // focus minutes (server-validated once Supabase lands)
  tc: number; // completed task count
  streak: number;
  last: string; // "YYYY-MM-DD" of last focus day
}

export interface FriendRelation {
  a: string;
  b: string;
  status: "pending" | "accepted";
  privacy: "board" | "stats" | "goals"; // what the user shares
}

/** Website blocking rule (enforced by the browser extension, not the web page). */
export interface WebsiteRule {
  id: string;
  host: string; // e.g. "youtube.com"
  blocked: boolean;
}

/** Usage record shape for extension (websites) and desktop (apps) clients. */
export interface UsageRecord {
  date: string; // "YYYY-MM-DD"
  kind: "website" | "app";
  name: string; // domain or app name
  seconds: number;
}

// ── BLOCKING (the model every client shares) ──────────────────────────────
// Implemented in ./blocking.js — these interfaces describe the same shapes the
// engine validates and evaluates, so a TS consumer cannot drift from it.

export type RuleKind = "website" | "app";

/** When a rule applies. `focus` = only while a focus session runs. */
export type RuleWhen = "always" | "focus" | "scheduled";

export interface BlockRule {
  id: string;
  kind: RuleKind;
  /** Normalized host ("youtube.com") for websites, display name for apps. */
  target: string;
  label: string;
  enabled: boolean;
  when: RuleWhen;
  /** Used when when === "scheduled"; empty means "any running schedule". */
  scheduleIds: string[];
  createdAt: number;
}

export interface BlockSchedule {
  id: string;
  name: string;
  /** 0 = Sunday … 6 = Saturday (mirrors Date#getDay on every client). */
  days: number[];
  /** "HH:MM". A window may cross midnight; start === end never blocks. */
  start: string;
  end: string;
  enabled: boolean;
}

export interface BlockingSettings {
  blockDuringFocus: boolean;
  allowTemporaryUnblock: boolean;
  tempUnblockMinutes: number;
}

export interface FocusWindow {
  startedAt: number;
  minutes: number;
  /** Epoch ms; the session ends by itself, no cleanup call needed. */
  endAt: number;
}

export interface BlockingState {
  version: 2;
  rules: BlockRule[];
  schedules: BlockSchedule[];
  settings: BlockingSettings;
  /** ruleId → epoch ms until which that rule is paused. */
  unblocks: Record<string, number>;
  focus: FocusWindow | null;
}

export type BlockReason = "always" | "focus" | `schedule:${string}` | "temp-unblock";

/** What `evaluateBlocking()` returns: the one verdict every client enforces. */
export interface BlockingVerdict {
  active: boolean;
  websites: string[];
  /** Lowercase keys, matched case-insensitively against OS process names. */
  apps: string[];
  appLabels: string[];
  reasons: Record<string, { reason: BlockReason; target: string; kind: RuleKind; until?: number }>;
  focus: { active: boolean; endsAt: number; minutesLeft: number };
  schedules: { id: string; name: string; end: string }[];
}

/** What each client is genuinely allowed to enforce (see ARCHITECTURE.md §1). */
export interface ClientCapability {
  id: "web" | "extension" | "desktop" | "mobile";
  label: string;
  configure: boolean;
  enforceWebsites: boolean;
  enforceApps: boolean;
  note: string;
}

/** Google Calendar integration state — secrets live server-side only. */
export interface CalendarIntegration {
  provider: "google";
  connected: boolean;
  scopes: string[];
  lastSyncedAt: number | null;
}
