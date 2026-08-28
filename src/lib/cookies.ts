import { StoredCookie } from '@/types'

/** claude.ai 会话相关的 cookie 都挂在这个域（含子域）下 */
export const COOKIE_DOMAIN = 'claude.ai'

/** 判定「已登录」的关键 cookie */
export const SESSION_COOKIE = 'sessionKey'

function cookieUrl(c: { domain: string; path: string; secure: boolean }): string {
  const host = c.domain.replace(/^\./, '')
  return `${c.secure ? 'https' : 'http'}://${host}${c.path}`
}

function toStored(c: chrome.cookies.Cookie): StoredCookie {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    hostOnly: c.hostOnly,
    session: c.session,
    expirationDate: c.expirationDate,
    storeId: c.storeId,
  }
}

/** 读取 claude.ai 域下的全部 cookie */
export async function captureCookies(): Promise<StoredCookie[]> {
  const cookies = await chrome.cookies.getAll({ domain: COOKIE_DOMAIN })
  return cookies.map(toStored)
}

export function hasSession(cookies: StoredCookie[]): boolean {
  return cookies.some((c) => c.name === SESSION_COOKIE && c.value.length > 0)
}

/** 当前浏览器是否持有 claude.ai 会话 */
export async function hasLiveSession(): Promise<boolean> {
  const c = await chrome.cookies.get({ url: 'https://claude.ai/', name: SESSION_COOKIE })
  return !!c?.value
}

/** 清空 claude.ai 域下的全部 cookie */
export async function clearCookies(): Promise<void> {
  const cookies = await chrome.cookies.getAll({ domain: COOKIE_DOMAIN })
  await Promise.all(
    cookies.map((c) =>
      chrome.cookies
        .remove({ url: cookieUrl(c), name: c.name, storeId: c.storeId })
        .catch(() => undefined),
    ),
  )
}

/**
 * 写回一份 cookie 快照。
 * 逐条 set，单条失败（例如过期的 __Secure- cookie）不影响其余的，
 * 返回失败的 cookie 名字供调用方判断是否算切换成功。
 */
export async function restoreCookies(cookies: StoredCookie[]): Promise<string[]> {
  const failed: string[] = []
  for (const c of cookies) {
    // 已过期的持久化 cookie 直接跳过，写进去也会被 Chrome 立刻丢弃
    if (!c.session && c.expirationDate !== undefined && c.expirationDate * 1000 <= Date.now()) {
      continue
    }
    const details: chrome.cookies.SetDetails = {
      url: cookieUrl(c),
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      storeId: c.storeId,
    }
    // hostOnly 的 cookie 必须省略 domain，否则会变成可被子域读取的域 cookie
    if (!c.hostOnly) details.domain = c.domain
    if (!c.session && c.expirationDate !== undefined) details.expirationDate = c.expirationDate

    try {
      const result = await chrome.cookies.set(details)
      if (!result) failed.push(c.name)
    } catch {
      failed.push(c.name)
    }
  }
  return failed
}
