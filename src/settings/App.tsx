import { useCallback, useEffect, useRef, useState } from 'react'
import { LANG_SETTINGS, type LangSetting, type Strings } from '@/i18n'
import { usePageChrome, useStrings } from '@/i18n/react'
import { send } from '@/lib/messaging'
import { Settings } from '@/types'

/** 只有布尔项才是开关；language 单独渲染成下拉 */
type ToggleKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never
}[keyof Settings]

interface Group {
  title: string
  items: ToggleKey[]
}

/** 分组与顺序在这儿定，文案全部来自词表 —— 加语言不用动这份结构 */
const GROUPS: { key: keyof Strings['settings']['groups']; items: ToggleKey[] }[] = [
  { key: 'capture', items: ['autoCapture'] },
  { key: 'loginPage', items: ['autoPrompt', 'autoFillEmail'] },
  { key: 'switching', items: ['clearSiteDataOnSwitch', 'reloadTabsAfterSwitch'] },
  { key: 'logout', items: ['interceptLogout'] },
  { key: 'backup', items: ['encryptExport'] },
]

export function App() {
  const s = useStrings()
  usePageChrome(`${s.common.extName} — ${s.settings.title}`)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    void send({ type: 'GET_SETTINGS' }).then(setSettings)
    return () => clearTimeout(savedTimer.current)
  }, [])

  const update = useCallback(async (patch: Partial<Settings>) => {
    // 先本地生效，别让开关卡在旧状态上等一个来回
    setSettings((current) => (current ? { ...current, ...patch } : current))
    setSettings(await send({ type: 'SET_SETTINGS', patch }))
    setSaved(true)
    clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(false), 1600)
  }, [])

  const openUsage = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/usage/index.html') })
  }

  const groups: Group[] = GROUPS.map((g) => ({ title: s.settings.groups[g.key], items: g.items }))

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>{s.settings.title}</h1>
          <p className="sub">{s.settings.sub}</p>
        </div>
        <div className="header-right">
          <span className={saved ? 'saved on' : 'saved'}>{s.settings.saved}</span>
          <button onClick={openUsage}>{s.settings.usage}</button>
        </div>
      </header>

      {settings === null ? (
        <p className="empty">{s.settings.loading}</p>
      ) : (
        <>
          <section className="group">
            <h2>{s.settings.language.group}</h2>
            <label className="item">
              <span className="item-text">
                <span className="item-title">{s.settings.language.title}</span>
                <span className="item-desc">{s.settings.language.desc}</span>
              </span>
              <select
                className="picker"
                value={settings.language}
                onChange={(e) => void update({ language: e.target.value as LangSetting })}
              >
                {LANG_SETTINGS.map((key) => (
                  <option key={key} value={key}>
                    {s.langName[key]}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {groups.map((group) => (
            <section key={group.title} className="group">
              <h2>{group.title}</h2>
              {group.items.map((key) => {
                const on = settings[key]
                const item = s.settings.items[key]
                const warn = 'warnWhenOff' in item ? item.warnWhenOff : undefined
                return (
                  <label key={key} className="item">
                    <span className="item-text">
                      <span className="item-title">{item.title}</span>
                      <span className="item-desc">{item.desc}</span>
                      {!on && warn && <span className="item-warn">{warn}</span>}
                    </span>
                    <input
                      type="checkbox"
                      className="switch"
                      checked={on}
                      onChange={(e) => void update({ [key]: e.target.checked })}
                    />
                  </label>
                )
              })}
            </section>
          ))}
        </>
      )}
    </div>
  )
}
