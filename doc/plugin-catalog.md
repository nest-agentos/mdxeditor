# mdx 插件目录

## MDxEditor

实现 `IEditor`。`createMDxEditor(container, options)` 返回实例。支持 edit/render 双模式。

## MDxPlugin 接口

```typescript
interface MDxPlugin {
    name: string;
    install(ctx: PluginContext): void;
    destroy?(): void;
}
```

## 核心插件一览

| 类别 | 插件 | 功能 |
|---|---|---|
| 语法 | `MermaidPlugin` | Mermaid 图表 |
| | `MathJaxPlugin` | LaTeX 公式 |
| | `FoldablePlugin` | 可折叠块 |
| | `CalloutPlugin` | Callout |
| 交互 | `TaskListPlugin` | 任务列表 toggle |
| | `TablePlugin` | 表格编辑 |
| | `CodeBlockControlsPlugin` | 代码块复制/下载/折叠 |
| | `PlaygroundPlugin` | HTML/CSS/JS 隔离预览，单块或同名分组运行 |
| 自动完成 | `MentionPlugin` | @-mention |
| | `TagPlugin` | #-tag 自动完成 |
| Anki | `ClozePlugin` / `MemoryPlugin` | 完形填空/间隔重复（SM-2 变种，逐卡存储，可重置） |
| UI | `ToolbarPlugin` / `TitleBarPlugin` | 工具栏/标题栏；`ui:toolbar` 在 edit 模式显示，render 模式隐藏整行 |

## 宿主与数据适配

插件通过 `PluginContext.getAssets()`、`getDocumentPath()`、`getScopedStore()` 和 `notify()` 访问公共能力；使用 `registerCodeMirrorExtension` / `registerSyntaxExtension` 注册扩展。

`context.renderMarkdown(markdown, options)` 解析内部片段，复用外层语法扩展与 HTML 策略，不执行生命周期钩子。异步 `afterRender` 钩子必须返回转换后的 `{ html, options }`，保留其他插件携带的 options。`FoldablePlugin` 使用此入口，避免内部解析绕过宿主的 `htmlPolicy`。

插件生成 `<details data-mdx-disclosure-key="stable-key">` 可保留展开状态；同一渲染器内 key 须唯一。`FoldablePlugin` 使用 `data-mdx-disclosure` 自动生成基于摘要和出现次序的 key。代码块控件根据代码内容及出现次序生成 key，也支持宿主在 `pre` 上显式提供 `data-mdx-disclosure-key`。状态只在实例内存保留，销毁时清理。

## 挖空复习（cloze:memory）

- 身份：`locator` 由内容 hash 与同内容出现序号生成（`auto-<hash>-<occurrence>`），因此插入/重排其他挖空不会让已有进度错位；作者显式写 `--[id] text--` 时以 id 为准。旧版位置序号（`auto-<n>`）通过 `data-cloze-legacy-locator` 在首次渲染时只在内存采纳，实际评分时才写入新格式。
- 调度：`nextReview(state, grade, now, maxIntervalDays)` 是纯函数（SM-2 变种），`now` 与 `maxIntervalDays`（默认 36500 天）可配置，测试时可注入时钟。
- 状态：`is-new` / `is-cooling` / `is-learning` / `is-approaching`（已进入提前隐藏窗口但未到期）/ `is-due` / `is-danger` / `is-cleared`。只有 `is-cleared` 与 `is-cooling` 默认可见。
- 存储：按卡写入 `card:<locator>`，值带 `v`；历史整份 `_mdx_srs` 只读加载，被实际评分的卡片才逐卡迁移，无法解析的条目保留不删；已有新格式进度优先。打开、临时显隐、渲染均不产生评分写入。宿主的 store 不提供 `entries()` 时退化为整值读写。
- 持久显示：评分菜单在四个双行评分按钮（等级 / 实际间隔）之后分组提供“固定显示”（图钉）和“固定隐藏”（锁）两个互斥图标，窄屏时设置组换行靠右；再次点击已选图标恢复正常复习，两个图标均未选中表示跟随复习调度。正文仅在固定时显示对应的可聚焦状态图标，位于答案与占位符之外，点击打开设置且不改变显隐；提示说明固定显示不改变复习时间。显示偏好以 `display:<locator>` 独立保存 `{v: 1, mode: 'open' | 'hidden'}`；正常复习删除该记录，恢复原调度显隐。显示选择不生成评分、不更改到期时间或历史；无需修改 Markdown 语法。固定状态优先于点击、全显/全隐及反转，固定隐藏时点击仅打开菜单，答案保持隐藏。选中状态通过 `aria-pressed` 标记；保存失败保留旧状态并允许重试。重置评分保留显示偏好。未注入持久 store 的独立宿主仍仅在内存保留。
- 入口：命令 `resetClozeProgress` 或事件 `clozeResetRequested` 清除本文档进度（工具栏重置按钮即通过事件触发）；评分按钮文案显示实际算出的下次间隔。

