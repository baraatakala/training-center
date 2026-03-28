import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'

// Auto-reload when Vite chunk preload fails (stale deployment / MIME type error).
// After a new deploy, old JS chunks no longer exist on the server. Vercel's
// SPA fallback serves index.html (text/html) instead, causing a MIME type error.
// This handler silently reloads the page so the user gets the fresh build.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  // Avoid infinite reload loops: only reload once per page lifetime
  const reloaded = sessionStorage.getItem('chunk-reload');
  if (!reloaded) {
    sessionStorage.setItem('chunk-reload', '1');
    window.location.reload();
  }
});

// Clear the reload guard only after the page has been alive long enough
// to confirm no preload errors fired (3 s is safely after any lazy chunk fetch).
// NEVER clear it synchronously at module-load time — that breaks the guard.
window.addEventListener('load', () => {
  setTimeout(() => {
    sessionStorage.removeItem('chunk-reload');
  }, 3000);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
