import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

// Each build gets an id, served as /version.json and baked into the app, so an
// open tab can tell a new version was deployed and switch over between pages
// rather than fail to load a page file that no longer exists (appVersion.ts).
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || String(Date.now())
const versionFile = (): Plugin => ({
  name: 'kuncho-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
  },
})

const outDir = process.env.VERCEL ? '.vercel/output/static' : 'dist'

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
  },
})