`MentionProvider`、`AutocompleteProvider` 和 `TagPluginOptions.getTags` 接收用户自己的查询实现。MindOS 的 VFS、附件管理和会话打印由 `@nestos/mdx-adapter` 接入，核心插件不导入内部业务包。

`CoreTitleBarPluginOptions.mountActions` 向现有标题栏右侧挂载宿主通用控件，返回清理函数。`overflowActions: true` 将次要按钮收进原标题栏更多菜单；默认不启用，宿主可按产品需要配置。保留原按钮与回调，标题输入仍负责文件重命名，核心不实现窗口列表和项目导航。

`presentButton(id, button)` 可在按钮创建时定制响应式图标和可访问名称，并返回销毁时释放监听的函数；它不替换核心按钮的异步点击处理管线。

## HTML/CSS/JS 在线预览

`PlaygroundPlugin` 在编辑器工厂中默认启用，注册名为 `playground`；通过 `plugins: ['-playground']` 禁用。
直接使用渲染器时调用 `renderer.usePlugin(new PlaygroundPlugin({ height: 360 }))`，并引入包的样式。
`height` 是预览高度（像素），默认 360。

独立演示使用 `html live`，可以包含 `<style>`、`<script>`，也可以写完整 HTML 文档：

````markdown
```html live
<button id="hello">点击</button>
<script>
document.querySelector('#hello').onclick = () => {
  document.querySelector('#hello').textContent = 'Hello!';
};
</script>
```
````

分开的代码块使用同一个 `playground=名称`。名称区分大小写，不含空白、引号、尖括号、反引号或等号，最多 128 字符；每个分组在首个代码块上方显示一套运行控件，避免长代码把按钮推到屏幕外：

````markdown
```html playground=demo
<button id="hello">点击</button>
```

代码块之间可以插入解释文字。

```css playground=demo
button { color: royalblue; }
```

```js playground=demo
document.querySelector('#hello').onclick = () => {
  document.querySelector('#hello').textContent = 'Hello!';
};
```
````

支持 `html`、`css`、`js` 和 `javascript`。同一渲染器内，同名分组的 HTML 按文档顺序拼接，CSS 在页面内容前加载，JS 在页面内容后按文档顺序执行。
各分组和每个 `html live` 块使用独立 iframe；普通代码块不参与运行。分组 JS 按浏览器经典脚本执行，不提供 Node.js、TypeScript、JSX 或 npm 构建环境。

代码块原位置使用单行工具栏：`HTML 预览 | 预览 | 刷新 | 代码 ... 下载 / 复制 / 折叠`，默认显示代码。
右侧图标直接移动原代码块按钮，仅在代码视图显示，不重建按钮或改变折叠、复制和下载行为；未安装代码块控件时只显示前三个操作。
首次点击“预览”才创建 iframe，运行结果替换该处代码的显示，不额外占用一块预览区域。运行前“刷新”禁用，刷新后显示新的预览。
切回“代码”保留原有复制、下载、折叠控件与折叠状态，同时保留 iframe；再次切到“预览”继续原来的运行状态。
“刷新”创建新的 iframe。替换首个代码块或销毁插件会移除 iframe；卸载 Playground 会把原代码块按钮还原到其工具栏。
分组在首个代码块处显示组合预览，其余 HTML/CSS/JS 代码块和解释文字保留在原位置。
流式更新通过现有 `StreamingDiffer` 渲染，同组后续代码发生变化时保留仍在运行的 iframe，并标记“刷新”按钮提示代码已更新。
完整重渲染（包括结束流式渲染）会关闭预览，需要再次点击“预览”。

