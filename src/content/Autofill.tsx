import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Strings } from '@/i18n'
import { useStrings } from '@/i18n/react'
import { send } from '@/lib/messaging'
import { Account } from '@/types'

interface Props {
  accounts: Account[]
  /** 下拉锚定的输入框 */
  input: HTMLInputElement
  onClose: () => void
  onToast: (text: string) => void
  onFillEmail: (email: string) => boolean
  /** 点击 Google / Apple 等第三方登录按钮 */
  onUseSso: (method: string) => boolean
}

const SSO_LABEL: Record<string, string> = {
  google: 'Google',
  apple: 'Apple',
  github: 'GitHub',
}

interface Rect {
  left: number
  top: number
  bottom: number
  width: number
}

function initials(account: Account): string {
  const source = account.note || account.displayName || account.email
  return (source.trim()[0] ?? '?').toUpperCase()
}

function label(account: Account, s: Strings): string {
  return account.note || account.email || account.displayName || s.common.unnamed
}

/** 跟随输入框位置。页面滚动、布局变化、SPA 重排都要跟上 */
function useAnchorRect(input: HTMLInputElement): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)

  useLayoutEffect(() => {
    let frame = 0
    let last = ''
    const measure = () => {
      const r = input.getBoundingClientRect()
      const key = `${r.left},${r.top},${r.width}`
      // 只有真的动了才 setState，避免每帧都重渲染
      if (key !== last) {
        last = key
        setRect({ left: r.left, top: r.top, bottom: r.bottom, width: r.width })
      }
      frame = requestAnimationFrame(measure)
    }
    frame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(frame)
  }, [input])

  return rect
}

