/*
 * Octavo Toolbar —— 选中文工具条（配套 Octavo 主题）
 *
 * 作用：在编辑器里选中一段文字、稍停片刻，选区上方浮出一条格式工具条
 *      （加粗、斜体、删除线、行内代码、高亮、链接、清除格式……）。
 *      按钮可在设置里逐个开关；「格式转换」（标题 / 列表 / 引用 / 代码块 /
 *      待办）默认收起，需要时打开。
 *
 * 为什么是插件：Obsidian 桌面端没有「选中就浮出格式条」这回事 —— 移动端
 *      有原生工具条（app.css 提供），桌面端没有。这要 JS 监听选区、算坐标、
 *      动态插 DOM，纯 CSS 做不到。
 *
 * 三个刻意的取舍：
 *   1. 按钮一律走 Obsidian 核心编辑器命令（editor:toggle-bold 等），不自己
 *      拼 Markdown —— 切换语义、多行行为、链接弹窗都交给官方，省得跟编辑器
 *      分叉。只有「朱笔下划线」（<u>…</u>）核心没有，自己实现（装了兼容的
 *      标记插件就直接用它的命令，行为一致、单一实现）。
 *   2. 只在**实时预览 / 源码模式**里出现：选区必须落在当前 MarkdownView
 *      自己的 .cm-editor 上。阅读视图、以及表格单元格里那层里层编辑器都不弹
 *      —— 那样会把格式错误地施加到外层文档上。
 *   3. 纯文本复制只做「可配置的语法过滤」，不引 Markdown 渲染器：代码围栏
 *      原样保留，其余按设置逐项去标记，行为可预测、体积也小。
 *
 * 依赖纯 DOM 与 require("obsidian")，不 import CodeMirror，无构建步骤，
 * main.js / styles.css 就是最终产物。
 */

const { Plugin, MarkdownView, PluginSettingTab, Setting, setIcon, Menu, Notice } = require("obsidian");

/* 按钮目录。
 *   command —— 交给 Obsidian 核心命令（id 取自 app.js，桌面端稳定）
 *   action  —— 核心没有的，自己实现（见 activate）
 *   group   —— 设置面板里的分组；"block"（格式转换）默认不开 */
const BUTTONS = [
  // —— 行内格式 ——
  { id: "bold",          group: "inline", label: "加粗",       icon: "bold",              command: "editor:toggle-bold" },
  { id: "italic",        group: "inline", label: "斜体",       icon: "italic",            command: "editor:toggle-italics" },
  { id: "strikethrough", group: "inline", label: "删除线",     icon: "strikethrough",     command: "editor:toggle-strikethrough" },
  { id: "code",          group: "inline", label: "行内代码",   icon: "code",              command: "editor:toggle-code" },
  { id: "highlight",     group: "inline", label: "高亮",       icon: "highlighter",       command: "editor:toggle-highlight" },
  { id: "underline",     group: "inline", label: "朱笔下划线", icon: "underline",         action: "underline" },
  { id: "link",          group: "inline", label: "链接",       icon: "link",              command: "editor:insert-link" },
  { id: "clear",         group: "inline", label: "清除格式",   icon: "remove-formatting", command: "editor:clear-formatting" },
  // —— 格式转换（段落）——
  { id: "h1",        group: "block", label: "标题 1",   icon: "heading-1",    command: "editor:set-heading-1" },
  { id: "h2",        group: "block", label: "标题 2",   icon: "heading-2",    command: "editor:set-heading-2" },
  { id: "h3",        group: "block", label: "标题 3",   icon: "heading-3",    command: "editor:set-heading-3" },
  { id: "ul",        group: "block", label: "无序列表", icon: "list",         command: "editor:toggle-bullet-list" },
  { id: "ol",        group: "block", label: "有序列表", icon: "list-ordered", command: "editor:toggle-numbered-list" },
  { id: "quote",     group: "block", label: "引用",     icon: "text-quote",   command: "editor:toggle-blockquote" },
  { id: "codeblock", group: "block", label: "代码块",   icon: "square-code",  command: "editor:insert-codeblock" },
  { id: "todo",      group: "block", label: "待办",     icon: "list-checks",  command: "editor:cycle-list-checklist" },
  // —— 标注（Callout）：一个按钮，点开选类型 ——
  { id: "callout",   group: "callout", label: "标注",   icon: "message-square-quote", action: "callout" },
  // —— 复制 ——
  { id: "copy-plain", group: "copy", label: "复制纯文本", icon: "copy", action: "copyPlain" },
];

