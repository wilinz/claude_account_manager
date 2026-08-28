import { LANG_SETTINGS, t, type LangSetting } from '@/i18n'
import { isBillingPlatform, isValidAnchor } from '@/lib/billing'
import {
  Account,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  ExportBundle,
  ImportResult,
  ImportStrategy,
  Settings,
  TransferParts,
  StoredCookie,
  DEFAULT_SETTINGS,
} from '@/types'



/** 按勾选把不导出的字段摘掉。摘的是键本身，留个 undefined 的话导入端会拿它盖掉现有值 */
export function stripAccount(account: Account, parts: TransferParts): Account {
  const copy: Account = { ...account }
  if (!parts.cookies) {
    copy.cookies = []
    copy.sessionUpdatedAt = 0
    delete copy.sessionInvalid
  }
  if (!parts.billing) {
    delete copy.billingAnchor
    delete copy.billingPlatform
  }
  return copy
}

/**
 * 账号里带着订阅信息（billingAnchor / billingPlatform，见 sanitizeAccount），
 * 设置单独放一份，换机器时一个文件全带走。带哪几类由 parts 决定。
 */
export function buildBundle(
  accounts: Account[],
  settings: Settings | undefined,
  parts: TransferParts,
): ExportBundle {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    warning: t().transfer.fileWarning,
    accounts: accounts.map((a) => stripAccount(a, parts)),
    settings: parts.settings ? settings : undefined,
  }
}

/**
 * 设置同样是用户给的文件里来的，逐项按类型收。
 * 认不出的键直接丢掉，缺的键用默认值补 —— 旧文件和新版本之间要能互相容忍。
 */
function sanitizeSettings(raw: unknown): Settings | undefined {
  if (!isRecord(raw)) return undefined
  const next = { ...DEFAULT_SETTINGS }
  let hit = false
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    // language 是唯一的非布尔项，单独收；其余全是开关
    if (key === 'language') {
      const value = raw[key]
      if (LANG_SETTINGS.includes(value as LangSetting)) {
        next.language = value as LangSetting
        hit = true
      }
      continue
    }
    if (typeof raw[key] === 'boolean') {
      next[key] = raw[key] as boolean
      hit = true
    }
  }
  return hit ? next : undefined
}

export function bundleFileName(count: number, encrypted = false): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return `claude-accounts-${count}-${stamp}${encrypted ? '.enc' : ''}.json`
}

