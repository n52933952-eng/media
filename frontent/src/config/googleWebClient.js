/**
 * Google OAuth Web client ID (public). Same as backend `GOOGLE_WEB_CLIENT_ID`.
 * Optional override: `VITE_GOOGLE_WEB_CLIENT_ID` in `frontent/.env` (must match this project in Google Cloud).
 */
const FALLBACK = '931688184474-3cc8ifh10tt1ritl08iu8majbiudtncp.apps.googleusercontent.com'
const fromEnv = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID
export const GOOGLE_WEB_CLIENT_ID =
  typeof fromEnv === 'string' && fromEnv.trim() ? fromEnv.trim() : FALLBACK
