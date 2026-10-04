import { App, Notice, TFile, TFolder } from 'obsidian';
import { Catalog, Entry, ROOT_DIR, RootEntry, WORD_DIR, WordEntry, indexNotes, parseNote, safeName, writeNote } from './model';
import { ChineseMeaningCandidate, findEcdictMeanings, parseEcdictCsv } from './dictionary';

export class VocabularyStore {
  catalog: Catalog = { roots: [], words: [], issues: [] };
  private listeners = new Set<() => void>();
  private generation = 0;

  constructor(private app: App, private ecdictPath: string) {}

  setEcdictPath(path: string): void { this.ecdictPath = path; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    const files = this.app.vault.getMarkdownFiles().filter(f =>
      f.path.startsWith(`${ROOT_DIR}/`) || f.path.startsWith(`${WORD_DIR}/`));
    const sources = await Promise.all(files.map(async f => ({ path: f.path, text: await this.app.vault.read(f) })));
    if (generation !== this.generation) return;
    this.catalog = indexNotes(sources);
    for (const listener of this.listeners) listener();
  }

  private async ensureFolder(path: string): Promise<void> {
    let current = '';
    for (const part of path.split('/')) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
      else if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw new Error(`${current} 不是文件夹`);
    }
  }

  async snapshot(entry: Entry): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(entry.path);
    if (!(file instanceof TFile)) throw new Error('笔记已移动或删除');
    return this.app.vault.read(file);
  }

  async save(entry: Entry, expectedOriginal?: string): Promise<void> {
    await this.refresh();
    if (entry.kind === 'word') {
      if (!entry.rootIds.length || entry.rootIds.some(id => !this.catalog.roots.some(r => r.id === id)))
        throw new Error('请至少选择一个有效词根');
      if (this.catalog.words.some(w => w.id !== entry.id && w.spelling.toLocaleLowerCase('en') === entry.spelling.trim().toLocaleLowerCase('en')))
        throw new Error('这个拼写已有单词笔记，请编辑现有条目');
    }
    const existing = entry.path ? this.app.vault.getAbstractFileByPath(entry.path) : null;
    if (entry.path && !(existing instanceof TFile)) throw new Error('原笔记已移动或删除，请刷新后重试');
    const original = existing instanceof TFile ? await this.app.vault.read(existing) : null;
    if (existing && expectedOriginal !== undefined && original !== expectedOriginal)
      throw new Error('笔记在编辑期间已发生变化，请关闭表单后重新打开');
    if (original) {
      const current = parseNote(entry.path, original);
      if (current.id !== entry.id || current.kind !== entry.kind) throw new Error('笔记标识已改变，请刷新后重试');
    }
    const content = writeNote(original, entry);
    const directory = entry.kind === 'root' ? ROOT_DIR : WORD_DIR;
    const path = entry.path || `${directory}/${safeName(entry.kind === 'root' ? entry.form : entry.spelling)}-${entry.id.slice(0, 8)}.md`;
    parseNote(path, content);
    if (existing instanceof TFile) await this.app.vault.modify(existing, content);
    else {
      await this.ensureFolder(directory);
      if (this.app.vault.getAbstractFileByPath(path)) throw new Error('目标文件已存在');
      await this.app.vault.create(path, content);
    }
    await this.refresh();
  }

  async updateWordState(word: WordEntry, change: Partial<Pick<WordEntry, 'favorite' | 'familiarity'>>): Promise<void> {
    const original = await this.snapshot(word);
    const current = parseNote(word.path, original);
    if (current.kind !== 'word' || current.id !== word.id) throw new Error('笔记已发生变化，请刷新后重试');
    await this.save({ ...current, ...change }, original);
  }

  async lookup(spelling: string): Promise<ChineseMeaningCandidate[]> {
    const path = this.ecdictPath.trim() || '词根词库/ecdict.csv';
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`找不到 ECDICT 文件：${path}。请下载 ecdict.csv 并放入该路径。`);
    const rows = parseEcdictCsv(await this.app.vault.read(file));
    const candidates = findEcdictMeanings(rows, spelling);
    if (!candidates.length) throw new Error(`ECDICT 中没有找到“${spelling.trim()}”的中文释义，可手动录入。`);
    return candidates;
  }

  async open(entry: RootEntry | WordEntry): Promise<void> {
    await this.openPath(entry.path);
  }

  async openPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    else new Notice('笔记已移动或删除，请刷新词库');
  }
}
