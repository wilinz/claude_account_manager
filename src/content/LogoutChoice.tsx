import { useEffect, useState } from 'react'
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
  const [busy, setBusy] = useState<LogoutVerdict | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDecide('cancel')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onDecide])

  const who = email || '当前账号'

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
      <div className="panel" role="dialog" aria-label="退出登录方式">
        <div className="head">
          <h2 className="title">要怎么退出 {who}？</h2>
          <p className="sub">
            claude.ai 的「退出登录」会让服务端吊销这份会话，扩展里保存的快照会同时作废，
            之后没法一键切回来。
          </p>
        </div>

        <div className="list">
          <button className="choice" disabled={busy !== null} onClick={() => void chooseLocal()}>
            <span className="choice-title">
              仅本地退出<span className="tag">推荐</span>
            </span>
            <span className="choice-sub">
              {busy === 'local' ? '正在保存会话…' : '保存当前会话后只清掉本地 cookie，随时能一键切回来'}
            </span>
          </button>

          <button
            className="choice danger"
            disabled={busy !== null}
            onClick={() => void choosePass()}
          >
            <span className="choice-title">注销并退出</span>
            <span className="choice-sub">
              {busy === 'pass'
                ? '正在标记账号…'
                : '真正向 claude.ai 注销。这份会话立刻失效，下次要重新登录'}
            </span>
          </button>
        </div>

        <div className="foot">
          <button className="ghost" onClick={() => void disableIntercept(onDecide)}>
            不再拦截退出
          </button>
          <button className="ghost" disabled={busy !== null} onClick={() => onDecide('cancel')}>
            取消
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