export function Autofill({ accounts, input, onClose, onToast, onFillEmail, onUseSso }: Props) {
  const s = useStrings()
  const rect = useAnchorRect(input)
  const [query, setQuery] = useState(input.value)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 输入框里已经打了字就按前缀过滤，和密码管理器一致
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? accounts.filter(
        (a) =>
          a.email.toLowerCase().includes(needle) ||
          (a.note ?? '').toLowerCase().includes(needle) ||
          (a.displayName ?? '').toLowerCase().includes(needle),
      )
    : accounts

  useEffect(() => {
    setActive((prev) => (prev < visible.length ? prev : 0))
  }, [visible.length])

  /** 会话不可用时，按登录方式选正确的入口：SSO 点按钮，邮箱登录填输入框 */
  const fallbackToLogin = (account: Account, prefix = ''): void => {
    const sso = account.loginMethod?.toLowerCase()
    if (sso && SSO_LABEL[sso]) {
      if (onUseSso(sso)) {
        onToast(s.autofill.ssoClicked(prefix, SSO_LABEL[sso]))
        onClose()
        return
      }
      onToast(s.autofill.ssoManual(prefix, SSO_LABEL[sso]))
      return
    }
    if (!account.email) {
      onToast(s.autofill.noEmailRecorded(prefix))
      return
    }
    if (!onFillEmail(account.email)) {
      onToast(s.autofill.noEmailField(prefix))
      return
    }
    onToast(s.autofill.filled(prefix, account.email))
    onClose()
  }

  const addAccount = async () => {
    setBusy('__add__')
    try {
      await send({ type: 'ADD_ACCOUNT' })
      onClose()
    } catch (error) {
      onToast(error instanceof Error ? error.message : s.autofill.addFailed)
    } finally {
      setBusy(null)
    }
  }

  /** 只把邮箱填进输入框，不动当前会话 */
  const fillOnly = (account: Account): void => {
    if (!account.email) {
      onToast(s.autofill.noEmail)
      return
    }
    if (!onFillEmail(account.email)) {
      onToast(s.autofill.noField)
      return
    }
    onToast(s.autofill.filledPlain(account.email))
    onClose()
  }

  const choose = async (account: Account) => {
    const usable = account.cookies.length > 0 && !account.sessionInvalid
    if (!usable) {
      fallbackToLogin(account)
      return
    }

    setBusy(account.id)
    let reason: string
    try {
      const res = await send({ type: 'SWITCH_ACCOUNT', id: account.id })
      if (res.ok) {
        onToast(res.warning ?? s.popup.msg.switched(label(account, s)))
        onClose()
        return
      }
      reason = res.reason ?? s.common.switchFailed
    } catch (error) {
      reason = error instanceof Error ? error.message : s.common.switchFailed
    } finally {
      setBusy(null)
    }

    // 失败原因是这里唯一的线索，不能被后续提示盖掉
    onToast(reason)
    console.warn('[claude-account-switcher] 切换失败：', reason)
  }

  // 键盘操作绑在输入框上：用户手还在输入框里，不该被迫去点鼠标
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Esc 任何时候都要能收起下拉，哪怕当前一条都没匹配上
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (visible.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % visible.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i - 1 + visible.length) % visible.length)
      } else if (e.key === 'Enter' && busy === null && visible[active]) {
        // 只有明确高亮了某一项才拦截回车，否则让页面正常提交
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) fillOnly(visible[active])
        else void choose(visible[active])
      }
    }
    const onInput = () => setQuery(input.value)

    input.addEventListener('keydown', onKeyDown, true)
    input.addEventListener('input', onInput)
    return () => {
      input.removeEventListener('keydown', onKeyDown, true)
      input.removeEventListener('input', onInput)
    }
  })

  // 点到别处才关；点下拉本身不算
  useEffect(() => {
    const onPointerDown = (e: Event) => {
      const target = e.target as Node
      if (target === input) return
      if (listRef.current?.contains(target)) return
      // 事件从 shadow root 里冒出来时 target 会被重定向到 host，需要看真实路径
      const path = (e as Event & { composedPath?: () => EventTarget[] }).composedPath?.() ?? []
      if (path.includes(input)) return
      if (listRef.current && path.includes(listRef.current)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [input, onClose])

  if (!rect) return null

  // 下方放不下就翻到输入框上面
  const maxHeight = 260
  const flip = rect.bottom + maxHeight + 8 > window.innerHeight && rect.top > maxHeight
  const style: React.CSSProperties = {
    left: rect.left,
    width: Math.max(rect.width, 260),
    ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
  }

  return (
    <div
      ref={listRef}
      className="autofill"
      style={style}
      // 按下鼠标不能让输入框失焦，否则页面会以为用户放弃了输入
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="autofill-head">
        {visible.length > 0 ? s.autofill.headerSaved : s.autofill.headerNone}
      </div>
      {visible.map((account, index) => {
        const usable = account.cookies.length > 0 && !account.sessionInvalid
        return (
          <div
            key={account.id}
            className={`autofill-item${index === active ? ' active' : ''}`}
            onMouseEnter={() => setActive(index)}
          >
            <button
              className="autofill-row"
              disabled={busy !== null}
              onClick={() => void choose(account)}
            >
              <span className="autofill-avatar">{initials(account)}</span>
              <span className="autofill-meta">
                <span className="autofill-email">{label(account, s)}</span>
                <span className="autofill-hint">
                  {account.note && account.email ? `${account.email} · ` : ''}
                  {usable
                    ? s.autofill.clickToLogin
                    : account.loginMethod && SSO_LABEL[account.loginMethod.toLowerCase()]
                      ? s.autofill.ssoRelogin(SSO_LABEL[account.loginMethod.toLowerCase()])
                      : s.autofill.fillEmail}
                </span>
              </span>
              {busy === account.id ? (
                <span className="autofill-tag">…</span>
              ) : usable ? (
                <span className="autofill-tag">{s.common.sessionUsable}</span>
              ) : null}
            </button>

            {/*
              两种情况都需要这个出口，所以只看有没有邮箱：
              · 会话可用的账号，点一下就切走了，但有时只是想拿这个邮箱走一次正常登录
              · Google / Apple 账号，主按钮会去点第三方登录，可这类账号同样能收
                claude.ai 发到该邮箱的验证码 —— 不给这个口子就等于把那条路堵死了
            */}
            {account.email && (
              <button
                className="autofill-fill"
                disabled={busy !== null}
                title={s.autofill.fillOnlyTitle}
                onClick={() => fillOnly(account)}
              >
                {s.autofill.fillOnly}
              </button>
            )}
          </div>
        )
      })}
      <button
        className="autofill-row autofill-add"
        disabled={busy !== null}
        onClick={() => void addAccount()}
      >
        <span className="autofill-avatar autofill-plus">＋</span>
        <span className="autofill-meta">
          <span className="autofill-email">{s.autofill.addOther}</span>
          <span className="autofill-hint">{s.autofill.addOtherHint}</span>
        </span>
      </button>
    </div>
  )
}
