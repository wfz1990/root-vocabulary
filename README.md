# root-vocabulary

个人英语词根和单词记录插件，适用于 Obsidian 桌面端。数据保存在库内 `词根词库/词根` 和 `词根词库/单词` 的 Markdown 笔记中，可直接修改 frontmatter 和正文。一个单词可以关联多个词根；收藏和熟悉度用于筛选，不安排复习日期。

## 构建与安装

开发与测试使用 Node.js 24 或更新版本。运行 `npm install`、`npm test`、`npm run typecheck`、`npm run build`。在目标 Obsidian 库中建立 `.obsidian/plugins/root-vocabulary/`，复制 `manifest.json`、`main.js`、`styles.css` 到该目录，然后在 Obsidian 的社区插件设置中启用 `root-vocabulary`。更新后替换这三个文件，并在社区插件设置中关闭再启用插件，或重启 Obsidian；只替换文件不会立即更新运行中的代码。

点击左侧书本图标或执行“打开词根词库”命令。界面分为“词根”和“单词”两个页面，可用顶部标签切换；先新建词根，再新建单词。点击笔记行打开 Markdown，铅笔图标编辑字段。单词页可按拼写、中文释义、词根形式和变体搜索，并按熟悉度或收藏筛选。

“全部单词”与点击词根会清除当前搜索、熟悉度及收藏筛选。词根可按字母或中文释义排序，并可分别折叠词根区和单词区；若侧栏提示“笔记问题”，请打开对应笔记检查字段。在线词典查询与候选位于单词表单的拼写字段旁，查询失败时会显示原因，不影响手动保存。

中文释义仅在单词表单点击“查询中文释义”时读取 vault 内的 ECDICT CSV，不请求网络，不需要有道账号。请从 [ECDICT 官方仓库](https://github.com/skywind3000/ECDICT) 获取 `ecdict.csv`，放入 `词根词库/ecdict.csv`，或在插件设置中填写其他 vault 相对路径。一个单词的多个中文释义会作为候选显示；释义为空时自动填入第一条，已有释义不会被覆盖。

## 笔记字段

词根：`type: root`、`id`、`form`、`meaning` 为必需字段；`variants` 为文本列表，`origin`、`explanation` 可选，`links` 为链接列表（表单中每行一个链接）。单词：`type: word`、`id`、`spelling`、`meaning`、`rootIds` 为必需字段；`ipa`、`memoryAid`、`example`、`favorite`、`familiarity`、`dictionarySource`、`dictionaryLicense` 可选。`memoryAid` 用于记录辅助记忆内容，并显示在单词列表中。旧笔记中的 `phonics` 和 `partOfSpeech` 会作为未知字段保留，但插件不再读取、创建或编辑它们。`rootIds` 引用词根笔记的稳定 ID，笔记文件名可以改变。未知 frontmatter 字段与正文会在表单保存时保留。

格式错误、重复 ID/拼写或无效关联显示在侧栏的“笔记问题”中，插件不会自动修改这些笔记。删除笔记请使用 Obsidian 文件管理器；删除词根前请先调整其关联单词。
