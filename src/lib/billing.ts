/**
 * 订阅续订日推算。
 *
 * ── 存的是「平台显示的续订日」，不是「购买日期」──────────────────────
 *
 * 从购买时间反推续订日这条路走不通：平台按账单地址所在时区算，不是按你的本地时区。
 * 实测一例：Google Play 下单时间 8/17 02:50（UTC+8），Play 里显示 9/16 续订；
 * 该账号账单地址在俄勒冈，也就是太平洋时间 —— 8/16 11:50 PDT，正好落在 16 号。
 * 要复现这个推算，就得知道每个账号的账单地址时区，那不是这个扩展该管的事。
 *
 * 所以不推：让用户照抄平台里已经显示出来的那个续订日期 —— 那是平台自己算完、
 * 时区已经解析完的结果。往后每个月按它的日号推即可：时区偏移已经一次性烘进锚点，
 * 平台内部同样是按自己的日历每月加一个月、日号不变，两边始终对齐。
 * 万一平台挪了锚点（扣款失败后在宽限期外恢复就会），重填一次即可。
 *
 * ── 短月规则（续订日 29/30/31 号，遇到 2 月怎么办）─────────────────────
 *
 * 三家各有官方说明，而且不是同一套：
 *
 *   官网（Stripe）  锚点保留。1/31 → 2/28 → **3/31** → 4/30 → 5/31。
 *                   短月只是那一次落到月末，锚点不动。
 *
 *   App Store       锚点保留，同上。App Store Connect Help 原文：
 *                   「the trial ends on the last day of the next month, and
 *                    reverts to the original date the next time that date occurs.
 *                    For example, if someone subscribes on January 30, the next
 *                    renewal date is February 28 (or February 29 in a leap year),
 *                    and then March 30.」
 *
 *   Google Play     锚点永久下移。1/31 → 2/28 → **3/28** → 4/28 …
 *                   官方原文：「continues to renew on the 28th of each month
 *                   for the duration of the subscription」。
 *                   另一个例子：3/31 起订 → 4/30 → 之后固定 30 号。
 *
 * 续订日在 28 号及以前时三套规则完全一致，也就没有任何不确定性 ——
 * 界面上只在 29 号及以后才提示。
 */

export type BillingPlatform = 'web' | 'ios' | 'android'

/** preserve = 锚点保留（Stripe）；ratchet = 锚点永久下移（Google Play） */
type ShortMonthRule = 'preserve' | 'ratchet'

export const BILLING_PLATFORMS: BillingPlatform[] = ['web', 'ios', 'android']

export const PLATFORM_LABELS: Record<BillingPlatform, string> = {
  web: '官网',
  ios: 'App Store',
  android: 'Google Play',
}

const PLATFORM_RULES: Record<BillingPlatform, ShortMonthRule> = {
  web: 'preserve',
  ios: 'preserve',
  android: 'ratchet',
}

/** 这个平台的短月规则是不是有官方文档背书 */
export const PLATFORM_RULE_DOCUMENTED: Record<BillingPlatform, boolean> = {
  web: true,
  ios: true,
  android: true,
}

export const PLATFORM_RULE_NOTES: Record<BillingPlatform, string> = {
  web: '短月落到月末，下个月回到原日号（Stripe 官方文档）',
  ios: '短月落到月末，下个月回到原日号（App Store Connect Help）',
  android: '短月下移后不再回弹，之后固定在新日号（Google Play 官方文档）',
}

const DAY_MS = 24 * 60 * 60 * 1000
/** 防呆：锚点离谱地早时别把循环跑飞 */
const MAX_MONTHS = 1200

export function isBillingPlatform(value: unknown): value is BillingPlatform {
  return value === 'web' || value === 'ios' || value === 'android'
}

export function isValidAnchor(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * 把日号夹到目标月真实存在的范围内。
 * 直接 new Date(2026, 1, 31) 会溢出成 3 月 3 号，必须先夹。
 */
function dateAt(day: number, year: number, month: number): Date {
  return new Date(year, month, Math.min(day, daysInMonth(year, month)))
}

/** 续订日的日号 */
export function anchorDay(anchorMs: number): number {
  return new Date(anchorMs).getDate()
}

/**
 * 走到目标年月时实际生效的日号。
 * preserve 规则下永远是原日号；ratchet 规则下要把沿途每个短月都碾一遍，
 * 因为每经过一个更短的月份，日号就再也回不去了。
 */
function effectiveDay(
  anchor: Date,
  year: number,
  month: number,
  rule: ShortMonthRule,
): number {
  const day = anchor.getDate()
  if (rule === 'preserve' || day <= 28) return day

  let current = day
  let y = anchor.getFullYear()
  let m = anchor.getMonth()
  for (let i = 0; i < MAX_MONTHS; i += 1) {
    if (y > year || (y === year && m >= month)) break
    m += 1
    if (m > 11) {
      m = 0
      y += 1
    }
    current = Math.min(current, daysInMonth(y, m))
  }
  return current
}

/**
 * 下一个续订日。
 * 今天正好是续订日就返回今天 —— 说「0 天后」比说「一个月后」有用。
 * 用户填的日期还没到就直接返回它 —— 那是平台的原话，不该被我们改写。
 */
export function nextRenewal(
  anchorMs: number,
  platform: BillingPlatform | undefined,
  from: Date = new Date(),
): Date {
  const today = startOfDay(from)
  const anchor = startOfDay(new Date(anchorMs))
  if (anchor > today) return anchor

  const rule = PLATFORM_RULES[platform ?? 'web']
  const y = today.getFullYear()
  const m = today.getMonth()

  const candidate = dateAt(effectiveDay(anchor, y, m, rule), y, m)
  if (candidate >= today) return candidate

  const nextYear = m === 11 ? y + 1 : y
  const nextMonth = (m + 1) % 12
  return dateAt(effectiveDay(anchor, nextYear, nextMonth, rule), nextYear, nextMonth)
}

/** 距离下一个续订日还有几天，今天就是续订日则为 0 */
export function daysUntilRenewal(
  anchorMs: number,
  platform: BillingPlatform | undefined,
  from: Date = new Date(),
): number {
  const next = nextRenewal(anchorMs, platform, from)
  return Math.round((next.getTime() - startOfDay(from).getTime()) / DAY_MS)
}

/** 续订日 29 号及以后，三家规则才会分叉，也才需要提示 */
export function ruleMatters(anchorMs: number): boolean {
  return anchorDay(anchorMs) >= 29
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 「App Store · 3 月 28 日续订 · 还有 12 天」 */
export function describeRenewal(
  anchorMs: number,
  platform: BillingPlatform | undefined,
  from: Date = new Date(),
): string {
  const next = nextRenewal(anchorMs, platform, from)
  const days = daysUntilRenewal(anchorMs, platform, from)
  const when = days === 0 ? '今天续订' : days === 1 ? '明天续订' : `还有 ${days} 天`
  const where = platform ? `${PLATFORM_LABELS[platform]} · ` : ''
  return `${where}${next.getMonth() + 1} 月 ${next.getDate()} 日续订 · ${when}`
}
