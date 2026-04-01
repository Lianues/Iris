import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // 将 @irises/extension-sdk 的所有子路径别名都映射到源码目录，
      // 这样测试时无需先构建 dist 产物，Vite 可以直接解析 TypeScript 源码。
      // 注意：更具体的路径必须放在前面，避免被主入口的别名提前匹配。
      '@irises/extension-sdk/pairing': path.resolve(__dirname, 'packages/extension-sdk/src/pairing'),
      '@irises/extension-sdk/utils': path.resolve(__dirname, 'packages/extension-sdk/src/utils'),
      '@irises/extension-sdk/plugin': path.resolve(__dirname, 'packages/extension-sdk/src/plugin'),
      '@irises/extension-sdk/tool-utils': path.resolve(__dirname, 'packages/extension-sdk/src/tool-utils'),
      '@irises/extension-sdk': path.resolve(__dirname, 'packages/extension-sdk/src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
  },
});
