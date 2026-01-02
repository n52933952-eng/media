// API base URL - works for both development and production
// Priority: VITE_API_URL env var > same origin > localhost
export const API_BASE_URL = import.meta.env.VITE_API_URL 
    || (import.meta.env.PROD 
        ? window.location.origin  // Production: same origin (if same server)
        : "http://localhost:5000")  // Development: localhost

export default API_BASE_URL

