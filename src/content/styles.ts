/** shadow DOM 内联样式：避免被 claude.ai 自身样式影响，也不污染页面 */
export const pickerStyles = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }

.backdrop {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(20, 18, 16, .45); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  animation: fade .15s ease-out;
}
@keyframes fade { from { opacity: 0 } to { opacity: 1 } }

.panel {
  width: min(420px, calc(100vw - 32px));
  max-height: min(560px, calc(100vh - 64px));
  display: flex; flex-direction: column;
  background: #ffffff; color: #1f1e1d;
  border: 1px solid rgba(0,0,0,.08);
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(0,0,0,.28);
  overflow: hidden;
}
@media (prefers-color-scheme: dark) {
  .panel { background: #262624; color: #f5f4ef; border-color: rgba(255,255,255,.1); }
  .row { border-color: rgba(255,255,255,.08) !important; }
  .row:hover { background: rgba(255,255,255,.05) !important; }
  .sub { color: rgba(245,244,239,.55) !important; }
  .foot { border-color: rgba(255,255,255,.08) !important; }
  .ghost { color: rgba(245,244,239,.7) !important; }
}

.head { padding: 18px 20px 12px; }
.title { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .01em; }
.sub { margin: 4px 0 0; font-size: 12.5px; line-height: 1.5; color: rgba(31,30,29,.55); }

.list { overflow-y: auto; padding: 4px 8px 8px; }
.row {
  width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border: 0; border-radius: 10px;
  background: transparent; text-align: left; cursor: pointer;
  font-size: 13.5px; color: inherit;
}
.row:hover { background: rgba(0,0,0,.045); }
.row[disabled] { cursor: default; opacity: .55; }

.avatar {
  flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%;
  display: grid; place-items: center;
  background: #c96442; color: #fff; font-size: 13px; font-weight: 600;
}
.meta { min-width: 0; flex: 1; }
.email { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hint { display: block; margin-top: 2px; font-size: 11.5px; color: rgba(128,122,114,.95); }
.tag {
  flex: 0 0 auto; font-size: 11px; padding: 3px 8px; border-radius: 999px;
  background: rgba(201,100,66,.14); color: #c96442; font-weight: 500;
}
.tag.weak { background: rgba(128,122,114,.16); color: rgba(128,122,114,1); }

.foot {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 14px; border-top: 1px solid rgba(0,0,0,.07);
}
.ghost {
  border: 0; background: transparent; cursor: pointer;
  font-size: 12px; color: rgba(31,30,29,.6); padding: 6px 8px; border-radius: 8px;
}
.ghost:hover { background: rgba(0,0,0,.05); }

/* ---- 退出方式二选一 ---- */
.choice {
  width: 100%; display: flex; flex-direction: column; gap: 3px;
  padding: 12px 14px; margin-bottom: 6px;
  border: 1px solid rgba(0,0,0,.1); border-radius: 12px;
  background: transparent; text-align: left; cursor: pointer; color: inherit;
}
.choice:hover { background: rgba(0,0,0,.04); border-color: rgba(201,100,66,.5); }
.choice[disabled] { cursor: default; opacity: .6; }
.choice-title { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; }
.choice-sub { font-size: 12px; line-height: 1.5; color: rgba(128,122,114,.95); }
.choice.danger:hover { border-color: rgba(190,60,60,.55); background: rgba(190,60,60,.06); }
.choice.danger .choice-title { color: #b0413e; }

@media (prefers-color-scheme: dark) {
  .choice { border-color: rgba(255,255,255,.12); }
  .choice:hover { background: rgba(255,255,255,.05); }
  .choice.danger .choice-title { color: #e2807c; }
}

/* ---- 输入框下方的账号下拉（密码管理器那种） ---- */
.autofill {
  position: fixed; z-index: 2147483647;
  max-height: 260px; overflow-y: auto;
  padding: 4px;
  background: #ffffff; color: #1f1e1d;
  border: 1px solid rgba(0,0,0,.1);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,.16);
  animation: pop .12s ease-out;
}
@keyframes pop { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: none } }

.autofill-head {
  padding: 7px 10px 5px; font-size: 11px; font-weight: 500;
  color: rgba(128,122,114,.95); letter-spacing: .02em;
}

/* 一行 = 主操作（整行）+ 可选的「仅填邮箱」副操作，按钮不能嵌套所以拆成两个 */
.autofill-item {
  display: flex; align-items: center; gap: 2px;
  border-radius: 8px; padding-right: 4px;
}
.autofill-item.active { background: rgba(201,100,66,.12); }

.autofill-row {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border: 0; border-radius: 8px;
  background: transparent; text-align: left; cursor: pointer;
  font-size: 13px; color: inherit;
}
.autofill-row[disabled] { cursor: default; opacity: .6; }

.autofill-fill {
  flex: 0 0 auto; border: 1px solid rgba(0,0,0,.12); border-radius: 7px;
  background: transparent; color: rgba(128,122,114,1);
  font-size: 11px; padding: 4px 8px; cursor: pointer; white-space: nowrap;
}
.autofill-fill:hover { border-color: rgba(201,100,66,.55); color: #c96442; }
.autofill-fill[disabled] { cursor: default; opacity: .5; }

.autofill-avatar {
  flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center;
  background: #c96442; color: #fff; font-size: 12px; font-weight: 600;
}
.autofill-meta { min-width: 0; flex: 1; }
.autofill-email { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.autofill-hint { display: block; margin-top: 1px; font-size: 11px; color: rgba(128,122,114,.95); }
/* 这行不在 .autofill-item 里，撑不到满宽要自己声明 */
.autofill-add { width: 100%; border-top: 1px solid rgba(0,0,0,.07); border-radius: 0 0 8px 8px; margin-top: 2px; }
.autofill-plus { background: transparent; color: rgba(128,122,114,.95); font-size: 16px; border: 1px dashed rgba(128,122,114,.5); }

.autofill-tag {
  flex: 0 0 auto; font-size: 10.5px; padding: 2px 7px; border-radius: 999px;
  background: rgba(201,100,66,.14); color: #c96442; font-weight: 500;
}

@media (prefers-color-scheme: dark) {
  .autofill { background: #262624; color: #f5f4ef; border-color: rgba(255,255,255,.12); }
  .autofill-item.active { background: rgba(255,255,255,.08); }
  .autofill-add { border-top-color: rgba(255,255,255,.1); }
  .autofill-fill { border-color: rgba(255,255,255,.16); color: rgba(245,244,239,.7); }
  .autofill-fill:hover { border-color: rgba(201,100,66,.6); color: #e08a6b; }
}

.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  z-index: 2147483647; padding: 12px 16px; border-radius: 10px;
  background: #1f1e1d; color: #fff; font-size: 13px; line-height: 1.6;
  box-shadow: 0 8px 28px rgba(0,0,0,.3);
  max-width: min(560px, calc(100vw - 40px));
  white-space: pre-wrap; word-break: break-word;
}
`
