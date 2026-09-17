import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    // MapLibre is large and only the map view needs it; splitting it keeps the
    // initial payload small enough that the overview paints before the map
    // library has finished downloading.
    rollupOptions: {
      output: {
        manualChunks: { maplibre: ['maplibre-gl'] },
      },
    },
  },
});
