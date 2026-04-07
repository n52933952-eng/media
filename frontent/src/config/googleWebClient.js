/**
 * Google OAuth **Web client ID** (public — safe in source; not the client secret).
 * Same value as backend `GOOGLE_WEB_CLIENT_ID`.
 *
 * - Local: can override via `frontent/.env` → `VITE_GOOGLE_WEB_CLIENT_ID=...`
 * - Render / CI: set `VITE_GOOGLE_WEB_CLIENT_ID` on the **static site** service before `npm run build`,
 *   or rely on the default below so the button appears even when the build has no env file.
 */
export const GOOGLE_WEB_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID ||
  '931688184474-3cc8ifh10tt1ritl08iu8majbiudtncp.apps.googleusercontent.com'