const GROUPS = [
  { id: "inline", title: "行内格式", desc: "选中文字后浮出的那一排按钮。" },
  { id: "block", title: "格式转换（段落）", desc: "把选中的段落转成标题 / 列表 / 引用 / 代码块 / 待办。默认收起。" },
  { id: "callout", title: "标注（Callout）", desc: "一个「标注」按钮，点开选类型。把选中的段落包成标注；同类型再点一次拆掉，换类型直接改。默认收起。" },
  { id: "copy", title: "复制", desc: "把选中内容复制为纯文本；过滤哪些 Markdown 语法可在下方「纯文本复制」里逐项设置。默认开启。" },
];

/* 标注的七个语义类型 —— 名称与图标跟主题 §12 的映射保持一致
 * （见 README「标注块」：Obsidian 默认里 tip / important 同为火焰、warning / caution
 *  同为三角，主题把这三处撞车的换成灯泡 / 圆圈警示 / 八边形警示，菜单照抄同一套）。 */
const CALLOUT_TYPES = [
  { type: "note",      label: "Note · 顺带一提",     icon: "pencil" },
  { type: "tip",       label: "Tip · 小技巧",        icon: "lightbulb" },
  { type: "important", label: "Important · 必须知道", icon: "alert-circle" },
  { type: "warning",   label: "Warning · 当心",       icon: "alert-triangle" },
  { type: "caution",   label: "Caution · 最重的一档", icon: "alert-octagon" },
  { type: "example",   label: "Example · 举例",       icon: "list" },
  { type: "quote",     label: "Quote · 引文",         icon: "quote" },
];

/* 默认只开「常用」一组 + 复制纯文本 —— 与 README 的「精简常用」一致 */
const DEFAULT_BUTTONS = ["bold", "italic", "strikethrough", "code", "highlight", "link", "clear", "copy-plain"];

/* 纯文本复制的过滤项。默认全开；关掉某个就保留对应的 Markdown 标记。
 * 例如只想要「去掉引用块」：把除「引用块」以外的项全部关掉。 */
const FILTERS = [
  { id: "frontmatter", label: "Frontmatter", desc: "删掉笔记顶部 --- 包起来的 YAML 属性。" },
  { id: "quote",    label: "引用块",       desc: "去掉行首的 >（含嵌套 > >），只保留引用文字。" },
  { id: "callout",  label: "标注块头",     desc: "去掉 > [!note] 这类标注头，保留标题和正文。" },
  { id: "headings", label: "标题标记",     desc: "去掉行首的 # / ## …，保留标题文字。" },
  { id: "emphasis", label: "强调标记",     desc: "去掉 **粗体**、*斜体*、~~删除线~~、==高亮== 的符号。" },
  { id: "code",     label: "代码标记",     desc: "去掉 `行内代码` 的反引号和 ``` 围栏，保留代码内容。" },
  { id: "list",     label: "列表标记",     desc: "去掉 -、1.、- [ ] 等列表符号，保留缩进和文字。" },
  { id: "link",     label: "链接 / 图片",  desc: "把 [文字](url)、[[双链|别名]] 还原成文字。" },
  { id: "table",    label: "表格",         desc: "去掉表格竖线和 |---| 分隔行，单元格之间用空格分开。" },
  { id: "html",     label: "HTML 标签",    desc: "去掉 <u>、<br>、<span> 等标签，保留文字。" },
  { id: "math",     label: "公式定界符",   desc: "去掉 $…$ / $$…$$ 的美元符号，保留公式内容。" },
  { id: "footnote", label: "脚注",         desc: "去掉 [^1] 标记和脚注定义，保留脚注文字。" },
  { id: "hr",       label: "分隔线",       desc: "删掉 --- / *** / ___ 这类单独成行的分隔线。" },
  { id: "comments", label: "Obsidian 注释", desc: "删掉 %%…%% 注释。" },
];
const DEFAULT_FILTERS = Object.fromEntries(FILTERS.map((f) => [f.id, true]));

