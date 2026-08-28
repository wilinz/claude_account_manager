import { emailFromOrgName, fetchIdentity, fetchIdentityDetailed, Identity } from '@/lib/claudeApi'
import {
  captureCookies,
  clearCookies,
  hasLiveSession,
  hasSession,
  restoreCookies,
  SESSION_COOKIE,
} from '@/lib/cookies'
import {
  getAccount,
  getSettings,
  getUsageCache,
  listAccounts,
  removeAccount,
  removeAccounts,
  saveAccounts,
  setSettings,
  setUsageCache,
  upsertAccount,
} from '@/lib/storage'
import { buildBundle, mergeAccounts, parseBundle } from '@/lib/transfer'
import { isBillingPlatform, isValidAnchor } from '@/lib/billing'
import { fetchUsageFor } from '@/lib/usage'
import {
  Account,
  AccountUsage,
  CurrentState,
  ImportStrategy,
  StoredCookie,
  TransferParts,
  Message,
  MessageResultMap,
  PromptPickerMessage,
  PurgeSiteDataMessage,
  Response,
} from '@/types'

const CLAUDE_TAB_FILTER = ['https://claude.ai/*', 'https://*.claude.ai/*']
const REFRESH_ALARM = 'refresh-session-snapshot'

/** 切换过程中挂起自动捕获，避免把「清空后的空会话」写进账号 */
let switching = false

const SWITCH_LOCK_KEY = 'switchLock'
/** 一次切换最多也就几秒，超过这个岁数的锁一定是没人收拾的遗留 */
const SWITCH_LOCK_TTL_MS = 30_000

/**
 * 锁同时写进 storage.session。
 * MV3 的 service worker 随时可能被回收，只靠内存变量的话，切到一半被回收 ->
 * 重启后锁没了 -> 自动捕获立刻把「清了一半的 cookie」当成新会话存进账号。
 */
async function setSwitching(on: boolean): Promise<void> {
  switching = on
  try {
    if (on) await chrome.storage.session.set({ [SWITCH_LOCK_KEY]: Date.now() })
    else await chrome.storage.session.remove(SWITCH_LOCK_KEY)
  } catch {
    // storage.session 不可用时退回纯内存语义，不该因此让切换失败
  }
}