预览使用 `srcdoc` 与 `sandbox="allow-scripts"`，不开放同源、弹窗、表单或宿主接口权限。
CSP 限制外部脚本、样式、图片和网络请求，只允许内联代码及指定的 data/blob 资源，因此 CDN、相对路径附件和远程 API 默认不可用。
这不是进程级隔离或 CPU 限额，不适合运行恶意代码。宿主 CSP 仍可能进一步限制内联脚本；Tauri/WebView 宿主需按实际策略验证。
`htmlPolicy` 继续只控制 Markdown 中的原始 HTML；显式标记的代码块由此插件提供隔离运行能力，宿主若不需要执行功能可禁用 `playground`。

### AI Chat（按需启用）

`interaction:ai-chat` / `AiChatPlugin` 支持独立行 `::@ 默认提示词` 和内联稳定锚点 `::@id@`，提供 render-only 选区插入、迷你图标、自动增高输入与独立只读回复预览。宿主提供 `AiChatHost`，负责创建 branch 与执行；详见 [接口与集成约定](./ai-chat.md)。

## 独立学习管理

`new StudyView(container, host)` 挂载范围选择、状态汇总与单卡学习页面；`StudyHost` 提供 `list`、带版本 `read`、`store`、`open`，可选 `now` 与 `locale`。首次扫描只显示含 cloze 的文件及其上级目录；单张清单同时展示总卡片、已学、未学、到期数和进度。目录与文件可混选，目录勾选联动后代并支持父级半选，空选择保持为空；扫描去重；`extractStudyCards` 与正文共用词法规则。评分前重新核对文档版本，成功持久化后推进队列；短间隔卡片到期再次出现。本轮独立卡片数和答题次数分别统计；自由练习不记录。`flush()` 等待在途动作，`destroy()` 停止扫描与计时并释放组件。评分成功时将历史与卡片状态同次保存；正文评分也计入。概览曲线跟随范围选择，文件行可展开独立曲线；支持覆盖率折线、复习次数柱状图、7/30 天及全部时间。日期按浏览器本地日历聚合，长时间范围按区间汇总且最多显示 366 个点；指针与可键盘操作的日期滑块查看数量及覆盖文档数。历史未知的日期不补点，卡片集合变化与部分文档缺历史用虚线提示；当前点取实际现有卡片数量，覆盖率不是掌握率。

宿主可选提供 `StudyHost.watch(listener)`，在数据库提交后通知 `{type: "progress", documents?: readonly string[]}` 或 `{type: "sources"}`，返回退订函数。普通评分只刷新进度和历史，不重读/解析文档，来源变化才重建清单；通知合并、隐藏/答题期间延后。`StudyView.refresh()` 供宿主在重新激活时补齐更新及到期状态；未实现 watch 的宿主仍可手动调用 refresh 或使用页面刷新按钮。

`StudyHost.creation = {documents: {save, directories?}, generation?, prompts?, recovery?, sources?, label?}` 启用顶部新增按钮和目录行“在此新建”，空学习清单也可新建。`documents.save(StudyDraft)` 由宿主持久化为新文档，成功后保留创建窗口，operationId 在保存失败重试时保持稳定。`generation.generate(StudyGenerationRequest)` 是可选纯草稿生成能力，调用者提供模型与模板；未提供时仍可手工填写或读取本地/已有文档内容。参考文件只读，取消不创建文件或复习状态。


创建端口按职责组合：`StudyDocuments` 提供保存与独立保存目录，`StudyGeneration` 提供必选 generate 和可选 resume/cancel/targets/configurationUrl，`StudyPromptOptions` 提供 presets/defaultPrompt/store，`StudyDraftStore` 提供 load/save/clear。生成错误可携带 `StudyGenerationFailure.recovery: 'pending'`，表示保留原操作并在重试时 resume；错误码只用于诊断。AbortSignal 停止观察，用户关闭另行调用 cancel；页面中断只保存检查点。无 DOM 的 CreationState 管理草稿身份、待确认操作与生成结果；宿主保存后的业务处理由宿主自身协调。旧顶层 save/generate/draftStore 等字段已迁至对应端口。
