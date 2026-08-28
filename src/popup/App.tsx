import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BILLING_PLATFORMS,
  BillingPlatform,
  describeRenewal,
  formatDate,
  platformLabel,
  platformRuleNote,
  ruleMatters,
} from '@/lib/billing'
import { decryptBundle, encryptBundle, isEncryptedBundle } from '@/lib/crypto'
import { send } from '@/lib/messaging'
import { bundleFileName } from '@/lib/transfer'
import type { Strings } from '@/i18n'
import { usePageChrome, useStrings } from '@/i18n/react'
import {
  Account,
  ALL_TRANSFER_PARTS,
  CurrentState,
  ImportStrategy,
  Settings,
  TransferParts,
} from '@/types'

const STRATEGIES: ImportStrategy[] = ['merge', 'overwrite', 'replace']

function initials(account: Account): string {
  const source = account.note || account.displayName || account.email
  return (source.trim()[0] ?? '?').toUpperCase()
}

function relative(ts: number, s: Strings): string {
  if (!ts) return s.common.never
  const diff = Date.now() - ts
  const minute = 60_000
  if (diff < minute) return s.common.justNow
  if (diff < 60 * minute) return s.common.minutesAgo(Math.floor(diff / minute))
  if (diff < 24 * 60 * minute) return s.common.hoursAgo(Math.floor(diff / (60 * minute)))
  return s.common.daysAgo(Math.floor(diff / (24 * 60 * minute)))
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

const PART_KEYS: (keyof TransferParts)[] = ['cookies', 'billing', 'settings']

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
  const s = useStrings()
  const [parts, setParts] = useState<TransferParts>(pending.available)
  // 策略跟着这次导入走，关掉面板就没了 —— 不该是个记在外面的全局开关
  const [strategy, setStrategy] = useState<ImportStrategy>('merge')
  const nothing = !parts.cookies && !parts.billing && !parts.settings

  return (
    <div className="sheet" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sheet-card" role="dialog" aria-label={s.popup.sheet.aria}>
        <p className="sheet-title">
          {pending.kind === 'export'
            ? s.popup.sheet.exportTitle(pending.label)
            : s.popup.sheet.importTitle}
        </p>
        <p className="sheet-sub">
          {pending.kind === 'export'
            ? s.popup.sheet.exportSub
            : s.popup.sheet.importSub(pending.label)}
          {pending.exportedAt &&
            s.popup.sheet.exportedAt(new Date(pending.exportedAt).toLocaleString())}
        </p>

        {PART_KEYS.map((key) => {
          const usable = pending.available[key]
          const item = s.popup.parts[key]
          return (
            <label key={key} className={usable ? 'sheet-item' : 'sheet-item off'}>
              <input
                type="checkbox"
                checked={usable && parts[key]}
                disabled={!usable}
                onChange={(e) => setParts((p) => ({ ...p, [key]: e.target.checked }))}
              />
              <span>
                <span className="sheet-item-title">{item.title}</span>
                <span className="sheet-item-desc">
                  {usable ? item.desc : s.popup.sheet.missing}
                </span>
              </span>
            </label>
          )
        })}

        {pending.kind === 'import' && (
          <label className="sheet-strategy">
            <span className="sheet-item-title">{s.popup.sheet.strategyLabel}</span>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value as ImportStrategy)}>
              {STRATEGIES.map((key) => (
                <option key={key} value={key}>
                  {s.popup.strategy[key]}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="sheet-actions">
          <button className="mini ghost" onClick={onCancel}>
            {s.common.cancel}
          </button>
          <button
            className="mini primary"
            disabled={nothing}
            onClick={() => {
              // 清空本地记录是不可逆的，问一次再走
              if (
                pending.kind === 'import' &&
                strategy === 'replace' &&
                !window.confirm(s.popup.sheet.replaceConfirm)
              ) {
                return
              }
              onCancel()
              void pending.run(parts, strategy)
            }}
          >
            {nothing
              ? s.popup.sheet.atLeastOne
              : pending.kind === 'export'
                ? s.popup.sheet.doExport
                : s.popup.sheet.doImport}
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
  const s = useStrings()
  const [date, setDate] = useState(
    account.billingAnchor ? formatDate(account.billingAnchor) : '',
  )
  const [platform, setPlatform] = useState<BillingPlatform>(account.billingPlatform ?? 'web')

  const parsed = date ? new Date(`${date}T00:00:00`) : null
  const anchor = parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : null

  return (
    <div className="billing-edit">
      <label className="billing-field">
        <span>{s.popup.billing.anchor}</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="billing-field">
        <span>{s.popup.billing.platform}</span>
        <select value={platform} onChange={(e) => setPlatform(e.target.value as BillingPlatform)}>
          {BILLING_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {platformLabel(p)}
            </option>
          ))}
        </select>
      </label>

      {/* 续订日 28 号及以前三家规则完全一致，没必要拿规则差异打扰用户 */}
      {anchor !== null && ruleMatters(anchor) && (
        <p className="billing-note">{platformRuleNote(platform)}</p>
      )}

      <p className="billing-note">{s.popup.billing.note}</p>

      <div className="billing-actions">
        <button
          className="mini"
          disabled={disabled || anchor === null}
          onClick={() => onSave(anchor, platform)}
        >
          {s.common.save}
        </button>
        <button
          className="mini ghost danger"
          disabled={disabled || !account.billingAnchor}
          onClick={() => onSave(null, null)}
        >
          {s.common.clear}
        </button>
        <button className="mini ghost" disabled={disabled} onClick={onCancel}>
          {s.common.cancel}
        </button>
      </div>
    </div>
  )
}

export function App() {
  const s = useStrings()
  usePageChrome(s.common.extName)
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
    void refresh().catch((e: unknown) => setMessage(e instanceof Error ? e.message : s.common.loadFailed))
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
      setMessage(error instanceof Error ? error.message : s.common.actionFailed)
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
      return res.saved
        ? s.popup.msg.saved(res.account?.email || s.common.currentAccount)
        : (res.reason ?? s.popup.msg.saveFailed)
    })

  const switchTo = (account: Account) =>
    run(account.id, async () => {
      const res = await send({ type: 'SWITCH_ACCOUNT', id: account.id })
      if (!res.ok) return res.reason ?? s.common.switchFailed
      // 没能向服务端确认时，含糊地说一句「已切换」会误导人
      return res.warning ?? s.popup.msg.switched(account.email || s.common.thisAccount)
    })

  const forget = (account: Account) =>
    run(account.id, async () => {
      await send({ type: 'FORGET_ACCOUNT', id: account.id })
      return s.popup.msg.deleted
    })

  const forgetSelected = () => {
    if (selectedAccounts.length === 0) return
    const names = selectedAccounts.map((a) => a.note || a.email || a.id).join('、')
    if (!window.confirm(s.popup.msg.deleteConfirm(selectedAccounts.length, names))) return
    void run('bulk', async () => {
      const res = await send({ type: 'FORGET_ACCOUNTS', ids: [...selected] })
      setSelected(new Set())
      return s.popup.msg.deletedN(res.removed)
    })
  }

  const saveBilling = (account: Account, anchor: number | null, platform: BillingPlatform | null) =>
    run(account.id, async () => {
      await send({ type: 'SET_BILLING', id: account.id, anchor, platform })
      setBillingFor(null)
      return anchor === null ? s.popup.billing.cleared : s.popup.billing.saved
    })

  const rename = (account: Account) => {
    const note = window.prompt(s.popup.msg.notePrompt, account.note ?? '')
    if (note === null) return
    void run(account.id, async () => {
      await send({ type: 'RENAME_ACCOUNT', id: account.id, note: note.trim() })
      return null
    })
  }

  const logout = () =>
    run('logout', async () => {
      await send({ type: 'LOGOUT_CURRENT' })
      return s.popup.msg.loggedOut
    })

  const addAccount = () => {
    // 会把浏览器变回未登录状态，说清楚这件事再动手
    if (
      state?.loggedIn &&
      !window.confirm(s.popup.msg.addConfirm)
    ) {
      return
    }
    void run('add', async () => {
      const res = await send({ type: 'ADD_ACCOUNT' })
      // 登录页已经打开了，弹窗留着也看不到
      window.close()
      return res.savedCurrent ? s.popup.msg.addSaved : s.popup.msg.addOpened
    })
  }

  /* ---------------- 导入 / 导出 ---------------- */

  /** ids 为空数组 = 导出全部 */
  const exportAccounts = (ids: string[], label: string) => {
    const encrypt = settings?.encryptExport ?? true
    const secret = password.trim()

    if (encrypt && !secret) {
      setMessage(s.popup.msg.needPassword)
      passwordRef.current?.focus()
      return
    }
    if (!encrypt && !window.confirm(s.popup.msg.plainConfirm)) {
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
      return s.popup.msg.exported(label, bundle.accounts.length, withSession, encrypt)
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
        throw new Error(s.popup.msg.badJson)
      }
      if (isEncryptedBundle(parsed)) {
        const secret =
          password.trim() || window.prompt(s.popup.msg.passwordPrompt)?.trim()
        if (!secret) throw new Error(s.popup.msg.needSecret)
        parsed = await decryptBundle(parsed, secret)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : s.popup.msg.readFailed)
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
      return s.popup.msg.imported(
        res.added,
        res.updated,
        res.skipped,
        res.invalid,
        res.settingsApplied,
      )
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
          <span>{s.popup.stale.text}</span>
          <button className="mini" onClick={() => chrome.runtime.reload()}>
            {s.popup.stale.reload}
          </button>
        </div>
      )}

      <header className="header">
        <div className="brand-row">
          <div className="brand">
            <span className="dot" />
            <span>{s.common.extName}</span>
          </div>
          <button className="open-site" title={s.popup.header.openSite} onClick={openClaude}>
            claude.ai <span className="arrow">↗</span>
          </button>
        </div>
        <p className="current">
          {state === null
            ? s.popup.header.loading
            : state.loggedIn
              ? s.popup.header.current(state.email || state.displayName || s.common.loggedIn)
              : s.popup.header.notLoggedIn}
        </p>
        {state?.loggedIn && settings && (
          <p className="current">
            {settings.autoCapture
              ? state.sessionUpdatedAt
                ? s.popup.header.autoSaved(relative(state.sessionUpdatedAt, s))
                : s.popup.header.notSavedYet
              : state.sessionUpdatedAt
                ? s.popup.header.autoOffWithSnapshot(relative(state.sessionUpdatedAt, s))
                : s.popup.header.autoOffNoSnapshot}
          </p>
        )}
      </header>

      <div className="actions">
        <button
          className="primary"
          title={s.popup.actions.addTitle}
          disabled={busy !== null}
          onClick={addAccount}
        >
          {s.popup.actions.add}
        </button>
        <button
          title={s.popup.actions.saveSessionTitle}
          disabled={busy !== null || !state?.loggedIn}
          onClick={() => void capture()}
        >
          {s.popup.actions.saveSession}
        </button>
        <button
          title={s.popup.actions.logoutTitle}
          disabled={busy !== null || !state?.loggedIn}
          onClick={() => void logout()}
        >
          {s.popup.actions.logout}
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
          {s.popup.transfer.section}
          <span className={transferOpen ? 'chevron open' : 'chevron'}>▾</span>
        </button>
        {transferOpen && (
          <section className="transfer">
          <div className="transfer-row">
            <button
              className="mini"
              disabled={busy !== null || accounts.length === 0}
              onClick={() => exportAccounts([], s.popup.transfer.all)}
            >
              {s.popup.transfer.exportAll}
            </button>
            <button
              className="mini"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
            >
              {s.popup.transfer.importBackup}
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
              {s.popup.transfer.encrypt}
            </label>
            <input
              ref={passwordRef}
              className="password"
              type="password"
              autoComplete="new-password"
              placeholder={
                settings?.encryptExport === false
                  ? s.popup.transfer.encryptOff
                  : s.popup.transfer.passwordPlaceholder
              }
              value={password}
              disabled={busy !== null || settings?.encryptExport === false}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <p className={settings?.encryptExport === false ? 'warn danger-text' : 'warn'}>
            {settings?.encryptExport === false
              ? s.popup.transfer.warnPlain
              : s.popup.transfer.warnEncrypted}
          </p>
          </section>
        )}
        <div className="entry-pair">
          <button className="entry" onClick={() => void chrome.runtime.openOptionsPage()}>
            {s.popup.transfer.settings}
            <span className="arrow">→</span>
          </button>
          <button className="entry" onClick={openUsage}>
            {s.popup.transfer.usage}
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
              ? s.popup.list.selectedOf(selected.size, accounts.length)
              : s.popup.list.count(accounts.length)}
          </label>
          <div className="selectbar-actions">
            <button
              className="mini"
              disabled={busy !== null || selected.size === 0}
              onClick={() => exportAccounts([...selected], s.popup.transfer.selected)}
            >
              {s.popup.list.exportSelected}
            </button>
            <button
              className="mini ghost danger"
              disabled={busy !== null || selected.size === 0}
              onClick={forgetSelected}
            >
              {s.popup.list.deleteSelected}
            </button>
          </div>
        </div>
      )}

      <section className="list">
        {accounts.length === 0 && (
          <p className="empty">{s.popup.list.empty}</p>
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
                aria-label={s.popup.list.selectAria(account.email || account.id)}
              />
              <span className="avatar">{initials(account)}</span>
              <div className="meta">
                <span className="email">
                  {account.note || account.email || account.displayName || s.common.unnamed}
                </span>
                <span className="hint">
                  {account.note && account.email ? `${account.email} · ` : ''}
                  {isCurrent
                    ? s.popup.list.inUse
                    : usable
                      ? s.popup.list.usable(relative(account.lastUsedAt, s))
                      : s.popup.list.emailOnly}
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
                    title={
                      usable ? s.popup.list.switchTitle : s.popup.list.switchTitleEmail
                    }
                    onClick={() => void switchTo(account)}
                  >
                    {busy === account.id ? '…' : s.common.switch}
                  </button>
                )}
                <button
                  className="mini ghost"
                  disabled={busy !== null}
                  onClick={() => rename(account)}
                >
                  {s.common.note}
                </button>
                <button
                  className="mini ghost"
                  disabled={busy !== null}
                  title={s.popup.list.billingTitle}
                  onClick={() => setBillingFor(billingFor === account.id ? null : account.id)}
                >
                  {s.common.subscription}
                </button>
                <button
                  className="mini ghost danger"
                  disabled={busy !== null}
                  onClick={() => void forget(account)}
                >
                  {s.common.delete}
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