async function isSwitching(): Promise<boolean> {
  if (switching) return true
  try {
    const raw = await chrome.storage.session.get(SWITCH_LOCK_KEY)
    const startedAt = raw[SWITCH_LOCK_KEY] as number | undefined
    if (!startedAt) return false
    if (Date.now() - startedAt > SWITCH_LOCK_TTL_MS) {
      await chrome.storage.session.remove(SWITCH_LOCK_KEY)
      return false
    }
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* 账号身份                                                            */
/* ------------------------------------------------------------------ */

/** 身份 -> 稳定主键。uuid 最可靠，其次邮箱，最后组织 uuid 兜底 */
function identityId(identity: Identity): string {
  if (identity.uuid) return identity.uuid
  if (identity.email) return `email:${identity.email.toLowerCase()}`
  if (identity.orgUuid) return `org:${identity.orgUuid}`
  return `anon:${Date.now()}`
}

/** 邮箱当主键时的 id，用于「只记录邮箱」的账号与真实会话账号合并 */
function emailId(email: string): string {
  return `email:${email.toLowerCase()}`
}

/**
 * 把仅有邮箱的占位账号并入拿到 uuid 的真实账号。
 * 登录页记下邮箱 -> 登录成功后拿到 uuid，两条记录必须合成一条。
 */
async function mergeEmailPlaceholder(realId: string, email: string): Promise<void> {
  if (!email) return
  const placeholderId = emailId(email)
  if (placeholderId === realId) return
  const accounts = await listAccounts()
  const placeholder = accounts.find((a) => a.id === placeholderId)
  if (!placeholder) return
  const real = accounts.find((a) => a.id === realId)
  if (!real) return
  real.note = real.note ?? placeholder.note
  real.createdAt = Math.min(real.createdAt, placeholder.createdAt)
  await saveAccounts(accounts.filter((a) => a.id !== placeholderId))
}

/* ------------------------------------------------------------------ */
/* 捕获与切换                                                          */
/* ------------------------------------------------------------------ */

/** 把当前浏览器里的 claude.ai 会话存进对应账号 */
async function captureCurrent(): Promise<MessageResultMap['CAPTURE_CURRENT']> {
  if (await isSwitching()) return { saved: false, reason: '正在切换账号' }
  if (!(await hasLiveSession())) return { saved: false, reason: '当前未登录 claude.ai' }

  const identity = await fetchIdentity()
  if (!identity) return { saved: false, reason: '会话已失效或无法读取账号信息' }

  const cookies = await captureCookies()
  if (!hasSession(cookies)) return { saved: false, reason: `未找到 ${SESSION_COOKIE}` }

  const id = identityId(identity)
  const now = Date.now()
  const account = await upsertAccount(id, {
    email: identity.email,
    displayName: identity.displayName,
    uuid: identity.uuid,
    orgUuid: identity.orgUuid,
    cookies,
    sessionUpdatedAt: now,
    lastUsedAt: now,
    sessionInvalid: false,
  })
  await mergeEmailPlaceholder(id, identity.email)
  await updateBadge()
  return { saved: true, account }
}

/** 用某个账号的 cookie 快照替换当前会话 */
async function switchAccount(id: string): Promise<MessageResultMap['SWITCH_ACCOUNT']> {
  const target = await getAccount(id)
  if (!target) return { ok: false, reason: '账号不存在' }
  if (!hasSession(target.cookies)) {
    return { ok: false, reason: '该账号没有保存会话，请用邮箱重新登录一次' }
  }

  const settings = await getSettings()
  await setSwitching(true)
  let warning: string | undefined

  // 出错时用它把浏览器恢复原状，不至于把用户留在半登出状态
  const previousCookies = await captureCookies()

  try {
    // 先把当前会话存好，否则切走之后就找不回来了
    await captureCurrentUnlocked()

    await clearCookies()
    const failed = await restoreCookies(target.cookies)
    console.info(
      `[switch] 写回 ${target.cookies.length - failed.length}/${target.cookies.length} 个 cookie`,
      failed.length ? `失败：${failed.join(', ')}` : '',
    )
    if (failed.includes(SESSION_COOKIE)) {
      await rollback(previousCookies)
      return { ok: false, reason: `会话 cookie 写入失败（${failed.join('、')}），已恢复原会话` }
    }

    // 用服务端校验这份会话是否还有效
    const verified = await fetchIdentityDetailed()

    if (verified.kind === 'unauthorized') {
      await markInvalid(id)
      const restored = await rollback(previousCookies)
      return {
        ok: false,
        reason:
          `cookie 写回成功（${target.cookies.length} 条），但服务端判定这个会话已失效。\n` +
          `快照时间：${new Date(target.sessionUpdatedAt).toLocaleString()}\n` +
          `最常见的原因是在 claude.ai 上点了「退出登录」—— 那会让服务端吊销这份会话，` +
          `保存的 cookie 就作废了。切换账号请直接用本扩展，或用弹窗里的「退出当前账号」（只清本地 cookie）。\n` +
          (restored
            ? `已恢复切换前的状态，这个账号需要重新登录一次。`
            : `注意：切换前的会话也没能恢复，现在是未登录状态，需要重新登录。`),
      }
    }

    if (verified.kind === 'ok') {
      const identity = verified.identity
      await upsertAccount(id, {
        email: identity.email || target.email,
        displayName: identity.displayName ?? target.displayName,
        lastUsedAt: Date.now(),
        sessionInvalid: false,
      })
    } else {
      // 问不到 ≠ 失效。此时目标 cookie 已经写进去了，切换大概率是成功的，
      // 回滚反而会把用户莫名其妙地丢回上一个账号 —— 保留现状，把不确定性如实说出来。
      await upsertAccount(id, { email: target.email, lastUsedAt: Date.now() })
      warning =
        `已写入 ${target.email || '该账号'} 的会话，但没能连上 claude.ai 确认（${verified.detail}）。\n` +
        `没有回滚。刷新页面确认一下；如果还是旧账号，重试一次即可。`
      console.warn('[switch] 无法校验目标会话，保留不回滚：', verified.detail)
    }

    // cookie 换好之后再清页面里的账号缓存：残留的 rq-cache-confirmed-account /
    // __qk_hint_account_uuid 会让 SPA 拿上个账号的身份去打接口，403 后直接跳登录。
    // 必须等清理完成再刷新，否则页面会带着旧缓存重新加载。
    if (settings.clearSiteDataOnSwitch) await purgeSiteDataInTabs()
  } finally {
    await setSwitching(false)
  }

  if (settings.reloadTabsAfterSwitch) await reloadClaudeTabs()
  await updateBadge()
  return warning ? { ok: true, warning } : { ok: true }
}

/**
 * 切换失败时把之前的 cookie 放回去。
 * 返回是否真的恢复出了一份可用会话 —— 回滚自己也会失败，这时用户是彻底登出的，
 * 必须让他知道，而不是笼统地说一句「已恢复」。
 */
async function rollback(previousCookies: StoredCookie[]): Promise<boolean> {
  if (!hasSession(previousCookies)) return false
  await clearCookies()
  const failed = await restoreCookies(previousCookies)
  const ok = !failed.includes(SESSION_COOKIE) && (await hasLiveSession())
  console.info(ok ? '[switch] 已回滚到切换前的会话' : '[switch] 回滚失败，当前处于未登录状态')
  return ok
}

/** switchAccount 内部使用：跳过 switching 锁的捕获 */
async function captureCurrentUnlocked(): Promise<void> {
  await captureCurrentUnlockedResult()
}

async function captureCurrentUnlockedResult(): Promise<MessageResultMap['CAPTURE_CURRENT']> {
  const wasSwitching = switching
  await setSwitching(false)
  try {
    return await captureCurrent()
  } finally {
    await setSwitching(wasSwitching)
  }
}

async function markInvalid(id: string): Promise<void> {
  const account = await getAccount(id)
  if (account) await upsertAccount(id, { email: account.email, sessionInvalid: true })
}

async function logoutCurrent(): Promise<void> {
  const settings = await getSettings()
  await setSwitching(true)
  try {
    await captureCurrentUnlocked()
    await clearCookies()
    if (settings.clearSiteDataOnSwitch) await purgeSiteDataInTabs()
  } finally {
    await setSwitching(false)
  }
  await reloadClaudeTabs()
  await updateBadge()
}

/**
 * 让每个 claude.ai 标签页清掉账号相关的站点数据。
 * 清理必须在页面上下文里做才能精确保留设备绑定，所以交给 content script。
 * 一个都没开着也无所谓：下次打开时 content script 会自查并自愈。
 */
async function purgeSiteDataInTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: CLAUDE_TAB_FILTER })
  const message: PurgeSiteDataMessage = { type: 'PURGE_SITE_DATA' }
  await Promise.all(
    tabs.map((tab) =>
      tab.id
        ? chrome.tabs.sendMessage(tab.id, message).catch(() => undefined)
        : Promise.resolve(undefined),
    ),
  )
}

