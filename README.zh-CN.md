# Claude 账号切换器

<p>
  <a href="https://github.com/wilinz/claude-web-toolbox/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/wilinz/claude-web-toolbox/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/wilinz/claude-web-toolbox/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/wilinz/claude-web-toolbox?label=release"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

**中文** · [English](README.md)

claude.ai 多账号管理 Chrome 扩展。在同一个浏览器里保存多份登录会话，点一下换人，不用反复收验证码。

MV3 + TypeScript + React + Vite + CRXJS。数据只存在本地，不发往任何第三方。

![弹窗与用量总览](docs/screenshot.png)

> 左：各账号的配额总览，逐个账号用它自己的会话查询，全程不改动浏览器里当前登录的账号。右：弹窗里的账号列表，带续订日与会话状态。（截图中账号信息已打码）

## 功能

- **自动记录** —— 在 claude.ai 登录成功后，自动把该账号的会话 cookie 快照存到本地（可关）
- **一键切换** —— 点列表里的账号直接换会话，切换失败会自动回滚到切换前的状态
- **输入框下拉** —— 登录页点一下邮箱框，就在框下方弹出已存账号，像浏览器密码管理器那样
- **添加账号** —— 存好当前会话并只在本地登出，进登录页加新号，原账号随时切回
- **退出拦截** —— 点 claude.ai 自己的「退出登录」时先问一句：真注销，还是只在本地退出
- **用量总览** —— 不切换会话就能看到每个账号的 5 小时 / 7 天配额用了多少
- **订阅续订日** —— 记下每个账号的续订日与渠道，按官网 / App Store / Google Play 各自的规则推算下次续订
- **导入导出** —— 导出为 JSON 备份，可用密码 AES 加密；导入导出都能按项勾选带哪些内容
- **中英双语** —— 默认跟随浏览器语言，也能在设置里固定成中文或英文

## 安装

**用发行版（推荐）**

