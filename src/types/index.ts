import type { BillingPlatform } from '@/lib/billing'
import type { LangSetting } from '@/i18n'

export type { BillingPlatform }

/** 一条被持久化的 cookie（chrome.cookies.Cookie 的可序列化子集） */
export interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: chrome.cookies.Cookie['sameSite']
  hostOnly: boolean
  session: boolean
  expirationDate?: number
  storeId?: string
}

/** 已记录的账号 */
export interface Account {
  /** 稳定主键：优先用服务端账号 uuid，退化时用邮箱 */
  id: string
  email: string
  displayName?: string
  uuid?: string
  /** 组织 uuid，切换后用于校验会话归属 */
  orgUuid?: string
  /** 该账号的完整 cookie 快照；为空表示只记录了邮箱（无可用会话） */
  cookies: StoredCookie[]
  /** 会话快照更新时间 */
  sessionUpdatedAt: number
  /** 最近一次被使用（切换或登录）的时间 */
  lastUsedAt: number
  createdAt: number
  /** 用户自定义备注，显示在列表里 */
  note?: string
  /** 上次探测到该会话已失效 */
  sessionInvalid?: boolean
  /** 登录方式，取自页面的 lastLoginMethod：google / apple / email … */
  loginMethod?: string
  /** 订阅起算日（首次订阅那天）的时间戳，用户自己填 */
  billingAnchor?: number
  /** 订阅渠道：官网 / App Store / Google Play，决定短月用哪套续订规则 */
  billingPlatform?: BillingPlatform
}

export interface Settings {
  /** 登录 / 会话变化时自动把当前会话存进对应账号。关掉后只能手动保存 */
  autoCapture: boolean
  /** 未登录时在 claude.ai 页面自动弹出账号选择面板 */
  autoPrompt: boolean
  /** 登录页自动把邮箱填进输入框（仅一个候选账号时直接填） */
  autoFillEmail: boolean
  /** 切换账号后自动刷新所有 claude.ai 标签页 */
  reloadTabsAfterSwitch: boolean
  /** 切换时清除 claude.ai 的 localStorage / IndexedDB / 缓存，避免带着上个账号的组织信息跳登录 */
  clearSiteDataOnSwitch: boolean
  /** 导出时默认加密。默认开启：备份里是明文登录凭证 */
  encryptExport: boolean
  /** 拦截 claude.ai 自身的「退出登录」，先问一句是注销还是只在本地退出 */
  interceptLogout: boolean
  /** 界面语言。'auto' = 跟浏览器的显示语言走 */
  language: LangSetting
}

export const DEFAULT_SETTINGS: Settings = {
  autoCapture: true,
  autoPrompt: true,
  autoFillEmail: true,
  reloadTabsAfterSwitch: true,
  clearSiteDataOnSwitch: true,
  encryptExport: true,
  interceptLogout: true,
  language: 'auto',
}

/** 当前浏览器里 claude.ai 的登录状态 */
export interface CurrentState {
  loggedIn: boolean
  email?: string
  uuid?: string
  displayName?: string
  orgUuid?: string
  /** 与已存账号匹配上的 id */
  matchedAccountId?: string
  /** 该账号上次被保存的时间，0 表示还没存过 */
  sessionUpdatedAt?: number
}

/* ---------- 导入 / 导出 ---------- */

export const EXPORT_FORMAT = 'claude-account-switcher'
export const EXPORT_VERSION = 1

/** 导出文件的结构 */
export interface ExportBundle {
  format: typeof EXPORT_FORMAT
  version: number
  exportedAt: number
  /** 提醒打开文件的人：里面是等价于登录凭证的明文会话 */
  warning: string
  accounts: Account[]
  /** 扩展设置。旧版本导出的文件没有这个字段，导入时按缺省处理 */
  settings?: Settings
}

/** 加密导出文件的结构；解密后得到的是一个 ExportBundle */
export interface EncryptedBundle {
  format: typeof EXPORT_FORMAT
  version: number
  encrypted: true
  exportedAt: number
  /** 不解密也能看出里面有几个账号，方便确认拿对了文件 */
  accountCount: number
  warning: string
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  cipher: { name: 'AES-GCM'; iv: string }
  /** base64 密文 */
  payload: string
}

/**
 * merge    同 id 只在导入的会话更新时才覆盖（默认，最安全）
 * overwrite 同 id 一律用导入的数据覆盖
 * replace  清空本地全部账号后再写入
 */
export type ImportStrategy = 'merge' | 'overwrite' | 'replace'

/**
 * 导入导出时勾选带哪几类数据。
 * 账号本身（邮箱、备注、身份）永远带，不然文件里什么都不剩。
 */
export interface TransferParts {
  /** 会话 cookie，也就是登录凭证本身 */
  cookies: boolean
  /** 每月续订日与订阅渠道 */
  billing: boolean
  /** 扩展设置 */
  settings: boolean
}

export const ALL_TRANSFER_PARTS: TransferParts = {
  cookies: true,
  billing: true,
  settings: true,
}

export interface ImportResult {
  added: number
  updated: number
  skipped: number
  invalid: number
  /** 文件里带了设置并且已经应用 */
  settingsApplied: boolean
}

/* ---------- 用量 ---------- */

/** 一个配额窗口，比如「5 小时会话」或「7 天」 */
export interface UsageWindow {
  /** 词表 usage.windows 里的键（five_hour / seven_day / extra …）。旧缓存里可能是已翻译的文案 */
  label: string
  /** 0–1 */
  utilization: number
  /** 配额重置时间，epoch ms */
  resetsAt?: number
  /** 服务端自己的告警等级，比阈值判断更准 */
  severity?: 'normal' | 'warning' | 'critical'
  /** 按额度计费的套餐才有 */
  usedDollars?: number
  limitDollars?: number
}

