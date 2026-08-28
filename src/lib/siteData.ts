/**
 * 切换账号时必须连站点数据一起换掉。
 *
 * sessionKey 是 httpOnly cookie，凭证本身不在 localStorage 里；
 * 但 claude.ai 把「这份缓存属于哪个账号」写进了 localStorage
 * （rq-cache-confirmed-account / __qk_hint_account_uuid / ccd-sync-owner …），
 * 并把整份 react-query 缓存放在 IndexedDB 的 keyval-store 里。
 * 只换 cookie 不清这些，SPA 会带着上一个账号的身份去打接口，
 * 403 之后按未登录处理直接跳 /login —— 表现得就像切换失败。
 *
 * 这段代码跑在 content script 里（与页面同源，能直接操作页面的存储）。
 */

/**
 * 设备级身份，跨账号共用，清掉会破坏设备绑定与站点证明，必须保留。
 * claude-device-binding 存的是不可导出的设备密钥；x-ark-arid-* 是 CDN 侧的证明。
 */
const PRESERVE_DB_NAMES = ['claude-device-binding', 'x-ark-arid-db']
const PRESERVE_KEY_PREFIXES = ['x-ark-arid-', 'anthropic-device-', 'test.']

export interface PurgeReport {
  localStorage: number
  sessionStorage: number
  indexedDB: string[]
  caches: number
}

function shouldPreserveKey(key: string): boolean {
  return PRESERVE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/**
 * 用「保留白名单」而不是「清除黑名单」：
 * claude.ai 随时会加新的账号相关 key，白名单模式才不会漏。
 */
function purgeWebStorage(storage: Storage): number {
  const doomed = Object.keys(storage).filter((key) => !shouldPreserveKey(key))
  for (const key of doomed) {
    try {
      storage.removeItem(key)
    } catch {
      /* 个别 key 删不掉不影响其余的 */
    }
  }
  return doomed.length
}

/**
 * 清空对象仓库的内容而不是 deleteDatabase：
 * 页面还持有连接时 deleteDatabase 会一直 blocked，而 readwrite 事务照常工作。
 */
function clearDatabase(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: boolean) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    // 兜底超时，避免某个库卡住整个切换流程
    const timer = setTimeout(() => done(false), 2000)

    const request = indexedDB.open(name)
    request.onerror = () => {
      clearTimeout(timer)
      done(false)
    }
    request.onsuccess = () => {
      const db = request.result
      const stores = [...db.objectStoreNames]
      if (stores.length === 0) {
        db.close()
        clearTimeout(timer)
        done(true)
        return
      }
      try {
        const tx = db.transaction(stores, 'readwrite')
        for (const store of stores) tx.objectStore(store).clear()
        tx.oncomplete = () => {
          db.close()
          clearTimeout(timer)
          done(true)
        }
        tx.onerror = tx.onabort = () => {
          db.close()
          clearTimeout(timer)
          done(false)
        }
      } catch {
        db.close()
        clearTimeout(timer)
        done(false)
      }
    }
  })
}

async function purgeIndexedDb(): Promise<string[]> {
  if (!indexedDB.databases) return []
  let names: string[]
  try {
    names = (await indexedDB.databases()).map((d) => d.name).filter((n): n is string => !!n)
  } catch {
    return []
  }
  const targets = names.filter((name) => !PRESERVE_DB_NAMES.includes(name))
  const cleared = await Promise.all(
    targets.map(async (name) => ((await clearDatabase(name)) ? name : null)),
  )
  return cleared.filter((n): n is string => n !== null)
}

async function purgeCaches(): Promise<number> {
  if (typeof caches === 'undefined') return 0
  try {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
    return keys.length
  } catch {
    return 0
  }
}

/** 清除账号相关的站点数据，保留设备身份 */
export async function purgeAccountSiteData(): Promise<PurgeReport> {
  const local = purgeWebStorage(window.localStorage)
  const session = purgeWebStorage(window.sessionStorage)
  const [dbs, cacheCount] = await Promise.all([purgeIndexedDb(), purgeCaches()])
  return { localStorage: local, sessionStorage: session, indexedDB: dbs, caches: cacheCount }
}

/**
 * 页面里缓存的账号 uuid。切换后若和 cookie 对应的账号对不上，
 * 说明这个标签页带着上个账号的状态，需要就地清理。
 */
const OWNER_KEYS = ['rq-cache-confirmed-account', '__qk_hint_account_uuid', 'ccd-sync-owner']

export function cachedOwners(): string[] {
  const owners = new Set<string>()
  for (const key of OWNER_KEYS) {
    try {
      const value = window.localStorage.getItem(key)
      if (value) owners.add(value)
    } catch {
      /* 隐私模式下可能抛错 */
    }
  }
  return [...owners]
}
