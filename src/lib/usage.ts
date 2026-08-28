import { t } from '@/i18n'
import { StoredCookie, UsageSnapshot, UsageWindow } from '@/types'

/**
 * 读取账号用量。
 *
 * 关键约束：不能为了看一眼用量就把浏览器的会话换掉。
 * 所以这里不动 cookie 罐，改用 declarativeNetRequest 在请求发出的瞬间
 * 把 Cookie 请求头换成目标账号的那一份 —— 只影响扩展自己发的这一个请求。
 */

export type UsageResult =
  | { kind: 'ok'; usage: UsageSnapshot }
  | { kind: 'unauthorized' }
  /** 接口答得好好的，只是这个账号没有配额可言 —— 免费版就是这样，不算错 */
  | { kind: 'no-quota' }
  | { kind: 'unreachable'; detail: string }

/** 抓包确认过的用量接口；需要组织 uuid */
const USAGE_ENDPOINT = 'https://claude.ai/api/organizations/{org}/usage'
const ACCOUNT_ENDPOINT = 'https://claude.ai/api/account'

/* ------------------------------------------------------------------ */
/* 解析                                                                */
/* ------------------------------------------------------------------ */

/**
 * 响应长这样（只列用得上的字段）：
 *
 *   {
 *     "five_hour":  { "utilization": 100.0, "resets_at": "…", "used_dollars": null, … },
 *     "seven_day":  { "utilization": 55.0,  "resets_at": "…", … },
 *     "seven_day_opus": null,
 *     "limits": [
 *       { "kind": "session",    "percent": 100, "severity": "critical", "resets_at": "…" },
 *       { "kind": "weekly_all", "percent": 55,  "severity": "normal",   "resets_at": "…" }
 *     ],
 *     "extra_usage": { "is_enabled": false, "used_credits": null, "monthly_limit": null, … }
 *   }
 *
 * `limits` 是页面自己用的规范化视图，优先用它：字段干净、还带服务端判定的告警等级。
 * 顶层那些具名窗口只在 limits 缺失时兜底 —— 它们里面混着一堆内部代号
 * （nimbus_quill、iguana_necktie 之类），照单全收会显示成一堆看不懂的标签。
 */

interface RawWindow {
  utilization?: number | null
  resets_at?: string | null
  used_dollars?: number | null
  limit_dollars?: number | null
}

interface RawLimit {
  kind?: string
  percent?: number | null
  severity?: string | null
  resets_at?: string | null
}

interface RawUsage {
  limits?: RawLimit[] | null
  extra_usage?: {
    is_enabled?: boolean
    used_credits?: number | null
    monthly_limit?: number | null
    utilization?: number | null
  } | null
  [key: string]: unknown
}

/**
 * limits[].kind -> 词表里的窗口键。
 * 存键而不是存翻译好的文案：用量结果会进缓存，存死了文案就会跟着语言过期。
 */
const LIMIT_LABELS: Record<string, string> = {
  session: 'five_hour',
  weekly_all: 'seven_day',
  weekly_opus: 'seven_day_opus',
  weekly_sonnet: 'seven_day_sonnet',
  weekly_cowork: 'seven_day_cowork',
}

/** limits[].kind -> 顶层具名窗口的键，用来把美元额度接回去 */
const LIMIT_TO_WINDOW: Record<string, string> = {
  session: 'five_hour',
  weekly_all: 'seven_day',
  weekly_opus: 'seven_day_opus',
  weekly_sonnet: 'seven_day_sonnet',
  weekly_cowork: 'seven_day_cowork',
}

/** limits 缺失时的兜底窗口，只认这几个已知的 */
const FALLBACK_WINDOWS: [string, string][] = [
  ['five_hour', 'five_hour'],
  ['seven_day', 'seven_day'],
  ['seven_day_opus', 'seven_day_opus'],
  ['seven_day_sonnet', 'seven_day_sonnet'],
  ['seven_day_cowork', 'seven_day_cowork'],
]

