import { createRoot, Root } from 'react-dom/client'
import { send } from '@/lib/messaging'
import { cachedOwners, purgeAccountSiteData } from '@/lib/siteData'
import {
  Account,
  LOGOUT_GUARD_SOURCE,
  LOGOUT_HOST_SOURCE,
  LogoutInterceptedMessage,
  LogoutVerdict,
  LogoutVerdictMessage,
  TabMessage,
} from '@/types'
import { Autofill } from './Autofill'
import { LogoutChoice } from './LogoutChoice'
import { Picker } from './Picker'
import { pickerStyles } from './styles'

const HOST_ID = 'claude-account-switcher-root'

/* ------------------------------------------------------------------ */
/* 挂载点：shadow DOM，避免和页面样式互相污染                          */
/* ------------------------------------------------------------------ */

let root: Root | null = null
let shadow: ShadowRoot | null = null

function ensureRoot(): Root {
  if (root && shadow) return root
  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647'
  document.documentElement.appendChild(host)

  shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = pickerStyles
  shadow.appendChild(style)

  const mount = document.createElement('div')
  shadow.appendChild(mount)
  root = createRoot(mount)
  return root
}

function closePicker(): void {
  root?.render(null)
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
function toast(text: string): void {
  if (!shadow) ensureRoot()
  const existing = shadow!.querySelector('.toast')
  existing?.remove()
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = text
  shadow!.appendChild(el)
  if (toastTimer) clearTimeout(toastTimer)
  // 长文案（多为失败诊断）需要更久才读得完
  toastTimer = setTimeout(() => el.remove(), text.length > 60 ? 15000 : 3500)
}

function openPicker(accounts: Account[]): void {
  ensureRoot().render(
    <Picker
      accounts={accounts}
      onClose={closePicker}
      onToast={toast}
      onFillEmail={fillEmailInput}
    />,
  )
}

/** 锚在输入框下方的下拉；关掉后还能靠再次点击输入框唤回来 */
function openAutofill(accounts: Account[], input: HTMLInputElement): void {
  ensureRoot().render(
    <Autofill
      accounts={accounts}
      input={input}
      onClose={closePicker}
      onToast={toast}
      onFillEmail={fillEmailInput}
      onUseSso={clickSsoButton}
    />,
  )
}

/** 点击对应的第三方登录按钮；找不到就返回 false，让调用方给出提示 */
function clickSsoButton(method: string): boolean {
  const button = findSsoButton(method)
  if (!button) return false
  button.scrollIntoView({ block: 'center', behavior: 'smooth' })
  button.click()
  return true
}

/* ------------------------------------------------------------------ */
/* 登录页邮箱输入框                                                    */
/* ------------------------------------------------------------------ */

const EMAIL_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[autocomplete="email"]',
  'input[autocomplete="username"]',
  'input[name*="email" i]',
  'input[placeholder*="email" i]',
  'input[placeholder*="邮箱"]',
]

function findEmailInput(): HTMLInputElement | null {
  for (const selector of EMAIL_SELECTORS) {
    const el = document.querySelector<HTMLInputElement>(selector)
    if (el && el.offsetParent !== null) return el
  }
  return null
}

/**
 * React 受控输入必须走原生 setter，直接改 .value 不会触发它的 onChange，
 * 表单会在提交时读到空值。
 */
function setReactInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function fillEmailInput(email: string): boolean {
  const input = findEmailInput()
  if (!input) return false
  setReactInputValue(input, email)
  input.focus()
  return true
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/* ------------------------------------------------------------------ */
/* 第三方登录                                                          */
/* ------------------------------------------------------------------ */

/** 登录方式 -> 登录页上按钮文案里的关键词 */
const SSO_KEYWORDS: Record<string, string[]> = {
  google: ['google'],
  apple: ['apple'],
  github: ['github'],
}

/**
 * Google/Apple 登录的账号没有密码也不走邮箱验证码，
 * 往邮箱框里填地址毫无意义，得去点对应的 SSO 按钮。
 */
export function findSsoButton(method: string): HTMLElement | null {
  const keywords = SSO_KEYWORDS[method.toLowerCase()]
  if (!keywords) return null
  const candidates = document.querySelectorAll<HTMLElement>('button, a[role="button"], a[href]')
  for (const el of candidates) {
    if (el.offsetParent === null) continue
    const text = (el.innerText || el.getAttribute('aria-label') || '').toLowerCase()
    if (!text) continue
    // 认「continue with google / sign in with google」这类，避免误伤页脚链接
    if (keywords.some((k) => text.includes(k)) && /continue|sign in|log in|登录|继续/.test(text)) {
      return el
    }
  }
  return null
}

/** 记录当前登录方式，供下次给这个账号选对入口 */
function reportLoginMethod(): void {
  try {
    const method = window.localStorage.getItem('lastLoginMethod')
    if (method) send({ type: 'REMEMBER_LOGIN_METHOD', method }).catch(() => undefined)
  } catch {
    /* 隐私模式下读不到就算了 */
  }
}

/** 用户手动登录时把邮箱记下来，下次就能自动填 */
function watchEmailForRemember(): void {
  const remember = (value: string) => {
    const email = value.trim()
    if (!isValidEmail(email)) return
    send({ type: 'REMEMBER_EMAIL', email }).catch(() => undefined)
  }

  document.addEventListener(
    'submit',
    () => {
      const input = findEmailInput()
      if (input) remember(input.value)
    },
    true,
  )

  document.addEventListener(
    'blur',
    (e) => {
      const target = e.target
      if (!(target instanceof HTMLInputElement)) return
      if (!EMAIL_SELECTORS.some((s) => target.matches(s))) return
      remember(target.value)
    },
    true,
  )

  // 回车提交（claude.ai 的登录表单常常不触发原生 submit）
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter') return
      const target = e.target
      if (target instanceof HTMLInputElement && EMAIL_SELECTORS.some((s) => target.matches(s))) {
        remember(target.value)
      }
    },
    true,
  )
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

/** 等登录框渲染出来（claude.ai 是 SPA，首帧通常还没有输入框） */
function waitForEmailInput(timeoutMs = 8000): Promise<HTMLInputElement | null> {
  const found = findEmailInput()
  if (found) return Promise.resolve(found)

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const input = findEmailInput()
      if (input) {
        observer.disconnect()
        clearTimeout(timer)
        resolve(input)
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
    const timer = setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, timeoutMs)
  })
}

/**
 * 把下拉常驻绑定到登录页的邮箱输入框上。
 *
 * 之前用的是全屏模态：点一下就整个消失，想再看账号列表没有任何入口。
 * 浏览器密码管理器的心智是「点输入框就出现」，这里照做：
 * focus / click 都会重新展开，选中或点别处才收起。
 */
let boundInput: HTMLInputElement | null = null

