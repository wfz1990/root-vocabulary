import YAML, { YAMLMap } from 'yaml';

export const ROOT_DIR = '词根词库/词根';
export const WORD_DIR = '词根词库/单词';
export type Familiarity = '未学' | '学习中' | '已掌握';
export type EntryKind = 'root' | 'word';

export interface RootEntry {
  kind: 'root'; id: string; path: string; form: string; meaning: string;
  variants: string[]; origin: string; explanation: string; links: string[];
}
export interface WordEntry {
  kind: 'word'; id: string; path: string; spelling: string; meaning: string;
  rootIds: string[]; ipa: string;
  memoryAid: string; example: string; favorite: boolean; familiarity: Familiarity; dictionarySource: string; dictionaryLicense: string;
}
export type Entry = RootEntry | WordEntry;
export interface Issue { path: string; message: string }
export interface Catalog { roots: RootEntry[]; words: WordEntry[]; issues: Issue[] }
export interface Source { path: string; text: string }
export interface WordFilter { query: string; rootId: string; status: Familiarity | '全部'; favorites: boolean }

export function resetWordFilter(rootId = ''): WordFilter {
  return { query: '', rootId, status: '全部', favorites: false };
}

const string = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every(x => typeof x === 'string') ? v.map(x => x.trim()).filter(Boolean) : null;
const optionalStrings = (data: Record<string, unknown>, key: string): string[] => {
  if (data[key] == null) return [];
  if (Array.isArray(data[key]) && data[key].every(x => typeof x === 'string'))
    return (data[key] as string[]).map(x => x.trim()).filter(Boolean);
  if (typeof data[key] === 'string') return String(data[key]).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  throw new Error(`${key} 必须是文本列表`);
};
const required = (data: Record<string, unknown>, key: string) => {
  const result = string(data[key]);
  if (!result) throw new Error(`${key} 必须是非空文本`);
  return result;
};
const optional = (data: Record<string, unknown>, key: string) => {
  if (data[key] != null && typeof data[key] !== 'string') throw new Error(`${key} 必须是文本`);
  return string(data[key]);
};

export function parseNote(path: string, text: string): Entry {
  const kind: EntryKind | null = path.startsWith(`${ROOT_DIR}/`) ? 'root' : path.startsWith(`${WORD_DIR}/`) ? 'word' : null;
  if (!kind || !path.endsWith('.md')) throw new Error('不是词库笔记');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error('缺少完整的 YAML frontmatter');
  const doc = YAML.parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length) throw new Error(`YAML 错误：${doc.errors[0].message}`);
  const data = doc.toJS();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('frontmatter 必须是对象');
  const fields = data as Record<string, unknown>;
  if (fields.type !== kind) throw new Error(`type 应为 ${kind}`);
  const id = required(fields, 'id');
  if (kind === 'root') {
    const variants = fields.variants == null ? [] : strings(fields.variants);
    if (!variants) throw new Error('variants 必须是文本列表');
    return { kind, id, path, form: required(fields, 'form'), meaning: required(fields, 'meaning'),
      variants, origin: optional(fields, 'origin'), explanation: optional(fields, 'explanation'), links: optionalStrings(fields, 'links') };
  }
  const rootIds = strings(fields.rootIds);
  if (!rootIds?.length) throw new Error('rootIds 至少包含一个词根 ID');
  if (fields.favorite != null && typeof fields.favorite !== 'boolean') throw new Error('favorite 必须是布尔值');
  const familiarity = fields.familiarity ?? '未学';
  if (!['未学', '学习中', '已掌握'].includes(String(familiarity))) throw new Error('familiarity 无效');
  return { kind, id, path, spelling: required(fields, 'spelling'), meaning: required(fields, 'meaning'), rootIds,
    ipa: optional(fields, 'ipa'),
    memoryAid: optional(fields, 'memoryAid'), example: optional(fields, 'example'), favorite: fields.favorite ?? false, familiarity: familiarity as Familiarity,
    dictionarySource: optional(fields, 'dictionarySource'), dictionaryLicense: optional(fields, 'dictionaryLicense') };
}

