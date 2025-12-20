// API base URL - works for both development and production
// In production, uses the current origin (same server)
// In development, uses localhost:5000
export const API_BASE_URL = import.meta.env.PROD 
    ? window.location.origin  // Production: same origin
    : "http://localhost:5000"  // Development: localhost

export default API_BASE_URL

