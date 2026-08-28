import { useEffect, useState } from 'react'
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

function relative(ts: number): string {
  if (!ts) return '从未使用'
  const diff = Date.now() - ts
  const minute = 60_000
  if (diff < minute) return '刚刚'
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`
  return `${Math.floor(diff / (24 * 60 * minute))} 天前`
}

export function Picker({ accounts, onClose, onToast, onFillEmail }: Props) {
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
          onToast(res.warning ?? `已切换到 ${account.email || account.displayName || '该账号'}`)
          onClose()
          return
        }
        failure = res.reason ?? '切换失败'
      } catch (error) {
        failure = error instanceof Error ? error.message : '切换失败'
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
      onToast('该账号没有记录邮箱，请手动登录')
      return
    }
    if (!onFillEmail(account.email)) {
      onToast('当前页面没有邮箱输入框')
      return
    }
    onToast(`已填入 ${account.email}，请继续完成验证`)
    onClose()
  }

  async function disableAutoPrompt() {
    await send({ type: 'SET_SETTINGS', patch: { autoPrompt: false } })
    onToast('已关闭自动弹出，可在扩展弹窗里重新打开')
    onClose()
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel" role="dialog" aria-label="选择 Claude 账号">
        <div className="head">
          <h2 className="title">选择要使用的 Claude 账号</h2>
          <p className="sub">
            带「会话可用」的账号点一下就能直接进去；其余的会把邮箱填进登录框，走验证码登录。
          </p>
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
                    {account.note || account.email || account.displayName || '未命名账号'}
                  </span>
                  <span className="hint">
                    {account.note && account.email ? `${account.email} · ` : ''}
                    {usable ? `上次使用 ${relative(account.lastUsedAt)}` : '需要重新登录'}
                  </span>
                </span>
                <span className={usable ? 'tag' : 'tag weak'}>
                  {busy === account.id ? '切换中…' : usable ? '会话可用' : '仅邮箱'}
                </span>
              </button>
            )
          })}
        </div>

        <div className="foot">
          <button className="ghost" onClick={() => void disableAutoPrompt()}>
            不再自动弹出
          </button>
          <button className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