const DEFAULT_SETTINGS = {
  delay: 200, // 选区稳定多久后浮出（毫秒）
  showLabels: true, // 按钮下是否显示名称（默认开启）
  buttons: DEFAULT_BUTTONS,
  plainTextFilters: Object.assign({}, DEFAULT_FILTERS),
};

const U_OPEN = "<u>";
const U_CLOSE = "</u>";

/* 「朱笔下划线」是核心唯一没有的按钮：包 / 去 <u>…</u>。
 * 装了兼容的标记插件（octavo-mark / folio-mark）就直接调它的命令；没装则退化为
 * 这里的简版。返回 true 表示「命令已接管」。 */
function toggleUnderline(app, editor) {
  for (const id of ["octavo-mark:toggle-underline", "folio-mark:toggle-underline"]) {
    if (app.commands.commands[id] && app.commands.executeCommandById(id)) return;
  }

  const sel = editor.getSelection();
  if (!sel) {
    editor.replaceSelection(U_OPEN + U_CLOSE);
    const c = editor.getCursor();
    editor.setCursor({ line: c.line, ch: c.ch - U_CLOSE.length });
    return;
  }
  // 选区自己就整段包着标签 → 去掉；否则包上
  const wrapped = sel.startsWith(U_OPEN) && sel.endsWith(U_CLOSE);
  editor.replaceSelection(wrapped ? sel.slice(U_OPEN.length, sel.length - U_CLOSE.length)
                                  : U_OPEN + sel + U_CLOSE);
}

/* 标注首行：> [!type] 或 > [!type] 标题（可带 +/- 折叠标记） */
const CALLOUT_HEAD = /^>\s*\[!([^\]]+)\][+-]?\s*(.*)$/;

/* 把选中的段落包成 / 拆掉标注。核心只能插固定类型的**空**标注，且不认选区，
 * 所以这里按类型自己改写，并顺带支持「同类型再点一次 = 拆掉」「换类型 = 直接改」。
 * 已被标注 / 引用的内容会先剥掉整齐的 > 前缀，再按新类型重排，不会叠成 > > 。 */
function toggleCallout(editor, type) {
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  let start = from.line;
  let end = to.line;
  // 选区正好停在下一行行首时，那一行不算进来
  if (to.ch === 0 && end > start) end -= 1;

  const raw = [];
  for (let n = start; n <= end; n++) raw.push(editor.getLine(n));

  const head = raw[0].match(CALLOUT_HEAD);
  const sameType = !!head && head[1].trim().toLowerCase() === type;

  // 剥掉已有的标注 / 引用前缀，拿到纯内容
  const body = [];
  if (head) {
    if (head[2].trim()) body.push(head[2]); // 同行标题文字并回正文
    for (let i = 1; i < raw.length; i++) body.push(raw[i].replace(/^>\s?/, ""));
  } else {
    for (const ln of raw) body.push(ln.replace(/^>\s?/, ""));
  }

  // 同类型再点一次 → 拆掉（body 空则留一个空行，别让 setSelection 越界）
  const out = sameType
    ? (body.length ? body : [""])
    : [`> [!${type}]`, ...body.map((ln) => (ln === "" ? ">" : "> " + ln))];

  editor.replaceRange(
    out.join("\n"),
    { line: start, ch: 0 },
    { line: end, ch: editor.getLine(end).length }
  );
  editor.setSelection(
    { line: start, ch: 0 },
    { line: start + out.length - 1, ch: out[out.length - 1].length }
  );
}

