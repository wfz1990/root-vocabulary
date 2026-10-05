import { App, ItemView, Modal, Notice, Setting, WorkspaceLeaf, requestUrl, setIcon } from 'obsidian';
import { Familiarity, RootEntry, WordEntry, resetWordFilter, visibleWords } from './model';
import { ChineseMeaningCandidate } from './dictionary';
import { VocabularyStore } from './store';

export const VIEW_TYPE = 'root-vocabulary-view';

function iconButton(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
  const button = parent.createEl('button', { cls: 'rv-icon-button', attr: { 'aria-label': label, title: label } });
  setIcon(button, icon);
  button.addEventListener('click', action);
  return button;
}

function displayMeaning(value: string): string {
  return value.replace(/\\(?:r)?n/g, ' ').replace(/[\r\n]+/g, ' ');
}

function rootSortForm(form: string): string {
  return form.trim().replace(/^-+|-+$/g, '') || form.trim();
}

export class VocabularyView extends ItemView {
  private unsubscribe?: () => void;
  private query = '';
  private rootId = '';
  private status: Familiarity | '全部' = '全部';
  private favorites = false;
  private viewMode: 'roots' | 'words' = 'roots';
  private rootSort: 'form-asc' | 'form-desc' | 'meaning' = 'form-asc';
  private wordSort: 'spelling-asc' | 'spelling-desc' = 'spelling-asc';
  private rootsCollapsed = false;
  private wordsCollapsed = false;
  private expandedRootGroups = new Set<string>();
  private expandedWordGroups = new Set<string>();
  private collapsedRootGroups = new Set<string>();
  private collapsedWordGroups = new Set<string>();
  private pronunciationCache = new Map<string, string | null>();
  private pronunciationRequests = new Map<string, Promise<string | null>>();
  private activeAudio?: HTMLAudioElement;
  private pronunciationSequence = 0;
  private results!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private statusSelect!: HTMLSelectElement;
  private favoriteCheckbox!: HTMLInputElement;

