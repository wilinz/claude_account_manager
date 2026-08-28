import { Account, AccountUsage, DEFAULT_SETTINGS, Settings, UsageCache } from '@/types'

const ACCOUNTS_KEY = 'accounts'
const SETTINGS_KEY = 'settings'
const USAGE_CACHE_KEY = 'usageCache'

export async function listAccounts(): Promise<Account[]> {
  const raw = await chrome.storage.local.get(ACCOUNTS_KEY)
  const accounts = (raw[ACCOUNTS_KEY] as Account[] | undefined) ?? []
  return accounts.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

export async function saveAccounts(accounts: Account[]): Promise<void> {
  await chrome.storage.local.set({ [ACCOUNTS_KEY]: accounts })
}

export async function getAccount(id: string): Promise<Account | undefined> {
  return (await listAccounts()).find((a) => a.id === id)
}

/**
 * 按 id 合并写入。已存在的账号只覆盖 patch 里出现的字段，
 * 这样「只捕获到邮箱」的更新不会抹掉已有的 cookie 快照。
 */
export async function upsertAccount(
  id: string,
  patch: Partial<Account> & { email: string },
): Promise<Account> {
  const accounts = await listAccounts()
  const now = Date.now()
  const idx = accounts.findIndex((a) => a.id === id)
  let next: Account
  if (idx >= 0) {
    next = { ...accounts[idx], ...patch, id }
    accounts[idx] = next
  } else {
    next = {
      cookies: [],
      sessionUpdatedAt: 0,
      lastUsedAt: now,
      createdAt: now,
      ...patch,
      id,
    }
    accounts.push(next)
  }
  await saveAccounts(accounts)
  return next
}

export async function removeAccount(id: string): Promise<void> {
  await removeAccounts([id])
}

/** 批量删除，返回实际删掉的条数 */
export async function removeAccounts(ids: string[]): Promise<number> {
  const target = new Set(ids)
  const accounts = await listAccounts()
  const next = accounts.filter((a) => !target.has(a.id))
  await saveAccounts(next)
  return accounts.length - next.length
}

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...((raw[SETTINGS_KEY] as Partial<Settings>) ?? {}) }
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  await chrome.storage.local.set({ [SETTINGS_KEY]: next })
  return next
}

/* ---------- 用量缓存 ---------- */

export async function getUsageCache(): Promise<UsageCache | null> {
  const raw = await chrome.storage.local.get(USAGE_CACHE_KEY)
  return (raw[USAGE_CACHE_KEY] as UsageCache | undefined) ?? null
}

export async function setUsageCache(rows: AccountUsage[]): Promise<void> {
  await chrome.storage.local.set({
    [USAGE_CACHE_KEY]: { fetchedAt: Date.now(), rows } satisfies UsageCache,
  })
}
