import { useEffect, useState } from 'react'
import { useStrings } from '@/i18n/react'
import { send } from '@/lib/messaging'
import { LogoutVerdict } from '@/types'

interface Props {
  /** 当前登录的账号，拿不到时为空 */
  email?: string
  /** 用户做出选择；组件自己不关闭，由调用方决定 */
  onDecide: (verdict: LogoutVerdict) => void
}

/**
 * 拦下网站的退出登录后问一句：要注销，还是只在本地退出。
 *
 * 这两件事在 claude.ai 上长得一模一样，后果却天差地别：
 * 注销会让服务端吊销会话，扩展里存的快照当场作废，再也切不回来。
 */
export function LogoutChoice({ email, onDecide }: Props) {
  const s = useStrings()
  const [busy, setBusy] = useState<LogoutVerdict | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDecide('cancel')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onDecide])

  const who = email || s.common.currentAccount

  async function chooseLocal() {
    setBusy('local')
    // 先把会话存好再放页面走，否则页面跳转会打断保存
    await send({ type: 'LOGOUT_CURRENT' }).catch(() => undefined)
    onDecide('local')
  }

  async function choosePass() {
    setBusy('pass')
    // 会话马上就要被服务端吊销，趁还能读到身份，先把这个账号标成失效
    await send({ type: 'INVALIDATE_CURRENT' }).catch(() => undefined)
    onDecide('pass')
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDecide('cancel')}>
      <div className="panel" role="dialog" aria-label={s.logout.aria}>
        <div className="head">
          <h2 className="title">{s.logout.title(who)}</h2>
          <p className="sub">{s.logout.desc}</p>
        </div>

        <div className="list">
          <button className="choice" disabled={busy !== null} onClick={() => void chooseLocal()}>
            <span className="choice-title">
              {s.logout.localTitle}
              <span className="tag">{s.logout.recommended}</span>
            </span>
            <span className="choice-sub">
              {busy === 'local' ? s.logout.localBusy : s.logout.localDesc}
            </span>
          </button>

          <button
            className="choice danger"
            disabled={busy !== null}
            onClick={() => void choosePass()}
          >
            <span className="choice-title">{s.logout.revokeTitle}</span>
            <span className="choice-sub">
              {busy === 'pass' ? s.logout.revokeBusy : s.logout.revokeDesc}
            </span>
          </button>
        </div>

        <div className="foot">
          <button className="ghost" onClick={() => void disableIntercept(onDecide)}>
            {s.logout.dontIntercept}
          </button>
          <button className="ghost" disabled={busy !== null} onClick={() => onDecide('cancel')}>
            {s.common.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 关掉拦截后，这一次退出按用户本来的意图放行 */
async function disableIntercept(onDecide: (verdict: LogoutVerdict) => void): Promise<void> {
  await send({ type: 'SET_SETTINGS', patch: { interceptLogout: false } }).catch(() => undefined)
  await send({ type: 'INVALIDATE_CURRENT' }).catch(() => undefined)
  onDecide('pass')
}
