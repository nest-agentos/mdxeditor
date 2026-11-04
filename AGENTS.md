# @nestos/mdxeditor

独立仓库 `mushuanli/mdxeditor`，发布名 `@nestos/mdxeditor`。
CodeMirror 6 驱动的 Markdown/MDX 编辑器。编辑/预览双模式、流式渲染、Mermaid/数学公式/PlantUML。

## Architecture

```
src/
├── editor/        ← MDxEditor (实现自有 IEditor，通过 assets/storeFactory/host 注入能力) + CodeMirrorAdapter
│                    + ModeManager / NavigationManager / SaveManager / SearchManager + commands
├── renderer/      ← MDxRenderer (实时预览) + MarkedAdapter + StreamingDiffer
├── core/          ← PluginManager, PluginRegistry, EventBus (独立实现，支持 coalesce), ServiceContainer, store/
├── plugins/       ← 6 组插件：core / syntax-extensions / interactions / autocomplete / cloze / ui
├── services/      ← MDxProcessor, DefaultPrintService, asset-helper
└── utils/         ← logger, regex-cache
```

`registerPlugin(MyPlugin)` — 全局注册。`defaultEditorFactory` — 默认 `EditorFactory`。

### 公共宿主接口

核心只依赖零应用依赖的 `@nestos/ui-common` 提供通用导航组件。接口定义在 `src/editor/contracts.ts`，从包根导出：

- `AssetProvider`：附件读取，可选上传、清理与 MIME 类型。
- `StoreFactory` / `ScopedPersistenceStore`：插件持久化，未注入时使用内存。
- `EditorHost`：文档打开、重命名和通知；`onSave` 提供内容保存。
- `documentPath` / `onDocumentPathChange`：宿主提供的文档标识，核心不推断消息或 Session 身份。

```ts
const bytes = await context.getAssets()?.read('image.png');
const path = context.getDocumentPath();
```

VFS、Session/namespace 校验、文件后缀判断、附件管理 UI 和会话打印位于 itookit 仓库的 `ui/mdx-adapter`。

详情: [插件目录](./doc/plugin-catalog.md)

## Conventions

- 嵌入布局使用公共 `scrollMode` 与 `--mdx-content-*` 变量；初始化保留挂载元素 class。普通文档默认行为不变。
- `htmlPolicy` 只控制原始 HTML；插件内片段使用 `context.renderMarkdown` 继承外层解析规则。`afterRender` 支持异步转换。
- 折叠状态通过通用 `data-mdx-disclosure-key` 在实例内存保留，核心不解释业务身份；系统/工具角色、摘要和配色属于宿主。
- 流式更新使用 `StreamingDiffer` 而非整体替换
- `ScopedPersistenceStore` — 插件私有持久化，由 `createStore()` 二级回退：注入的 `StoreFactory` → 内存（`MemoryStore`）。可选 `entries(prefix)` 用于按 key 加载；不提供的 store 仍按整值读写。
- 挖空复习状态（`cloze:memory`）以 `card:<locator>` 逐卡写入，payload 带 `v`（`SRS_STORAGE_VERSION`）；历史整份 `_mdx_srs` 在同步时只读加载，实际评分时才迁移被修改的卡片，读取失败的条目保留不删；已有新格式进度优先。打开、临时显隐和渲染不写入进度，重置删除评分记录。持久显示独立使用 `display:<locator>` 的 `{v:1, mode:'open'|'hidden'}`，正常复习删除该偏好；不生成评分/历史，不修改调度，重置评分保留偏好。`locator` 由内容 hash + 同内容出现序号生成（`auto-<hash>-<occurrence>`），`data-cloze-legacy-locator` 供旧 `auto-<n>` 进度迁移。调度函数 `nextReview(state, grade, now, maxIntervalDays)` 是纯函数，时钟通过 `MemoryPluginOptions.now` 注入。
- `AssetResolverPlugin` 通过 `AssetProvider` 读取资源；路径生成统一走 `services/asset-helper.ts`
- 暗色主题 CSS 同时使用 `[data-theme="dark"]` 和 `@media (prefers-color-scheme: dark)` 选择器，支持手动和系统主题切换
- Mermaid 默认使用本地依赖且只在出现 `language-mermaid` 块时动态加载；Tauri 构建把其依赖放入独立 `mermaid-runtime` chunk。MathJax 只在渲染结果含 `\\(`/`\\[` 时加载。普通 Markdown 更新不得触发这两个运行时。

运行: `pnpm typecheck` / `pnpm test` / `pnpm build`

- core:titlebar.mountActions 提供通用宿主按钮插槽并执行其清理函数；overflowActions 将原次要按钮移到同一标题栏更多菜单，不重建按钮或改变保存、重命名和模式切换行为。核心不定义项目、窗口列表或侧栏导航状态。更多菜单顺序由 `actionOrder` 声明（按 `data-button-id`），宿主不得移动面板内部节点。
- 插件通过 `context.translate(key)` 取文案，宿主可注入 `translate`；字典键在 `src/utils/i18n.ts` 同时维护 zh-CN 与 en。

- AiChatPlugin 的目标以文字入口展示；宿主可通过 AiChatHost.getDefaultTarget 注入默认目标。剪贴板文件/图片在输入行内保留为本地附件，发送回调负责上传与接纳；核心不推断 Session 身份或过滤业务 Flow。