/**
 * 添加账号：把当前会话完整存好，再把浏览器变回未登录状态，然后打开登录页。
 *
 * 只清本地 cookie，绝不调用 claude.ai 的登出接口 —— 那会让服务端吊销会话，
 * 刚存下的快照就白存了，之后切不回来。
 */
async function addAccount(): Promise<MessageResultMap['ADD_ACCOUNT']> {
  const settings = await getSettings()
  let savedCurrent = false

  await setSwitching(true)
  try {
    const captured = await captureCurrentUnlockedResult()
    savedCurrent = captured.saved
    await clearCookies()
    if (settings.clearSiteDataOnSwitch) await purgeSiteDataInTabs()
  } finally {
    await setSwitching(false)
  }

  // 刚清空会话，这次跳转不用再弹「已保存的账号」——用户就是要加新的
  suppressPromptOnce = true
  await openLoginPage()
  await updateBadge()
  return { ok: true, savedCurrent }
}

/** 复用已有的 claude.ai 标签页去登录，没有就新开一个 */
async function openLoginPage(): Promise<void> {
  const url = 'https://claude.ai/login'
  const tabs = await chrome.tabs.query({ url: CLAUDE_TAB_FILTER })
  const [first, ...rest] = tabs
  if (first?.id) {
    await chrome.tabs.update(first.id, { url, active: true })
    if (first.windowId !== undefined) {
      await chrome.windows.update(first.windowId, { focused: true }).catch(() => undefined)
    }
  } else {
    await chrome.tabs.create({ url, active: true })
  }
  // 其余标签页还停在上个账号的界面上，刷掉
  await Promise.all(
    rest.map((tab) => (tab.id ? chrome.tabs.reload(tab.id).catch(() => undefined) : undefined)),
  )
}

