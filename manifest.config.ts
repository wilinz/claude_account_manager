import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
  name: 'Claude 账号切换器',
  version: pkg.version,
  description: pkg.description,
  default_locale: undefined,
  minimum_chrome_version: '116',

  // scripting 用来动态注册页面世界的退出拦截脚本，见 background 里的 registerLogoutGuard；
  // declarativeNetRequestWithHostAccess 用来按账号改写 Cookie 请求头，见 lib/usage.ts
  permissions: [
    'cookies',
    'storage',
    'tabs',
    'alarms',
    'scripting',
    'declarativeNetRequestWithHostAccess',
  ],
  host_permissions: ['https://claude.ai/*', 'https://*.claude.ai/*'],

  // 设置作为扩展的选项页；用量总览是另一张独立页面，从弹窗或设置页打开
  options_page: 'src/settings/index.html',

  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Claude 账号切换器',
  },

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  content_scripts: [
    {
      matches: ['https://claude.ai/*', 'https://*.claude.ai/*'],
      js: ['src/content/index.tsx'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],

  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
})