/* ------------------------------------------------------------------ */
/* 校验：导入的文件是用户给的，任何字段都不能直接信                    */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeCookie(raw: unknown): StoredCookie | null {
  if (!isRecord(raw)) return null
  const { name, value, domain, path } = raw
  if (typeof name !== 'string' || !name) return null
  if (typeof value !== 'string') return null
  if (typeof domain !== 'string' || !domain) return null
  // 只接受 claude.ai 的 cookie，别让一个导入文件往任意站点写凭证
  if (!/(^|\.)claude\.ai$/.test(domain.replace(/^\./, ''))) return null

  const sameSite = raw.sameSite
  return {
    name,
    value,
    domain,
    path: typeof path === 'string' && path ? path : '/',
    secure: raw.secure === true,
    httpOnly: raw.httpOnly === true,
    sameSite:
      sameSite === 'lax' || sameSite === 'strict' || sameSite === 'no_restriction'
        ? sameSite
        : 'unspecified',
    hostOnly: raw.hostOnly === true,
    session: raw.session === true,
    expirationDate:
      typeof raw.expirationDate === 'number' && Number.isFinite(raw.expirationDate)
        ? raw.expirationDate
        : undefined,
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function sanitizeAccount(raw: unknown): Account | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  const email = typeof raw.email === 'string' ? raw.email : ''
  if (!id) return null
  // 既没有 id 语义也没有邮箱的条目没有意义
  if (!email && !str(raw.uuid) && !str(raw.orgUuid)) return null

  const cookies = Array.isArray(raw.cookies)
    ? raw.cookies.map(sanitizeCookie).filter((c): c is StoredCookie => c !== null)
    : []

  const now = Date.now()
  return {
    id,
    email,
    displayName: str(raw.displayName),
    uuid: str(raw.uuid),
    orgUuid: str(raw.orgUuid),
    note: str(raw.note),
    cookies,
    sessionUpdatedAt: num(raw.sessionUpdatedAt, 0),
    lastUsedAt: num(raw.lastUsedAt, 0),
    createdAt: num(raw.createdAt, now),
    sessionInvalid: raw.sessionInvalid === true,
    loginMethod: str(raw.loginMethod),
    billingAnchor: isValidAnchor(raw.billingAnchor) ? raw.billingAnchor : undefined,
    billingPlatform: isBillingPlatform(raw.billingPlatform) ? raw.billingPlatform : undefined,
  }
}

/** 解析导入文件；结构不对时抛出可直接展示给用户的错误 */
export function parseBundle(raw: unknown): {
  accounts: Account[]
  invalid: number
  settings?: Settings
} {
  if (!isRecord(raw)) throw new Error(t().transfer.notObject)

  // 兼容直接给一个账号数组的情况
  const list = Array.isArray(raw) ? raw : raw.accounts
  if (!Array.isArray(list)) {
    throw new Error(t().transfer.noAccountsArray)
  }
  if (raw.format !== undefined && raw.format !== EXPORT_FORMAT) {
    throw new Error(t().transfer.unknownFormat(String(raw.format)))
  }

  const accounts: Account[] = []
  let invalid = 0
  for (const item of list) {
    const account = sanitizeAccount(item)
    if (account) accounts.push(account)
    else invalid += 1
  }
  if (accounts.length === 0) throw new Error(t().transfer.noValidAccounts)
  return { accounts, invalid, settings: sanitizeSettings(raw.settings) }
}

/** 把导入的账号并进现有列表，返回新列表与统计 */
export function mergeAccounts(
  existing: Account[],
  incoming: Account[],
  strategy: ImportStrategy,
  parts: TransferParts,
): { accounts: Account[]; result: Omit<ImportResult, 'invalid'> } {
  const base = strategy === 'replace' ? [] : existing
  const byId = new Map(base.map((a) => [a.id, a]))
  let added = 0
  let updated = 0
  let skipped = 0

  for (const raw of incoming) {
    // 没勾的类别在进入合并之前就摘掉，后面一律按「文件里没有这项」处理
    const incomingAccount = stripAccount(raw, parts)
    const current = byId.get(incomingAccount.id)
    if (!current) {
      byId.set(incomingAccount.id, incomingAccount)
      added += 1
      continue
    }
    // merge 策略下，导入的会话不比本地新就不动，避免用旧快照覆盖可用会话。
    // 没勾会话时这条不适用 —— 那次导入根本不碰 cookie，不该因为快照旧就整条跳过，
    // 否则订阅信息和备注也跟着进不来。
    if (
      strategy === 'merge' &&
      parts.cookies &&
      incomingAccount.sessionUpdatedAt <= current.sessionUpdatedAt
    ) {
      skipped += 1
      continue
    }

    const merged: Account = {
      ...current,
      ...incomingAccount,
      note: incomingAccount.note ?? current.note,
      createdAt: Math.min(current.createdAt, incomingAccount.createdAt),
      lastUsedAt: Math.max(current.lastUsedAt, incomingAccount.lastUsedAt),
    }
    // 没勾的类别保留本地原值，别被空壳盖掉
    if (!parts.cookies) {
      merged.cookies = current.cookies
      merged.sessionUpdatedAt = current.sessionUpdatedAt
      merged.sessionInvalid = current.sessionInvalid
    }
    if (!parts.billing) {
      merged.billingAnchor = current.billingAnchor
      merged.billingPlatform = current.billingPlatform
    }
    byId.set(incomingAccount.id, merged)
    updated += 1
  }

  return {
    accounts: [...byId.values()],
    result: { added, updated, skipped, settingsApplied: false },
  }
}