async function reloadClaudeTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: CLAUDE_TAB_FILTER })
  await Promise.all(
    tabs.map((t) => (t.id ? chrome.tabs.reload(t.id).catch(() => undefined) : undefined)),
  )
}

/* ------------------------------------------------------------------ */
/* 退出登录拦截脚本                                                    */
/* ------------------------------------------------------------------ */

const LOGOUT_GUARD_SCRIPT_ID = 'claude-logout-guard'

/**
 * 把 public/logout-guard.js 注册成页面世界的 content script。
 *
 * 为什么不写在 manifest 里：打包器会把 manifest 声明的脚本换成一个 loader，
 * 由它在页面上下文里 import 真正的 chunk —— 而 claude.ai 的 CSP 是
 * `default-src 'none'; script-src 'nonce-…'`，那次 import 会被拦死，拦截就装不上。
 * 动态注册的脚本和 manifest 声明的一样由浏览器注入，不受页面 CSP 约束。
 */
async function registerLogoutGuard(): Promise<void> {
  const script: chrome.scripting.RegisteredContentScript = {
    id: LOGOUT_GUARD_SCRIPT_ID,
    matches: CLAUDE_TAB_FILTER,
    js: ['logout-guard.js'],
    runAt: 'document_start',
    allFrames: false,
    world: 'MAIN',
    persistAcrossSessions: true,
  }
  try {
    await chrome.scripting.registerContentScripts([script])
  } catch {
    // 已经注册过了（浏览器重启后会自己恢复），更新一次保证是最新版本
    await chrome.scripting.updateContentScripts([script]).catch((error: unknown) => {
      console.warn('[claude-account-switcher] 退出拦截脚本注册失败', error)
    })
  }
}

/* ------------------------------------------------------------------ */
/* 用量总览                                                            */
/* ------------------------------------------------------------------ */

/**
 * 依次查询每个账号的用量。
 *
 * 串行是有意的：cookie 改写靠的是一条全局 DNR 规则，并发会互相踩到
 * —— 两个请求同时在飞，谁的 cookie 生效就说不准了。
 */
