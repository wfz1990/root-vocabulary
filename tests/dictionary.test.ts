import assert from 'node:assert/strict';
import test from 'node:test';
import { findEcdictMeanings, parseEcdictCsv } from '../src/dictionary.ts';

const csv = `word,translation,definition,phonetic\n"ascribe","把…归因于;归咎于","attribute","əˈskraɪb"\n"respect","尊重;敬意","esteem","rɪˈspekt"\n"multi","第一行;第二行","",""\n`;
const escapedNewlineCsv = `word,translation,definition,phonetic\n"escaped","第一行\\n第二行","",""\n`;

test('parses quoted ECDICT CSV fields', () => {
  const rows = parseEcdictCsv(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].word, 'ascribe');
  assert.equal(rows[0].phonetic, 'əˈskraɪb');
});

test('finds multiple Chinese meanings and matches spelling case-insensitively', () => {
  const candidates = findEcdictMeanings(parseEcdictCsv(csv), 'ASCRIBE');
  assert.deepEqual(candidates.map(candidate => candidate.meaning), ['把…归因于', '归咎于']);
  assert.equal(candidates[0].source, 'ECDICT');
  assert.equal(findEcdictMeanings(parseEcdictCsv(csv), 'missing').length, 0);
});

test('supports multiple meanings separated by newlines', () => {
  assert.deepEqual(findEcdictMeanings(parseEcdictCsv(csv), 'multi').map(candidate => candidate.meaning), ['第一行', '第二行']);
});

test('normalizes escaped newlines from ECDICT translations', () => {
  assert.deepEqual(findEcdictMeanings(parseEcdictCsv(escapedNewlineCsv), 'escaped').map(candidate => candidate.meaning), ['第一行', '第二行']);
});