1. 从 [Releases](https://github.com/wilinz/claude-web-toolbox/releases/latest) 下载 `claude-account-switcher-vX.Y.Z.zip` 并解压
2. Chrome → `chrome://extensions` → 打开右上角「开发者模式」
3. 「加载已解压的扩展程序」→ 选中解压出来的目录

**从源码构建**

```bash
npm install
npm run build   # 产物在 dist/，加载这个目录
```

## 开发

```bash
npm run dev     # HMR，产物同样在 dist/
npm run build   # 生产构建（先跑 tsc --noEmit）
npm run zip     # 打包成 claude-account-switcher.zip
```

改了 service worker 的代码要在 `chrome://extensions` 重新加载扩展才生效。弹窗每次打开都重读文件、SW 不会——所以弹窗里内置了构建戳比对，两边对不上会在顶部压一条橙色横幅提醒你重载。

发版：改 `package.json` 的 `version`，然后推标签，CI 会构建并把 zip 传到 Release。

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## 工作方式

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| Service Worker | `src/background/index.ts` | 捕获/切换/校验会话，消息路由，自动弹窗触发 |
| Content Script | `src/content/index.tsx` | 输入框绑定、邮箱填充与记录、站点数据自愈 |
| 下拉组件 | `src/content/Autofill.tsx` | 锚定在邮箱输入框下方的账号列表 |
| 退出询问 | `src/content/LogoutChoice.tsx` | 拦下站点的退出登录，问清是注销还是本地退出 |
| 站点数据 | `src/lib/siteData.ts` | 清除账号相关缓存，保留设备绑定 |
| Popup | `src/popup/App.tsx` | 账号列表、备注、订阅信息、导入导出 |
| 设置页 | `src/settings/App.tsx` | 全部开关与语言 |
| 用量页 | `src/usage/App.tsx` | 各账号配额总览 |
| Cookie 层 | `src/lib/cookies.ts` | claude.ai 域 cookie 的读取 / 清空 / 写回 |
| 身份识别 | `src/lib/claudeApi.ts` | 调 `/api/account` 拿邮箱与 uuid |
| 用量 | `src/lib/usage.ts` | 借 declarativeNetRequest 换请求头读用量 |
| 续订推算 | `src/lib/billing.ts` | 三个平台各自的短月规则 |
| 导入导出 | `src/lib/transfer.ts` | 导出打包、导入校验、合并策略与内容项裁剪 |
| 加密 | `src/lib/crypto.ts` | PBKDF2-SHA256 + AES-GCM-256 |
| 文案 | `src/i18n/` | 中英两份词表、语言解析与切换 |

### 为什么必须连站点数据一起换

`sessionKey` 是 httpOnly cookie，凭证本身不在 localStorage 里。但 claude.ai 会把「这份缓存属于哪个账号」写在页面侧：

| 位置 | 键 | 内容 |
| --- | --- | --- |
| localStorage | `rq-cache-confirmed-account` | react-query 缓存所属账号 uuid |
| localStorage | `__qk_hint_account_uuid` | 账号 uuid 提示 |
| localStorage | `ccd-sync-owner` | 同步状态所属账号 |
| IndexedDB | `keyval-store` → `react-query-cache` | 整份查询缓存 |

只换 cookie 不清这些，SPA 会带着上一个账号的身份去打接口，403 之后按未登录处理，**直接跳 `/login`**——看起来就像切换失败。

清理是在页面上下文里做的（content script），因为必须**精确保留设备级身份**，用 `chrome.browsingData` 一把清 IndexedDB 会连带抹掉：

- `claude-device-binding` —— 设备绑定密钥
- `x-ark-arid-db` / localStorage 的 `x-ark-arid-*` —— 站点证明

采用「保留白名单」而不是「清除黑名单」，这样 claude.ai 新增账号相关的键时不会漏。

切换时没开着 claude.ai 标签页也没关系：content script 在下次加载时会比对缓存里的账号 uuid 和当前会话，对不上就地清理并重载一次（有 `sessionStorage` 标记防循环）。

### 账号是怎么被识别的

身份来自 `GET /api/account`（返回 `uuid` / `email_address` / `full_name` / `memberships`），依次退到 `/api/bootstrap` 和 `/api/organizations`。

> `/api/auth/current_account` 已经下线，现在返回 **404**，不要再用。

主键优先取服务端返回的账号 `uuid`，其次 `email:<邮箱>`，最后用 `org:<组织 uuid>` 兜底。登录页先记下邮箱、登录成功后再拿到 uuid 的情况，会由 `mergeEmailPlaceholder` 合并成一条记录。

### 切换流程

1. 先把**当前**会话快照存好（否则切走就找不回来了）
2. 清空 `claude.ai` 域下全部 cookie
3. 写回目标账号的快照（跳过已过期的条目，`hostOnly` 的 cookie 不带 `domain` 写）
4. 调一次 `/api/account` 校验会话是否还有效；失效则标记 `sessionInvalid` 并**回滚到切换前的 cookie**
5. 让每个 claude.ai 标签页清掉上个账号的页面缓存
6. 刷新所有 claude.ai 标签页

## 添加账号

弹窗里的「＋ 添加账号」，或登录页下拉最底部的「添加其他账号」，做三件事：

1. 把当前会话完整存进对应账号
2. **只清本地 cookie**——绝不调用 claude.ai 的登出接口，否则服务端会吊销会话，刚存的快照就白存了
3. 打开登录页（复用已有标签页），并跳过这一次的账号选择弹窗

登录成功后自动保存被记成一个新账号，原账号仍在列表里，随时切回。

## 自动保存

三个触发点，都受设置里的「登录 / 会话变化时自动保存当前会话」开关控制：

| 触发 | 时机 | 防抖 |
| --- | --- | --- |
| `cookies.onChanged` | `sessionKey` 新增或变化（登录、会话续期） | 1.5s |
| `tabs.onUpdated` | claude.ai 标签页加载完成 | 0.8s |
| `alarms` | 每 30 分钟刷新一次，避免快照过旧 | — |

关掉开关后这三个都不再触发，但下面这些**仍然会写入快照**，因为它们是用户明确发起的操作：

- 弹窗里的「保存当前会话」按钮
- 切换账号前（先存当前会话，否则切走就找不回来了）
- 「退出当前账号」前
- 导出前（否则刚登录的账号会导出成空快照）

## 用量总览

用量接口要带对应账号的 cookie 才能读，但**为了看一眼用量把浏览器的会话换掉是不可接受的**。所以这里不动 cookie 罐：用 `declarativeNetRequestWithHostAccess` 在请求发出的瞬间改写 Cookie 请求头，只作用于扩展自己发的那一个请求，页面里正在用的会话完全不受影响。

免费版账号没有配额可言，接口正常返回但没有窗口数据——这种情况显示成「无配额」，不算错误。

## 订阅续订日

存的是**平台上显示的那个续订日**，不是购买日期。从购买时间反推走不通：平台按账单地址所在时区算，不是按你的本地时区（实测一例：Google Play 下单 8/17 02:50 UTC+8，Play 里显示 9/16 续订——账单地址在太平洋时区，那边是 8/16 11:50）。让用户照抄平台已经算好的日期，时区偏移就一次性烘进了锚点。

续订日在 29 号及以后时，三个平台的短月规则不一样，界面上会提示：

| 渠道 | 1/31 起订之后 |
| --- | --- |
| 官网（Stripe） | 2/28 → **3/31** → 4/30，锚点保留 |
| App Store | 同上，锚点保留 |
| Google Play | 2/28 → **3/28** → 4/28，锚点永久下移 |

28 号及以前三套规则完全一致，也就不提示。

## 导入 / 导出

弹窗底部：勾选账号后「导出所选」，或直接「导出全部」。导入导出都会先弹一个面板，勾选这次要带哪几类内容：

| 内容项 | 说明 |
| --- | --- |
| 会话 cookie | 登录凭证本身，能直接登进账号 |
| 订阅信息 | 每月续订日与订阅渠道 |
| 扩展设置 | 全部开关 |

账号本身（邮箱、备注、身份）永远带，没有不带的选项。导入侧的面板**照着文件实际内容渲染**：文件里没有的类别置灰不给勾。没勾的类别在合并时**保留本地原值**，不会被空壳盖掉。

「加密导出」**默认勾选**（存在设置里，跨会话保持），此时必须填密码才能导出。要明文导出得先手动取消勾选，并再确认一次。

同名账号的处理策略在导入面板里选：

| 策略 | 行为 |
| --- | --- |
| `merge`（默认） | 同 id 账号只在导入的会话**更新**时才覆盖，不会用旧快照顶掉可用会话 |
| `overwrite` | 同 id 一律用导入的数据覆盖 |
| `replace` | 清空本地全部账号后再写入（会二次确认） |

导入文件是外部输入，全部字段都过 `sanitizeAccount` 校验：非法条目被计数忽略，**cookie 的 domain 不属于 claude.ai 的会被直接丢弃**，避免一个构造过的备份文件往任意站点写凭证。设置同样逐键按 `DEFAULT_SETTINGS` 收敛，认不出的键丢掉、类型不对的退回默认值。

### 加密格式

```
PBKDF2-SHA256(password, salt=16B random, iterations=250000) -> AES-GCM-256 key
密文 = AES-GCM(iv=12B random, JSON.stringify(bundle))
```

salt / iv / 密文以 base64 存在文件里，明文可见的只有 `exportedAt` 和 `accountCount`（方便确认拿对了文件）。AES-GCM 自带认证，密码错或文件被篡改都会在解密时报「密码错误，或文件已损坏」。**密码丢失无法恢复。**

## 界面语言

默认「跟随浏览器」：浏览器显示语言是中文（`zh`、`zh-CN`、`zh-TW`…）就用中文，其余一律英文。想固定住的话，设置页第一项可以直接选中文或 English，改完所有已打开的页面立即跟着变，不用刷新。

文案放在 `src/i18n/`：`zh.ts` 是原本，`en.ts` 用 `Strings` 类型约束——**少一个键、或者带参数的文案参数个数对不上，都在编译期就挡下来**，不会等到界面上冒出一句原文才发现。带参数的文案写成函数而不是 `{n}` 这种占位符，参数的个数和类型跟着 TypeScript 走。

用量结果里存的是窗口的**键**（`five_hour`、`seven_day`…）而不是翻译好的文案，因为这份结果会进缓存——存死了文案，换语言之后缓存里的旧文案就跟着一起显示出来了。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `cookies` + `host_permissions` | 读写 claude.ai 的会话 cookie，这是切换功能的核心 |
| `storage` | 把账号快照存在 `chrome.storage.local` |
| `tabs` | 切换后刷新 claude.ai 标签页、向页面发送弹窗消息 |
| `alarms` | 每 30 分钟刷新一次当前账号的快照，避免存的会话过旧 |
| `scripting` | 注册页面世界的退出拦截脚本 |
| `declarativeNetRequestWithHostAccess` | 只为读用量的那一个请求改写 Cookie 头 |

不需要 `browsingData`：站点数据的清理由 content script 在页面上下文里精确完成。

## 常见问题

### 切换后跳回登录页

先看扩展给出的失败原因（页面底部的黑色提示条，长文案停留 15 秒）。最常见的两种：

**1. 在 claude.ai 上点了「退出登录」。** 那个操作会让**服务端吊销**这份会话，保存的 cookie 当场作废，写回去也没用。

> 切换账号请直接点扩展里的账号，或用弹窗里的「退出当前账号」——后者只清本地 cookie，不碰服务端，快照仍然有效。开着「退出拦截」的话，点站点自己的退出登录时扩展会先问你一句。

**2. 上个账号的页面缓存没清干净。** 打开设置里的「切换时清除上个账号的页面缓存」（默认开）。

### Google / Apple 登录的账号

这类账号没有密码，也不走邮箱验证码，往邮箱框里填地址没有意义。扩展会从页面的 `lastLoginMethod` 记下登录方式，会话失效时直接帮你点「Continue with Google」/「Continue with Apple」，列表里也会显示「用 Google 重新登录」而不是「填入邮箱」。

### 账号显示成组织名（`x@y.com's Organization`）

旧版本用已下线的 `/api/auth/current_account`，只能退到 `/api/organizations` 拿组织名。升级后启动时会自动从组织名里把邮箱补回去；重新登录一次则会拿到完整的账号信息。

### 保存成功了，但什么都没发生

多半是 service worker 还在跑旧代码——它不像弹窗那样每次打开重读文件。弹窗顶部出现橙色横幅时点一下「重新加载扩展」即可。

## 注意

- **会话 cookie 等价于登录凭证**，明文存在 `chrome.storage.local` 里。共用电脑请谨慎使用。
- 不填密码导出的备份是**明文凭证**，别提交进 git、别丢进网盘或聊天工具。需要传输时务必填密码。
- 扩展不发送任何数据到第三方，所有请求只打 `claude.ai` 自身接口。
- claude.ai 可能调整登录页 DOM 或接口返回结构；邮箱选择器集中在 `src/content/index.tsx` 的 `EMAIL_SELECTORS`，身份解析集中在 `src/lib/claudeApi.ts`，改起来只需要动这两处。

## 许可证

[MIT](LICENSE) © wilinz

本项目与 Anthropic 无关，未获其背书。