async function fetchAllUsage(): Promise<AccountUsage[]> {
  // 先把当前会话存好，免得总览里显示的是过期快照。必须赶在上锁之前
  await captureCurrent().catch(() => undefined)

  const accounts = await listAccounts()
  const results: AccountUsage[] = []

  // 整个扫描期间挂起自动捕获。
  // cookie 改写规则挡的是「不属于任何标签页的请求」—— 后台自己的 fetchIdentity
  // 同样落在这个范围里，不挡住的话，captureCurrent 会拿被探测账号的身份去存
  // 当前浏览器的 cookie，直接把账号数据写串。
  await setSwitching(true)
  try {
    for (const account of accounts) {
      // 锁有 30 秒的过期兜底，账号多了会扫超时，每轮续一次
      await setSwitching(true)

      const base = {
        accountId: account.id,
        email: account.email,
        note: account.note,
        displayName: account.displayName,
        billingAnchor: account.billingAnchor,
        billingPlatform: account.billingPlatform,
      }

      if (!hasSession(account.cookies)) {
        results.push({ ...base, error: '没有保存会话' })
        continue
      }
      if (account.sessionInvalid) {
        results.push({ ...base, error: '会话已失效，需要重新登录' })
        continue
      }

      const result = await fetchUsageFor(account.cookies, account.orgUuid)
      if (result.kind === 'ok') {
        results.push({ ...base, usage: result.usage })
      } else if (result.kind === 'unauthorized') {
        // 服务端不认这份会话，顺手标记，省得下次还拿它去切换
        await markInvalid(account.id)
        results.push({ ...base, error: '会话已失效，需要重新登录' })
      } else if (result.kind === 'no-quota') {
        results.push({ ...base, error: '没有配额数据（免费账号）' })
      } else {
        results.push({ ...base, error: `拿不到用量（${result.detail}）` })
      }
    }
  } finally {
    await setSwitching(false)
  }

  // 存下来，下次打开页面先拿它顶上
  await setUsageCache(results).catch(() => undefined)
  return results
}

/* ------------------------------------------------------------------ */
/* 导入 / 导出                                                         */
/* ------------------------------------------------------------------ */

/** ids 为空表示导出全部 */
async function exportAccounts(
  ids: string[],
  parts: TransferParts,
): Promise<MessageResultMap['EXPORT_ACCOUNTS']> {
  // 导出前先把当前会话落盘，否则刚登录的账号会导出成空快照
  await captureCurrent().catch(() => undefined)

  const all = await listAccounts()
  const selected = ids.length === 0 ? all : all.filter((a) => ids.includes(a.id))
  if (selected.length === 0) throw new Error('没有选中任何账号')
  // 订阅信息挂在账号上，跟着账号走；设置是全局的，单独带一份
  return buildBundle(selected, await getSettings(), parts)
}

async function importAccounts(
  raw: unknown,
  strategy: ImportStrategy,
  parts: TransferParts,
): Promise<MessageResultMap['IMPORT_ACCOUNTS']> {
  const { accounts: incoming, invalid, settings } = parseBundle(raw)
  const existing = await listAccounts()
  const { accounts, result } = mergeAccounts(existing, incoming, strategy, parts)
  await saveAccounts(accounts)
  // 勾了设置、且文件里确实有，才覆盖当前设置
  const applySettings = parts.settings && settings !== undefined
  if (applySettings) await setSettings(settings)
  await updateBadge()
  return { ...result, invalid, settingsApplied: applySettings }
}

/* ------------------------------------------------------------------ */
/* 当前状态 / 角标                                                     */
/* ------------------------------------------------------------------ */

async function getState(): Promise<CurrentState> {
  if (!(await hasLiveSession())) return { loggedIn: false }
  const identity = await fetchIdentity()
  if (!identity) return { loggedIn: false }
  const id = identityId(identity)
  const known = await getAccount(id)
  return {
    loggedIn: true,
    email: identity.email || known?.email,
    uuid: identity.uuid,
    displayName: identity.displayName ?? known?.displayName,
    orgUuid: identity.orgUuid,
    matchedAccountId: known?.id,
    sessionUpdatedAt: known?.sessionUpdatedAt ?? 0,
  }
}

async function updateBadge(): Promise<void> {
  const state = await getState().catch(() => ({ loggedIn: false }) as CurrentState)
  const label = state.email || state.displayName
  await chrome.action.setTitle({
    title: label ? `Claude 账号切换器 — ${label}` : 'Claude 账号切换器 — 未登录',
  })
  await chrome.action.setBadgeBackgroundColor({ color: '#c96442' })
  await chrome.action.setBadgeText({ text: state.loggedIn ? '' : '!' })
}

