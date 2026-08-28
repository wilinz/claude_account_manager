import { useCallback, useEffect, useRef, useState } from 'react'
import { send } from '@/lib/messaging'
import { Settings } from '@/types'

interface Item {
  key: keyof Settings
  title: string
  desc: string
  /** 关掉之后需要警告一句的项 */
  warnWhenOff?: string
}

interface Group {
  title: string
  items: Item[]
}

const GROUPS: Group[] = [
  {
    title: '会话保存',
    items: [
      {
        key: 'autoCapture',
        title: '自动保存当前会话',
        desc: '登录、切换、会话续期时自动把 cookie 快照存进对应账号。关掉后只能在弹窗里手动保存，容易丢会话。',
      },
    ],
  },
  {
    title: '登录页',
    items: [
      {
        key: 'autoPrompt',
        title: '未登录时自动弹出账号选择',
        desc: '打开 claude.ai 发现没登录时，直接把已保存的账号列出来。关掉后仍可点邮箱输入框唤出下拉。',
      },
      {
        key: 'autoFillEmail',
        title: '自动填充邮箱',
        desc: '只有一个候选账号、且它没有可用会话时，直接把邮箱填进登录框。',
      },
    ],
  },
  {
    title: '切换账号',
    items: [
      {
        key: 'clearSiteDataOnSwitch',
        title: '切换时清除上个账号的页面缓存',
        desc: '不清的话，页面会带着上个账号的身份去打接口，403 之后直接跳登录页。设备绑定信息会保留，不影响免验证。',
      },
      {
        key: 'reloadTabsAfterSwitch',
        title: '切换后自动刷新 claude.ai 标签页',
        desc: '不刷新的话，页面上显示的还是上个账号的界面，直到你自己刷新。',
      },
    ],
  },
  {
    title: '退出登录',
    items: [
      {
        key: 'interceptLogout',
        title: '拦截网站的「退出登录」并询问',
        desc: '点击 claude.ai 自己的退出登录时，先问一句是「注销」还是「仅本地退出」。注销会让服务端吊销会话，保存的快照当场作废，之后切不回来。',
        warnWhenOff: '关掉后，在 claude.ai 上点退出登录会直接注销，那个账号保存的会话将立即失效。',
      },
    ],
  },
  {
    title: '导出备份',
    items: [
      {
        key: 'encryptExport',
        title: '导出时加密',
        desc: '用 AES-GCM-256 加密（PBKDF2-SHA256 派生密钥）。密码丢失无法恢复。',
        warnWhenOff: '未加密的导出文件里是明文会话 cookie，等同于登录凭证，切勿分享或上传。',
      },
    ],
  },
]

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    void send({ type: 'GET_SETTINGS' }).then(setSettings)
    return () => clearTimeout(savedTimer.current)
  }, [])

  const toggle = useCallback(async (key: keyof Settings, value: boolean) => {
    // 先本地生效，别让开关卡在旧状态上等一个来回
    setSettings((current) => (current ? { ...current, [key]: value } : current))
    const next = await send({ type: 'SET_SETTINGS', patch: { [key]: value } })
    setSettings(next)
    setSaved(true)
    clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(false), 1600)
  }, [])

  const openUsage = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/usage/index.html') })
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>设置</h1>
          <p className="sub">改动即时生效，无需保存。</p>
        </div>
        <div className="header-right">
          <span className={saved ? 'saved on' : 'saved'}>已保存</span>
          <button onClick={openUsage}>用量总览</button>
        </div>
      </header>

      {settings === null ? (
        <p className="empty">正在读取设置…</p>
      ) : (
        GROUPS.map((group) => (
          <section key={group.title} className="group">
            <h2>{group.title}</h2>
            {group.items.map((item) => {
              const on = settings[item.key]
              return (
                <label key={item.key} className="item">
                  <span className="item-text">
                    <span className="item-title">{item.title}</span>
                    <span className="item-desc">{item.desc}</span>
                    {!on && item.warnWhenOff && (
                      <span className="item-warn">{item.warnWhenOff}</span>
                    )}
                  </span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={on}
                    onChange={(e) => void toggle(item.key, e.target.checked)}
                  />
                </label>
              )
            })}
          </section>
        ))
      )}
    </div>
  )
}
