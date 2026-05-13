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
        // Manual chunks for better caching
        manualChunks: {
          // React core
          'vendor-react': ['react', 'react-dom'],
          // Icons (heavy)
          'vendor-icons': ['lucide-react'],
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