/* ------------------------------------------------------------------ */
/* 自动弹出选择面板                                                    */
/* ------------------------------------------------------------------ */

/** 同一个标签页的重复弹窗节流，SPA 导航不该反复打扰用户 */
const lastPromptAt = new Map<number, number>()
const PROMPT_COOLDOWN_MS = 60_000

/** 添加账号时刚清空会话，这一次导航不该再弹已存账号 */
let suppressPromptOnce = false

async function maybePromptPicker(tabId: number): Promise<void> {
  if (await isSwitching()) return
  if (suppressPromptOnce) {
    suppressPromptOnce = false
    return
  }
  const last = lastPromptAt.get(tabId) ?? 0
  if (Date.now() - last < PROMPT_COOLDOWN_MS) return
  const settings = await getSettings()
  if (!settings.autoPrompt) return
  if (await hasLiveSession()) return

  const accounts = await listAccounts()
  if (accounts.length === 0) return

  lastPromptAt.set(tabId, Date.now())
  const message: PromptPickerMessage = { type: 'PROMPT_PICKER', accounts }
  chrome.tabs.sendMessage(tabId, message).catch(() => undefined)
}

chrome.tabs.onRemoved.addListener((tabId) => lastPromptAt.delete(tabId))

/* ------------------------------------------------------------------ */
/* 事件绑定                                                            */
/* ------------------------------------------------------------------ */

let captureTimer: ReturnType<typeof setTimeout> | undefined

/** 自动触发的保存，受设置开关控制；手动保存与切换前的保存不走这里 */
async function autoCapture(): Promise<void> {
  const settings = await getSettings()
  if (!settings.autoCapture) return
  await captureCurrent()
}

function scheduleCapture(delay = 1500): void {
  if (captureTimer) clearTimeout(captureTimer)
  captureTimer = setTimeout(() => {
    captureTimer = undefined
    autoCapture().catch(() => undefined)
  }, delay)
}

// sessionKey 变动 = 登录 / 登出 / 会话续期，都值得重新快照
chrome.cookies.onChanged.addListener((info) => {
  if (info.cookie.name !== SESSION_COOKIE) return
  if (!info.cookie.domain.includes('claude.ai')) return
  if (switching) return
  if (info.removed) {
    updateBadge().catch(() => undefined)
    return
  }
  scheduleCapture()
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return
  if (!tab.url?.startsWith('https://claude.ai')) return
  scheduleCapture(800)
  maybePromptPicker(tabId).catch(() => undefined)
})

/**
 * 老版本用 /api/organizations 兜底存下的账号邮箱是空的，
 * 但组织名里带着邮箱（"x@y.com's Organization"），启动时补回去。
 */
async function backfillEmails(): Promise<void> {
  const accounts = await listAccounts()
  let changed = false
  for (const account of accounts) {
    if (account.email) continue
    const email = emailFromOrgName(account.displayName)
    if (!email) continue
    account.email = email
    changed = true
  }
  if (changed) await saveAccounts(accounts)
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 30 })
  backfillEmails().catch(() => undefined)
  updateBadge().catch(() => undefined)
  registerLogoutGuard().catch(() => undefined)
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 30 })
  backfillEmails().catch(() => undefined)
  updateBadge().catch(() => undefined)
  registerLogoutGuard().catch(() => undefined)
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) autoCapture().catch(() => undefined)
})

/* ------------------------------------------------------------------ */
/* 消息路由                                                            */
/* ------------------------------------------------------------------ */

