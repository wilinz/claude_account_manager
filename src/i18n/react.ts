import { useEffect, useState } from 'react'
import { getLang, onLangChange, ready, t, type Lang, type Strings } from './index'

/**
 * 组件里拿当前词表。语言变了会重渲染。
 *
 * 单独放一个文件是为了让 background 那个 bundle 不至于因为 import 词表而拖进 React。
 */
export function useStrings(): Strings {
  const [, setLangState] = useState<Lang>(getLang)
  useEffect(() => {
    let alive = true
    void ready.then((lang) => alive && setLangState(lang))
    const off = onLangChange((lang) => setLangState(lang))
    return () => {
      alive = false
      off()
    }
  }, [])
  return t()
}

/**
 * 扩展自己的页面（弹窗 / 设置 / 用量）用：标题和 <html lang> 跟着语言走。
 *
 * 只给扩展页面用 —— content script 跑在 claude.ai 的文档里，
 * 改那儿的 documentElement.lang 是在动别人的页面。
 */
export function usePageChrome(title: string): void {
  const lang = getLang()
  useEffect(() => {
    document.title = title
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [title, lang])
}
