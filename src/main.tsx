import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Auto-reload when Vite chunk preload fails (stale deployment / MIME type error).
// After a new deploy, old JS chunks no longer exist on the server. Vercel's
// SPA fallback serves index.html (text/html) instead, causing a MIME type error.
// This handler silently reloads the page so the user gets the fresh build.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  // Avoid infinite reload loops: only reload once per session
  const reloaded = sessionStorage.getItem('chunk-reload');
  if (!reloaded) {
    sessionStorage.setItem('chunk-reload', '1');
    window.location.reload();
  }
});

// Clear the reload flag on successful app boot
sessionStorage.removeItem('chunk-reload');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