/* ==========================================================================
 * 纯文本复制
 * --------------------------------------------------------------------------
 * 把选中文本里的 Markdown 语法按 FILTERS 的开关逐项过滤。默认全开，
 * 也就是「复制成读起来干净的文字」；关掉某一项就保留对应标记。
 * 代码围栏里的内容不参与行内过滤，避免把代码里的 * / _ / ` 吃掉。
 * ========================================================================== */

function isTableRow(line) {
  const s = line.trim();
  if (!s || !s.includes("|")) return false;
  if (s.startsWith("|") || s.endsWith("|")) return true;
  return (s.match(/\|/g) || []).length >= 2;
}

function isTableSeparator(line) {
  const s = line.trim();
  if (!s.includes("|")) return false;
  const body = s.replace(/^\|/, "").replace(/\|$/, "");
  const cells = body.split("|");
  return cells.length > 0 && cells.every((c) => /^\s*:?-{3,}:?\s*$/.test(c));
}

function tableRowToText(line) {
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return s.split("|").map((c) => c.trim()).join("  ");
}

function stripHtml(line) {
  return line
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<((?:https?|mailto):[^>]+)>/gi, "$1")
    .replace(/<([^ >]+@[^ >]+)>/g, "$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripLinks(line) {
  return line
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, file, alt) => alt || file)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
}

function stripInlineCode(line) {
  return line
    .replace(/``\s?([\s\S]*?)\s?``/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1");
}

function stripEmphasis(line) {
  return line
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/___([^_]+)___/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/g, "$1$2")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/==([^=]+)==/g, "$1");
}

