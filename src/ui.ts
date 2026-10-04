import { App, ItemView, Modal, Notice, Setting, WorkspaceLeaf, setIcon } from 'obsidian';
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

export class VocabularyView extends ItemView {
  private unsubscribe?: () => void;
  private query = '';
  private rootId = '';
  private status: Familiarity | '全部' = '全部';
  private favorites = false;
  private viewMode: 'roots' | 'words' = 'roots';
  private rootSort: 'form-asc' | 'form-desc' | 'meaning' = 'form-asc';
  private rootsCollapsed = false;
  private wordsCollapsed = false;
  private results!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private statusSelect!: HTMLSelectElement;
  private favoriteCheckbox!: HTMLInputElement;

  constructor(leaf: WorkspaceLeaf, private store: VocabularyStore, private edit: (entry?: RootEntry | WordEntry, kind?: 'root' | 'word') => void) {
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
    iconButton(actions, 'plus', '新建词根', () => this.edit(undefined, 'root'));
    iconButton(actions, 'file-plus', '新建单词', () => this.edit(undefined, 'word'));
    iconButton(actions, 'refresh-cw', '刷新词库', () => {
      void this.store.refresh().catch(error => new Notice((error as Error).message));
    });
    const modeTabs = container.createDiv({ cls: 'rv-mode-tabs', attr: { role: 'tablist', 'aria-label': '词库页面' } });
    for (const mode of [{ value: 'roots', label: '词根' }, { value: 'words', label: '单词' }] as const) {
      const tab = modeTabs.createEl('button', { text: mode.label, cls: 'rv-mode-tab', attr: { role: 'tab' } });
      tab.addEventListener('click', () => { this.viewMode = mode.value; this.renderResults(); });
    }

    this.searchInput = container.createEl('input', { cls: 'rv-search', attr: { type: 'search', placeholder: '搜索拼写、中文释义或词根', 'aria-label': '搜索词库' } });
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

  async onClose(): Promise<void> { this.unsubscribe?.(); }

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
    rootHeader.createEl('h4', { text: `词根 ${roots.length}` });
    const rootActions = rootHeader.createDiv({ cls: 'rv-root-actions' });
    const sort = rootActions.createEl('select', { cls: 'rv-root-sort', attr: { 'aria-label': '词根排序', title: '词根排序' } });
    sort.createEl('option', { text: 'A-Z', value: 'form-asc' });
    sort.createEl('option', { text: 'Z-A', value: 'form-desc' });
    sort.createEl('option', { text: '按释义', value: 'meaning' });
    sort.value = this.rootSort;
    sort.addEventListener('change', () => {
      this.rootSort = sort.value as typeof this.rootSort;
      this.renderResults();
    });
    const all = rootActions.createEl('button', { text: '全部单词', cls: this.rootId ? 'rv-text-button' : 'rv-text-button is-active' });
    all.addEventListener('click', () => this.showScope(''));
    const rootCollapse = iconButton(rootActions, this.rootsCollapsed ? 'chevron-down' : 'chevron-up',
      this.rootsCollapsed ? '展开所有词根' : '折叠所有词根', () => {
        this.rootsCollapsed = !this.rootsCollapsed;
        this.renderResults();
      });
    rootCollapse.setAttribute('aria-expanded', String(!this.rootsCollapsed));
    const rootList = this.results.createDiv({ cls: 'rv-root-list' });
    rootElements.push(rootList);
    rootList.toggleClass('rv-hidden', this.rootsCollapsed);
    const needle = this.query.trim().toLocaleLowerCase();
    const filteredRoots = roots.filter(r => !needle || `${r.form} ${r.meaning} ${r.variants.join(' ')}`.toLocaleLowerCase().includes(needle)
      || words.some(w => w.rootIds.includes(r.id) && `${w.spelling} ${w.meaning}`.toLocaleLowerCase().includes(needle)));
    filteredRoots.sort((a, b) => this.rootSort === 'meaning'
      ? a.meaning.localeCompare(b.meaning, 'zh-CN') || a.form.localeCompare(b.form, 'en', { sensitivity: 'base' })
      : (this.rootSort === 'form-desc' ? -1 : 1) * a.form.localeCompare(b.form, 'en', { sensitivity: 'base' }));
    let currentGroup = '';
    let groupBody: HTMLElement | null = null;
    for (const root of filteredRoots) {
      const group = this.rootSort === 'meaning' ? '释义' : (/^[a-z]/i.test(root.form) ? root.form[0].toUpperCase() : '#');
      if (group !== currentGroup) {
        currentGroup = group;
        const section = rootList.createDiv({ cls: 'rv-root-group' });
        section.createDiv({ text: group, cls: 'rv-root-group-label' });
        groupBody = section.createDiv({ cls: 'rv-root-group-grid' });
      }
      const count = words.filter(w => w.rootIds.includes(root.id));
      const row = groupBody!.createDiv({ cls: `rv-root-row${this.rootId === root.id ? ' is-active' : ''}` });
      const select = row.createEl('button', { cls: 'rv-root-select' });
      select.createEl('strong', { text: root.form });
      select.createEl('span', { text: root.meaning, cls: 'rv-muted' });
      select.addEventListener('click', () => this.showScope(root.id));
      row.createEl('span', { text: String(count.length), cls: 'rv-count' });
      iconButton(row, 'file-text', '打开词根笔记', () => { void this.store.open(root); });
      iconButton(row, 'pencil', '编辑词根', () => this.edit(root));
    }
    const selected = roots.find(r => r.id === this.rootId);
    if (this.rootId && !selected) this.rootId = '';
    if (selected) {
      const detail = this.results.createDiv({ cls: 'rv-root-detail' });
      rootElements.push(detail);
      detail.toggleClass('rv-hidden', this.rootsCollapsed);
      detail.createEl('h4', { text: `${selected.form} · ${selected.meaning}` });
      if (selected.variants.length) detail.createDiv({ text: `变体：${selected.variants.join('、')}`, cls: 'rv-muted' });
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
    const wordCollapse = iconButton(wordHeader, this.wordsCollapsed ? 'chevron-down' : 'chevron-up',
      this.wordsCollapsed ? '展开所有单词' : '折叠所有单词', () => {
        this.wordsCollapsed = !this.wordsCollapsed;
        this.renderResults();
      });
    wordCollapse.setAttribute('aria-expanded', String(!this.wordsCollapsed));
    const wordList = wordSection.createDiv({ cls: 'rv-word-list' });
    wordList.toggleClass('rv-hidden', this.wordsCollapsed);
    for (const word of matched) {
      const row = wordList.createDiv({ cls: 'rv-word-row' });
      const main = row.createEl('button', { cls: 'rv-word-main' });
      main.createEl('strong', { text: word.spelling });
      if (word.ipa) main.createEl('span', { text: word.ipa, cls: 'rv-muted' });
      main.createSpan({ text: word.meaning, cls: 'rv-meaning' });
      main.addEventListener('click', () => { void this.store.open(word); });
      const state = row.createEl('select', { cls: 'rv-state', attr: { 'aria-label': `${word.spelling} 熟悉度` } });
      for (const option of ['未学', '学习中', '已掌握'] as Familiarity[]) state.createEl('option', { text: option, value: option });
      state.value = word.familiarity;
      state.addEventListener('change', () => {
        void this.store.updateWordState(word, { familiarity: state.value as Familiarity })
          .catch(error => { state.value = word.familiarity; new Notice((error as Error).message); });
      });
      const star = iconButton(row, 'star', word.favorite ? '取消收藏' : '收藏单词', () => {
        void this.store.updateWordState(word, { favorite: !word.favorite })
          .catch(error => new Notice((error as Error).message));
      });
      if (word.favorite) star.addClass('is-favorite');
      iconButton(row, 'pencil', '编辑单词', () => this.edit(word));
    }
    if (!roots.length) wordList.createDiv({ text: '还没有词根。点击上方加号开始。', cls: 'rv-empty' });
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

  constructor(app: App, private store: VocabularyStore, entry: RootEntry | WordEntry | undefined, kind: 'root' | 'word') {
    super(app);
    this.draft = entry ? structuredClone(entry) : kind === 'root'
      ? { kind: 'root', id: crypto.randomUUID(), path: '', form: '', meaning: '', variants: [], origin: '', explanation: '' }
      : { kind: 'word', id: crypto.randomUUID(), path: '', spelling: '', meaning: '', rootIds: [], ipa: '', phonics: '',
          partOfSpeech: '', example: '', favorite: false, familiarity: '未学', dictionarySource: '', dictionaryLicense: '' };
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass('rv-modal');
    this.titleEl.setText(`${this.draft.path ? '编辑' : '新建'}${this.draft.kind === 'root' ? '词根' : '单词'}`);
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
          if (!this.draft.form.trim() || !this.draft.meaning.trim()) throw new Error('请填写词根形式和中文含义');
        } else if (!this.draft.spelling.trim() || !this.draft.meaning.trim() || !this.draft.rootIds.length) {
          throw new Error('请填写拼写、中文释义并选择至少一个词根');
        }
        await this.store.save(this.draft, this.expected);
        this.close();
      } catch (error) { new Notice((error as Error).message, 7000); }
    }));
  }

  private renderRoot(body: HTMLElement, root: RootEntry): void {
    new Setting(body).setName('词根形式 *').addText(t => t.setValue(root.form).onChange(v => root.form = v));
    new Setting(body).setName('中文含义 *').addText(t => t.setValue(root.meaning).onChange(v => root.meaning = v));
    new Setting(body).setName('变体').setDesc('多个变体用逗号分隔').addText(t => t.setValue(root.variants.join(', '))
      .onChange(v => root.variants = v.split(/[,，]/).map(x => x.trim()).filter(Boolean)));
    new Setting(body).setName('来源').addText(t => t.setValue(root.origin).onChange(v => root.origin = v));
    new Setting(body).setName('说明').addTextArea(t => t.setValue(root.explanation).onChange(v => root.explanation = v));
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
        if (!word.meaning.trim() && this.candidates[0]) this.applyMeaning(word, this.candidates[0]);
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
    if (!roots.length) body.createDiv({ text: '请先建立词根，再添加单词。', cls: 'rv-warning' });
    const rootGroup = body.createDiv({ cls: 'rv-root-choices' });
    rootGroup.createEl('strong', { text: '关联词根 *' });
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
      const selected = word.meaning.trim() === candidate.meaning;
      const button = controls.createEl('button', { text: selected ? '已填入' : '采用释义' });
      button.disabled = selected;
      button.addEventListener('click', () => { this.applyMeaning(word, candidate); this.renderCandidates(word); });
    }
    this.candidateContainer.createDiv({ text: '结果来源：ECDICT', cls: 'rv-muted rv-candidate-source' });
  }

  private applyMeaning(word: WordEntry, candidate: ChineseMeaningCandidate): void {
    word.meaning = candidate.meaning;
    word.dictionarySource = candidate.source;
    word.dictionaryLicense = '';
    this.refreshField('中文释义 *', word.meaning);
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
