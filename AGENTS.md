# NORTH — permanent agent instructions

`NORTH_MASTER_PLAN.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `PROGRESS.md`, and `ROADMAP.md` are the durable source of truth for this repository. Read them, then inspect the relevant code before planning or changing a feature. When they conflict with older readmes, audits, or checklists, the newer decision in `DECISIONS.md` wins. Do not erase useful older documentation; correct or deprecate it in the source-of-truth documents.

## Product guardrails

- NORTH is a cross-platform productivity and focus ecosystem: web, browser extension, desktop, Android, iOS/iPadOS, and one shared account/cloud model.
- Focus/Pomodoro is the primary experience. Tasks support it and must stay in sync where a client implements them.
- **North Flow** is one shared rules, schedules, limits, and blocking model. The cloud model is shared; enforcement stays local to the platform that is technically able and authorized to enforce it. Never claim that configuration is enforcement.
- The Board/kanban direction is deprecated. Do not add, promote, or plan Board work. Existing Board code and data need a deliberate migration/removal plan; do not silently delete user data.
- Keep the product minimal, atmospheric, Apple-inspired, and focused. Avoid generic SaaS layouts, decorative card grids, nested containers, fake metrics, and functionality presented as real before it is verified.

## Truth, integrations, and security

- Spotify, Google Calendar, authentication, social, sync, and blocking must use real integrations and real data. If a dependency, account, entitlement, deployment, or browser/native test is missing, show and document the honest unavailable state.
- Never commit, document, print, or send credentials: passwords, API keys, OAuth secrets, access/refresh tokens, service-role keys, or database secrets. Use ignored environment files and platform secret configuration. Public client configuration is still handled through environment variables.
- Inspect actual code before asserting status. Label work **Planned**, **Implemented**, **Verified**, **Blocked**, or **Deprecated**.

## Working agreement

1. Preserve unrelated uncommitted work. Check `git status` before edits.
2. Prefer the existing shared model and the smallest correct change. Do not build parallel state or duplicate platform logic.
3. For UI work, read `design-rules/apple-design-skill/SKILL.md` and the local Apple design skill before editing. Use the token system and accessibility / reduced-motion rules already established in the app.
4. After meaningful changes, run the narrowest relevant checks, then broader checks when practical. Record what passed, failed, or could not be verified in `PROGRESS.md`.
5. Update `DECISIONS.md` and `PROGRESS.md` whenever a substantial decision or implementation change is made, so a future session can continue from files rather than chat history.

## Useful commands

```bash
npm run dev
npm test
npm run check:jsx
npm run check:shared
npm run build
npm run lint
```
