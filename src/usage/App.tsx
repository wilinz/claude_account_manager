import { useCallback, useEffect, useState } from 'react'
import type { Strings } from '@/i18n'
import { usePageChrome, useStrings } from '@/i18n/react'
import { describeRenewal } from '@/lib/billing'
import { send } from '@/lib/messaging'
import { AccountUsage, UsageWindow } from '@/types'

function label(row: AccountUsage): string {
  return row.note || row.email || row.displayName || row.accountId
}

function initials(row: AccountUsage): string {
  return (label(row).trim()[0] ?? '?').toUpperCase()
}

/** 用量文案：按额度计费的套餐给美元数，否则给百分比 */
function amount(window: UsageWindow): string {
  const pct = `${Math.round(window.utilization * 100)}%`
  if (window.usedDollars !== undefined) {
    const limit = window.limitDollars !== undefined ? ` / $${window.limitDollars}` : ''
    return `$${window.usedDollars}${limit} · ${pct}`
  }
  return pct
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 「多久之前」。缓存刚写下时说「刚刚」，别显示成 0 分钟前 */
function ago(at: number, s: Strings): string {
  const diff = Date.now() - at
  if (diff < MINUTE) return s.common.justNow
  if (diff < HOUR) return s.common.minutesAgo(Math.floor(diff / MINUTE))
  if (diff < DAY) return s.common.hoursAgo(Math.floor(diff / HOUR))
  return s.common.daysAgo(Math.floor(diff / DAY))
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 绝对时刻。今明两天用「今天 / 明天」，更远的带上日期 */
function clock(at: number, s: Strings): string {
  const date = new Date(at)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const days = Math.floor((at - startOfToday.getTime()) / DAY)

  if (days === 0) return s.usage.today(time)
  if (days === 1) return s.usage.tomorrow(time)
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`
}

/**
 * 距离重置还有多久。
 * 取两级单位（3 小时 12 分钟），只给一级的话「3 小时后」可能实际是 3 小时 59 分，
 * 差出来的将近一小时正是你要不要现在开一轮的依据。
 */
function countdown(diff: number, s: Strings): string {
  if (diff < MINUTE) return s.usage.lessThanMinute
  if (diff < HOUR) return s.usage.minutes(Math.floor(diff / MINUTE))
  if (diff < DAY) {
    return s.usage.hours(Math.floor(diff / HOUR), Math.floor((diff % HOUR) / MINUTE))
  }
  return s.usage.days(Math.floor(diff / DAY), Math.floor((diff % DAY) / HOUR))
}

/** 已经过了就说「即将重置」，避免显示负数 */
function untilReset(resetsAt: number | undefined, s: Strings): string | null {
  if (!resetsAt) return null
  const diff = resetsAt - Date.now()
  if (diff <= 0) return s.usage.resettingSoon
  return s.usage.resetIn(countdown(diff, s), clock(resetsAt, s))
}

/** 颜色优先听服务端的 severity，它比拍脑袋的阈值准；没给才退回阈值 */
function tone(usageWindow: UsageWindow): string {
  if (usageWindow.severity === 'critical') return ' danger'
  if (usageWindow.severity === 'warning') return ' warn'
  if (usageWindow.severity === 'normal') return ''
  if (usageWindow.utilization >= 0.95) return ' danger'
  if (usageWindow.utilization >= 0.8) return ' warn'
  return ''
}

function Bar({ window: usageWindow, s }: { window: UsageWindow; s: Strings }) {
  // label 存的是词表键；旧缓存里可能还是当时那份已翻译的文案，认不出就原样显示
  const name = s.usage.windows[usageWindow.label] ?? usageWindow.label
  const reset = untilReset(usageWindow.resetsAt, s)
  return (
    <div className="window">
      <div className="window-head">
        <span className="window-label">{name}</span>
        <span className="window-amount">{amount(usageWindow)}</span>
      </div>
      <div className="bar">
        <div
          className={`bar-fill${tone(usageWindow)}`}
          style={{ width: `${usageWindow.utilization * 100}%` }}
        />
      </div>
      {reset && (
        <span
          className="window-reset"
          title={usageWindow.resetsAt ? new Date(usageWindow.resetsAt).toLocaleString() : undefined}
        >
          {reset}
        </span>
      )}
    </div>
  )
}

export function App() {
  const s = useStrings()
  usePageChrome(`${s.common.extName} — ${s.usage.title}`)
  const [rows, setRows] = useState<AccountUsage[] | null>(null)
  /** 当前显示的数据是哪一刻查的；null 表示还没有任何数据 */
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  // 页面可能开着放很久，倒计时得自己走，不然显示的是打开那一刻的数
  const [, tick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setRows(await send({ type: 'FETCH_ALL_USAGE' }))
      setFetchedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : s.usage.queryFailed)
    } finally {
      setBusy(false)
    }
  }, [s])

  // 先把上次的结果铺上去，再在后台刷新 —— 打开页面不该先看几秒空白
  useEffect(() => {
    let stale = false
    void (async () => {
      const cached = await send({ type: 'GET_CACHED_USAGE' }).catch(() => null)
      // 真实结果可能已经先回来了，别用旧数据把它盖掉
      if (cached && !stale) {
        setRows((current) => current ?? cached.rows)
        setFetchedAt((current) => current ?? cached.fetchedAt)
      }
    })()
    void load()
    return () => {
      stale = true
    }
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  const withUsage = rows?.filter((r) => r.usage) ?? []

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>{s.usage.title}</h1>
          <p className="sub">{s.usage.sub}</p>
          <p className="status">
            {fetchedAt && <span>{s.usage.fetchedAt(ago(fetchedAt, s))}</span>}
            {busy && rows !== null && <span className="spin">{s.usage.refreshing}</span>}
          </p>
        </div>
        <button className="primary" disabled={busy} onClick={() => void load()}>
          {busy ? s.usage.querying : s.usage.refresh}
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      {rows === null && !error && <p className="empty">{s.usage.loadingAll}</p>}
      {rows !== null && rows.length === 0 && <p className="empty">{s.usage.empty}</p>}

      <div className="grid">
        {rows?.map((row) => (
          <section key={row.accountId} className={`card${row.error ? ' muted' : ''}`}>
            <div className="card-head">
              <span className="avatar">{initials(row)}</span>
              <span className="who">
                <span className="name">{label(row)}</span>
                {row.note && row.email && <span className="mail">{row.email}</span>}
                {row.billingAnchor && (
                  <span className="billing">
                    {describeRenewal(row.billingAnchor, row.billingPlatform)}
                  </span>
                )}
              </span>
            </div>

            {row.usage ? (
              <>
                <div className="windows">
                  {row.usage.windows.map((w, i) => (
                    <Bar key={`${w.label}-${i}`} window={w} s={s} />
                  ))}
                </div>
                <button
                  className="link"
                  onClick={() => setExpanded(expanded === row.accountId ? null : row.accountId)}
                >
                  {expanded === row.accountId ? s.usage.rawCollapse : s.usage.raw}
                </button>
                {expanded === row.accountId && (
                  <pre className="raw">
                    {row.usage.source}
                    {'\n\n'}
                    {JSON.stringify(row.usage.raw, null, 2)}
                  </pre>
                )}
              </>
            ) : (
              <p className="reason">{row.error}</p>
            )}
          </section>
        ))}
      </div>

      {rows !== null && rows.length > 0 && withUsage.length === 0 && (
        <p className="empty">
          {s.usage.allFailed}
          <code>chrome://extensions</code>
          {s.usage.allFailedTail}
        </p>
      )}
    </div>
  )
}
