/**
 * 页面世界（MAIN world）注入脚本：拦住 claude.ai 自己发出的退出登录请求。
 *
 * 为什么必须在页面世界里做：content script 跑在隔离世界，改不到页面的 window.fetch。
 * 而这个请求一旦发到服务端，会话就被吊销了 —— 扩展里存的 cookie 快照当场作废，
 * 事后再怎么补救都切不回来。所以只能在发出去之前把它按住，问用户一句。
 *
 * 为什么是 public/ 里的普通 JS 而不是 src/ 里的 TS：
 * claude.ai 的 CSP 是 `default-src 'none'; script-src 'nonce-…' 'unsafe-eval'`，
 * 不含 chrome-extension: 也没有 strict-dynamic。manifest 声明的脚本由浏览器注入，
 * 不受页面 CSP 管；但打包器生成的 loader 会再去 import 真正的 chunk，那一步是页面
 * 上下文的加载，会被 CSP 拦死。所以这个文件必须自包含：不 import 任何东西。
 *
 * 下面两个标识必须和 src/types/index.ts 里的 LOGOUT_GUARD_SOURCE / LOGOUT_HOST_SOURCE 一致。
 */
;(function () {
  'use strict'

  const GUARD_SOURCE = 'claude-account-switcher:guard'
  const HOST_SOURCE = 'claude-account-switcher:host'

  /** 等用户做决定，超时就当放弃 —— 宁可退出失败，也不要替他把会话注销掉 */
  const VERDICT_TIMEOUT_MS = 120000

  /**
   * 认哪些请求算「退出登录」。
   * 宁可宽一点：漏判的代价是会话被悄悄吊销，误判的代价只是多问一句。
   */
  const LOGOUT_PATTERN = /\/(logout|log[-_]?out|sign[-_]?out|signout)(\/|\?|$)/i

  function isLogoutUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href)
      if (!url.hostname.endsWith('claude.ai')) return false
      return LOGOUT_PATTERN.test(url.pathname)
    } catch {
      return false
    }
  }

  /* ---------------------------------------------------------------- */
  /* 与隔离世界通信                                                    */
  /* ---------------------------------------------------------------- */

  const pending = new Map()
  let seq = 0

  window.addEventListener('message', (event) => {
    // 只认自己这个 window 发来的、带我们标识的消息
    if (event.source !== window) return
    const data = event.data
    if (!data || data.source !== HOST_SOURCE) return
    const resolve = pending.get(data.id)
    if (!resolve) return
    pending.delete(data.id)
    resolve(data.verdict)
  })

  function askHost(url, method) {
    const id = String(Date.now()) + '-' + seq++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        console.warn('[claude-account-switcher] 退出登录的确认框没有响应，已取消这次退出')
        resolve('cancel')
      }, VERDICT_TIMEOUT_MS)

      pending.set(id, (verdict) => {
        clearTimeout(timer)
        resolve(verdict)
      })

      window.postMessage({ source: GUARD_SOURCE, id, url, method }, location.origin)
    })
  }

  /** 选了「本地退出」时给页面的假响应：让 SPA 以为退成功了，照常跳登录页 */
  function fakeOk() {
    return new Response('{}', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    })
  }

  /* ---------------------------------------------------------------- */
  /* fetch                                                             */
  /* ---------------------------------------------------------------- */

  const nativeFetch = window.fetch

  window.fetch = async function patchedFetch(input, init) {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url
    if (!url || !isLogoutUrl(url)) return nativeFetch.call(window, input, init)

    const method = String(
      (init && init.method) || (input && input.method) || 'GET',
    ).toUpperCase()

    const verdict = await askHost(url, method)
    if (verdict === 'pass') return nativeFetch.call(window, input, init)
    if (verdict === 'local') return fakeOk()
    // cancel：给一个网络错误，页面会当成退出失败，什么都不会变
    throw new DOMException('已取消退出登录', 'AbortError')
  }

  /* ---------------------------------------------------------------- */
  /* XMLHttpRequest                                                    */
  /* ---------------------------------------------------------------- */

  const nativeOpen = XMLHttpRequest.prototype.open
  const nativeSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function open(method, url) {
    const href = typeof url === 'string' ? url : url && url.href
    if (href && isLogoutUrl(href)) {
      this.__casLogoutUrl = href
      this.__casLogoutMethod = String(method || 'GET').toUpperCase()
    }
    return nativeOpen.apply(this, arguments)
  }

  XMLHttpRequest.prototype.send = function send(body) {
    const url = this.__casLogoutUrl
    if (!url) return nativeSend.call(this, body)

    askHost(url, this.__casLogoutMethod || 'GET').then((verdict) => {
      if (verdict === 'pass') {
        nativeSend.call(this, body)
        return
      }
      // 不发请求就不会有任何事件，页面会一直等；给它一个结束信号
      this.dispatchEvent(new ProgressEvent(verdict === 'local' ? 'load' : 'error'))
      this.dispatchEvent(new ProgressEvent('loadend'))
    })
  }

  /* ---------------------------------------------------------------- */
  /* sendBeacon —— 关页面时的退出上报走这条                            */
  /* ---------------------------------------------------------------- */

  if (navigator.sendBeacon) {
    const nativeBeacon = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = function sendBeacon(url, data) {
      const href = typeof url === 'string' ? url : url && url.href
      // beacon 是同步 API，没法等用户点确认。直接吞掉：
      // 页面正在卸载，此时注销会话就是最糟的结果。
      if (href && isLogoutUrl(href)) {
        console.info('[claude-account-switcher] 拦下了一个 sendBeacon 退出请求')
        return true
      }
      return nativeBeacon(href, data)
    }
  }

  console.info('[claude-account-switcher] 退出登录拦截已就绪')
})()
