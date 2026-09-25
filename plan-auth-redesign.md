# Implementation Plan: Login System Redesign

We are redesigning the authentication system in `react-app/src/focusly.jsx` to feature a polished, Apple-inspired UI, Supabase Auth integration, and an animated aurora gradient background.

## Steps

1.  **Dependencies**: Install `@supabase/supabase-js`.
2.  **Supabase Client Setup**: Create a new file `react-app/src/lib/supabase.js` to initialize the Supabase client.
3.  **UI Redesign (Auth component in `focusly.jsx`)**:
    *   Implement the animated Aurora gradient background via CSS.
    *   Refine the login card design for a true "frosted-glass" effect (backdrop-filter, semi-transparent layers).
    *   Add password visibility toggle (using `lucide-react` icons).
    *   Integrate Supabase sign-in/sign-up methods replacing existing logic.
    *   Implement loading and validation states with smooth transitions.
4.  **Google OAuth Integration**: Configure Google Auth provider in Supabase (instructions provided to user).
5.  **Refinement**: Apply Apple-style motion (spring-based transitions).

## Tech Stack Note
- Styling: Existing CSS-in-JS pattern (inline styles + palette `K`)
- Theme: Apple-inspired (using `focusly.jsx` design token system)
- Auth: Supabase Auth
