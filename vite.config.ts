import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  esbuild: {
    // Strip console.log/warn in production (keep console.error for debugging)
    drop: ['debugger'],
    pure: ['console.log', 'console.warn'],
  },
  build: {
    // Improve chunk splitting
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
            return 'react-vendor'
          }

          if (id.includes('@supabase/supabase-js')) {
            return 'supabase'
          }

          if (id.includes('recharts') || id.includes('date-fns')) {
            return 'ui-libs'
          }

          if (id.includes('face-api.js')) {
            return 'face-recognition'
          }

          if (id.includes('jspdf') || id.includes('jspdf-autotable')) {
            return 'pdf-libs'
          }

          if (id.includes('xlsx') || id.includes('file-saver')) {
            return 'spreadsheet-libs'
          }

          if (id.includes('docx')) {
            return 'word-libs'
          }

          return undefined
        },
      },
    },
  },
})
