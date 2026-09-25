# AGENTS.md — guidance for AI agents working in this repo

## Design system (apply on every UI change)

NORTH follows Apple's Human Interface Guidelines. Two skill sources live in
this repo and BOTH should be loaded before any design feedback or restyle:

- `design-rules/apple-design-skill/` — vendored Apple HIG reference (color,
  typography, layout, dark-mode, materials, motion, icons, …).
- `.agents/skills/apple-design/SKILL.md` — installed via `npx skills add
  https://github.com/emilkowalski/skills --skill apple-design` (tracked in
  `skills-lock.json`). Focuses on fluid interaction: press physics, springs,
  interruptible motion, scroll-edge translucent chrome, size-aware type
  (tracking/leading), and `prefers-reduced-motion` / `prefers-reduced-
  transparency` handling. Rules already live in the codebase: press feedback
  on `.b:active`, `color-scheme` per theme, `backdrop-filter` frosted header
  (`.mtrl`), page arrival via the `.pge` animation, and global reduced-motion
  overrides in the injected `G()` stylesheet.
- **Non-negotiable rules in use today**: system semantic colors (the `K`
  token palettes), ≥4.5:1 contrast for text, no hard-coded hex outside the
  token block, hairlines + grouped gray surfaces instead of heavy borders or
  gradients, system-first font stack, content-aware motion only.
- **Product decision**: unlike stock Apple apps, NORTH shows a manual
  light/dark switch (user requirement). Default is **light**; the switch is
  an iOS-style control with sun/moon affordance.

## Stack map (one product, many clients)

- `react-app/src/focusly.jsx` — the web client (single-file React app, inline
  styles via the `K` token system). Data goes through the `S.*` storage layer.
- `react-app/src/preview.jsx` — browser shim + demo seed (dev preview only).
- `apps/extension/`, `apps/desktop/`, `apps/mobile/` — other clients; each
  owns only the OS capabilities a web page cannot (see ARCHITECTURE.md).
- `packages/shared-types/` — canonical data shapes.

## Build order (user's priority)

1. **Website** (react-app) — currently in progress
2. Desktop app → 3. Browser extension → 4. Mobile app
Supabase/Google accounts come later; never fake them (see SETUP.md).
