import { defineConfig } from 'vite';

// Relative base so the build works under any GitHub Pages path (/<repo>/).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 800 }, // Cytoscape alone is ~450 kB
});
