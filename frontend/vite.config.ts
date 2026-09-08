import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Phase A2b: minimal config for the placeholder scaffold. Backend proxy,
// path aliases, etc. are Phase F's job to add alongside the real app.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
