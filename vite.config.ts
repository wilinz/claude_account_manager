import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath, URL } from 'node:url'
import manifest from './manifest.config'

/*
 * 每次构建换一个值。弹窗和页面每次打开都重新读文件，service worker 不重载扩展
 * 就一直跑旧代码 —— 两边对一下这个戳，不一致就在界面上说出来，
 * 而不是让人对着「保存成功但什么都没发生」发呆。
 */
const BUILD_ID = Date.now().toString(36)

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      // 用量总览页不由 manifest 引用（options_page 让给了设置页），
      // 不显式列成入口的话 crxjs 不会打包它
      input: { usage: 'src/usage/index.html' },
      output: { chunkFileNames: 'assets/chunk-[hash].js' },
    },
  },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
})
