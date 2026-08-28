/** 从 claude.ai 服务端读取当前 cookie 对应的账号身份 */

/** fetchIdentityDetailed 的三态结果，unauthorized 才代表这份会话真的废了 */
export type IdentityResult =
  | { kind: 'ok'; identity: Identity }
  | { kind: 'unauthorized' }
  | { kind: 'unreachable'; detail: string }

export interface Identity {
  email: string
  uuid?: string
  displayName?: string
  orgUuid?: string
}

interface RawAccount {
  uuid?: string
  email_address?: string
  email?: string
  full_name?: string
  display_name?: string
  name?: string
}

function pickIdentity(account: RawAccount | undefined, orgUuid?: string): Identity | null {
  if (!account) return null
  const email = account.email_address ?? account.email
  if (!email) return null
  return {
    email,
    uuid: account.uuid,
    displayName: account.full_name ?? account.display_name ?? account.name,
    orgUuid,
  }
}

/** 从 "someone@example.com's Organization" 里取出邮箱 */
export function emailFromOrgName(name: string | undefined): string | null {
  if (!name) return null
  const match = /^([^\s@]+@[^\s@]+\.[^\s@]+)'s\s+Organization$/i.exec(name.trim())
  return match ? match[1] : null
}

/** 单次请求的超时。没有它，网络挂起会让整个切换卡死在这里 */
const REQUEST_TIMEOUT_MS = 8_000

/**
 * 一次取数的结果。关键在于把「服务端说这份会话不认」和「压根没问到」分开：
 * 前者才意味着快照失效，后者只是这一刻不通，不该拿去给账号判死刑。
 */
type Fetched =
  | { kind: 'ok'; data: unknown }
  | { kind: 'unauthorized' }
  | { kind: 'unreachable'; detail: string }

async function getJson(url: string): Promise<Fetched> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (res.status === 401 || res.status === 403) return { kind: 'unauthorized' }
    // 429 是限流，5xx 是服务端自己的问题，都跟会话有没有效无关
    if (!res.ok) return { kind: 'unreachable', detail: `HTTP ${res.status}` }
    try {
      return { kind: 'ok', data: await res.json() }
    } catch {
      // 200 但不是 JSON：多半是 Cloudflare 挑战页或登录页 HTML，不能当作失效
      return { kind: 'unreachable', detail: '响应不是 JSON' }
    }
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    return { kind: 'unreachable', detail: aborted ? `超时 ${REQUEST_TIMEOUT_MS}ms` : '网络错误' }
  } finally {
    clearTimeout(timer)
  }
}

type MembershipList = { organization?: { uuid?: string } }[]

/**
 * 返回当前会话的身份，并说明拿不到时到底是哪一种拿不到。
 *
 * 接口优先级：
 *   /api/account    —— 当前正确的账号接口，直接带 uuid + email_address + memberships
 *   /api/bootstrap  —— 同样带 account，但响应体很大（几百个 feature flag），只当备用
 *   /api/organizations —— 最后兜底，只能拿到组织 uuid
 *
 * 注意：/api/auth/current_account 已经下线（返回 404），不要再用。
 *
 * 只要有任何一个接口是「问不到」（超时 / 限流 / 5xx / Cloudflare 挑战页），
 * 结果就是 unreachable —— 宁可说不知道，也不要把一份好会话误判成失效。
 */
export async function fetchIdentityDetailed(): Promise<IdentityResult> {
  let unreachable: string | null = null

  const account = await getJson('https://claude.ai/api/account')
  if (account.kind === 'ok') {
    const raw = account.data as (RawAccount & { memberships?: MembershipList }) | null
    const identity = pickIdentity(raw ?? undefined, raw?.memberships?.[0]?.organization?.uuid)
    if (identity) return { kind: 'ok', identity }
  } else if (account.kind === 'unreachable') {
    unreachable = account.detail
  }

  const bootstrap = await getJson('https://claude.ai/api/bootstrap')
  if (bootstrap.kind === 'ok') {
    const raw = (bootstrap.data as { account?: RawAccount & { memberships?: MembershipList } } | null)
      ?.account
    const identity = pickIdentity(raw, raw?.memberships?.[0]?.organization?.uuid)
    if (identity) return { kind: 'ok', identity }
  } else if (bootstrap.kind === 'unreachable') {
    unreachable = unreachable ?? bootstrap.detail
  }

  const orgs = await getJson('https://claude.ai/api/organizations')
  if (orgs.kind === 'ok') {
    const list = orgs.data as { uuid?: string; name?: string }[] | null
    if (Array.isArray(list) && list.length > 0 && list[0].uuid) {
      // 拿不到邮箱时用组织 uuid 兜底，组织名通常是 "someone@example.com's Organization"，
      // 能从里面把邮箱抠出来就别让账号显示成「未命名」
      return {
        kind: 'ok',
        identity: {
          email: emailFromOrgName(list[0].name) ?? '',
          uuid: undefined,
          orgUuid: list[0].uuid,
          displayName: list[0].name,
        },
      }
    }
  } else if (orgs.kind === 'unreachable') {
    unreachable = unreachable ?? orgs.detail
  }

  return unreachable ? { kind: 'unreachable', detail: unreachable } : { kind: 'unauthorized' }
}

/** 只关心「拿没拿到」的调用方用这个 */
export async function fetchIdentity(): Promise<Identity | null> {
  const result = await fetchIdentityDetailed()
  return result.kind === 'ok' ? result.identity : null
}
