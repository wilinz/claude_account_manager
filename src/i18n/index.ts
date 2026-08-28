import { en } from './en'
import { zh, type Strings } from './zh'

export type { Strings }

/** 实际渲染用的语言。'auto' 只存在于设置里，用之前一定会被解析成这两个之一 */
export type Lang = 'zh' | 'en'
/** 设置里存的值 */
export type LangSetting = 'auto' | Lang

export const LANG_SETTINGS: LangSetting[] = ['auto', 'zh', 'en']

const TABLE: Record<Lang, Strings> = { zh, en }

/**
 * 浏览器界面语言里凡是中文（zh、zh-CN、zh-TW、zh-Hant…）都用中文，其余一律英文。
 * 不去区分简繁：这份词表只有一套简体，硬按 zh-TW 匹配也变不出繁体来。
 */
export function detectLang(): Lang {
  const ui =
    (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.()) ||
    (typeof navigator !== 'undefined' ? navigator.language : '') ||
    ''
  return ui.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function resolveLang(setting: LangSetting | undefined): Lang {
  return setting === 'zh' || setting === 'en' ? setting : detectLang()
}

let current: Lang = detectLang()

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  current = lang
}

/**
 * 当前语言的词表。写成函数而不是导出常量，是因为语言会在运行中被改掉 ——
 * 导出常量的话，模块顶层 `const s = t` 会永远停在初始那一份。
 */
export function t(): Strings {
  return TABLE[current]
}

/* ------------------------------------------------------------------ */
/* 与设置的联动                                                        */
/* ------------------------------------------------------------------ */

/*
 * 这里直接读 chrome.storage，不走 lib/storage —— i18n 被 lib/billing 之类的
 * 底层模块引用，绕开 storage 才不会绕出一个 i18n → storage → types → billing → i18n 的环。
 */
const SETTINGS_KEY = 'settings'

async function readSetting(): Promise<LangSetting> {
  try {
    const raw = await chrome.storage.local.get(SETTINGS_KEY)
    const settings = raw[SETTINGS_KEY] as { language?: LangSetting } | undefined
    return settings?.language ?? 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * 读一次设置并订阅后续改动。每个入口（background / popup / settings / usage / content）
 * 各自 import 一次即可 —— 它们本来就是互相独立的 bundle。
 */
export const ready: Promise<Lang> = (async () => {
  const lang = resolveLang(await readSetting())
  setLang(lang)
  return lang
})()

/** 设置页改了语言时，其余页面跟着变，不用手动刷新 */
export function onLangChange(listener: (lang: Lang) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return
    const next = resolveLang((changes[SETTINGS_KEY].newValue as { language?: LangSetting })?.language)
    if (next === current) return
    setLang(next)
    listener(next)
  }
  chrome.storage.onChanged.addListener(handler)
  return () => chrome.storage.onChanged.removeListener(handler)
}
