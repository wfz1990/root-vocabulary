import assert from 'node:assert/strict';
import test from 'node:test';
import { indexNotes, parseNote, resetWordFilter, searchWords, visibleWords, writeNote, type RootEntry, type WordEntry } from '../src/model.ts';

const root: RootEntry = { kind: 'root', id: 'root-1', path: '词根词库/词根/spect.md', form: 'spect',
  meaning: '看', variants: ['spec'], origin: '', explanation: '' };
const otherRoot: RootEntry = { ...root, id: 'root-2', path: '词根词库/词根/re.md', form: 're', meaning: '再次', variants: [] };
const word: WordEntry = { kind: 'word', id: 'word-1', path: '词根词库/单词/respect.md', spelling: 'respect',
  meaning: '尊重', rootIds: ['root-1', 'root-2'], ipa: '/rɪˈspekt/',
  example: 'Respect others.', favorite: true, familiarity: '学习中', dictionarySource: '', dictionaryLicense: '' };
const source = (entry: RootEntry | WordEntry) => ({ path: entry.path, text: writeNote(null, entry) });

test('round trips root and multi-root word through Markdown frontmatter', () => {
  assert.deepEqual(parseNote(root.path, source(root).text), root);
  assert.deepEqual(parseNote(word.path, source(word).text), word);
});

test('editing preserves body, unknown fields and comments', () => {
  const original = source(word).text.replace('spelling: respect', 'extra: custom # retained\nphonics: re-spect\npartOfSpeech: verb\nspelling: respect') + '## Personal notes\nDo not erase me.\n';
  const updated = writeNote(original, { ...word, meaning: '敬重', familiarity: '已掌握' });
  assert.match(updated, /extra: custom # retained/);
  assert.match(updated, /phonics: re-spect/);
  assert.match(updated, /partOfSpeech: verb/);
  assert.match(updated, /## Personal notes\nDo not erase me/);
  assert.equal(parseNote(word.path, updated).meaning, '敬重');
});

test('index reports malformed notes, duplicate IDs, duplicate spelling and broken links without rewriting', () => {
  const malformed = { path: '词根词库/单词/bad.md', text: '---\nid: [oops\n---\n' };
  const duplicateId = source({ ...word, path: '词根词库/单词/z-duplicate-id.md', spelling: 'another' });
  const duplicateSpelling = source({ ...word, id: 'word-2', path: '词根词库/单词/z-duplicate-spelling.md', spelling: 'RESPECT' });
  const dangling = source({ ...word, id: 'word-3', path: '词根词库/单词/lost.md', spelling: 'lost', rootIds: ['missing'] });
  const catalog = indexNotes([source(root), source(otherRoot), source(word), malformed, duplicateId, duplicateSpelling, dangling]);
  assert.equal(catalog.words.length, 2);
  assert.equal(catalog.issues.length, 4);
  assert.ok(catalog.issues.some(i => i.message.includes('YAML 错误')));
  assert.ok(catalog.issues.some(i => i.message.includes('重复 ID')));
  assert.ok(catalog.issues.some(i => i.message.includes('重复拼写')));
  assert.ok(catalog.issues.some(i => i.message.includes('失效的词根关联')));
  assert.equal(malformed.text, '---\nid: [oops\n---\n');
});

test('renamed files retain stable IDs and references; deleting root reports dangling relation', () => {
  const renamed = source({ ...root, path: '词根词库/词根/renamed.md' });
  const current = indexNotes([renamed, source(otherRoot), source(word)]);
  assert.equal(current.issues.length, 0);
  assert.equal(current.roots.find(r => r.id === root.id)?.path, renamed.path);
  const deleted = indexNotes([source(otherRoot), source(word)]);
  assert.ok(deleted.issues.some(i => i.message.includes('root-1')));
});

test('filters words by spelling, Chinese meaning, root, familiarity and favorite', () => {
  assert.deepEqual(searchWords([word], 'RESPECT', '全部', false), [word]);
  assert.deepEqual(searchWords([word], '尊重', '全部', false), [word]);
  assert.deepEqual(searchWords([word], 'spec', '全部', false, [root]), [word]);
  assert.deepEqual(searchWords([word], '', '已掌握', false), []);
  assert.deepEqual(searchWords([word], '', '学习中', true), [word]);
});

test('all words and root navigation clear hidden search, status and favorite filters', () => {
  const second = { ...word, id: 'word-2', path: '词根词库/单词/inspect.md', spelling: 'inspect',
    rootIds: ['root-1'], favorite: false, familiarity: '未学' as const };
  const catalog = indexNotes([source(root), source(otherRoot), source(word), source(second)]);
  const filtered = { query: 'respect', rootId: 'root-2', status: '学习中' as const, favorites: true };
  assert.deepEqual(visibleWords(catalog, filtered).map(w => w.spelling), ['respect']);
  assert.deepEqual(visibleWords(catalog, resetWordFilter()).map(w => w.spelling).sort(), ['inspect', 'respect']);
  assert.deepEqual(visibleWords(catalog, resetWordFilter('root-1')).map(w => w.spelling).sort(), ['inspect', 'respect']);
  assert.deepEqual(visibleWords(catalog, resetWordFilter('root-2')).map(w => w.spelling), ['respect']);
});

test('invalid YAML cannot be overwritten by form writer', () => {
  assert.throws(() => writeNote('---\nid: [broken\n---\nbody', word));
});