function stripMath(line) {
  return line
    .replace(/\$\$([^$]+)\$\$/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1");
}

/* 核心入口：逐行处理块级语法，再对非代码行做行内过滤。 */
function markdownToPlainText(markdown, filters) {
  const on = (id) => filters[id] !== false;

  let text = String(markdown == null ? "" : markdown).replace(/\r\n?/g, "\n");
  if (on("frontmatter")) text = text.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, "");
  if (on("comments")) text = text.replace(/%%[\s\S]*?%%/g, "");

  const lines = text.split("\n");
  const out = [];
  let fence = null; // 当前代码围栏的字符（` 或 ~）

  for (const rawLine of lines) {
    const fenceMatch = rawLine.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) {
        fence = marker;
        if (!on("code")) out.push(rawLine); // 保留 ``` 围栏
        continue;
      }
      if (fence === marker) {
        fence = null;
        if (!on("code")) out.push(rawLine);
        continue;
      }
    }
    if (fence) {
      out.push(rawLine); // 代码内容原样保留，不吃行内语法
      continue;
    }

    let line = rawLine;

    // 标注头：先只去掉 [!type]，> 交给引用块过滤
    if (on("callout")) {
      line = line.replace(/^(\s*>\s*)+\[![^\]]+\][+-]?\s*/, (m) =>
        m.replace(/\[![^\]]+\][+-]?\s*/, "")
      );
    }
    if (on("quote")) line = line.replace(/^(\s*>\s?)+/, "");
    if (on("headings")) {
      line = line.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/\s+#{1,6}\s*$/, "");
    }
    if (on("list")) {
      line = line.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, "$1"); // - [ ] / - [x]
      line = line.replace(/^(\s*)(?:[-*+]|\d+[.)])\s+/, "$1"); // - / 1.
    }
    if (on("hr") && /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) continue;

    if (on("table")) {
      if (isTableSeparator(line)) continue;
      if (isTableRow(line)) line = tableRowToText(line);
    }

    if (on("footnote") && /^\s*\[\^[^\]]+\]:\s*/.test(line)) {
      line = line.replace(/^\s*\[\^[^\]]+\]:\s*/, "");
    }
    if (on("link") && /^\s*\[[^\]]+\]:\s*\S+/.test(line)) continue; // 引用式链接定义

    // 行内代码先抽出来做占位，避免代码里的 * / _ / <tag> 被后面的过滤器吃掉
    const codeSpans = [];
    line = line.replace(/(``[\s\S]*?``|`[^`\n]+`)/g, (m) => {
      const token = `\u0000${codeSpans.length}\u0000`;
      codeSpans.push(m);
      return token;
    });

    if (on("html")) line = stripHtml(line);
    if (on("link")) line = stripLinks(line);
    if (on("emphasis")) line = stripEmphasis(line);
    if (on("math")) line = stripMath(line);
    if (on("footnote")) line = line.replace(/\[\^[^\]]+\]/g, "");
    // 反斜杠转义永远还原：\* → *，\_ → _
    line = line.replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1");

    // 还原代码：过滤「代码标记」时去掉反引号，但内容原样保留
    line = line.replace(/\u0000(\d+)\u0000/g, (m, i) => {
      const code = codeSpans[Number(i)];
      return on("code") ? stripInlineCode(code) : code;
    });

    out.push(line.replace(/[ \t]+$/g, ""));
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (err) {
    // 权限 / 焦点问题：继续走 textarea + execCommand 兜底
  }
  // 旧 Electron / 无剪贴板权限时的兜底
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("execCommand('copy') 返回 false");
}

class OctavoToolbar extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // 兜底：设置里若存了已经删掉的按钮 id，清掉
    this.settings.buttons = (this.settings.buttons || []).filter((id) =>
      BUTTONS.some((b) => b.id === id)
    );
    // 老版本没有 plainTextFilters：补默认值，并丢掉已经删掉的过滤项
    this.settings.plainTextFilters = Object.assign(
      {},
      DEFAULT_FILTERS,
      this.settings.plainTextFilters
    );
    for (const id of Object.keys(this.settings.plainTextFilters)) {
      if (!FILTERS.some((f) => f.id === id)) delete this.settings.plainTextFilters[id];
    }

    this.el = null; // 工具条根元素（懒建）
    this.range = null; // 触发时的选区，滚动时靠它重新定位
    this.editor = null; // 触发时的编辑器
    this.visible = false;
    this.timer = 0;

    this.registerDomEvent(document, "selectionchange", () => this.onSelectionChange());
    this.registerDomEvent(document, "keydown", (e) => {
      if (e.key === "Escape") this.hide();
    });
    // 滚动用捕获阶段：scroll 不冒泡，但捕获能接到任意滚动容器的滚动
    this.registerDomEvent(window, "scroll", () => this.reposition(), true);
    this.registerDomEvent(window, "resize", () => this.reposition());
    // 切文件 / 切视图就收起来，免得停在不该在的地方
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.hide()));

    this.addCommand({
      id: "copy-as-plain-text",
      name: "复制为纯文本",
      editorCallback: (editor) => this.copyAsPlainText(editor),
    });

    // 编辑器右键菜单也放一份，不依赖工具条是否弹出
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        menu.addItem((item) =>
          item
            .setTitle("复制为纯文本")
            .setIcon("copy")
            .onClick(() => this.copyAsPlainText(editor))
        );
      })
    );

    this.addSettingTab(new OctavoToolbarSettingTab(this.app, this));
    this.register(() => this.destroy());
  }

  onunload() {
    this.destroy();
  }

  /* 选区一变就重置延迟：拖动过程中不弹，停下来 delay 毫秒后才弹。
     选区塌了 / 空了则立刻收起，不等延迟。 */
  onSelectionChange() {
    window.clearTimeout(this.timer);
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      this.hide();
      return;
    }
    this.timer = window.setTimeout(() => this.maybeShow(), this.settings.delay);
  }

  maybeShow() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return this.hide();
    const range = sel.getRangeAt(0);

    const node = range.commonAncestorContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    const cmEl = el && el.closest ? el.closest(".cm-editor") : null;
    if (!cmEl) return this.hide(); // 阅读视图 / 界面其它地方

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor || !view.editor.cm) return this.hide();
    // 选区必须落在「本视图主编辑器」上：表格单元格里另有一层 .cm-editor，
    // 在它里面选中不能把格式施到外层文档上
    if (view.editor.cm.dom !== cmEl) return this.hide();

    this.view = view;
    this.editor = view.editor;
    this.range = range;
    this.show();
  }

  show() {
    const el = this.el || this.build();
    // 先量后显：给个初始位置之前别让它闪在左上角
    el.style.visibility = "hidden";
    el.classList.add("is-visible");
    this.visible = true;
    this.position();
    el.style.visibility = "";
  }

  /* 把工具条摆在选区上方；上方不够就翻到下方；水平居中并夹进视口 */
  position() {
    if (!this.visible || !this.el || !this.range) return;
    const rects = this.range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : this.range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return this.hide();
    // 选区整体滚出视口就不再跟随
    if (rect.bottom < 0 || rect.top > window.innerHeight) return this.hide();

    const el = this.el;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 8;
    const edge = 8;

    let top = rect.top - h - gap;
    if (top < edge) top = rect.bottom + gap; // 上方放不下 → 翻到选区下方
    top = Math.max(edge, Math.min(window.innerHeight - h - edge, top));

    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(edge, Math.min(window.innerWidth - w - edge, left));

    el.style.top = Math.round(top) + "px";
    el.style.left = Math.round(left) + "px";
  }

  reposition() {
    if (this.visible) this.position();
  }

  build() {
    const el = document.body.createDiv({ cls: "octavo-toolbar" });
    el.setAttribute("role", "toolbar");
    el.setAttribute("aria-label", "格式工具条");
    // 关键：一按下就 preventDefault —— 否则编辑器失焦、选区塌掉，按钮就无从施加
    el.addEventListener("mousedown", (e) => e.preventDefault());
    this.el = el;
    this.render();
    return el;
  }

  /* 按设置里勾选的按钮重建这一排；分隔线加在「行内 → 格式转换」之间 */
  render() {
    const el = this.el;
    if (!el) return;
    el.empty();
    el.classList.toggle("is-labeled", !!this.settings.showLabels);

    const enabled = new Set(this.settings.buttons);
    let prevGroup = null;
    for (const b of BUTTONS) {
      if (!enabled.has(b.id)) continue;
      // 分组一变就插一条分隔线（行内 → 格式转换 → 标注）
      if (prevGroup !== null && b.group !== prevGroup) {
        el.createDiv({ cls: "octavo-toolbar-sep" });
      }
      prevGroup = b.group;

      const btn = el.createEl("button", {
        cls: "octavo-toolbar-btn",
        attr: { type: "button", "aria-label": b.label, title: b.label },
      });
      setIcon(btn, b.icon);
      if (this.settings.showLabels) {
        btn.createSpan({ cls: "octavo-toolbar-label", text: b.label });
      }
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.activate(b, e);
      });
    }
  }

  activate(b, evt) {
    const editor = this.editor;
    if (!editor) return;
    if (b.action === "copyPlain") {
      this.copyAsPlainText(editor);
      this.hide();
      return;
    }
    if (b.action === "callout") {
      this.openCalloutMenu(evt);
      return;
    }
    if (b.command) {
      this.app.commands.executeCommandById(b.command);
    } else if (b.action === "underline") {
      toggleUnderline(this.app, editor);
    }
    // 命令执行后选区可能变了（插入链接会清空、加粗把光标留在词尾）：重算一次
    window.setTimeout(() => {
      if (editor === this.editor) this.maybeShow();
    }, 0);
  }

  /* 复制为纯文本：优先用选区；没有选区时复制光标所在行。
     过滤规则见 markdownToPlainText / FILTERS。 */
  async copyAsPlainText(editor) {
    const active = editor || this.editor;
    if (!active) return;
    const selected = active.getSelection();
    const text = selected || active.getLine(active.getCursor().line);
    if (!text || !text.trim()) {
      new Notice("请先选中文字，或把光标放到要复制的那一行");
      return;
    }
    const plain = markdownToPlainText(text, this.settings.plainTextFilters);
    if (!plain.trim()) {
      new Notice("过滤后没有可复制的内容");
      return;
    }
    try {
      await copyToClipboard(plain);
      new Notice(selected ? "已复制为纯文本" : "已复制当前行（纯文本）");
    } catch (err) {
      console.error("Octavo Toolbar: copy failed", err);
      new Notice("复制失败，请查看开发者控制台");
    }
  }

  /* 「标注」按钮：先收起工具条（免得压在菜单下），再在按钮位置弹出类型菜单。
   * 菜单接管鼠标后编辑器会失焦，但 CodeMirror 的选区状态还在，
   * editor.getCursor / getSelection 照常可用，落笔不受影响。 */
  openCalloutMenu(evt) {
    const editor = this.editor;
    if (!editor) return;
    this.hide();

    const menu = new Menu();
    for (const t of CALLOUT_TYPES) {
      menu.addItem((item) =>
        item
          .setTitle(t.label)
          .setIcon(t.icon)
          .onClick(() => {
            toggleCallout(editor, t.type);
            editor.focus();
            window.setTimeout(() => {
              if (editor === this.editor) this.maybeShow();
            }, 0);
          })
      );
    }
    menu.showAtMouseEvent(evt);
  }

  hide() {
    window.clearTimeout(this.timer);
    this.visible = false;
    this.range = null;
    if (this.el) this.el.classList.remove("is-visible");
  }

  destroy() {
    window.clearTimeout(this.timer);
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    this.visible = false;
    this.range = null;
  }
}

class OctavoToolbarSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("octavo-toolbar-settings");
    containerEl.createEl("h2", { text: "Octavo Toolbar" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "在编辑器里选中文字、稍停片刻，选区上方浮出一条格式工具条。按钮走 Obsidian 核心命令，行为与编辑器自带的一致；只在实时预览 / 源码模式里出现。",
    });

    new Setting(containerEl)
      .setName("弹出延迟")
      .setDesc("选区稳定多久后浮出（毫秒）。改成 0 则几乎立刻弹出，但拖动时会闪。")
      .addSlider((s) =>
        s
          .setLimits(0, 800, 20)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.delay)
          .onChange(async (v) => {
            this.plugin.settings.delay = v;
            await this.plugin.saveData(this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName("按钮下显示名称")
      .setDesc("除了图标再显示文字，看得更明白，但工具条会更宽。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showLabels).onChange(async (v) => {
          this.plugin.settings.showLabels = v;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.render();
        })
      );

    for (const g of GROUPS) {
      containerEl.createEl("h3", { text: g.title });
      containerEl.createEl("p", { cls: "setting-item-description", text: g.desc });
      for (const b of BUTTONS.filter((x) => x.group === g.id)) {
        new Setting(containerEl)
          .setName(b.label)
          .setDesc(
            b.command ||
              (b.action === "underline"
                ? "朱笔下划线（<u>…</u>）"
                : b.action === "copyPlain"
                  ? "复制为纯文本（按下方「纯文本复制」的过滤项）"
                  : "点开选类型（见上方说明）")
          )
          .addToggle((t) =>
            t.setValue(this.plugin.settings.buttons.includes(b.id)).onChange(async (v) => {
              const set = new Set(this.plugin.settings.buttons);
              if (v) set.add(b.id);
              else set.delete(b.id);
              // 按 BUTTONS 顺序存，设置面板重开时顺序稳定
              this.plugin.settings.buttons = BUTTONS.filter((x) => set.has(x.id)).map((x) => x.id);
              await this.plugin.saveData(this.plugin.settings);
              this.plugin.render();
            })
          );
      }
    }

    containerEl.createEl("h3", { text: "纯文本复制" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "复制为纯文本时，按下面的勾选过滤 Markdown 语法。全部打开 = 尽量干净的文字；只留「引用块」就只去掉行首的 >，其余标记原样保留。",
    });

    for (const f of FILTERS) {
      new Setting(containerEl)
        .setName(f.label)
        .setDesc(f.desc)
        .addToggle((t) =>
          t
            .setValue(this.plugin.settings.plainTextFilters[f.id] !== false)
            .onChange(async (v) => {
              this.plugin.settings.plainTextFilters[f.id] = v;
              await this.plugin.saveData(this.plugin.settings);
            })
        );
    }
  }
}

module.exports = OctavoToolbar;
