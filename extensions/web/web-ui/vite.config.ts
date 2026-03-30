import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@web-shared': path.resolve(__dirname, '../src'),
    },
  },
  server: {
    // 开发时代理 API 请求到后端
    proxy: {
      '/api': 'http://localhost:8192',
      '/ws': {
        target: 'http://localhost:8192',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1280,
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

          // mermaid 子依赖拆分为独立 chunk（必须在 mermaid 规则之前）
          if (/\/node_modules\/d3(-[^/]+)?\//.test(normalizedId)) {
            return 'vendor-d3'
          }

          if (/\/node_modules\/cytoscape(-[^/]+)?\//.test(normalizedId)) {
            return 'vendor-cytoscape'
          }

          if (normalizedId.includes('/node_modules/@mermaid-js/')) {
            return 'vendor-mermaid-parser'
          }

          if (normalizedId.includes('/node_modules/dagre-d3-es/') || normalizedId.includes('/node_modules/roughjs/') || normalizedId.includes('/node_modules/lodash-es/')) {
            return 'vendor-mermaid-deps'
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

          if (normalizedId.includes('/node_modules/@xterm/')) {
            return 'vendor-xterm'
          }

          if (normalizedId.includes('/node_modules/vue/') || normalizedId.includes('/node_modules/@vue/')) {
            return 'vendor-vue'
          }
        },
      },
    },
  },
})