function bindAutofill(input: HTMLInputElement): void {
  if (boundInput === input) return
  boundInput = input

  const open = () => {
    if (latestAccounts.length > 0) openAutofill(latestAccounts, input)
  }
  input.addEventListener('focus', open)
  input.addEventListener('click', open)

  // 输入框被 SPA 重新挂载后要重新绑定
  const observer = new MutationObserver(() => {
    if (!input.isConnected) {
      observer.disconnect()
      boundInput = null
      closePicker()
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
}

/** 最近一次从后台拿到的账号列表，供输入框的 focus 回调使用 */
let latestAccounts: Account[] = []

async function handlePrompt(accounts: Account[]): Promise<void> {
  latestAccounts = accounts
  const settings = await send({ type: 'GET_SETTINGS' })
  const input = await waitForEmailInput()

  // 页面上没有邮箱输入框可锚定（比如非登录页），退回到居中面板
  if (!input) {
    openPicker(accounts)
    return
  }

  bindAutofill(input)

  const onlyEmailAccounts = accounts.filter((a) => a.cookies.length === 0 || a.sessionInvalid)
  const singleEmailOnly =
    accounts.length === 1 && onlyEmailAccounts.length === 1 && !!accounts[0].email

  // 只有一个「仅邮箱」账号时没什么可选的，直接填掉
  if (singleEmailOnly && settings.autoFillEmail && !input.value) {
    if (fillEmailInput(accounts[0].email)) {
      toast(`已填入 ${accounts[0].email}`)
      return
    }
  }

  if (settings.autoPrompt) openAutofill(accounts, input)
}

/**
 * 登录页随时可能在我们弹过一次之后才渲染出输入框（SPA 路由切换）。
 * 持续盯着，出现新的邮箱框就把下拉绑上去。
 */
function watchForEmailInput(): void {
  const attach = () => {
    const input = findEmailInput()
    if (input && input !== boundInput && latestAccounts.length > 0) {
      bindAutofill(input)
    }
  }
  attach()
  new MutationObserver(attach).observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}

/* ------------------------------------------------------------------ */
/* 退出登录拦截                                                        */
/* ------------------------------------------------------------------ */

/**
 * 页面世界的注入脚本按住了一个退出请求，在这里问用户，再把裁决送回去。
 *
 * 注入脚本发的是 window.postMessage，页面自己也能伪造。最坏的后果只是
 * 平白弹一次对话框：真正的动作都在用户点了之后才发生，所以不额外做校验。
 */
/** 弹出二选一并等用户决定；本地退出 / 标记失效都由对话框自己做完 */
async function askLogoutChoice(): Promise<LogoutVerdict> {
  const settings = await send({ type: 'GET_SETTINGS' }).catch(() => null)
  // 拦截被关掉时不该挡路，原样放行
  if (settings && !settings.interceptLogout) return 'pass'

  const state = await send({ type: 'GET_STATE' }).catch(() => null)

  return new Promise<LogoutVerdict>((resolve) => {
    ensureRoot().render(
      <LogoutChoice
        email={state?.email}
        onDecide={(verdict) => {
          closePicker()
          if (verdict === 'local') toast('已保存会话并在本地退出，可在扩展里一键切回来')
          resolve(verdict)
        }}
      />,
    )
  })
}

async function handleLogoutIntercepted(id: string): Promise<void> {
  const verdict = await askLogoutChoice()
  const message: LogoutVerdictMessage = { source: LOGOUT_HOST_SOURCE, id, verdict }
  window.postMessage(message, location.origin)
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return
  const data = event.data as LogoutInterceptedMessage | undefined
  if (data?.source !== LOGOUT_GUARD_SOURCE) return
  void handleLogoutIntercepted(data.id)
})

/** 注入脚本只管得住 fetch/XHR，退出要是做成一个链接跳转，得在这儿拦 */
const LOGOUT_HREF = /\/(logout|log[-_]?out|sign[-_]?out|signout)(\/|\?|$)/i

document.addEventListener(
  'click',
  (event) => {
    const anchor = (event.target as Element | null)?.closest?.('a[href]')
    if (!(anchor instanceof HTMLAnchorElement)) return
    let url: URL
    try {
      url = new URL(anchor.href, location.href)
    } catch {
      return
    }
    if (!url.hostname.endsWith('claude.ai') || !LOGOUT_HREF.test(url.pathname)) return

    event.preventDefault()
    event.stopPropagation()
    void askLogoutChoice().then((verdict) => {
      // local 时对话框已经清完本地 cookie，后台会把标签页刷掉，这里不用再跳
      if (verdict === 'pass') location.assign(url.href)
    })
  },
  true,
)

/* ------------------------------------------------------------------ */
/* 站点数据自愈                                                        */
/* ------------------------------------------------------------------ */

const SELF_HEAL_FLAG = 'claude-account-switcher:self-healed'

/**
 * 切换账号时如果这个标签页没开着，就没人清它的缓存。
 * 页面加载时对一次账，发现缓存属于别的账号就地清掉并重载一次。
 * 不这么做的话，SPA 会带着上个账号的 uuid 打接口，403 后跳登录。
 */
async function selfHealStaleAccountData(): Promise<void> {
  const owners = cachedOwners()
  if (owners.length === 0) return

  let state
  try {
    state = await send({ type: 'GET_STATE' })
  } catch {
    return
  }
  // 未登录时页面本来就要去登录页，不用管缓存
  if (!state.loggedIn || !state.uuid) return
  if (owners.includes(state.uuid)) return

  // 只自愈一次，避免和页面自身的写入打架变成刷新循环
  try {
    if (sessionStorage.getItem(SELF_HEAL_FLAG)) return
  } catch {
    return
  }

  const report = await purgeAccountSiteData()
  try {
    sessionStorage.setItem(SELF_HEAL_FLAG, '1')
  } catch {
    /* 清理已经做了，标记失败就算了 */
  }
  console.info('[claude-account-switcher] 清除了上个账号的缓存，正在重载', report)
  location.reload()
}

chrome.runtime.onMessage.addListener((message: TabMessage, _sender, sendResponse) => {
  if (message?.type === 'PROMPT_PICKER') {
    void handlePrompt(message.accounts)
    return
  }
  if (message?.type === 'PURGE_SITE_DATA') {
    purgeAccountSiteData()
      .then((report) => sendResponse({ ok: true, report }))
      .catch(() => sendResponse({ ok: false }))
    return true // 异步回复
  }
})

/**
 * 主动拉一次账号列表。
 * 不能只等 background 的 PROMPT_PICKER：自动弹窗被关掉、或撞上 60 秒冷却时它不会来，
 * 而「点输入框就出现下拉」必须在那些情况下照样可用。
 */
async function initAutofill(): Promise<void> {
  try {
    latestAccounts = await send({ type: 'LIST_ACCOUNTS' })
  } catch {
    return
  }
  if (latestAccounts.length === 0) return
  watchForEmailInput()
}

watchEmailForRemember()
reportLoginMethod()
void initAutofill()
void selfHealStaleAccountData()
