export interface ChineseMeaningCandidate {
  meaning: string;
  source: string;
  label?: string;
}

export interface EcdictRow {
  word: string;
  translation: string;
  definition: string;
  phonetic: string;
}

export function parseEcdictCsv(text: string): EcdictRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(value => value.trim().toLocaleLowerCase());
  const index = (name: string) => header.indexOf(name);
  const wordIndex = index('word');
  if (wordIndex < 0) throw new Error('ECDICT CSV 缺少 word 列');
  return rows.slice(1).map(values => ({
    word: values[wordIndex] ?? '', translation: values[index('translation')] ?? '',
    definition: values[index('definition')] ?? '', phonetic: values[index('phonetic')] ?? '',
  })).filter(row => row.word.trim());
}

function splitMeanings(value: string): string[] {
  return value.split(/[\n;]/).map(item => item.replace(/^\s*(?:\d+\.|[-*])\s*/, '').trim()).filter(Boolean);
}

export function findEcdictMeanings(rows: EcdictRow[], spelling: string): ChineseMeaningCandidate[] {
  const query = spelling.trim().toLocaleLowerCase();
  const matches = rows.filter(row => row.word.trim().toLocaleLowerCase() === query);
  const candidates: ChineseMeaningCandidate[] = [];
  const seen = new Set<string>();
  for (const row of matches) {
    for (const meaning of splitMeanings(row.translation)) {
      const key = meaning.toLocaleLowerCase();
      if (!seen.has(key)) { seen.add(key); candidates.push({ meaning, source: 'ECDICT', label: '中文释义' }); }
    }
  }
  return candidates.slice(0, 20);
}

export function findEcdictPhonetic(rows: EcdictRow[], spelling: string): string {
  const query = spelling.trim().toLocaleLowerCase();
  return rows.find(row => row.word.trim().toLocaleLowerCase() === query)?.phonetic.trim() ?? '';
}