function severityOf(value: unknown): UsageWindow['severity'] {
  return value === 'critical' || value === 'warning' || value === 'normal' ? value : undefined
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function ratio(percent: unknown): number | undefined {
  // 服务端给的是 0–100
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return undefined
  return Math.max(0, Math.min(1, percent / 100))
}

function dollars(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function windowAt(payload: RawUsage, key: string | undefined): RawWindow | undefined {
  if (!key) return undefined
  const value = payload[key]
  return value && typeof value === 'object' ? (value as RawWindow) : undefined
}

export function parseUsage(payload: unknown): UsageWindow[] {
  if (!payload || typeof payload !== 'object') return []
  const raw = payload as RawUsage
  const windows: UsageWindow[] = []

  if (Array.isArray(raw.limits) && raw.limits.length > 0) {
    for (const limit of raw.limits) {
      const utilization = ratio(limit.percent)
      if (utilization === undefined) continue
      const kind = limit.kind ?? ''
      const named = windowAt(raw, LIMIT_TO_WINDOW[kind])
      windows.push({
        label: LIMIT_LABELS[kind] ?? kind,
        utilization,
        resetsAt: timestamp(limit.resets_at) ?? timestamp(named?.resets_at),
        severity: severityOf(limit.severity),
        usedDollars: dollars(named?.used_dollars),
        limitDollars: dollars(named?.limit_dollars),
      })
    }
  } else {
    for (const [key, label] of FALLBACK_WINDOWS) {
      const named = windowAt(raw, key)
      const utilization = ratio(named?.utilization)
      if (utilization === undefined) continue
      windows.push({
        label,
        utilization,
        resetsAt: timestamp(named?.resets_at),
        usedDollars: dollars(named?.used_dollars),
        limitDollars: dollars(named?.limit_dollars),
      })
    }
  }

  // 额外用量（超出套餐后的按量计费）没开就不显示，开了才是有意义的一行
  const extra = raw.extra_usage
  if (extra?.is_enabled) {
    const utilization = ratio(extra.utilization) ?? 0
    windows.push({
      label: 'extra',
      utilization,
      usedDollars: dollars(extra.used_credits),
      limitDollars: dollars(extra.monthly_limit),
    })
  }

  return windows
}

/* ------------------------------------------------------------------ */
/* 用指定账号的 cookie 发请求                                          */
/* ------------------------------------------------------------------ */

/** DNR 规则 id。只用这一个，用完即删，不会和别的规则打架 */
const COOKIE_RULE_ID = 9001

function cookieHeader(cookies: StoredCookie[]): string {
  return cookies
    .filter((c) => c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
}

/**
 * 装上一条只作用于「扩展自己发出的 claude.ai 请求」的改写规则。
 *
 * tabIds: [-1] 是关键：它把规则限定在不属于任何标签页的请求上，也就是 service worker
 * 发的那些。页面自己的请求 tabId >= 0，绝不会被这条规则碰到。
 */
async function withAccountCookies<T>(cookies: StoredCookie[], run: () => Promise<T>): Promise<T> {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [COOKIE_RULE_ID],
    addRules: [
      {
        id: COOKIE_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'cookie', operation: 'set', value: cookieHeader(cookies) }],
        },
        condition: {
          urlFilter: '||claude.ai/api/',
          resourceTypes: ['xmlhttprequest'],
          tabIds: [chrome.tabs.TAB_ID_NONE],
        },
      },
    ],
  })
  try {
    return await run()
  } finally {
    await chrome.declarativeNetRequest
      .updateSessionRules({ removeRuleIds: [COOKIE_RULE_ID] })
      .catch(() => undefined)
  }
}

const REQUEST_TIMEOUT_MS = 10_000

type Fetched =
  | { kind: 'ok'; data: unknown }
  | { kind: 'unauthorized' }
  | { kind: 'unreachable'; detail: string }

async function getJson(url: string): Promise<Fetched> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      // 浏览器自己的 cookie 一律不要带，全靠 DNR 写进去的那一份
      credentials: 'omit',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (res.status === 401 || res.status === 403) return { kind: 'unauthorized' }
    if (!res.ok) return { kind: 'unreachable', detail: `HTTP ${res.status}` }
    try {
      return { kind: 'ok', data: await res.json() }
    } catch {
      return { kind: 'unreachable', detail: t().net.notJson }
    }
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    return { kind: 'unreachable', detail: aborted ? t().net.timeout : t().net.networkError }
  } finally {
    clearTimeout(timer)
  }
}

/** 老账号记录里可能没存 orgUuid，用这份 cookie 现问一次 */
async function resolveOrgUuid(): Promise<string | undefined> {
  const account = await getJson(ACCOUNT_ENDPOINT)
  if (account.kind !== 'ok') return undefined
  const memberships = (account.data as { memberships?: { organization?: { uuid?: string } }[] })
    ?.memberships
  return memberships?.[0]?.organization?.uuid
}

/**
 * 拿一个账号的用量。整个过程不碰浏览器里的当前会话。
 */
export async function fetchUsageFor(
  cookies: StoredCookie[],
  orgUuid: string | undefined,
): Promise<UsageResult> {
  if (cookies.length === 0) return { kind: 'unauthorized' }

  return withAccountCookies(cookies, async () => {
    const org = orgUuid ?? (await resolveOrgUuid())
    if (!org) return { kind: 'unauthorized' as const }

    const result = await getJson(USAGE_ENDPOINT.replace('{org}', org))
    if (result.kind !== 'ok') return result

    const windows = parseUsage(result.data)
    if (windows.length === 0) return { kind: 'no-quota' as const }
    return {
      kind: 'ok' as const,
      usage: {
        fetchedAt: Date.now(),
        source: USAGE_ENDPOINT.replace('{org}', org),
        windows,
        raw: result.data,
      },
    }
  })
}
