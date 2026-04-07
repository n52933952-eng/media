/**
 * Same OAuth client as backend `GOOGLE_WEB_CLIENT_ID` and mobile `GOOGLE_WEB_CLIENT_ID`.
 * Set in `.env`: VITE_GOOGLE_WEB_CLIENT_ID=xxxxx.apps.googleusercontent.com
 * (Firebase Console → Authentication → Sign-in method → Google → Web client ID)
 */
export const GOOGLE_WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || ''