`StudyView` 是独立学习管理组件，宿主通过 `StudyHost` 注入目录枚举、带版本文档读取、作用域存储和原文导航。范围合并、cloze 提取、到期队列、显答评分和本轮进展归库；扫描不写进度，自由练习不保存，评分前核对来源版本。初始只读扫描识别含 cloze 的文件并裁剪空目录，单张学习清单提供范围选择与逐文件状态；目录复选框联动全部后代，父级支持半选，空选择不回退为全选。已学指存在复习状态，到期与未学分别统计，目录汇总后代卡片。仅复选框改变范围选择，文件名通过宿主 open 打开原文，点击文件名不切换勾选状态。选择立即更新概览；关闭组件后停止扫描和复习计时。

评分 payload 的可选 history(v:1) 记录评分时间/等级和文档卡片集合摘要、总数、已学数，与状态在同一次 set 提交；正文与学习页复用 review-history，不记录正文。只读扫描读取历史，不补造旧进度的过去。StudyView 的范围曲线和行内单文档曲线支持覆盖率/复习次数、7/30 天及全部；按卡片数加权，历史不完整或集合变化用虚线提示。重置进度会清除该卡片内的历史，宿主移动/删除直接处理整个卡片 payload。

StudyHost.watch 为可选的通用提交后通知：progress 可带不透明文档 ID，sources 表示来源变化；不包含 VFS/seqfile 类型。通知按 120ms 合并，进度刷新只读取状态与历史并更新原清单行，保留选择、目录展开和曲线状态；隐藏和答题期间只标脏。宿主复用编辑器时调用 StudyView.refresh()，失败保留旧快照并等待下次通知/激活重试；destroy 释放订阅与到期计时。

StudyHost.creation 是可选的新文档能力：documents.save 接收稳定 operationId、标题、内容与可选不透明父级；generation.generate 接收提示、参考正文、上一草稿与 AbortSignal，核心不包含业务模板、模型或 VFS。创建弹窗支持粘贴、本地文本文件和 host.list/read 选择已有文档；只在明确保存时调用 save。重新生成保留提示，失败保留已有草稿，手工改稿需显式允许替换，取消中止生成且不保存。

创建目录使用可搜索的 combobox，枚举全部目录（含无 cloze 的目录），提交宿主原始 StudyEntry，不从输入字符串构造路径。文件选择器的 cancel 不关闭创建弹窗。可选 creation.prompts.store 提供提示词加载和显式保存；异步加载不得覆盖用户输入。语法帮助说明单行挖空、¶ 换行、唯一 ID、朗读后缀和分隔符约束，可追加到提示词；核心不内置具体学科的生成模板。

creation.prompts.presets 注入命名预设；creation.prompts.store 可选 list/saveList 支持持久化提示词集合，旧 load/save 保持兼容。列表使用可输入名称的 combobox 与单个保存按钮，展开时总是显示全部模板，输入时可筛选；支持方向键、Enter 和 Escape，避免原生 datalist 按当前名称过滤导致其他模板不可见。同名更新原 ID，新名创建新 ID；切换暂存窗口内编辑，迟到加载不得覆盖编辑；预设业务内容由宿主提供。

creation.generation.configurationUrl 提供宿主模型配置入口，在新窗口打开以保留草稿；生成失败展示安全错误码及可操作原因，核心不访问宿主配置或模型服务。

创建界面使用待处理内容/提示词/生成结果三个保留 DOM 的页签，生成后切到结果。creation.generation.targets 提供不透明连接与模型选择，失效时禁止静默回退。结果可编辑或通过独立 MDxRenderer + ClozePlugin 预览，不挂载 SRS 存储。底部清空并新建只清内容/文件名，保留目录/提示/模型并分配新 operationId；保存成功保留窗口，显示回执并清空当前输入/输出草稿，保留目录、提示和模型；关闭由独立按钮执行。

创建来源可由 StudyCreation.sources 注入跨空间的 search/read：ID 不透明；search 可接收选中父级，结果目录项用于逐层进入，支持 @ 触发、多关键词过滤及回车选择。NestOS 先筛选位置，目录搜索限制深度，不全盘递归；未注入时沿用当前文档树。生成按钮要求正文、提示词和可用模型，手工改稿需同意替换；保存要求合法文件名、已确认目录和非空结果，异步加载及操作结束后重新计算状态。


StudyCreation 使用 documents/generation/prompts/recovery 具名能力组，跨空间来源通过只读 sources 注入。生成错误的 recovery:pending 是恢复语义，不得按宿主错误码推断；重试先 resume 原操作。AbortSignal 只停止观察，显式关闭另行调用 generation.cancel，页面中断不取消执行。CreationState 管理不依赖 DOM 的身份与生成状态转换；保存后会话改名等业务由宿主协调，不进入核心契约。

core:titlebar.mountTitleBar 是可选完整布局端口，交接原标题输入、经重命名屏障的返回按钮、次要动作与更多菜单；不解释项目、窗口或路由，不新增宿主依赖。重绘先释放旧布局，卸载释放全部挂载；未提供时保留独立默认标题栏。


代码文件按 documentPath 后缀或显式 language 选择 CodeMirror language-data 的语言描述，解析器通过 load() 按需加载；未知类型按纯文本处理。contentFormat 显式配置优先；Markdown 保留原行为，超过字节/行数/长行语法预算不加载代码解析器。配置高亮只重配语言 compartment，不改变正文、选区、撤销或 dirty 状态；代次检查阻止旧文件/销毁后的异步结果应用。失败显示可重试提示并记录操作身份、语言名、阶段、结果和耗时，不记录路径、正文或异常原文。

TitleBarPlugin passes the original toggle-edit-mode button through ContentTitleBarParts.modeToggle and excludes it from secondary actions. Keep its command, mode-dependent icon/label and node identity; do not render a second mode switch beside the title.
