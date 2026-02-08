import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  esbuild: {
    // Strip console.log/warn in production (keep console.error for debugging)
    drop: ['debugger'],
    pure: ['console.log', 'console.warn'],
  },
  build: {
    // Improve chunk splitting
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
          'ui-libs': ['date-fns', 'recharts'],
          'export-libs': ['jspdf', 'jspdf-autotable', 'xlsx', 'docx', 'file-saver'],
        },
      },
    },
  },
})