export function indexNotes(sources: Source[]): Catalog {
  const roots: RootEntry[] = [], words: WordEntry[] = [], issues: Issue[] = [];
  const ids = new Map<string, string>(), spellings = new Map<string, string>();
  for (const source of sources.sort((a, b) => a.path.localeCompare(b.path))) {
    try {
      const entry = parseNote(source.path, source.text);
      if (ids.has(entry.id)) throw new Error(`重复 ID：${entry.id}（另见 ${ids.get(entry.id)}）`);
      if (entry.kind === 'word' && spellings.has(entry.spelling.toLocaleLowerCase('en'))) {
        throw new Error(`重复拼写：${entry.spelling}（另见 ${spellings.get(entry.spelling.toLocaleLowerCase('en'))}）`);
      }
      ids.set(entry.id, source.path);
      if (entry.kind === 'root') roots.push(entry);
      else { words.push(entry); spellings.set(entry.spelling.toLocaleLowerCase('en'), source.path); }
    } catch (error) { issues.push({ path: source.path, message: String((error as Error).message) }); }
  }
  const rootIds = new Set(roots.map(root => root.id));
  for (const word of words) for (const id of new Set(word.rootIds)) {
    if (!rootIds.has(id)) issues.push({ path: word.path, message: `失效的词根关联：${id}` });
  }
  return { roots, words, issues };
}

export function searchWords(words: WordEntry[], query: string, status: Familiarity | '全部', favorites: boolean, roots: RootEntry[] = []): WordEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  const matchingRoots = new Set(roots.filter(root => `${root.form} ${root.meaning} ${root.variants.join(' ')}`.toLocaleLowerCase().includes(needle)).map(root => root.id));
  return words.filter(w => (!favorites || w.favorite) && (status === '全部' || w.familiarity === status)
    && (!needle || `${w.spelling} ${w.meaning}`.toLocaleLowerCase().includes(needle) || w.rootIds.some(id => matchingRoots.has(id))));
}

export function visibleWords(catalog: Catalog, filter: WordFilter): WordEntry[] {
  return searchWords(catalog.words, filter.query, filter.status, filter.favorites, catalog.roots)
    .filter(word => !filter.rootId || word.rootIds.includes(filter.rootId));
}

export function writeNote(original: string | null, entry: Entry): string {
  const match = original && /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(original);
  if (original && !match) throw new Error('无法编辑没有完整 frontmatter 的笔记');
  const doc = match ? YAML.parseDocument(match[1], { uniqueKeys: true }) : new YAML.Document();
  if (doc.errors.length) throw new Error('无法编辑 YAML 格式错误的笔记');
  if (!doc.contents) doc.contents = new YAMLMap();
  if (!(doc.contents instanceof YAMLMap)) throw new Error('frontmatter 必须是对象');
  const fields: Record<string, unknown> = entry.kind === 'root'
    ? { type: 'root', id: entry.id, form: entry.form, meaning: entry.meaning, variants: entry.variants,
        origin: entry.origin, explanation: entry.explanation, links: entry.links }
    : { type: 'word', id: entry.id, spelling: entry.spelling, meaning: entry.meaning, rootIds: entry.rootIds,
        ipa: entry.ipa, memoryAid: entry.memoryAid, example: entry.example,
        favorite: entry.favorite, familiarity: entry.familiarity, dictionarySource: entry.dictionarySource,
        dictionaryLicense: entry.dictionaryLicense };
  for (const [key, value] of Object.entries(fields)) doc.set(key, value);
  return `---\n${doc.toString().trimEnd()}\n---\n${match ? original!.slice(match[0].length) : '\n'}`;
}

export function safeName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|#\[\]^]/g, '-').replace(/\s+/g, ' ').slice(0, 80) || '未命名';
}
