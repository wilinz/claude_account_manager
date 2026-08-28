/**
 * 中文文案。这份是「原本」—— en.ts 用 `Strings` 约束，少一个键就编译不过。
 *
 * 带参数的文案写成函数而不是模板占位符（`{n}`），这样参数的个数和类型
 * 由 TypeScript 管，翻译时漏一个参数在编译期就会被发现。
 */
export const zh = {
  langName: { auto: '跟随浏览器', zh: '中文', en: 'English' },

  common: {
    extName: 'Claude 账号切换器',
    cancel: '取消',
    save: '保存',
    clear: '清除',
    close: '关闭',
    delete: '删除',
    note: '备注',
    subscription: '订阅',
    switch: '切换',
    unnamed: '未命名账号',
    thisAccount: '该账号',
    currentAccount: '当前账号',
    loggedIn: '已登录',
    loadFailed: '加载失败',
    actionFailed: '操作失败',
    switchFailed: '切换失败',
    sessionUsable: '会话可用',
    never: '从未使用',
    justNow: '刚刚',
    minutesAgo: (n: number) => `${n} 分钟前`,
    hoursAgo: (n: number) => `${n} 小时前`,
    daysAgo: (n: number) => `${n} 天前`,
  },

  popup: {
    strategy: {
      merge: '合并（只用更新的会话）',
      overwrite: '覆盖同名账号',
      replace: '替换本地全部账号',
    },
    parts: {
      cookies: { title: '会话 cookie', desc: '登录凭证本身，能直接登进账号' },
      billing: { title: '订阅信息', desc: '每月续订日与订阅渠道' },
      settings: { title: '扩展设置', desc: '自动保存、退出拦截等开关' },
    },
    sheet: {
      aria: '选择内容',
      exportTitle: (what: string) => `导出${what}`,
      importTitle: '导入备份',
      exportSub: '选择要写进文件的内容',
      importSub: (file: string) => `从 ${file} 恢复哪些内容`,
      exportedAt: (when: string) => ` · 导出于 ${when}`,
      missing: '这个文件里没有',
      strategyLabel: '同名账号怎么处理',
      replaceConfirm: '「替换本地全部账号」会清空现有记录，继续？',
      atLeastOne: '至少选一项',
      doExport: '导出',
      doImport: '导入',
    },
    billing: {
      anchor: '续订日',
      platform: '订阅渠道',
      note: '照抄平台里显示的下次续订日期。各家按自己的时区算，从购买时间反推会差一天。',
      cleared: '已清除订阅信息',
      saved: '订阅信息已保存',
    },
    stale: {
      text: '后台还在跑旧代码，保存和导出可能静默失效。',
      reload: '重新加载扩展',
    },
    header: {
      openSite: '在新标签页打开 claude.ai',
      loading: '读取中…',
      current: (who: string) => `当前：${who}`,
      notLoggedIn: '当前未登录 claude.ai',
      autoSaved: (rel: string) => `会话已自动保存 · ${rel}`,
      notSavedYet: '尚未保存这个会话，稍后会自动保存',
      autoOffWithSnapshot: (rel: string) => `自动保存已关闭 · 快照停留在 ${rel}`,
      autoOffNoSnapshot: '自动保存已关闭 · 这个会话还没有快照',
    },
    actions: {
      add: '＋ 添加账号',
      saveSession: '保存当前会话',
      logout: '退出当前账号',
    },
    transfer: {
      section: '导入导出',
      exportAll: '导出全部',
      importBackup: '导入备份',
      encrypt: '加密导出',
      encryptOff: '已关闭加密',
      passwordPlaceholder: '设置加密密码',
      warnPlain: '未加密导出的是明文会话 cookie，等同于登录凭证，请勿分享或上传。',
      warnEncrypted: '导出用 AES-GCM-256 加密（PBKDF2-SHA256 派生密钥）。密码丢失无法恢复。',
      settings: '设置',
      usage: '用量总览',
      all: '全部',
      selected: '所选',
    },
    list: {
      selectedOf: (n: number, total: number) => `已选 ${n} / ${total}`,
      count: (n: number) => `${n} 个账号`,
      exportSelected: '导出所选',
      deleteSelected: '删除所选',
      empty: '还没有记录任何账号。登录一次 claude.ai 后点上面的「保存当前会话」，或展开「导入导出」恢复备份。',
      selectAria: (who: string) => `选择 ${who}`,
      inUse: '正在使用',
      usable: (rel: string) => `会话可用 · ${rel}`,
      emailOnly: '仅记录邮箱',
      switchTitle: '用保存的会话切换',
      switchTitleEmail: '没有可用会话，去登录页会自动填邮箱',
      billingTitle: '下次续订日与渠道',
    },
    msg: {
      saved: (who: string) => `已保存 ${who}`,
      saveFailed: '保存失败',
      switched: (who: string) => `已切换到 ${who}`,
      deleted: '已删除',
      deletedN: (n: number) => `已删除 ${n} 个账号`,
      deleteConfirm: (n: number, names: string) => `删除这 ${n} 个账号的记录？\n${names}`,
      notePrompt: '给这个账号起个备注',
      loggedOut: '已退出当前会话（快照已保留）',
      addConfirm:
        '将先保存当前会话，然后退出并打开登录页去添加新账号。\n' +
        '当前账号的会话会留在列表里，随时可以切回来。继续？',
      addSaved: '已保存当前会话，去登录新账号吧',
      addOpened: '已打开登录页',
      needPassword: '请先填写加密密码，或取消勾选「加密导出」',
      plainConfirm: '明文导出的备份包含可直接登录的会话凭证，确定不加密？',
      exported: (what: string, n: number, withSession: number, encrypted: boolean) =>
        `已导出${what} ${n} 个账号（${withSession} 个含会话）${encrypted ? '，已用密码加密' : '，未加密'}`,
      badJson: '文件不是合法的 JSON',
      passwordPrompt: '这是加密备份，请输入导出时设置的密码',
      needSecret: '这是加密备份，需要密码才能导入',
      readFailed: '读取文件失败',
      imported: (added: number, updated: number, skipped: number, invalid: number, settings: boolean) => {
        const done = [`新增 ${added}`, `更新 ${updated}`]
        if (skipped) done.push(`跳过 ${skipped}`)
        if (invalid) done.push(`忽略无效 ${invalid}`)
        if (settings) done.push('已恢复设置')
        return `导入完成：${done.join(' · ')}`
      },
    },
  },

  settings: {
    title: '设置',
    sub: '改动即时生效，无需保存。',
    saved: '已保存',
    usage: '用量总览',
    loading: '正在读取设置…',
    language: {
      group: '语言',
      title: '界面语言',
      desc: '「跟随浏览器」按浏览器的显示语言选：中文环境用中文，其余用英文。',
    },
    groups: {
      capture: '会话保存',
      loginPage: '登录页',
      switching: '切换账号',
      logout: '退出登录',
      backup: '导出备份',
    },
    items: {
      autoCapture: {
        title: '自动保存当前会话',
        desc: '登录、切换、会话续期时自动把 cookie 快照存进对应账号。关掉后只能在弹窗里手动保存，容易丢会话。',
      },
      autoPrompt: {
        title: '未登录时自动弹出账号选择',
        desc: '打开 claude.ai 发现没登录时，直接把已保存的账号列出来。关掉后仍可点邮箱输入框唤出下拉。',
      },
      autoFillEmail: {
        title: '自动填充邮箱',
        desc: '只有一个候选账号、且它没有可用会话时，直接把邮箱填进登录框。',
      },
      clearSiteDataOnSwitch: {
        title: '切换时清除上个账号的页面缓存',
        desc: '不清的话，页面会带着上个账号的身份去打接口，403 之后直接跳登录页。设备绑定信息会保留，不影响免验证。',
      },
      reloadTabsAfterSwitch: {
        title: '切换后自动刷新 claude.ai 标签页',
        desc: '不刷新的话，页面上显示的还是上个账号的界面，直到你自己刷新。',
      },
      interceptLogout: {
        title: '拦截网站的「退出登录」并询问',
        desc: '点击 claude.ai 自己的退出登录时，先问一句是「注销」还是「仅本地退出」。注销会让服务端吊销会话，保存的快照当场作废，之后切不回来。',
        warnWhenOff: '关掉后，在 claude.ai 上点退出登录会直接注销，那个账号保存的会话将立即失效。',
      },
      encryptExport: {
        title: '导出时加密',
        desc: '用 AES-GCM-256 加密（PBKDF2-SHA256 派生密钥）。密码丢失无法恢复。',
        warnWhenOff: '未加密的导出文件里是明文会话 cookie，等同于登录凭证，切勿分享或上传。',
      },
    },
  },

  usage: {
    title: '账号用量总览',
    sub: '逐个账号用它自己的会话查询，全程不改动浏览器里当前登录的账号。',
    fetchedAt: (rel: string) => `数据来自 ${rel}`,
    refreshing: '正在刷新…',
    refresh: '刷新',
    querying: '查询中…',
    loadingAll: '正在逐个账号查询…',
    empty: '还没有保存任何账号。',
    raw: '原始数据',
    rawCollapse: '收起原始数据',
    queryFailed: '查询失败',
    allFailed: '一个账号的用量都没取到。逐个卡片上的原因通常就是答案；如果全是网络问题，看一眼 ',
    allFailedTail: ' 里后台的报错。',
    today: (time: string) => `今天 ${time}`,
    tomorrow: (time: string) => `明天 ${time}`,
    lessThanMinute: '不到 1 分钟',
    minutes: (n: number) => `${n} 分钟`,
    hours: (h: number, m: number) => (m ? `${h} 小时 ${m} 分钟` : `${h} 小时`),
    days: (d: number, h: number) => (h ? `${d} 天 ${h} 小时` : `${d} 天`),
    resettingSoon: '即将重置',
    resetIn: (countdown: string, clock: string) => `${countdown}后重置 · ${clock}`,
    windows: {
      five_hour: '5 小时会话',
      seven_day: '7 天',
      seven_day_opus: '7 天 Opus',
      seven_day_sonnet: '7 天 Sonnet',
      seven_day_cowork: '7 天 Cowork',
      extra: '额外用量',
    } as Record<string, string>,
  },

  picker: {
    aria: '选择 Claude 账号',
    title: '选择要使用的 Claude 账号',
    desc: '带「会话可用」的账号点一下就能直接进去；其余的会把邮箱填进登录框，走验证码登录。',
    lastUsed: (rel: string) => `上次使用 ${rel}`,
    needLogin: '需要重新登录',
    switching: '切换中…',
    emailOnly: '仅邮箱',
    dontPrompt: '不再自动弹出',
    noEmail: '该账号没有记录邮箱，请手动登录',
    noEmailField: '当前页面没有邮箱输入框',
    filled: (email: string) => `已填入 ${email}，请继续完成验证`,
    promptDisabled: '已关闭自动弹出，可在扩展弹窗里重新打开',
  },

  autofill: {
    headerSaved: '已保存的 Claude 账号',
    headerNone: '没有匹配的账号',
    clickToLogin: '点击直接登录',
    ssoRelogin: (sso: string) => `用 ${sso} 重新登录`,
    fillEmail: '填入邮箱',
    fillOnly: '仅填邮箱',
    fillOnlyTitle: '只把邮箱填进输入框，不切换账号（Shift+Enter）',
    addOther: '添加其他账号',
    addOtherHint: '先保存当前会话，再去登录新账号',
    ssoClicked: (prefix: string, sso: string) => `${prefix}这个账号用 ${sso} 登录，已为你点击对应按钮`,
    ssoManual: (prefix: string, sso: string) =>
      `${prefix}这个账号用 ${sso} 登录，请点页面上的 ${sso} 登录按钮`,
    noEmailRecorded: (prefix: string) => `${prefix}这个账号没有记录邮箱，请手动登录一次`,
    noEmailField: (prefix: string) => `${prefix}页面上找不到邮箱输入框`,
    filled: (prefix: string, email: string) => `${prefix}已填入 ${email}`,
    addFailed: '添加账号失败',
    noEmail: '这个账号没有记录邮箱',
    noField: '页面上找不到邮箱输入框',
    filledPlain: (email: string) => `已填入 ${email}`,
  },

  logout: {
    aria: '退出登录方式',
    title: (who: string) => `要怎么退出 ${who}？`,
    desc: 'claude.ai 的「退出登录」会让服务端吊销这份会话，扩展里保存的快照会同时作废，之后没法一键切回来。',
    localTitle: '仅本地退出',
    recommended: '推荐',
    localBusy: '正在保存会话…',
    localDesc: '保存当前会话后只清掉本地 cookie，随时能一键切回来',
    revokeTitle: '注销并退出',
    revokeBusy: '正在标记账号…',
    revokeDesc: '真正向 claude.ai 注销。这份会话立刻失效，下次要重新登录',
    dontIntercept: '不再拦截退出',
    doneLocal: '已保存会话并在本地退出，可在扩展里一键切回来',
  },

  bg: {
    switching: '正在切换账号',
    notLoggedIn: '当前未登录 claude.ai',
    identityFailed: '会话已失效或无法读取账号信息',
    noSessionCookie: (name: string) => `未找到 ${name}`,
    accountMissing: '账号不存在',
    noSavedSession: '该账号没有保存会话，请用邮箱重新登录一次',
    writeFailed: (names: string) => `会话 cookie 写入失败（${names}），已恢复原会话`,
    invalidSession: (count: number, savedAt: string, restored: boolean) =>
      `cookie 写回成功（${count} 条），但服务端判定这个会话已失效。\n` +
      `快照时间：${savedAt}\n` +
      `最常见的原因是在 claude.ai 上点了「退出登录」—— 那会让服务端吊销这份会话，` +
      `保存的 cookie 就作废了。切换账号请直接用本扩展，或用弹窗里的「退出当前账号」（只清本地 cookie）。\n` +
      (restored
        ? `已恢复切换前的状态，这个账号需要重新登录一次。`
        : `注意：切换前的会话也没能恢复，现在是未登录状态，需要重新登录。`),
    unverified: (who: string, detail: string) =>
      `已写入 ${who} 的会话，但没能连上 claude.ai 确认（${detail}）。\n` +
      `没有回滚。刷新页面确认一下；如果还是旧账号，重试一次即可。`,
    noSession: '没有保存会话',
    sessionExpired: '会话已失效，需要重新登录',
    noQuota: '没有配额数据（免费账号）',
    usageFailed: (detail: string) => `拿不到用量（${detail}）`,
    noneSelected: '没有选中任何账号',
    badgeTitle: (label: string | undefined) =>
      label ? `Claude 账号切换器 — ${label}` : 'Claude 账号切换器 — 未登录',
    unknownMessage: (type: string) =>
      `后台不认识这个消息类型：${type}。多半是扩展代码更新了但没重新加载，去 chrome://extensions 重新加载一次。`,
  },

  messaging: {
    noResponse: '后台无响应，请重新加载扩展',
  },

  transfer: {
    fileWarning:
      '本文件包含 claude.ai 的明文会话 cookie，等同于登录凭证。请勿分享、上传或提交到代码仓库。',
    notObject: '文件内容不是合法的 JSON 对象',
    noAccountsArray: '文件里没有 accounts 数组，可能不是本扩展导出的文件',
    unknownFormat: (format: string) => `不认识的文件格式：${format}`,
    noValidAccounts: '文件里没有可用的账号记录',
  },

  billing: {
    platforms: { web: '官网', ios: 'App Store', android: 'Google Play' },
    rules: {
      web: '短月落到月末，下个月回到原日号（Stripe 官方文档）',
      ios: '短月落到月末，下个月回到原日号（App Store Connect Help）',
      android: '短月下移后不再回弹，之后固定在新日号（Google Play 官方文档）',
    },
    renewal: (where: string, month: number, day: number, days: number) => {
      const when = days === 0 ? '今天续订' : days === 1 ? '明天续订' : `还有 ${days} 天`
      return `${where}${month} 月 ${day} 日续订 · ${when}`
    },
  },

  crypto: {
    warning: '本文件已用密码加密（PBKDF2-SHA256 + AES-GCM-256）。丢失密码无法恢复。',
    unsupported: '不支持的加密算法，可能来自更新版本的扩展',
    wrongPassword: '密码错误，或文件已损坏',
    notJson: '解密成功但内容不是合法 JSON',
  },

  net: {
    notJson: '响应不是 JSON',
    timeout: '超时',
    timeoutMs: (ms: number) => `超时 ${ms}ms`,
    networkError: '网络错误',
  },
}

export type Strings = typeof zh
