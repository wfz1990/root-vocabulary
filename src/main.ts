import { Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { RootEntry, WordEntry, ROOT_DIR, WORD_DIR } from './model';
import { VocabularyStore } from './store';
import { EntryModal, VIEW_TYPE, VocabularyView } from './ui';

export default class RootVocabularyPlugin extends Plugin {
  private store!: VocabularyStore;
  private ecdictPath = '词根词库/ecdict.csv';
  private refreshTimer?: number;

  async onload(): Promise<void> {
    this.ecdictPath = (await this.loadData() as { ecdictPath?: string } | null)?.ecdictPath || this.ecdictPath;
    this.store = new VocabularyStore(this.app, this.ecdictPath);
    this.addSettingTab(new RootVocabularySettingTab(this.app, this));
    this.registerView(VIEW_TYPE, leaf => new VocabularyView(leaf, this.store, (entry, kind, rootId) => this.edit(entry, kind, rootId)));
    this.addRibbonIcon('book-open', '打开词根词库', () => { void this.activateView(); });
    this.addCommand({ id: 'open-vocabulary', name: '打开词根词库', callback: () => { void this.activateView(); } });
    this.addCommand({ id: 'new-root', name: '新建词根词缀', callback: () => this.edit(undefined, 'root') });
    this.addCommand({ id: 'new-word', name: '新建单词', callback: () => this.edit(undefined, 'word') });
    const affected = (file: TFile) => file.path.startsWith(`${ROOT_DIR}/`) || file.path.startsWith(`${WORD_DIR}/`);
    this.registerEvent(this.app.vault.on('create', file => { if (file instanceof TFile && affected(file)) this.scheduleRefresh(); }));
    this.registerEvent(this.app.vault.on('modify', file => { if (file instanceof TFile && affected(file)) this.scheduleRefresh(); }));
    this.registerEvent(this.app.vault.on('delete', file => { if (file instanceof TFile && affected(file)) this.scheduleRefresh(); }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile && (affected(file) || oldPath.startsWith(`${ROOT_DIR}/`) || oldPath.startsWith(`${WORD_DIR}/`)))
        this.scheduleRefresh();
    }));
    await this.store.refresh();
  }

  onunload(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      void this.store.refresh().catch(error => new Notice(`词库刷新失败：${(error as Error).message}`));
    }, 150);
  }

  private async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false)!;
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  private edit(entry?: RootEntry | WordEntry, kind?: 'root' | 'word', rootId?: string): void {
    new EntryModal(this.app, this.store, entry, entry?.kind ?? kind ?? 'root', rootId).open();
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ ecdictPath: this.ecdictPath });
  }

  getEcdictPath(): string { return this.ecdictPath; }
  setEcdictPath(path: string): void { this.ecdictPath = path; this.store?.setEcdictPath(path); }
}

class RootVocabularySettingTab extends PluginSettingTab {
  constructor(app: import('obsidian').App, private plugin: RootVocabularyPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: '词根词库：ECDICT 本地词典' });
    containerEl.createEl('p', { text: '查询使用 vault 内的 ECDICT 本地词典。请下载 ecdict.csv，放入 vault 后填写路径。' });
    new Setting(containerEl).setName('ECDICT CSV 路径').setDesc('相对于 vault 根目录，例如：词根词库/ecdict.csv')
      .addText(text => text.setPlaceholder('词根词库/ecdict.csv').setValue(this.plugin.getEcdictPath())
        .onChange(async value => { this.plugin.setEcdictPath(value.trim() || '词根词库/ecdict.csv'); await this.plugin.saveSettings(); }));
  }
}
