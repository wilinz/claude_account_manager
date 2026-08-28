import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BILLING_PLATFORMS,
  BillingPlatform,
  describeRenewal,
  formatDate,
  PLATFORM_LABELS,
  PLATFORM_RULE_NOTES,
  ruleMatters,
} from '@/lib/billing'
import { decryptBundle, encryptBundle, isEncryptedBundle } from '@/lib/crypto'
import { send } from '@/lib/messaging'
import { bundleFileName } from '@/lib/transfer'
import {
  Account,
  ALL_TRANSFER_PARTS,
  CurrentState,
  ImportStrategy,
  Settings,
  TransferParts,
} from '@/types'

const STRATEGY_LABEL: Record<ImportStrategy, string> = {
  merge: '合并（只用更新的会话）',
  overwrite: '覆盖同名账号',
  replace: '替换本地全部账号',
}

function initials(account: Account): string {
  const source = account.note || account.displayName || account.email
  return (source.trim()[0] ?? '?').toUpperCase()
}

function relative(ts: number): string {
  if (!ts) return '从未使用'
  const diff = Date.now() - ts
  const minute = 60_000
  if (diff < minute) return '刚刚'
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`
  return `${Math.floor(diff / (24 * 60 * minute))} 天前`
}

/** 触发浏览器下载。popup 关闭不影响已经开始的下载 */
function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

interface PendingTransfer {
  kind: 'export' | 'import'
  /** 面板标题里的对象：导出是「全部」「所选」，导入是文件名 */
  label: string
  /** 哪几项可勾。导入时按文件实际内容决定 */
  available: TransferParts
  /** 文件的导出时间。缺哪一项时，这个时间往往就是原因 —— 旧文件里根本没有 */
  exportedAt?: number
  /** strategy 只对导入有意义，导出时忽略 */
  run: (parts: TransferParts, strategy: ImportStrategy) => void | Promise<void>
}

const PART_LABELS: { key: keyof TransferParts; title: string; desc: string }[] = [
  { key: 'cookies', title: '会话 cookie', desc: '登录凭证本身，能直接登进账号' },
  { key: 'billing', title: '订阅信息', desc: '每月续订日与订阅渠道' },
  { key: 'settings', title: '扩展设置', desc: '自动保存、退出拦截等开关' },
]

/**
 * 导入 / 导出前勾选带哪几类数据。
 * 账号本身（邮箱、备注、身份）永远带，所以不列在这儿 —— 它没有不带的选项。
 */
function TransferPicker({
  pending,
  onCancel,
}: {
  pending: PendingTransfer
  onCancel: () => void
}) {
  // 默认勾上所有「可用」的项：多数时候用户就是想整份带走
  const [parts, setParts] = useState<TransferParts>(pending.available)
  // 策略跟着这次导入走，关掉面板就没了 —— 不该是个记在外面的全局开关
  const [strategy, setStrategy] = useState<ImportStrategy>('merge')
  const nothing = !parts.cookies && !parts.billing && !parts.settings

  return (
    <div className="sheet" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sheet-card" role="dialog" aria-label="选择内容">
        <p className="sheet-title">
          {pending.kind === 'export' ? `导出${pending.label}` : '导入备份'}
        </p>
        <p className="sheet-sub">
          {pending.kind === 'export' ? '选择要写进文件的内容' : `从 ${pending.label} 恢复哪些内容`}
          {pending.exportedAt && ` · 导出于 ${new Date(pending.exportedAt).toLocaleString()}`}
        </p>

        {PART_LABELS.map((item) => {
          const usable = pending.available[item.key]
          return (
            <label key={item.key} className={usable ? 'sheet-item' : 'sheet-item off'}>
              <input
                type="checkbox"
                checked={usable && parts[item.key]}
                disabled={!usable}
                onChange={(e) => setParts((p) => ({ ...p, [item.key]: e.target.checked }))}
              />
              <span>
                <span className="sheet-item-title">{item.title}</span>
                <span className="sheet-item-desc">
                  {usable ? item.desc : '这个文件里没有'}
                </span>
              </span>
            </label>
          )
        })}

        {pending.kind === 'import' && (
          <label className="sheet-strategy">
            <span className="sheet-item-title">同名账号怎么处理</span>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value as ImportStrategy)}>
              {(Object.keys(STRATEGY_LABEL) as ImportStrategy[]).map((key) => (
                <option key={key} value={key}>
                  {STRATEGY_LABEL[key]}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="sheet-actions">
          <button className="mini ghost" onClick={onCancel}>
            取消
          </button>
          <button
            className="mini primary"
            disabled={nothing}
            onClick={() => {
              // 清空本地记录是不可逆的，问一次再走
              if (
                pending.kind === 'import' &&
                strategy === 'replace' &&
                !window.confirm('「替换本地全部账号」会清空现有记录，继续？')
              ) {
                return
              }
              onCancel()
              void pending.run(parts, strategy)
            }}
          >
            {nothing ? '至少选一项' : pending.kind === 'export' ? '导出' : '导入'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface BillingEditorProps {
  account: Account
  disabled: boolean
  onSave: (anchor: number | null, platform: BillingPlatform | null) => void
  onCancel: () => void
}

/**
 * 订阅信息编辑器。填的是「平台里显示的下次续订日期」，不是购买日期 ——
 * 平台按账单地址时区算，从购买时间反推会差一天。渠道决定短月怎么往后推。
 */
function BillingEditor({ account, disabled, onSave, onCancel }: BillingEditorProps) {
  const [date, setDate] = useState(
    account.billingAnchor ? formatDate(account.billingAnchor) : '',
  )
  const [platform, setPlatform] = useState<BillingPlatform>(account.billingPlatform ?? 'web')

  const parsed = date ? new Date(`${date}T00:00:00`) : null
  const anchor = parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : null

  return (
    <div className="billing-edit">
      <label className="billing-field">
        <span>续订日</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="billing-field">
        <span>订阅渠道</span>
        <select value={platform} onChange={(e) => setPlatform(e.target.value as BillingPlatform)}>
          {BILLING_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABELS[p]}
            </option>
          ))}
        </select>
      </label>

      {/* 续订日 28 号及以前三家规则完全一致，没必要拿规则差异打扰用户 */}
      {anchor !== null && ruleMatters(anchor) && (
        <p className="billing-note">{PLATFORM_RULE_NOTES[platform]}</p>
      )}

      <p className="billing-note">照抄平台里显示的下次续订日期。各家按自己的时区算，
        从购买时间反推会差一天。</p>

      <div className="billing-actions">
        <button className="mini" disabled={disabled || anchor === null} onClick={() => onSave(anchor, platform)}>
          保存
        </button>
        <button
          className="mini ghost danger"
          disabled={disabled || !account.billingAnchor}
          onClick={() => onSave(null, null)}
        >
          清除
        </button>
        <button className="mini ghost" disabled={disabled} onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  )
}

export function App() {
  const [state, setState] = useState<CurrentState | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [settings, setSettingsState] = useState<Settings | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  /** 正在编辑订阅信息的账号 id */
  const [billingFor, setBillingFor] = useState<string | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  /** 等用户勾选内容项的导入 / 导出任务；null 表示没有面板在等 */
  const [pending, setPending] = useState<PendingTransfer | null>(null)
  /** service worker 的构建戳和弹窗对不上 = 它还在跑旧代码 */
  const [stale, setStale] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void send({ type: 'PING' })
      .then((res) => setStale(res.buildId !== __BUILD_ID__))
      // 老版本 background 压根没有 PING，会抛「不认识这个消息类型」—— 那更是旧的
      .catch(() => setStale(true))
  }, [])

  const refresh = useCallback(async () => {
    const [nextAccounts, nextSettings] = await Promise.all([
      send({ type: 'LIST_ACCOUNTS' }),
      send({ type: 'GET_SETTINGS' }),
    ])
    setAccounts(nextAccounts)
    setSettingsState(nextSettings)
    // 丢弃已经不存在的选中项
    setSelected((prev) => {
      const alive = new Set(nextAccounts.map((a) => a.id))
      return new Set([...prev].filter((id) => alive.has(id)))
    })
    setState(await send({ type: 'GET_STATE' }))
  }, [])

  useEffect(() => {
    void refresh().catch((e: unknown) => setMessage(e instanceof Error ? e.message : '加载失败'))
  }, [refresh])

  const allSelected = accounts.length > 0 && selected.size === accounts.length
  const someSelected = selected.size > 0 && !allSelected

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  const selectedAccounts = useMemo(
    () => accounts.filter((a) => selected.has(a.id)),
    [accounts, selected],
  )

  async function run(key: string, fn: () => Promise<string | null>) {
    setBusy(key)
    setMessage(null)
    try {
      const result = await fn()
      if (result) setMessage(result)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(null)
    }
  }

  /* ---------------- 选择 ---------------- */

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAll = () =>
    setSelected((prev) => (prev.size === accounts.length ? new Set() : new Set(accounts.map((a) => a.id))))

  /* ---------------- 账号操作 ---------------- */

  const capture = () =>
    run('capture', async () => {
      const res = await send({ type: 'CAPTURE_CURRENT' })
      return res.saved ? `已保存 ${res.account?.email || '当前账号'}` : (res.reason ?? '保存失败')
    })

  const switchTo = (account: Account) =>
    run(account.id, async () => {
      const res = await send({ type: 'SWITCH_ACCOUNT', id: account.id })
      if (!res.ok) return res.reason ?? '切换失败'
      // 没能向服务端确认时，含糊地说一句「已切换」会误导人
      return res.warning ?? `已切换到 ${account.email || '该账号'}`
    })

  const forget = (account: Account) =>
    run(account.id, async () => {
      await send({ type: 'FORGET_ACCOUNT', id: account.id })
      return '已删除'
    })

  const forgetSelected = () => {
    if (selectedAccounts.length === 0) return
    const names = selectedAccounts.map((a) => a.note || a.email || a.id).join('、')
    if (!window.confirm(`删除这 ${selectedAccounts.length} 个账号的记录？\n${names}`)) return
    void run('bulk', async () => {
      const res = await send({ type: 'FORGET_ACCOUNTS', ids: [...selected] })
      setSelected(new Set())
      return `已删除 ${res.removed} 个账号`
    })
  }

  const saveBilling = (account: Account, anchor: number | null, platform: BillingPlatform | null) =>
    run(account.id, async () => {
      await send({ type: 'SET_BILLING', id: account.id, anchor, platform })
      setBillingFor(null)
      return anchor === null ? '已清除订阅信息' : '订阅信息已保存'
    })

  const rename = (account: Account) => {
    const note = window.prompt('给这个账号起个备注', account.note ?? '')
    if (note === null) return
    void run(account.id, async () => {
      await send({ type: 'RENAME_ACCOUNT', id: account.id, note: note.trim() })
      return null
    })
  }

  const logout = () =>
    run('logout', async () => {
      await send({ type: 'LOGOUT_CURRENT' })
      return '已退出当前会话（快照已保留）'
    })

  const addAccount = () => {
    // 会把浏览器变回未登录状态，说清楚这件事再动手
    if (
      state?.loggedIn &&
      !window.confirm(
        '将先保存当前会话，然后退出并打开登录页去添加新账号。\n' +
          '当前账号的会话会留在列表里，随时可以切回来。继续？',
      )
    ) {
      return
    }
    void run('add', async () => {
      const res = await send({ type: 'ADD_ACCOUNT' })
      // 登录页已经打开了，弹窗留着也看不到
      window.close()
      return res.savedCurrent ? '已保存当前会话，去登录新账号吧' : '已打开登录页'
    })
  }

  /* ---------------- 导入 / 导出 ---------------- */

  /** ids 为空数组 = 导出全部 */
  const exportAccounts = (ids: string[], label: string) => {
    const encrypt = settings?.encryptExport ?? true
    const secret = password.trim()

    if (encrypt && !secret) {
      setMessage('请先填写加密密码，或取消勾选「加密导出」')
      passwordRef.current?.focus()
      return
    }
    if (!encrypt && !window.confirm('明文导出的备份包含可直接登录的会话凭证，确定不加密？')) {
      return
    }

    setPending({
      kind: 'export',
      label,
      // 导出时三项都可选，默认全带
      available: ALL_TRANSFER_PARTS,
      run: (parts) => doExport(ids, label, encrypt, secret, parts),
    })
  }

  const doExport = (
    ids: string[],
    label: string,
    encrypt: boolean,
    secret: string,
    parts: TransferParts,
  ) =>
    run('export', async () => {
      const bundle = await send({ type: 'EXPORT_ACCOUNTS', ids, parts })
      const file = encrypt ? await encryptBundle(bundle, secret) : bundle
      downloadJson(bundleFileName(bundle.accounts.length, encrypt), file)

      const withSession = bundle.accounts.filter((a) => a.cookies.length > 0).length
      const suffix = encrypt ? '，已用密码加密' : '，未加密'
      return `已导出${label} ${bundle.accounts.length} 个账号（${withSession} 个含会话）${suffix}`
    })

  const onPickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = '' // 允许连续导入同一个文件
    if (!file) return

    // 先解出内容才知道文件里有哪几类数据，勾选面板要照着它来
    let parsed: unknown
    try {
      const text = await file.text()
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('文件不是合法的 JSON')
      }
      if (isEncryptedBundle(parsed)) {
        const secret =
          password.trim() || window.prompt('这是加密备份，请输入导出时设置的密码')?.trim()
        if (!secret) throw new Error('这是加密备份，需要密码才能导入')
        parsed = await decryptBundle(parsed, secret)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取文件失败')
      return
    }

    const bundle = parsed as { accounts?: unknown; settings?: unknown; exportedAt?: unknown }
    const list = Array.isArray(bundle?.accounts) ? (bundle.accounts as Account[]) : []
    setPending({
      kind: 'import',
      label: file.name,
      // 文件里没有的类别不给勾 —— 勾了也无事发生，只会让人以为丢了数据
      available: {
        cookies: list.some((a) => Array.isArray(a?.cookies) && a.cookies.length > 0),
        billing: list.some((a) => typeof a?.billingAnchor === 'number'),
        settings: bundle?.settings !== undefined && bundle.settings !== null,
      },
      exportedAt: typeof bundle?.exportedAt === 'number' ? bundle.exportedAt : undefined,
      run: (parts, strategy) => doImport(parsed, parts, strategy),
    })
  }

  const doImport = (bundle: unknown, parts: TransferParts, strategy: ImportStrategy) =>
    run('import', async () => {
      const res = await send({ type: 'IMPORT_ACCOUNTS', bundle, strategy, parts })
      const done = [`新增 ${res.added}`, `更新 ${res.updated}`]
      if (res.skipped) done.push(`跳过 ${res.skipped}`)
      if (res.invalid) done.push(`忽略无效 ${res.invalid}`)
      if (res.settingsApplied) done.push('已恢复设置')
      return `导入完成：${done.join(' · ')}`
    })

  const toggle = (patch: Partial<Settings>) =>
    run('settings', async () => {
      setSettingsState(await send({ type: 'SET_SETTINGS', patch }))
      return null
    })

  const openClaude = () => {
    void chrome.tabs.create({ url: 'https://claude.ai/' })
  }

  const openUsage = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/usage/index.html') })
  }

  return (
    <div className="app">
      {pending && <TransferPicker pending={pending} onCancel={() => setPending(null)} />}

      {stale && (
        <div className="stale">
          <span>
            后台还在跑旧代码，保存和导出可能静默失效。
          </span>
          <button className="mini" onClick={() => chrome.runtime.reload()}>
            重新加载扩展
          </button>
        </div>
      )}

      <header className="header">
        <div className="brand-row">
          <div className="brand">
            <span className="dot" />
            <span>Claude 账号切换器</span>
          </div>
          <button className="open-site" title="在新标签页打开 claude.ai" onClick={openClaude}>
            claude.ai <span className="arrow">↗</span>
          </button>
        </div>
        <p className="current">
          {state === null
            ? '读取中…'
            : state.loggedIn
              ? `当前：${state.email || state.displayName || '已登录'}`
              : '当前未登录 claude.ai'}
        </p>
        {state?.loggedIn && settings && (
          <p className="current">
            {settings.autoCapture
              ? state.sessionUpdatedAt
                ? `会话已自动保存 · ${relative(state.sessionUpdatedAt)}`
                : '尚未保存这个会话，稍后会自动保存'
              : state.sessionUpdatedAt
                ? `自动保存已关闭 · 快照停留在 ${relative(state.sessionUpdatedAt)}`
                : '自动保存已关闭 · 这个会话还没有快照'}
          </p>
        )}
      </header>

      <div className="actions">
        <button className="primary" disabled={busy !== null} onClick={addAccount}>
          ＋ 添加账号
        </button>
        <button disabled={busy !== null || !state?.loggedIn} onClick={() => void capture()}>
          保存当前会话
        </button>
        <button disabled={busy !== null || !state?.loggedIn} onClick={() => void logout()}>
          退出当前账号
        </button>
      </div>

      {message && <div className="message">{message}</div>}

      {/* 全部开关都在独立设置页里，那儿有解释和危险项警告；弹窗只留入口 */}
      <div className="entries">
        {/* 导入导出平时用不上，占着两行加一段警告太亏，收起来 */}
        <button
          className="entry"
          aria-expanded={transferOpen}
          onClick={() => setTransferOpen((open) => !open)}
        >
          导入导出
          <span className={transferOpen ? 'chevron open' : 'chevron'}>▾</span>
        </button>
        {transferOpen && (
          <section className="transfer">
          <div className="transfer-row">
            <button
              className="mini"
              disabled={busy !== null || accounts.length === 0}
              onClick={() => exportAccounts([], '全部')}
            >
              导出全部
            </button>
            <button
              className="mini"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
            >
              导入备份
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => void onPickFile(e)}
            />
          </div>
          <div className="transfer-row">
            <label className="encrypt-toggle">
              <input
                type="checkbox"
                checked={settings?.encryptExport ?? true}
                disabled={busy !== null || settings === null}
                onChange={(e) => void toggle({ encryptExport: e.target.checked })}
              />
              加密导出
            </label>
            <input
              ref={passwordRef}
              className="password"
              type="password"
              autoComplete="new-password"
              placeholder={settings?.encryptExport === false ? '已关闭加密' : '设置加密密码'}
              value={password}
              disabled={busy !== null || settings?.encryptExport === false}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <p className={settings?.encryptExport === false ? 'warn danger-text' : 'warn'}>
            {settings?.encryptExport === false
              ? '未加密导出的是明文会话 cookie，等同于登录凭证，请勿分享或上传。'
              : '导出用 AES-GCM-256 加密（PBKDF2-SHA256 派生密钥）。密码丢失无法恢复。'}
          </p>
          </section>
        )}
        <div className="entry-pair">
          <button className="entry" onClick={() => void chrome.runtime.openOptionsPage()}>
            设置
            <span className="arrow">→</span>
          </button>
          <button className="entry" onClick={openUsage}>
            用量总览
            <span className="arrow">→</span>
          </button>
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="selectbar">
          <label className="selectall">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={busy !== null}
            />
            {selected.size > 0
              ? `已选 ${selected.size} / ${accounts.length}`
              : `${accounts.length} 个账号`}
          </label>
          <div className="selectbar-actions">
            <button
              className="mini"
              disabled={busy !== null || selected.size === 0}
              onClick={() => exportAccounts([...selected], '所选')}
            >
              导出所选
            </button>
            <button
              className="mini ghost danger"
              disabled={busy !== null || selected.size === 0}
              onClick={forgetSelected}
            >
              删除所选
            </button>
          </div>
        </div>
      )}

      <section className="list">
        {accounts.length === 0 && (
          <p className="empty">
            还没有记录任何账号。登录一次 claude.ai 后点上面的「保存当前会话」，
            或展开「导入导出」恢复备份。
          </p>
        )}
        {accounts.map((account) => {
          const usable = account.cookies.length > 0 && !account.sessionInvalid
          const isCurrent = state?.matchedAccountId === account.id
          return (
            <div key={account.id} className={`row${isCurrent ? ' current-row' : ''}`}>
              <input
                type="checkbox"
                className="pick"
                checked={selected.has(account.id)}
                onChange={() => toggleOne(account.id)}
                disabled={busy !== null}
                aria-label={`选择 ${account.email || account.id}`}
              />
              <span className="avatar">{initials(account)}</span>
              <div className="meta">
                <span className="email">
                  {account.note || account.email || account.displayName || '未命名账号'}
                </span>
                <span className="hint">
                  {account.note && account.email ? `${account.email} · ` : ''}
                  {isCurrent
                    ? '正在使用'
                    : usable
                      ? `会话可用 · ${relative(account.lastUsedAt)}`
                      : '仅记录邮箱'}
                </span>
                {account.billingAnchor && (
                  <span className="hint billing">
                    {describeRenewal(account.billingAnchor, account.billingPlatform)}
                  </span>
                )}
              </div>
              <div className="row-actions">
                {!isCurrent && (
                  <button
                    className="mini"
                    disabled={busy !== null || !usable}
                    title={usable ? '用保存的会话切换' : '没有可用会话，去登录页会自动填邮箱'}
                    onClick={() => void switchTo(account)}
                  >
                    {busy === account.id ? '…' : '切换'}
                  </button>
                )}
                <button
                  className="mini ghost"
                  disabled={busy !== null}
                  onClick={() => rename(account)}
                >
                  备注
                </button>
                <button
                  className="mini ghost"
                  disabled={busy !== null}
                  title="下次续订日与渠道"
                  onClick={() => setBillingFor(billingFor === account.id ? null : account.id)}
                >
                  订阅
                </button>
                <button
                  className="mini ghost danger"
                  disabled={busy !== null}
                  onClick={() => void forget(account)}
                >
                  删除
                </button>
              </div>

              {billingFor === account.id && (
                <BillingEditor
                  account={account}
                  disabled={busy !== null}
                  onSave={(anchor, platform) => void saveBilling(account, anchor, platform)}
                  onCancel={() => setBillingFor(null)}
                />
              )}
            </div>
          )
        })}
      </section>

    </div>
  )
}
