import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  build: {
    // Target modern browsers for smaller bundles
    target: ['es2020', 'chrome90', 'firefox88', 'safari14'],

    // Enable source maps for production debugging (set false to reduce size)
    sourcemap: false,

    // Chunk size warning limit
    chunkSizeWarningLimit: 600,

    // CSS code splitting
    cssCodeSplit: true,

    rollupOptions: {
      output: {
        // Split vendor libs into cacheable chunks
        // Firebase (~800KB) and Maps (~200KB) change rarely → long cache hits
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('firebase'))    return 'vendor-firebase';
          if (id.includes('lucide-react')) return 'vendor-icons';
          // React core must be in the same chunk as react-dom — checked AFTER leaflet
          // so react-leaflet is already captured above and won't land here
          if (id.includes('node_modules/react/') || id.includes('react-dom') || id.includes('react/jsx') || id.includes('scheduler')) return 'vendor-react';
          // QR packages are dynamically imported only when top-up modal renders —
          // keep them out of the startup bundle so a load error can't white-screen the app
          if (id.includes('promptpay-qr') || id.includes('/qrcode/') || id.includes('/crc/') || id.includes('buffer-crc')) return undefined;
          return 'vendor-misc';
        },
        // Asset naming for long-term caching
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },

    // Minification (esbuild is built-in, faster than terser)
    minify: 'esbuild',
  },

  // Dev server
  server: {
    port: 5173,
    host: true,
    open: false,
  },

  // Preview server
  preview: {
    port: 4173,
    host: true,
  },

  // Optimize deps
  optimizeDeps: {
    include: ['react', 'react-dom', 'lucide-react'],
  },
})
