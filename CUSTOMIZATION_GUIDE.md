# Eruda 交互功能定制指南

> 适用仓库：`/Users/randolf/Documents/eruda`（eruda **v3.4.3**）
> 目标：在不破坏现有结构的前提下，新增或改造「交互功能」（按钮、面板、手势、开关、主题等）
> 官方文档：[Writing a Plugin](https://eruda.liriliri.io/docs/plugin.html) · [Contributing Guide](https://eruda.liriliri.io/docs/contributing.html) · [API](https://eruda.liriliri.io/docs/api.html)（中文版把 `/docs/` 换成 `/zh/docs/`）
> 类型定义：[eruda.d.ts](eruda.d.ts)（`Tool`、`ErudaApis`、`Settings`、`Snippets` 等接口都在这里）

---

## 0. 先选对路径（决策表）

| 你想做的交互 | 走哪条路 | 要不要改源码 / 重新构建 |
| --- | --- | --- |
| 加一个「点一下就执行」的小动作（清缓存、刷新、切环境、复制信息） | **路径 A**：`eruda.get('snippets').add(...)` | 否，运行时即可 |
| 加一个带自己 UI 的标签页 / 面板（表单、开关、列表、自定义手势） | **路径 B**：`eruda.add(自定义 Tool)` | 否，外部脚本即可 |
| 让新面板成为「默认内置面板」（每次 init 自动出现） | **路径 C**：新增 `src/<Name>/` + 改 `src/eruda.js` | 是，`npm run dev/build` |
| 改入口按钮（长按/双击/自定义菜单）、面板拖拽缩放、Tab 行为 | **路径 C**：改 `src/EntryBtn/`、`src/DevTools/` | 是 |
| 改配色、主题、视觉样式 | **路径 D**：`eruda.util.evalCss` 或 `src/lib/themes.js` | 否（运行时）/ 是（内置主题） |

**一句话原则**：能用 A/B（运行时 API）解决的，不要动源码；只有要「内置化」或「改 eruda 自身交互」才走 C/D 并重新构建。

---

## 1. 环境准备与调试闭环

```bash
cd /Users/randolf/Documents/eruda
npm install          # 当前仓库 node_modules 为空，必须先装
npm run setup        # 复制 jasmine 到 test/lib，只有跑 npm test 才需要
npm run dev          # webpack-dev-server，端口 8080
```

`npm run dev` 的关键配置（`build/webpack.base.js:43-54`、`build/webpack.dev.js`）：

- devServer 静态目录 = `test/`，端口 **8080**，输出 `assets/eruda.js`（`publicPath: '/assets/'`）。
- 所以测试页都用 `<script src="assets/eruda.js"></script>`，例如 `test/manual.html:11`。
- 打开 `http://localhost:8080/manual.html` 即可看到实时构建结果；`test/manual.html:78-99` 已经有一段 `eruda.add(...)` 的插件演示，是最好的参考。
- 想单独验证自己的交互，就在 `test/` 下新建一个 html，照抄 `test/manual.html` 的头部 + `eruda.init(); eruda.show();`（`test/manual.html:188-190`）。

生产构建与校验（`package.json`）：

```bash
npm run build   # webpack.prod.js + webpack.polyfill.js + build/build.js，产物在 dist/
npm run lint    # eslint .
npm test        # karma（需先 npm run setup）
npm run es5     # es-check 校验 ES5 兼容，改源码后建议跑
```

⚠️ **本仓库的一个坑**：`build`/`format`/`setup`/`genIcon` 这些脚本都通过 `lsla` 这个 CLI 启动器去调 `shx`、`prettier`、`genIcon` 等，而它们**没有声明在 `package.json` 的 devDependencies 里**（本会话里 `lsla` 也不在 PATH 上）。因此：
- 本地调交互优先用 `npm run dev`（纯 webpack-dev-server，不依赖 `lsla`）；
- 若 `npm run build` 报 `lsla: command not found`，可直接跑底层命令：`npx webpack --config build/webpack.prod.js`，再 `node build/build.js` 补 `dist/package.json`；或全局补装 `lsla`。

---

## 2. 路径 A：运行时 API（零构建，最快）

`eruda.init()` 之后，直接拿内置工具往里加东西。**不需要重新编译**。

### 2.1 加可点击的小动作 —— Snippets

`src/Snippets/Snippets.js` 提供 `add(name, fn, desc)` / `remove(name)` / `run(name)` / `clear()`；面板内部对每个 `.eruda-run` 行做点击委托（`Snippets.js:61-72`）。内置示例见 `src/Snippets/defSnippets.js`（Border All、Refresh Page、Edit Page、Fit Screen 等）。

```js
eruda.init()

const snippets = eruda.get('snippets')

// ① 清缓存并刷新
snippets.add('清空缓存并刷新', () => {
  localStorage.clear()
  sessionStorage.clear()
  location.reload()
}, 'Clear storage and reload')

// ② 切换接口环境（带持久化）
snippets.add('切到预发环境', () => {
  localStorage.setItem('API_ENV', 'staging')
  eruda.get().notify('已切到 staging，请刷新页面', { icon: 'success' })
}, 'Switch API env to staging')

// ③ 复制当前页面信息
snippets.add('复制页面 URL', () => {
  navigator.clipboard && navigator.clipboard.writeText(location.href)
}, 'Copy current URL')

eruda.show('snippets')   // 直接跳到该面板
```

### 2.2 加一条信息 / 配置项 —— Info、Settings

```js
// Info：val 可以是字符串，也可以是函数（每次渲染时求值，见 src/Info/Info.js:91-95）
eruda.get('info').add('当前用户', () => window.__CURRENT_USER__ || '未登录')
eruda.get('info').add('构建号', '2026.11.13')

// Settings：先建持久化配置，再挂控件
const cfg = eruda.Settings.createCfg('my-tool', {
  enabled: true,
  mode: 'A',
  threshold: 50,
})
const settings = eruda.get('settings')
settings.text('我的定制')                       // 分组标题
settings.switch(cfg, 'enabled', '启用定制功能')
settings.select(cfg, 'mode', '运行模式', ['A', 'B', 'C'])
settings.range(cfg, 'threshold', '阈值', { min: 0, max: 100, step: 1 })
settings.button('重置并刷新', () => location.reload())
settings.separator()

cfg.on('change', (key, val) => console.log('[cfg]', key, val))  // 配置变更监听
```

`Settings` 控件签名（`src/Settings/Settings.js:63-114`）：
`switch(config, key, desc)`、`select(config, key, desc, selections)`、`range(config, key, desc, {min,max,step})`、`button(text, handler)`、`text(text)`、`separator()`、`clear()`、`remove(config, key)`。
`Settings.createCfg(name, data)` 返回 `new LocalStore('eruda-' + name, data)`（`Settings.js:147-149`），数据落在 localStorage，键名以 `eruda` 开头；`cfg.get(k)` / `cfg.set(k,v)` / `cfg.on('change', (k,v)=>{})`。

### 2.3 控制显隐、位置、缩放、入口按钮

```js
eruda.show()                 // 展开面板
eruda.show('console')        // 展开并切到某个面板 → devTools.showTool(name)
eruda.hide()                 // 收起
eruda.position()             // 读入口按钮位置 {x, y}
eruda.position({ x: 20, y: 300 })  // 设置入口按钮位置
eruda.scale(1.5)             // 整体缩放（会广播 SCALE，样式里的 px 会跟着变）
eruda.get('entryBtn').on('click', () => console.log('入口被点了'))
eruda.destroy()              // 销毁，之后可再次 init()
```

`init` 可选项（`src/eruda.js:34-41`、`eruda.d.ts:21-46`）里和「交互」最相关的几个：

| 选项 | 作用 |
| --- | --- |
| `tool: ['console','snippets']` | **只加载指定内置面板**（默认 7 个，见 `src/eruda.js:290-299`）。这是最轻量的「裁剪交互」手段 |
| `inline: true` | 隐藏入口按钮、面板内联显示（`src/eruda.js:60-64`） |
| `defaults: { transparency, displaySize, theme }` | 初始透明度/面板高度/主题（`src/DevTools/DevTools.js:37-44`） |
| `useShadowDom` / `container` / `autoScale` | 样式隔离 / 挂载容器 / 移动端自动缩放 |

⚠️ `tool` 数组里的名字会做 `this[upperFirst(name)]` 查找（`src/eruda.js:306`），**只有 eruda 对象上已注册构造器的名字才有效**；自定义名字请先按路径 C 注册，否则会被静默跳过。

---

## 3. 路径 B：自定义面板 / 插件（完整可复制示例）

这是「定制交互功能」的主力方式：一个 `Tool` 就是一个标签页，你自己画 DOM、绑事件。`eruda.add()` 接受三种形态（`src/eruda.js:109-117`、`src/DevTools/DevTools.js:97-133`）：

- 普通对象 `{ name, init, show, hide, destroy }`；
- 函数 `fn(eruda)` 返回上面的对象或 `eruda.Tool` 子类实例（**推荐**，能拿到 `eruda` 引用）；
- `eruda.Tool` 的实例。

`DevTools.add` 会为每个工具生成一个 `<div>` 并调用 `tool.init($el, devTools)`，其中 `$el` 是 licia 的 jQuery-like 对象，**第二个参数 `devTools` 是 DevTools 实例**（可用来 `notify()` / `showTool()`）；`show()`/`hide()` 由切换标签时调用，依赖 `this._$el`，所以 `init` 里必须 `super.init($el)` 或 `this._$el = $el`。

把下面这段存成 `test/my-panel.html`，`npm run dev` 后打开 `http://localhost:8080/my-panel.html` 即可看到效果：

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My Panel</title>
    <script src="assets/eruda.js"></script>
  </head>
  <body>
    <h1>点击右下角 eruda 图标</h1>
    <script>
      eruda.init()

      eruda.add(function (eruda) {
        class QuickPanel extends eruda.Tool {
          constructor() {
            super()
            this.name = 'quick'                 // 标签页标题，必须唯一
            // 用 var(--xxx) 跟随主题；px 会随 eruda.scale() 一起缩放
            this.style = eruda.util.evalCss(`
              .eruda-quick { padding: 10px; color: var(--foreground); }
              .eruda-quick h2 { font-size: 14px; margin: 0 0 10px; color: var(--primary); }
              .eruda-quick .row { display: flex; gap: 8px; margin-bottom: 8px; }
              .eruda-quick input {
                flex: 1; padding: 6px; border: 1px solid var(--border);
                background: var(--darker-background); color: var(--foreground);
              }
              .eruda-quick button {
                padding: 6px 12px; border: 1px solid var(--border);
                background: var(--accent); color: #fff; cursor: pointer;
              }
              .eruda-quick .log {
                margin-top: 10px; padding: 8px; font-size: 12px;
                border: 1px solid var(--border); color: var(--foreground);
              }
            `)
          }

          init($el, devTools) {
            super.init($el)                    // 关键：设置 this._$el，show/hide 才能工作
            this.devTools = devTools
            this.count = 0

            $el.html(`
              <div class="eruda-quick">
                <h2>快捷操作</h2>
                <div class="row">
                  <input class="eruda-quick-url" placeholder="输入要打开的 URL" />
                  <button class="eruda-quick-go">打开</button>
                </div>
                <div class="row">
                  <button class="eruda-quick-notify">发通知</button>
                  <button class="eruda-quick-count">点我 +1</button>
                </div>
                <div class="log eruda-quick-log">尚未操作</div>
              </div>
            `)

            // 事件委托：所有交互都挂在自己的 $el 上，不要写到 document.body
            $el.on('click', '.eruda-quick-go', () => {
              const url = $el.find('.eruda-quick-url').val()
              if (url) location.href = url
            })
            $el.on('click', '.eruda-quick-notify', () => {
              this.devTools.notify('来自自定义面板的通知', { icon: 'success' })
            })
            $el.on('click', '.eruda-quick-count', () => {
              this.count++
              $el.find('.eruda-quick-log').text('点击次数：' + this.count)
            })
          }

          destroy() {
            super.destroy()                    // 移除 DOM
            eruda.util.evalCss.remove(this.style)  // 移除样式，避免重复注册泄漏
          }
        }
        return new QuickPanel()
      })

      eruda.show('quick')
    </script>
  </body>
</html>
```

**要点 / 坑**：

- `name` 必须唯一；重名时 `DevTools.add` 会 `logger.warn('Tool xxx already exists')` 并忽略（`DevTools.js:106-112`）。标签 `id` = `name.replace(/\s+/g, '-')`。
- 用普通对象形态时，若省略 `show`/`hide`，`DevTools.add` 会用 `defaults()` 补上基类实现，但它们依赖 `this._$el`——所以**自定义 `init` 里一定要 `this._$el = $el`**。
- `eruda.util.evalCss(css)` 返回样式句柄，`eruda.util.evalCss.remove(handle)` 移除；它内部会把 CSS 里的 `var(--foreground)` 等替换成当前主题色、把 `px` 按 `scale` 缩放、**把 `_` 全部替换成 `eruda-`**（`src/lib/evalCss.js:69-79`）。因此自定义 CSS 里**不要出现下划线**，类名直接写 `eruda-xxx`。
- 可用主题变量来自 `src/lib/themes.js:5-25`：`--background`、`--foreground`、`--primary`、`--accent`、`--border`、`--highlight`、`--darker-background`、`--select-foreground`、`--contrast` 等（kebab-case）。
- 同一个 CSS 字符串重复 `evalCss` 会命中去重直接 `return`（`evalCss.js:18-20`），返回 `undefined`，此时无法 `remove`——样式字符串保持唯一。
- 需要用户输入时：外部插件最稳妥是像上面那样自己渲染 `<input>`；若是从源码构建，可 `import LunaModal from 'luma-modal'`（内置「Search Text」用的是 `LunaModal.prompt('Enter the text')`，见 `src/Snippets/defSnippets.js:46`）。注意包名是 `luna-modal`。
- 通知：`devTools.notify(content, options)`（`DevTools.js:249-251`），`options` 如 `{ icon: 'success' }`（内置用法见 `src/Info/Info.js:115`）。
- 想做成可分发的独立插件包，用官方模板 [eruda-plugin](https://github.com/liriliri/eruda-plugin)；第三方范例见 `README.md:75-77`。

---

## 4. 路径 C：改源码（内置化 + 改 eruda 自身交互）

只有这几种情况需要动源码并重新构建。

### 4.1 把自定义面板变成「默认内置面板」

1. 新建 `src/Mytool/Mytool.js`（+ `Mytool.scss`），类继承 `Tool`：
   ```js
   import Tool from '../DevTools/Tool'
   import evalCss from '../lib/evalCss'
   import { classPrefix as c } from '../lib/util'

   export default class Mytool extends Tool {
     constructor() {
       super()
       this.name = 'mytool'                       // 与下面的 tool 字符串对应
       this._style = evalCss(require('./Mytool.scss'))
     }
     init($el) {
       super.init($el)
       $el.html(`<div class="${c('mytool')}">Hello</div>`)
       this._bindEvent()
     }
     destroy() {
       super.destroy()
       evalCss.remove(this._style)
     }
     _bindEvent() {
       this._$el.on('click', c('.mytool'), () => { /* 你的交互 */ })
     }
   }
   ```
   SCSS 里类名写 `.mytool` 即可：webpack 的 `postcss-prefixer`（`build/webpack.base.js:17-20`）会加 `_` 前缀，`evalCss` 再把它换成 `eruda-`，正好与 JS 里 `c('mytool')`（`src/lib/util.js:108-146`，输出 `eruda-mytool`）对齐。样式变量用 `var(--foreground)` 等。
2. 在 `src/eruda.js` 顶部 `import Mytool from './Mytool/Mytool'`，并在默认导出对象里加一行属性，属性名 = `upperFirst(工具名)`：工具名 `mytool` → 属性 `Mytool`。
3. 把 `'mytool'` 加进 `_initTools` 的默认 `tool` 数组（`src/eruda.js:290-299`）；或在调用方 `eruda.init({ tool: [...,'mytool'] })` 里指定。
4. `npm run dev` 验证 → `npm run build` 出包。

原因：`_initTools` 用 `const Tool = this[upperFirst(name)]; devTools.add(new Tool())`（`src/eruda.js:306-308`）按名字反查构造器，所以必须同时注册属性 + 名字。

### 4.2 改入口按钮交互

`src/EntryBtn/EntryBtn.js` 是拖拽 + 点击逻辑：

- `_onDragStart` / `_onDragMove` / `_onDragEnd`（`EntryBtn.js:87-149`）：`pointerdown/move/up`，位移 >3px 判定为拖动，否则 `this.emit('click')`。
- 点击后的默认行为在 `src/eruda.js:277-280`：`this._entryBtn.on('click', () => this._devTools.toggle())`。
- 想加「长按 / 双击 / 自定义菜单」，就在 `EntryBtn._bindEvent()`（`EntryBtn.js:150-157`）里加监听，或改 `_onDragEnd`。
- 运行时想**附加**行为可用 `eruda.get('entryBtn').on('click', fn)`；但要**替换**默认的 toggle，必须改 `src/eruda.js:279`（内部监听器是匿名箭头，无法用 `off` 精确移除）。
- 位置记忆配置在 `EntryBtn.initCfg()`（`EntryBtn.js:158-167`）：`rememberPos`。

### 4.3 改面板拖拽缩放 / Tab / 全局手势

`src/DevTools/DevTools.js` 的 `_bindEvent()`（`DevTools.js:342-407`）：

- `.resizer` 的 `pointerdown/move/up` 拖动改 `config.displaySize`，范围钳在 **40–100**（`DevTools.js:365-382`）；`inline` 模式下 resizer 隐藏。
- `this.$container.on('click', (e) => e.stopPropagation())`（`DevTools.js:396`）阻止点击穿透到宿主页面。
- Tab 用 LunaTab，`select` 事件 → `showTool(id)`（`DevTools.js:316-321`）；`showTool` 会 `emit('showTool', name, lastTool)`，可在自己的工具里监听切换。
- 主题/透明度/尺寸配置在 `initCfg()`（`DevTools.js:191-248`），`System preference` 会跟随系统主题切换。

### 4.4 内部事件总线（仅源码内）

`src/lib/emitter.js` 定义 `emitter.ADD = 'ADD'`、`emitter.SHOW = 'SHOW'`、`emitter.SCALE = 'SCALE'`；`src/eruda.js:175-187` 把它们分别绑定到 `add`、`show`、`evalCss.setScale`。CDN 插件加载用的就是 `emitter.emit(emitter.ADD, window[globalName])` 和 `emitter.emit(emitter.SHOW, name)`（`src/Snippets/defSnippets.js:220-221`）。这些常量**没有导出到 `eruda.util`**，外部插件请直接调 `eruda.add()`；只有从源码构建的内部代码才用 emitter。

---

## 5. 路径 D：主题与视觉定制

- **运行时换主题**：`eruda.init({ defaults: { theme: 'Dark' } })`，或在 Settings 面板选；主题列表来自 `src/lib/themes.js:75-92` 的 `darkThemes` 与整个 `themes` 对象（Light / Dark / Material Oceanic / Monokai Pro / Dracula / AMOLED …）。
- **跟随主题写自己的样式**：用 `eruda.util.evalCss()` + `var(--xxx)`（见第 3 节要点），这样切换主题时 `evalCss.setTheme()` 会重新替换颜色（`src/lib/evalCss.js:40-48`）。
- **判断深浅色**：`eruda.util.isDarkTheme(theme)` / `eruda.util.getTheme()`（`src/eruda.js:68-89`）；内置 `isDarkTheme` 是查表判断（`src/lib/themes.js:90-92`）。
- **新增内置主题**：在 `src/lib/themes.js` 的 `export default { ... }` 里加一项（`createLightTheme({...})` 或 `createDarkTheme({...})`），深色主题还要把名字加进 `darkThemes` 数组，然后重新构建。
- **完全自定义容器样式**：`eruda.init({ container: 你的元素, useShadowDom: false })` 可让 eruda 挂到指定节点、去掉 Shadow DOM 隔离，便于外部 CSS 覆盖（注意选择器要带 `eruda-` 前缀，见 `src/style/style.scss:5-49`）。

---

## 6. 关键 API 速查

| API | 位置 | 说明 |
| --- | --- | --- |
| `eruda.init(options)` | `src/eruda.js:34` | 初始化，`_isInit` 防重复 |
| `eruda.add(tool)` | `src/eruda.js:109` | 加面板；支持对象 / `fn(eruda)` / Tool 实例 |
| `eruda.remove(name)` | `src/eruda.js:118` | 移除面板 → 触发该工具 `destroy()` |
| `eruda.get(name?)` | `src/eruda.js:100` | 无参返回 DevTools；`'entryBtn'` 返回入口按钮；否则返回对应工具 |
| `eruda.show(name?) / hide()` | `src/eruda.js:123-137` | 展开 / 收起，可指定面板 |
| `eruda.position(p?) / scale(s?)` | `src/eruda.js:151-169` | 入口按钮位置 / 整体缩放 |
| `eruda.destroy()` | `src/eruda.js:139` | 销毁后可再次 `init()` |
| `devTools.notify(content, options)` | `src/DevTools/DevTools.js:249` | 顶部通知 |
| `devTools.showTool(name)` | `src/DevTools/DevTools.js:161` | 切换面板，发 `showTool` 事件 |
| `snippets.add(name, fn, desc)` | `src/Snippets/Snippets.js:32` | 可点击小动作 |
| `info.add(name, val)` | `src/Info/Info.js:35` | 信息项，`val` 可为函数 |
| `settings.switch/select/range/button` | `src/Settings/Settings.js:63-114` | 配置控件 |
| `eruda.Settings.createCfg(name, data)` | `src/Settings/Settings.js:147` | 持久化配置（LocalStore） |
| `eruda.Tool` | `src/DevTools/Tool.js` | 工具基类：`init($el)` / `show()` / `hide()` / `destroy()` |
| `eruda.util.evalCss / isErudaEl / getTheme / isDarkTheme` | `src/eruda.js:68` | 工具函数 |

---

## 7. 常见坑清单

1. `eruda.add()` / `eruda.get()` 必须在 `eruda.init()` **之后**调用，否则 `logger.error('Please call "eruda.init()" first')`（`src/eruda.js:188-191`）。
2. 自定义工具 `init` 里务必 `super.init($el)`（或 `this._$el = $el`），否则 `show/hide` 报错。
3. 事件只绑在自己的 `$el` 上（事件委托），不要挂 `document.body`；`DevTools` 会 `stopPropagation` 容器点击。
4. `evalCss` 的 CSS 里别写下划线；类名用 `eruda-xxx`；颜色用 `var(--xxx)` 主题变量。
5. `tool: [...]` 只认已注册到 eruda 对象上的构造器名，自定义名字需先做 4.1 的注册。
6. `npm run build` 依赖未声明的 `lsla` CLI；本地调交互优先 `npm run dev`。
7. 入口按钮的默认 `click → toggle` 只能「附加」不能「替换」，替换要改 `src/eruda.js:279`。
8. 分发给别人的插件建议做成独立包（[eruda-plugin](https://github.com/liriliri/eruda-plugin)），不要直接改 eruda 源码。