export interface UsageSnapshot {
  fetchedAt: number
  /** 命中的接口 */
  source: string
  windows: UsageWindow[]
  raw: unknown
}

/** 一个账号的用量查询结果 */
export interface AccountUsage {
  accountId: string
  email: string
  note?: string
  displayName?: string
  billingAnchor?: number
  billingPlatform?: BillingPlatform
  usage?: UsageSnapshot
  /** 拿不到时的原因，直接显示给用户 */
  error?: string
}

/** 上一次查询的结果，页面打开时先拿它顶上，别让人对着空白等 */
export interface UsageCache {
  fetchedAt: number
  rows: AccountUsage[]
}

/* ---------- 后台消息协议 ---------- */

export type Message =
  | { type: 'GET_STATE' }
  /** 探活 + 拿 service worker 的构建戳，用来发现它跑的是不是旧代码 */
  | { type: 'PING' }
  | { type: 'LIST_ACCOUNTS' }
  | { type: 'CAPTURE_CURRENT' }
  | { type: 'SWITCH_ACCOUNT'; id: string }
  | { type: 'FORGET_ACCOUNT'; id: string }
  | { type: 'FORGET_ACCOUNTS'; ids: string[] }
  | { type: 'EXPORT_ACCOUNTS'; ids: string[]; parts: TransferParts }
  | { type: 'IMPORT_ACCOUNTS'; bundle: unknown; strategy: ImportStrategy; parts: TransferParts }
  | { type: 'RENAME_ACCOUNT'; id: string; note: string }
  /** 设置订阅起算日与渠道；anchor 为 null 表示清除 */
  | { type: 'SET_BILLING'; id: string; anchor: number | null; platform: BillingPlatform | null }
  | { type: 'LOGOUT_CURRENT' }
  /** 用户执行了服务端注销：这份快照即将作废，先把当前账号标成失效 */
  | { type: 'INVALIDATE_CURRENT' }
  /** 保存当前会话后本地登出，并打开登录页去添加一个新账号 */
  | { type: 'ADD_ACCOUNT' }
  /** 逐个账号拉取用量，不影响浏览器里的当前会话 */
  | { type: 'FETCH_ALL_USAGE' }
  /** 读上一次的查询结果，不发任何网络请求 */
  | { type: 'GET_CACHED_USAGE' }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; patch: Partial<Settings> }
  /** content script -> background：登录页捕获到用户输入的邮箱 */
  | { type: 'REMEMBER_EMAIL'; email: string }
  /** content script -> background：页面里读到的登录方式，记到当前账号上 */
  | { type: 'REMEMBER_LOGIN_METHOD'; method: string }

export interface MessageResultMap {
  GET_STATE: CurrentState
  PING: { buildId: string }
  LIST_ACCOUNTS: Account[]
  CAPTURE_CURRENT: { saved: boolean; account?: Account; reason?: string }
  /** warning：切换已执行但没能向服务端确认，需要让用户自己核对一眼 */
  SWITCH_ACCOUNT: { ok: boolean; reason?: string; warning?: string }
  FORGET_ACCOUNT: { ok: boolean }
  FORGET_ACCOUNTS: { removed: number }
  EXPORT_ACCOUNTS: ExportBundle
  IMPORT_ACCOUNTS: ImportResult
  RENAME_ACCOUNT: { ok: boolean }
  SET_BILLING: { ok: boolean }
  LOGOUT_CURRENT: { ok: boolean }
  INVALIDATE_CURRENT: { ok: boolean; email?: string }
  ADD_ACCOUNT: { ok: boolean; savedCurrent: boolean }
  FETCH_ALL_USAGE: AccountUsage[]
  GET_CACHED_USAGE: UsageCache | null
  GET_SETTINGS: Settings
  SET_SETTINGS: Settings
  REMEMBER_EMAIL: { ok: boolean }
  REMEMBER_LOGIN_METHOD: { ok: boolean }
}

export type Response<T> = { ok: true; data: T } | { ok: false; error: string }

/** background -> content：让页面弹出账号选择面板 */
export interface PromptPickerMessage {
  type: 'PROMPT_PICKER'
  accounts: Account[]
}

/** background -> content：就地清除账号相关的站点数据（保留设备身份） */
export interface PurgeSiteDataMessage {
  type: 'PURGE_SITE_DATA'
}

export type TabMessage = PromptPickerMessage | PurgeSiteDataMessage

/* ---------- 退出登录拦截（MAIN world <-> content script） ---------- */

/** 页面世界注入脚本的标识，收消息时用来筛掉无关的 postMessage */
export const LOGOUT_GUARD_SOURCE = 'claude-account-switcher:guard'
export const LOGOUT_HOST_SOURCE = 'claude-account-switcher:host'

/**
 * pass   放行原请求 —— 服务端会吊销这份会话
 * local  不发请求，改由扩展只清本地 cookie，会话快照保住
 * cancel 什么都不做，用户反悔了
 */
export type LogoutVerdict = 'pass' | 'local' | 'cancel'

/** 注入脚本 -> content script：拦下了一个退出请求，等一个裁决 */
export interface LogoutInterceptedMessage {
  source: typeof LOGOUT_GUARD_SOURCE
  id: string
  url: string
  method: string
}

/** content script -> 注入脚本：裁决结果 */
export interface LogoutVerdictMessage {
  source: typeof LOGOUT_HOST_SOURCE
  id: string
  verdict: LogoutVerdict
}