async function handle(message: Message): Promise<unknown> {
  switch (message.type) {
    case 'PING':
      return { buildId: __BUILD_ID__ }
    case 'GET_STATE':
      return getState()
    case 'LIST_ACCOUNTS':
      return listAccounts()
    case 'CAPTURE_CURRENT':
      return captureCurrent()
    case 'SWITCH_ACCOUNT':
      return switchAccount(message.id)
    case 'FORGET_ACCOUNT':
      await removeAccount(message.id)
      return { ok: true }
    case 'FORGET_ACCOUNTS':
      return { removed: await removeAccounts(message.ids) }
    case 'EXPORT_ACCOUNTS':
      return exportAccounts(message.ids, message.parts)
    case 'IMPORT_ACCOUNTS':
      return importAccounts(message.bundle, message.strategy, message.parts)
    case 'RENAME_ACCOUNT': {
      const account = await getAccount(message.id)
      if (!account) return { ok: false }
      await upsertAccount(message.id, { email: account.email, note: message.note })
      return { ok: true }
    }
    case 'SET_BILLING': {
      const account = await getAccount(message.id)
      if (!account) return { ok: false }
      if (message.anchor !== null && !isValidAnchor(message.anchor)) return { ok: false }
      if (message.platform !== null && !isBillingPlatform(message.platform)) return { ok: false }
      await upsertAccount(message.id, {
        email: account.email,
        billingAnchor: message.anchor ?? undefined,
        billingPlatform: message.platform ?? undefined,
      })
      return { ok: true }
    }
    case 'LOGOUT_CURRENT':
      await logoutCurrent()
      return { ok: true }
    case 'INVALIDATE_CURRENT': {
      // 用户选择了向服务端注销：会话马上会被吊销，保存的快照跟着作废。
      // 现在标好，免得之后拿一份必定失败的 cookie 去切换。
      const state = await getState()
      if (!state.matchedAccountId) return { ok: false, email: state.email }
      await markInvalid(state.matchedAccountId)
      await updateBadge()
      return { ok: true, email: state.email }
    }
    case 'ADD_ACCOUNT':
      return addAccount()
    case 'FETCH_ALL_USAGE':
      return fetchAllUsage()
    case 'GET_CACHED_USAGE':
      return getUsageCache()
    case 'GET_SETTINGS':
      return getSettings()
    case 'SET_SETTINGS':
      return setSettings(message.patch)
    case 'REMEMBER_LOGIN_METHOD': {
      const method = message.method.trim()
      if (!method) return { ok: false }
      const state = await getState()
      if (!state.matchedAccountId) return { ok: false }
      const account = await getAccount(state.matchedAccountId)
      if (!account || account.loginMethod === method) return { ok: false }
      await upsertAccount(account.id, { email: account.email, loginMethod: method })
      return { ok: true }
    }
    case 'REMEMBER_EMAIL': {
      const email = message.email.trim()
      if (!email) return { ok: false }
      const id = emailId(email)
      const existing = (await listAccounts()).find(
        (a) => a.email.toLowerCase() === email.toLowerCase(),
      )
      if (existing) {
        await upsertAccount(existing.id, { email: existing.email, lastUsedAt: Date.now() })
      } else {
        await upsertAccount(id, { email, lastUsedAt: Date.now() })
      }
      return { ok: true }
    }
  }

  /*
   * 走到这里说明来了个 switch 不认识的类型。
   *
   * 以前这里是直接掉出去返回 undefined，被监听器包成 { ok: true }，调用方
   * 于是弹一个「已保存」然后什么都没发生 —— 开发时改完没重新加载扩展，
   * service worker 还跑着旧代码，新加的消息类型就是这个下场，而且毫无征兆。
   * 宁可炸出来。
   *
   * message 在这里被收窄成 never：漏写一个 case 会直接编译不过。
   */
  const unknown: never = message
  throw new Error(
    `后台不认识这个消息类型：${(unknown as Message).type}。` +
      `多半是扩展代码更新了但没重新加载，去 chrome://extensions 点一下刷新。`,
  )
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handle(message)
    .then((data) => sendResponse({ ok: true, data } satisfies Response<unknown>))
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies Response<never>),
    )
  return true
})

export type { Account }
