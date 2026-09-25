/**
 * NORTH — shared domain types (JS mirror).
 *
 * TypeScript consumers should use ./index.d.ts — the canonical contracts.
 * This file gives plain-JS consumers the same shapes as JSDoc typedefs plus
 * the handful of shared constants every client hard-codes today.
 */

export const TASK_PRIORITIES = ["low", "medium", "high"];
export const TASK_CATEGORIES = ["Personal", "Work", "Study", "Health"];
export const BOARD_COL_IDS = ["todo", "doing", "done"];
export const BOARD_COL_NAMES = { todo: "To do", doing: "Doing", done: "Done" };
export const FOCUS_PHASES = ["focus", "shortBreak", "longBreak"];

/**
 * @typedef {"low" | "medium" | "high"} TaskPriority
 * @typedef {"Personal" | "Work" | "Study" | "Health"} TaskCategory
 * @typedef {"todo" | "doing" | "done"} BoardColId
 * @typedef {"focus" | "shortBreak" | "longBreak"} FocusPhase
 *
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string} [due]  "YYYY-MM-DD"
 * @property {TaskPriority} pri
 * @property {TaskCategory} cat
 * @property {boolean} completed
 * @property {number} at  created epoch ms
 * @property {string} [boardId]  set when the task is a card on a board
 * @property {BoardColId} [colId]
 *
 * @typedef {Object} BoardCol
 * @property {BoardColId} id
 * @property {string} name
 *
 * @typedef {Object} Board
 * @property {string} id
 * @property {string} name
 * @property {BoardCol[]} cols
 *
 * @typedef {Object} PomodoroProfile
 * @property {number} w  focus minutes
 * @property {number} sb  short break minutes
 * @property {number} lb  long break minutes
 * @property {boolean} [sound]
 * @property {boolean} [notify]
 *
 * @typedef {Object} UserRecord
 * @property {string} [pw]  legacy plain text — removed with Supabase auth
 * @property {string} name
 * @property {Task[]} tasks
 * @property {import("./index.js").TrackedApp[]} apps
 * @property {string[]} friends
 * @property {PomodoroProfile} pm
 *
 * @typedef {Object} TrackedApp
 * @property {string} id
 * @property {string} name
 * @property {string} icon
 * @property {number} limit  daily minute limit
 * @property {number} used
 * @property {boolean} blocked  enforced by desktop/extension, never the web page
 * @property {string} lastD
 *
 * @typedef {Object} FocusSessionRecord
 * @property {string} id
 * @property {FocusPhase} type
 * @property {number} start  epoch ms
 * @property {number} end  epoch ms
 * @property {number} planned  planned seconds
 * @property {number} actual  actually focused seconds
 * @property {boolean} completed
 *
 * @typedef {Object} LeaderboardEntry
 * @property {string} name
 * @property {number} fm
 * @property {number} tc
 * @property {number} streak
 * @property {string} last
 *
 * @typedef {Object} UsageRecord
 * @property {string} date  "YYYY-MM-DD"
 * @property {"website" | "app"} kind
 * @property {string} name
 * @property {number} seconds
 *
 * @typedef {Object} CalendarIntegration
 * @property {"google"} provider
 * @property {boolean} connected
 * @property {string[]} scopes
 * @property {number|null} lastSyncedAt
 */
export {};
