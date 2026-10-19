# Folio Toolbar

**选中文工具条**：在 Obsidian 编辑器里选中文字、稍停片刻，选区上方浮出一排格式按钮 —— [Folio 主题](https://github.com/jiuxianzai/obsidian-theme-folio) 的配套插件。

Obsidian 桌面端没有「选中就浮出格式条」这回事（移动端的原生工具条由 App 提供，桌面端没有）。要监听选区、算坐标、动态插 DOM，纯 CSS 做不到，所以做成这个轻量插件：纯 DOM、无构建，`main.js` 就是最终产物。

## 用法

选中一段文字、松手稍停（默认 200 ms），选区上方浮出工具条；点一下就作用，`Esc` 或点别处收起。

| 组 | 按钮 | 默认 | 走什么 |
| --- | --- | --- | --- |
| 行内格式 | 加粗、斜体、删除线、行内代码、高亮、链接、清除格式 | 开 | Obsidian 核心命令（`editor:toggle-bold` / `editor:insert-link` / `editor:clear-formatting` …） |
| 行内格式 | 朱笔下划线（`<u>…</u>`） | 关 | 装了 [folio-mark](https://github.com/jiuxianzai/obsidian-folio-mark) 就复用它的命令，否则插件自带简版 |
| 格式转换（段落） | 标题 1–3、无序 / 有序列表、引用、代码块、待办 | 关 | 核心命令（`editor:set-heading-1` / `editor:toggle-bullet-list` / `editor:toggle-blockquote` / `editor:insert-codeblock` / `editor:cycle-list-checklist`） |
| 标注 | 标注：**一个按钮，点开选类型**（note / tip / important / warning / caution / example / quote） | 关 | 核心只能插固定类型的空标注、且不认选区，所以按类型自己改写 `> [!type]`；同类型再点一次拆掉，换类型直接改 |

> 按钮**尽量走核心命令**（标注、朱笔下划线除外）：切换语义、链接弹窗、多行行为都跟编辑器自带的一致。

## 设置

`设置 → Folio Toolbar`：

- **弹出延迟**：选区稳定多久后浮出（0–800 ms）。
- **按钮下显示名称**：除了图标再显示文字。
- **逐按钮开关**：行内格式一组、格式转换一组、标注一组，按需打开。

## 已知边界

- **只在实时预览 / 源码模式出现**：选区必须落在当前文档的主编辑器上。阅读视图不弹；表格单元格里那层里层编辑器也不弹（否则会把格式施加到外层文档）。
- **桌面端专用**（`isDesktopOnly`）：移动端 Obsidian 自带格式工具条，这里不重复造。

## 和主题的分工

| 谁 | 管什么 |
| --- | --- |
| 本插件 | 工具条本体：选区监听、定位、按钮落笔 |
| [Folio 主题](https://github.com/jiuxianzai/obsidian-theme-folio) | 工具条的外观（`theme.css` §13）：三级纸底 + 规则色描边 + 柔和投影，跟随纸感 / ChatGPT 两套配色 |

不装主题也能用，只是外观回到浏览器默认。

## 安装

```
<vault>/.obsidian/plugins/folio-toolbar/
├── main.js
└── manifest.json
```

放进上面的目录，重启 Obsidian（或在「设置 → 第三方插件」里重载）后启用。

## 许可

MIT，见 [LICENSE](LICENSE)。
