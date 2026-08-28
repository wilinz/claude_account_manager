import { useEffect, useState } from 'react'
import type { Strings } from '@/i18n'
import { useStrings } from '@/i18n/react'
import { send } from '@/lib/messaging'
import { Account } from '@/types'

interface Props {
  accounts: Account[]
  onClose: () => void
  onToast: (text: string) => void
  /** 把邮箱填进登录页输入框；返回是否填成功 */
  onFillEmail: (email: string) => boolean
}

function initials(account: Account): string {
  const source = account.note || account.displayName || account.email
  return (source.trim()[0] ?? '?').toUpperCase()
}

function relative(ts: number, s: Strings): string {
  if (!ts) return s.common.never
  const diff = Date.now() - ts
  const minute = 60_000
  if (diff < minute) return s.common.justNow
  if (diff < 60 * minute) return s.common.minutesAgo(Math.floor(diff / minute))
  if (diff < 24 * 60 * minute) return s.common.hoursAgo(Math.floor(diff / (60 * minute)))
  return s.common.daysAgo(Math.floor(diff / (24 * 60 * minute)))
}

export function Picker({ accounts, onClose, onToast, onFillEmail }: Props) {
  const s = useStrings()
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  async function choose(account: Account) {
    const usable = account.cookies.length > 0 && !account.sessionInvalid
    let failure: string | null = null

    if (usable) {
      setBusy(account.id)
      try {
        const res = await send({ type: 'SWITCH_ACCOUNT', id: account.id })
        if (res.ok) {
          onToast(
            res.warning ??
              s.popup.msg.switched(account.email || account.displayName || s.common.thisAccount),
          )
          onClose()
          return
        }
        failure = res.reason ?? s.common.switchFailed
      } catch (error) {
        failure = error instanceof Error ? error.message : s.common.switchFailed
      } finally {
        setBusy(null)
      }
    }

    // 切换失败时原因就是唯一线索，直接呈现，不要被后续提示盖掉
    if (failure) {
      onToast(failure)
      return
    }
    if (!account.email) {
      onToast(s.picker.noEmail)
      return
    }
    if (!onFillEmail(account.email)) {
      onToast(s.picker.noEmailField)
      return
    }
    onToast(s.picker.filled(account.email))
    onClose()
  }

  async function disableAutoPrompt() {
    await send({ type: 'SET_SETTINGS', patch: { autoPrompt: false } })
    onToast(s.picker.promptDisabled)
    onClose()
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel" role="dialog" aria-label={s.picker.aria}>
        <div className="head">
          <h2 className="title">{s.picker.title}</h2>
          <p className="sub">{s.picker.desc}</p>
        </div>

        <div className="list">
          {accounts.map((account) => {
            const usable = account.cookies.length > 0 && !account.sessionInvalid
            return (
              <button
                key={account.id}
                className="row"
                disabled={busy !== null}
                onClick={() => void choose(account)}
              >
                <span className="avatar">{initials(account)}</span>
                <span className="meta">
                  <span className="email">
                    {account.note || account.email || account.displayName || s.common.unnamed}
                  </span>
                  <span className="hint">
                    {account.note && account.email ? `${account.email} · ` : ''}
                    {usable ? s.picker.lastUsed(relative(account.lastUsedAt, s)) : s.picker.needLogin}
                  </span>
                </span>
                <span className={usable ? 'tag' : 'tag weak'}>
                  {busy === account.id
                    ? s.picker.switching
                    : usable
                      ? s.common.sessionUsable
                      : s.picker.emailOnly}
                </span>
              </button>
            )
          })}
        </div>

        <div className="foot">
          <button className="ghost" onClick={() => void disableAutoPrompt()}>
            {s.picker.dontPrompt}
          </button>
          <button className="ghost" onClick={onClose}>
            {s.common.close}
          </button>
        </div>
      </div>
    </div>
  )
}
