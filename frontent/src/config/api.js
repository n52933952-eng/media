// API base URL - works for both development and production
// If your frontend is on a different host than the API (e.g. Vercel + Render), set VITE_API_URL to your backend URL (e.g. https://media-1-aue5.onrender.com)
export const API_BASE_URL = import.meta.env.VITE_API_URL 
    || (import.meta.env.PROD 
        ? window.location.origin  // Production: same origin (when front and API are same host)
        : "http://localhost:5000")  // Development: localhost

export default API_BASE_URL

