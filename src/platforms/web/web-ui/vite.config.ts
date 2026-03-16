import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    // 开发时代理 API 请求到后端
    proxy: {
      '/api': 'http://localhost:8192',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')

          if (normalizedId.includes('/src/utils/markdown.ts') || normalizedId.includes('/src/utils/renderers/')) {
            return 'markdown-renderer'
          }

          if (normalizedId.includes('/node_modules/highlight.js/')) {
            return 'vendor-highlight'
          }

          if (normalizedId.includes('/node_modules/mermaid/')) {
            return 'vendor-mermaid'
          }

          if (normalizedId.includes('/node_modules/katex/')) {
            return 'vendor-katex'
          }

          if (normalizedId.includes('/node_modules/markdown-it/') || normalizedId.includes('/node_modules/dompurify/')) {
            return 'vendor-markdown'
          }

          if (normalizedId.includes('/node_modules/vue/') || normalizedId.includes('/node_modules/@vue/')) {
            return 'vendor-vue'
          }
        },
      },
    },
  },
})
