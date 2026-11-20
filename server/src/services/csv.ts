// قارئ CSV بسيط يدعم الحقول بين علامات تنصيص، وعلامة BOM التي يضيفها Excel، والفاصل المنقوطة
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = src.split('\n', 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const out: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur.trim()); cur = ''; }
    else if (ch === '\n') { row.push(cur.trim()); out.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur.length || row.length) { row.push(cur.trim()); out.push(row); }
  const lines = out.filter((r) => r.some((c) => c !== ''));
  const header = (lines.shift() ?? []).map((h) => h.trim().toLowerCase());
  return { header, rows: lines };
}