  constructor(leaf: WorkspaceLeaf, private store: VocabularyStore, private edit: (entry?: RootEntry | WordEntry, kind?: 'root' | 'word', rootId?: string) => void) {
    super(leaf);
  }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return '词根词库'; }
  getIcon(): string { return 'book-open'; }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass('rv-view');
    const header = container.createDiv({ cls: 'rv-header' });
    header.createEl('h3', { text: '词根词库' });
    const actions = header.createDiv({ cls: 'rv-actions' });
    iconButton(actions, 'plus', '新建词根词缀', () => this.edit(undefined, 'root'));
    iconButton(actions, 'file-plus', '新建单词', () => this.edit(undefined, 'word'));
    iconButton(actions, 'refresh-cw', '刷新词库', () => {
      void this.store.refresh().catch(error => new Notice((error as Error).message));
    });
    const modeTabs = container.createDiv({ cls: 'rv-mode-tabs', attr: { role: 'tablist', 'aria-label': '词库页面' } });
    for (const mode of [{ value: 'roots', label: '词根词缀' }, { value: 'words', label: '单词' }] as const) {
      const tab = modeTabs.createEl('button', { text: mode.label, cls: 'rv-mode-tab', attr: { role: 'tab' } });
      tab.addEventListener('click', () => { this.viewMode = mode.value; this.renderResults(); });
    }

    this.searchInput = container.createEl('input', { cls: 'rv-search', attr: { type: 'search', placeholder: '搜索拼写、中文释义或词根词缀', 'aria-label': '搜索词库' } });
    this.searchInput.addEventListener('input', () => { this.query = this.searchInput.value; this.rootId = ''; this.renderResults(); });
    const filters = container.createDiv({ cls: 'rv-filters' });
    this.statusSelect = filters.createEl('select', { attr: { 'aria-label': '熟悉度筛选' } });
    for (const option of ['全部', '未学', '学习中', '已掌握']) this.statusSelect.createEl('option', { text: option, value: option });
    this.statusSelect.addEventListener('change', () => { this.status = this.statusSelect.value as Familiarity | '全部'; this.renderResults(); });
    const favoriteLabel = filters.createEl('label', { cls: 'rv-favorite-filter' });
    this.favoriteCheckbox = favoriteLabel.createEl('input', { attr: { type: 'checkbox' } });
    favoriteLabel.appendText('仅收藏');
    this.favoriteCheckbox.addEventListener('change', () => { this.favorites = this.favoriteCheckbox.checked; this.renderResults(); });
    this.results = container.createDiv({ cls: 'rv-results' });
    this.unsubscribe = this.store.subscribe(() => this.renderResults());
    this.renderResults();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.pronunciationSequence++;
    this.stopPronunciation();
  }

  private stopPronunciation(): void {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this.activeAudio?.pause();
    this.activeAudio = undefined;
  }

  private findYoudaoAudio(spelling: string): string | null {
    const query = spelling.trim();
    return query ? `https://dict.youdao.com/dictvoice?type=1&audio=${encodeURIComponent(query)}` : null;
  }

  private async findFreeDictionaryAudio(spelling: string): Promise<string | null> {
    const query = spelling.trim().toLocaleLowerCase();
    if (!query) return null;
    if (this.pronunciationCache.has(query)) return this.pronunciationCache.get(query) ?? null;
    const existing = this.pronunciationRequests.get(query);
    if (existing) return existing;
    const request = (async () => {
      try {
        const response = await requestUrl({
          url: `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`,
          method: 'GET',
        });
        const data = JSON.parse(response.text) as unknown;
        if (!Array.isArray(data)) return null;
        for (const entry of data as Array<Record<string, unknown>>) {
          const phonetics = entry.phonetics;
          if (!Array.isArray(phonetics)) continue;
          for (const phonetic of phonetics as Array<Record<string, unknown>>) {
            const audio = typeof phonetic.audio === 'string' ? phonetic.audio.trim() : '';
            if (audio) return audio.startsWith('//') ? `https:${audio}` : audio;
          }
        }
      } catch {
        // Online pronunciation is optional; the caller falls back to system speech.
      }
      return null;
    })();
    this.pronunciationRequests.set(query, request);
    const audio = await request;
    this.pronunciationRequests.delete(query);
    this.pronunciationCache.set(query, audio);
    return audio;
  }

  private async playRemoteAudio(url: string): Promise<boolean> {
    const audio = new Audio();
    audio.preload = 'auto';
    this.activeAudio = audio;
    const loaded = await new Promise<boolean>(resolve => {
      let settled = false;
      const finish = (success: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('error', onError);
        resolve(success);
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);
      const timeout = window.setTimeout(() => finish(false), 5000);
      audio.addEventListener('canplaythrough', onReady, { once: true });
      audio.addEventListener('error', onError, { once: true });
      audio.src = url;
      audio.load();
    });
    if (!loaded || this.activeAudio !== audio) {
      audio.pause();
      if (this.activeAudio === audio) this.activeAudio = undefined;
      return false;
    }
    try {
      await audio.play();
      audio.addEventListener('ended', () => {
        if (this.activeAudio === audio) this.activeAudio = undefined;
      }, { once: true });
      return true;
    } catch {
      if (this.activeAudio === audio) this.activeAudio = undefined;
      return false;
    }
  }

  private speakSystemWord(spelling: string): void {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      new Notice('当前环境不支持单词发音');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spelling);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  private async playWord(spelling: string): Promise<void> {
    const sequence = ++this.pronunciationSequence;
    this.stopPronunciation();
    const youdaoAudio = this.findYoudaoAudio(spelling);
    if (youdaoAudio && await this.playRemoteAudio(youdaoAudio)) return;
    if (sequence !== this.pronunciationSequence) return;
    const freeDictionaryAudio = await this.findFreeDictionaryAudio(spelling);
    if (sequence !== this.pronunciationSequence) return;
    if (freeDictionaryAudio && await this.playRemoteAudio(freeDictionaryAudio)) return;
    if (sequence === this.pronunciationSequence) this.speakSystemWord(spelling);
  }

  private showScope(rootId: string): void {
    const filter = resetWordFilter(rootId);
    this.rootId = filter.rootId;
    this.query = filter.query;
    this.status = filter.status;
    this.favorites = filter.favorites;
    this.searchInput.value = '';
    this.statusSelect.value = '全部';
    this.favoriteCheckbox.checked = false;
    if (rootId) this.viewMode = 'words';
    this.renderResults();
  }

  private toggleRootGroup(group: string): void {
    if (this.rootsCollapsed) {
      if (this.expandedRootGroups.has(group)) this.expandedRootGroups.delete(group);
      else this.expandedRootGroups.add(group);
    } else if (this.collapsedRootGroups.has(group)) this.collapsedRootGroups.delete(group);
    else this.collapsedRootGroups.add(group);
    this.renderResults();
  }

  private toggleWordGroup(group: string): void {
    if (this.wordsCollapsed) {
      if (this.expandedWordGroups.has(group)) this.expandedWordGroups.delete(group);
      else this.expandedWordGroups.add(group);
    } else if (this.collapsedWordGroups.has(group)) this.collapsedWordGroups.delete(group);
    else this.collapsedWordGroups.add(group);
    this.renderResults();
  }

  private renderResults(): void {
    if (!this.results) return;
    this.results.empty();
    const { roots, words, issues } = this.store.catalog;
    if (issues.length) {
      const alert = this.results.createEl('details', { cls: 'rv-issues' });
      alert.createEl('summary', { text: `${issues.length} 项笔记问题` });
      for (const issue of issues) {
        const row = alert.createDiv({ cls: 'rv-issue' });
        const open = row.createEl('button', { text: issue.path, cls: 'rv-issue-link', attr: { title: '打开问题笔记' } });
        open.addEventListener('click', () => { void this.store.openPath(issue.path); });
        row.createDiv({ text: issue.message });
      }
    }
    const rootElements: HTMLElement[] = [];
    const rootHeader = this.results.createDiv({ cls: 'rv-section-heading' });
    rootElements.push(rootHeader);
    rootHeader.createEl('h4', { text: `词根词缀 ${roots.length}` });
    const rootActions = rootHeader.createDiv({ cls: 'rv-root-actions' });
    const sort = rootActions.createEl('select', { cls: 'rv-root-sort', attr: { 'aria-label': '词根词缀排序', title: '词根词缀排序' } });
    sort.createEl('option', { text: 'A-Z', value: 'form-asc' });
    sort.createEl('option', { text: 'Z-A', value: 'form-desc' });
    sort.createEl('option', { text: '按释义', value: 'meaning' });
    sort.value = this.rootSort;
    sort.addEventListener('change', () => {
      this.rootSort = sort.value as typeof this.rootSort;
      this.renderResults();
    });
    const rootCollapse = iconButton(rootActions, this.rootsCollapsed ? 'chevron-down' : 'chevron-up',
      this.rootsCollapsed ? '展开所有词根词缀' : '折叠所有词根词缀', () => {
        this.rootsCollapsed = !this.rootsCollapsed;
        this.expandedRootGroups.clear();
        this.collapsedRootGroups.clear();
        this.renderResults();
      });
    rootCollapse.setAttribute('aria-expanded', String(!this.rootsCollapsed));
    const rootList = this.results.createDiv({ cls: 'rv-root-list' });
    rootElements.push(rootList);
    const needle = this.query.trim().toLocaleLowerCase();
    const filteredRoots = roots.filter(r => !needle || `${r.form} ${r.meaning} ${r.variants.join(' ')}`.toLocaleLowerCase().includes(needle)
      || words.some(w => w.rootIds.includes(r.id) && `${w.spelling} ${w.meaning}`.toLocaleLowerCase().includes(needle)));
    filteredRoots.sort((a, b) => this.rootSort === 'meaning'
      ? a.meaning.localeCompare(b.meaning, 'zh-CN') || rootSortForm(a.form).localeCompare(rootSortForm(b.form), 'en', { sensitivity: 'base' })
      : (this.rootSort === 'form-desc' ? -1 : 1) * rootSortForm(a.form).localeCompare(rootSortForm(b.form), 'en', { sensitivity: 'base' }));
    let currentGroup = '';
    let groupBody: HTMLElement | null = null;
    for (const root of filteredRoots) {
      const sortableForm = rootSortForm(root.form);
      const group = this.rootSort === 'meaning' ? '释义' : (/^[a-z]/i.test(sortableForm) ? sortableForm[0].toUpperCase() : '#');
      if (group !== currentGroup) {
        currentGroup = group;
        const section = rootList.createDiv({ cls: 'rv-root-group' });
        const label = section.createEl('button', { text: group, cls: 'rv-root-group-label', attr: {
          'aria-label': `${group} 词根词缀分组`, 'aria-expanded': String(this.rootsCollapsed
            ? this.expandedRootGroups.has(group) : !this.collapsedRootGroups.has(group))
        } });
        label.addEventListener('click', () => this.toggleRootGroup(group));
        groupBody = section.createDiv({ cls: 'rv-root-group-grid' });
        const rootGroupOpen = this.rootsCollapsed ? this.expandedRootGroups.has(group) : !this.collapsedRootGroups.has(group);
        groupBody.toggleClass('rv-hidden', !rootGroupOpen);
      }
      const count = words.filter(w => w.rootIds.includes(root.id));
      const row = groupBody!.createDiv({ cls: `rv-root-row${this.rootId === root.id ? ' is-active' : ''}` });
      const select = row.createEl('button', { cls: 'rv-root-select' });
      select.createEl('strong', { text: root.form });
      select.createSpan({ text: root.meaning, cls: 'rv-muted' });
      select.addEventListener('click', () => this.showScope(root.id));
      row.createSpan({ text: String(count.length), cls: 'rv-count' });
      iconButton(row, 'file-text', '打开词根笔记', () => { void this.store.open(root); });
      iconButton(row, 'file-plus', '在此词根词缀下新增单词', () => this.edit(undefined, 'word', root.id));
      iconButton(row, 'pencil', '编辑词根词缀', () => this.edit(root));
    }
    const selected = roots.find(r => r.id === this.rootId);
    if (this.rootId && !selected) this.rootId = '';
    if (selected) {
      const detail = this.results.createDiv({ cls: 'rv-root-detail' });
      rootElements.push(detail);
      detail.toggleClass('rv-hidden', this.rootsCollapsed);
      detail.createEl('h4', { text: `${selected.form} · ${selected.meaning}` });
      if (selected.variants.length) detail.createDiv({ text: `变体：${selected.variants.join('、')}`, cls: 'rv-muted' });
      if (selected.links.length) {
        const links = detail.createDiv({ cls: 'rv-root-links' });
        links.createSpan({ text: '链接：', cls: 'rv-muted' });
        selected.links.forEach((link, index) => {
          if (index) links.createSpan({ text: '、', cls: 'rv-muted' });
          links.createEl('a', { text: link, href: link, attr: { target: '_blank', rel: 'noopener' } });
        });
      }
      const related = words.filter(w => w.rootIds.includes(selected.id));
      const counts = (['未学', '学习中', '已掌握'] as Familiarity[]).map(s => `${s} ${related.filter(w => w.familiarity === s).length}`);
      detail.createDiv({ text: counts.join('  ·  '), cls: 'rv-muted' });
    }
    const matched = visibleWords(this.store.catalog, {
      query: this.query, rootId: this.rootId, status: this.status, favorites: this.favorites,
    });
    const wordSection = this.results.createDiv({ cls: 'rv-word-section' });
    wordSection.toggleClass('rv-pane-hidden', this.viewMode !== 'words');
    const wordHeader = wordSection.createDiv({ cls: 'rv-section-heading rv-word-header' });
    wordHeader.createEl('h4', { text: `${selected ? `${selected.form} · ` : ''}单词 ${matched.length}`, cls: 'rv-word-heading' });
    const wordActions = wordHeader.createDiv({ cls: 'rv-word-actions' });
    const all = wordActions.createEl('button', { text: '全部单词', cls: this.rootId ? 'rv-text-button' : 'rv-text-button is-active' });
    all.addEventListener('click', () => { this.viewMode = 'words'; this.showScope(''); });
    const wordSort = wordActions.createEl('select', { cls: 'rv-word-sort', attr: { 'aria-label': '单词排序', title: '单词排序' } });
    wordSort.createEl('option', { text: 'A-Z', value: 'spelling-asc' });
    wordSort.createEl('option', { text: 'Z-A', value: 'spelling-desc' });
    wordSort.value = this.wordSort;
    wordSort.addEventListener('change', () => {
      this.wordSort = wordSort.value as typeof this.wordSort;
      this.renderResults();
    });
    const wordCollapse = iconButton(wordActions, this.wordsCollapsed ? 'chevron-down' : 'chevron-up',
      this.wordsCollapsed ? '展开所有单词' : '折叠所有单词', () => {
        this.wordsCollapsed = !this.wordsCollapsed;
        this.expandedWordGroups.clear();
        this.collapsedWordGroups.clear();
        this.renderResults();
      });
    wordCollapse.setAttribute('aria-expanded', String(!this.wordsCollapsed));
    const wordList = wordSection.createDiv({ cls: 'rv-word-list' });
    const sortedWords = [...matched].sort((a, b) => (this.wordSort === 'spelling-desc' ? -1 : 1)
      * a.spelling.localeCompare(b.spelling, 'en', { sensitivity: 'base' }));
    let currentWordGroup = '';
    let wordGroupBody: HTMLElement | null = null;
    for (const word of sortedWords) {
      const wordGroup = /^[a-z]/i.test(word.spelling) ? word.spelling[0].toUpperCase() : '#';
      if (wordGroup !== currentWordGroup) {
        currentWordGroup = wordGroup;
        const section = wordList.createDiv({ cls: 'rv-word-group' });
        const label = section.createEl('button', { text: wordGroup, cls: 'rv-word-group-label', attr: {
          'aria-label': `${wordGroup} 单词分组`, 'aria-expanded': String(this.wordsCollapsed
            ? this.expandedWordGroups.has(wordGroup) : !this.collapsedWordGroups.has(wordGroup))
        } });
        label.addEventListener('click', () => this.toggleWordGroup(wordGroup));
        wordGroupBody = section.createDiv({ cls: 'rv-word-group-body' });
        const wordGroupOpen = this.wordsCollapsed ? this.expandedWordGroups.has(wordGroup) : !this.collapsedWordGroups.has(wordGroup);
        wordGroupBody.toggleClass('rv-hidden', !wordGroupOpen);
      }
      const row = wordGroupBody!.createDiv({ cls: 'rv-word-row' });
      const main = row.createDiv({ cls: 'rv-word-main', attr: { role: 'button', tabindex: '0', 'aria-label': `打开单词笔记：${word.spelling}` } });
      main.createEl('strong', { text: word.spelling });
      if (word.ipa) main.createSpan({ text: word.ipa, cls: 'rv-muted' });
      main.createSpan({ text: displayMeaning(word.meaning), cls: 'rv-meaning' });
      if (word.memoryAid) main.createSpan({ text: `辅助记忆：${displayMeaning(word.memoryAid)}`, cls: 'rv-memory-aid' });
      const openWord = () => { void this.store.open(word); };
      main.addEventListener('click', openWord);
      main.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openWord(); }
      });
      const controls = row.createDiv({ cls: 'rv-word-controls' });
      const state = controls.createEl('select', { cls: 'rv-state', attr: { 'aria-label': `${word.spelling} 熟悉度` } });
      for (const option of ['未学', '学习中', '已掌握'] as Familiarity[]) state.createEl('option', { text: option, value: option });
      state.value = word.familiarity;
      state.addEventListener('change', () => {
        void this.store.updateWordState(word, { familiarity: state.value as Familiarity })
          .catch(error => { state.value = word.familiarity; new Notice((error as Error).message); });
      });
      iconButton(controls, 'volume-2', `播放${word.spelling}发音`, () => { void this.playWord(word.spelling); });
      const star = iconButton(controls, 'star', word.favorite ? '取消收藏' : '收藏单词', () => {
        void this.store.updateWordState(word, { favorite: !word.favorite })
          .catch(error => new Notice((error as Error).message));
      });
      if (word.favorite) star.addClass('is-favorite');
      iconButton(controls, 'pencil', '编辑单词', () => this.edit(word));
    }
    if (!roots.length) wordList.createDiv({ text: '还没有词根词缀。点击上方加号开始。', cls: 'rv-empty' });
    else if (!matched.length) wordList.createDiv({ text: words.length ? '没有符合条件的单词。' : '还没有单词。点击上方新建单词按钮添加。', cls: 'rv-empty' });
    for (const element of rootElements) element.toggleClass('rv-pane-hidden', this.viewMode !== 'roots');
    this.contentEl.querySelectorAll<HTMLButtonElement>('.rv-mode-tab').forEach((tab, index) => {
      const active = (index === 0 && this.viewMode === 'roots') || (index === 1 && this.viewMode === 'words');
      tab.toggleClass('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
  }
}

export class EntryModal extends Modal {
  private draft: RootEntry | WordEntry;
  private expected?: string;
  private candidates: ChineseMeaningCandidate[] = [];
  private candidateContainer!: HTMLElement;

  constructor(app: App, private store: VocabularyStore, entry: RootEntry | WordEntry | undefined, kind: 'root' | 'word', initialRootId?: string) {
    super(app);
    this.draft = entry ? structuredClone(entry) : kind === 'root'
      ? { kind: 'root', id: crypto.randomUUID(), path: '', form: '', meaning: '', variants: [], origin: '', explanation: '', links: [] }
      : { kind: 'word', id: crypto.randomUUID(), path: '', spelling: '', meaning: '', rootIds: initialRootId ? [initialRootId] : [], ipa: '',
          memoryAid: '', example: '', favorite: false, familiarity: '未学', dictionarySource: '', dictionaryLicense: '' };
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass('rv-modal');
    this.titleEl.setText(`${this.draft.path ? '编辑' : '新建'}${this.draft.kind === 'root' ? '词根词缀' : '单词'}`);
    if (this.draft.path) {
      try { this.expected = await this.store.snapshot(this.draft); }
      catch (error) { new Notice((error as Error).message); this.close(); return; }
    }
    const body = this.contentEl;
    if (this.draft.kind === 'root') this.renderRoot(body, this.draft);
    else this.renderWord(body, this.draft);
    new Setting(body).addButton(button => button.setButtonText('保存').setCta().onClick(async () => {
      try {
        if (this.draft.kind === 'root') {
          if (!this.draft.form.trim() || !this.draft.meaning.trim()) throw new Error('请填写词根/词缀形式和中文含义');
        } else if (!this.draft.spelling.trim() || !this.draft.meaning.trim() || !this.draft.rootIds.length) {
          throw new Error('请填写拼写、中文释义并选择至少一个词根');
        }
        await this.store.save(this.draft, this.expected);
        this.close();
      } catch (error) { new Notice((error as Error).message, 7000); }
    }));
  }

  private renderRoot(body: HTMLElement, root: RootEntry): void {
    new Setting(body).setName('词根/词缀形式 *').addText(t => t.setValue(root.form).onChange(v => root.form = v));
    new Setting(body).setName('中文含义 *').addText(t => t.setValue(root.meaning).onChange(v => root.meaning = v));
    new Setting(body).setName('变体').setDesc('多个变体用逗号分隔').addText(t => t.setValue(root.variants.join(', '))
      .onChange(v => root.variants = v.split(/[,，]/).map(x => x.trim()).filter(Boolean)));
    new Setting(body).setName('来源').addText(t => t.setValue(root.origin).onChange(v => root.origin = v));
    new Setting(body).setName('说明').addTextArea(t => t.setValue(root.explanation).onChange(v => root.explanation = v));
    new Setting(body).setName('链接').setDesc('每行一个链接').addTextArea(t => t.setValue(root.links.join('\n'))
      .onChange(v => root.links = v.split(/\r?\n/).map(x => x.trim()).filter(Boolean)));
  }

  private renderWord(body: HTMLElement, word: WordEntry): void {
    new Setting(body).setName('拼写 *').addText(t => t.setValue(word.spelling).onChange(v => word.spelling = v));
    const lookup = new Setting(body).setName('ECDICT 中文释义查询').setDesc('使用 vault 内的 ECDICT 本地词典；已有释义不会被覆盖。');
    lookup.addButton(button => button.setButtonText('查询中文释义').onClick(async () => {
      button.setDisabled(true);
      this.candidateContainer.empty();
      this.candidateContainer.createDiv({ text: '查询中…', cls: 'rv-muted' });
      try {
        this.candidates = await this.store.lookup(word.spelling);
        if (!word.meaning.trim() && this.candidates.length) this.applyMeanings(word, this.candidates);
        this.renderCandidates(word);
      } catch (error) {
        const message = (error as Error).message;
        this.candidateContainer.setText(message);
        new Notice(message, 7000);
      } finally {
        button.setDisabled(false);
        this.candidateContainer.scrollIntoView({ block: 'nearest' });
      }
    }));
    this.candidateContainer = body.createDiv({ cls: 'rv-candidates', attr: { 'aria-live': 'polite' } });
    const roots = this.store.catalog.roots;
    if (!roots.length) body.createDiv({ text: '请先建立词根词缀，再添加单词。', cls: 'rv-warning' });
    const rootGroup = body.createDiv({ cls: 'rv-root-choices' });
    rootGroup.createEl('strong', { text: '关联词根词缀 *' });
    const rootSearch = rootGroup.createEl('input', { cls: 'rv-root-search', attr: { type: 'search', placeholder: '筛选词根', 'aria-label': '筛选关联词根' } });
    const choices: { element: HTMLElement; text: string }[] = [];
    for (const root of roots) {
      const setting = new Setting(rootGroup).setName(`${root.form} · ${root.meaning}`).addToggle(toggle => toggle
        .setValue(word.rootIds.includes(root.id)).onChange(value => {
          word.rootIds = value ? [...new Set([...word.rootIds, root.id])] : word.rootIds.filter(id => id !== root.id);
        }));
      choices.push({ element: setting.settingEl, text: `${root.form} ${root.meaning} ${root.variants.join(' ')}`.toLocaleLowerCase() });
    }
    rootSearch.addEventListener('input', () => {
      const term = rootSearch.value.trim().toLocaleLowerCase();
      for (const choice of choices) choice.element.toggleClass('rv-hidden', !!term && !choice.text.includes(term));
    });
    for (const missing of word.rootIds.filter(id => !roots.some(root => root.id === id))) {
      new Setting(rootGroup).setName(`失效关联：${missing}`).setClass('rv-warning').addButton(button => button
        .setButtonText('移除').onClick(() => {
          word.rootIds = word.rootIds.filter(id => id !== missing);
          button.buttonEl.closest('.setting-item')?.remove();
        }));
    }
    new Setting(body).setName('中文释义 *').addTextArea(t => t.setValue(word.meaning).onChange(v => word.meaning = v));
    new Setting(body).setName('音标').addText(t => t.setValue(word.ipa).onChange(v => word.ipa = v));
    new Setting(body).setName('辅助记忆').addTextArea(t => t.setValue(word.memoryAid).onChange(v => word.memoryAid = v));
    new Setting(body).setName('例句').addTextArea(t => t.setValue(word.example).onChange(v => word.example = v));
    new Setting(body).setName('收藏').addToggle(t => t.setValue(word.favorite).onChange(v => word.favorite = v));
    new Setting(body).setName('熟悉度').addDropdown(d => {
      for (const state of ['未学', '学习中', '已掌握'] as Familiarity[]) d.addOption(state, state);
      d.setValue(word.familiarity).onChange(v => word.familiarity = v as Familiarity);
    });
  }

  private renderCandidates(word: WordEntry): void {
    this.candidateContainer.empty();
    if (!this.candidates.length) { this.candidateContainer.setText('未找到中文释义，仍可手动录入。'); return; }
    for (const candidate of this.candidates) {
      const row = this.candidateContainer.createDiv({ cls: 'rv-candidate' });
      if (candidate.label) row.createDiv({ text: candidate.label, cls: 'rv-candidate-label' });
      row.createDiv({ text: candidate.meaning, cls: 'rv-candidate-meaning' });
      const controls = row.createDiv({ cls: 'rv-actions' });
      const selected = this.meaningItems(word.meaning).some(item => item.toLocaleLowerCase() === candidate.meaning.toLocaleLowerCase());
      const button = controls.createEl('button', { text: selected ? '已填入' : '采用释义' });
      button.disabled = selected;
      button.addEventListener('click', () => { this.applyMeaning(word, candidate); this.renderCandidates(word); });
    }
    this.candidateContainer.createDiv({ text: '结果来源：ECDICT', cls: 'rv-muted rv-candidate-source' });
  }

  private meaningItems(value: string): string[] {
    return value.split(/[\r\n;；]+/).map(item => item.trim()).filter(Boolean);
  }

  private applyMeanings(word: WordEntry, candidates: ChineseMeaningCandidate[]): void {
    const items = this.meaningItems(word.meaning);
    const seen = new Set(items.map(item => item.toLocaleLowerCase()));
    for (const candidate of candidates) {
      const meaning = candidate.meaning.trim();
      if (meaning && !seen.has(meaning.toLocaleLowerCase())) {
        items.push(meaning);
        seen.add(meaning.toLocaleLowerCase());
      }
    }
    word.meaning = items.join('；');
    const source = candidates.find(candidate => candidate.meaning.trim())?.source;
    if (source) word.dictionarySource = source;
    word.dictionaryLicense = '';
    this.refreshField('中文释义 *', word.meaning);
  }

  private applyMeaning(word: WordEntry, candidate: ChineseMeaningCandidate): void {
    this.applyMeanings(word, [candidate]);
  }

  private refreshField(name: string, value: string): void {
    for (const setting of Array.from(this.contentEl.querySelectorAll('.setting-item'))) {
      if (setting.querySelector('.setting-item-name')?.textContent === name) {
        const input = setting.querySelector('input, textarea');
        if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.value = value;
      }
    }
  }
}
