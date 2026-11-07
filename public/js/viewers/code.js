/* 代码高亮与 CSV 表格查看器 */
import { el, $, $$, escapeHtml, clamp } from '../util.js';

const LANG_MAP = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript',
  jsx: 'javascript', vue: 'xml', py: 'python', java: 'java', c: 'c', h: 'c', cpp: 'cpp',
  hpp: 'cpp', cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', sh: 'bash',
  bash: 'bash', ps1: 'powershell', sql: 'sql', json: 'json', xml: 'xml', yaml: 'yaml',
  yml: 'yaml', toml: 'ini', ini: 'ini', conf: 'ini', css: 'css', scss: 'scss',
  less: 'less', lua: 'lua', kt: 'kotlin', swift: 'swift', dart: 'dart', r: 'r', m: 'objectivec'
};

export function createCodeViewer({ text, ext, name }) {
  const lang = LANG_MAP[ext.replace('.', '')] || '';
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const big = lines.length > 4000;

  const viewer = {
    kind: 'code',
    title: name,
    author: '',
    outline: [],
    pageCount: 1,
    _onUpdate: () => { },
    _stage: null,

    mount(stage) {
      this._stage = stage;
      stage.classList.add('scroll-mode');
      stage.innerHTML = '';

      const wrap = el('div', { class: 'code-view' });
      const head = el('div', { class: 'code-head' });
      head.innerHTML = `<span>${escapeHtml(name)} · ${lines.length} 行${lang ? ' · ' + lang.toUpperCase() : ''}</span><span>${big ? '大文件已关闭语法高亮' : '语法高亮'}</span>`;
      wrap.append(head);

      const block = el('div', { class: 'code-block' });
      const table = el('table');
      const tbody = el('tbody');

      let highlighted = null;
      if (!big && window.hljs && lang) {
        try { highlighted = window.hljs.highlight(text, { language: lang, ignoreIllegals: true }).value.split('\n'); } catch { }
      }
      if (!highlighted && !big && window.hljs) {
        try { highlighted = window.hljs.highlightAuto(text).value.split('\n'); } catch { }
      }

      const frag = document.createDocumentFragment();
      for (let i = 0; i < lines.length; i++) {
        const tr = el('tr');
        tr.dataset.i = i;
        const ln = el('td', { class: 'ln' });
        ln.textContent = String(i + 1);
        const cd = el('td', { class: 'cd' });
        if (highlighted && highlighted[i] !== undefined) cd.innerHTML = highlighted[i] || ' ';
        else cd.textContent = lines[i] || ' ';
        tr.append(ln, cd);
        frag.append(tr);
      }
      tbody.append(frag);
      table.append(tbody);
      block.append(table);
      wrap.append(block);
      stage.append(wrap);
      this._rows = $$('tr', tbody);

      stage.addEventListener('scroll', () => {
        const max = stage.scrollHeight - stage.clientHeight;
        this._onUpdate({ type: 'ratio', v: max > 0 ? stage.scrollTop / max : 0 }, max > 0 ? stage.scrollTop / max : 0);
      }, { passive: true });
    },

    goTo(t) {
      if (!t) return;
      const st = this._stage;
      if (t.type === 'line') {
        const row = this._rows[t.n];
        if (row) st.scrollTop = row.offsetTop - 40;
      } else if (t.type === 'ratio') {
        st.scrollTop = (st.scrollHeight - st.clientHeight) * (t.v || 0);
      }
    },
    next() { this._stage.scrollBy({ top: this._stage.clientHeight * 0.9, behavior: 'smooth' }); },
    prev() { this._stage.scrollBy({ top: -this._stage.clientHeight * 0.9, behavior: 'smooth' }); },
    progress() {
      const st = this._stage;
      if (!st) return 0;
      const max = st.scrollHeight - st.clientHeight;
      return max > 0 ? clamp(st.scrollTop / max, 0, 1) : 0;
    },
    label() { return lines.length + ' 行'; },
    search(q) {
      const query = q.trim().toLowerCase();
      if (!query) return [];
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        const idx = lines[i].toLowerCase().indexOf(query);
        if (idx < 0) continue;
        out.push({ title: `第 ${i + 1} 行`, snippet: lines[i].slice(Math.max(0, idx - 30), idx + q.length + 40), target: { type: 'line', n: i } });
        if (out.length >= 150) break;
      }
      return out;
    },
    text() { return text; },
    setLayout() { },
    destroy() { if (this._stage) this._stage.innerHTML = ''; }
  };
  return viewer;
}

/* ───────── CSV ───────── */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuote = false;
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else field += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function createCsvViewer({ text, name }) {
  const rows = parseCsv(text);
  const header = rows[0] || [];
  const body = rows.slice(1);

  const viewer = {
    kind: 'csv',
    title: name,
    author: '',
    outline: [],
    pageCount: body.length,
    _onUpdate: () => { },
    _stage: null,

    mount(stage) {
      this._stage = stage;
      stage.classList.add('scroll-mode');
      stage.innerHTML = '';
      const wrap = el('div', { class: 'paper-sheet full' });
      wrap.style.padding = '22px';
      const head = el('div', { class: 'code-head' });
      head.innerHTML = `<span>${escapeHtml(name)} · ${body.length} 行 × ${header.length} 列</span>`;
      wrap.append(head);

      const table = el('table', { class: 'csv-table' });
      const thead = el('thead');
      const trh = el('tr');
      header.forEach((h, i) => trh.append(el('th', { text: h || '列 ' + (i + 1) })));
      thead.append(trh);
      const tbody = el('tbody');
      const frag = document.createDocumentFragment();
      body.forEach((r, ri) => {
        const tr = el('tr', { dataset: { i: ri } });
        for (let ci = 0; ci < Math.max(header.length, r.length); ci++) {
          tr.append(el('td', { text: r[ci] ?? '' }));
        }
        frag.append(tr);
      });
      tbody.append(frag);
      table.append(thead, tbody);
      wrap.append(table);
      stage.append(wrap);
      this._rows = $$('tr', tbody);

      stage.addEventListener('scroll', () => {
        const max = stage.scrollHeight - stage.clientHeight;
        this._onUpdate({ type: 'ratio', v: max > 0 ? stage.scrollTop / max : 0 }, max > 0 ? stage.scrollTop / max : 0);
      }, { passive: true });
    },
    goTo(t) {
      if (!t) return;
      const st = this._stage;
      if (t.type === 'row') {
        const row = this._rows[t.n];
        if (row) st.scrollTop = row.offsetTop - 60;
      } else if (t.type === 'ratio') {
        st.scrollTop = (st.scrollHeight - st.clientHeight) * (t.v || 0);
      }
    },
    next() { this._stage.scrollBy({ top: this._stage.clientHeight * 0.9, behavior: 'smooth' }); },
    prev() { this._stage.scrollBy({ top: -this._stage.clientHeight * 0.9, behavior: 'smooth' }); },
    progress() {
      const st = this._stage;
      if (!st) return 0;
      const max = st.scrollHeight - st.clientHeight;
      return max > 0 ? clamp(st.scrollTop / max, 0, 1) : 0;
    },
    label() { return body.length + ' 行'; },
    search(q) {
      const query = q.trim().toLowerCase();
      if (!query) return [];
      const out = [];
      body.forEach((r, ri) => {
        const line = r.join(' , ');
        if (line.toLowerCase().includes(query)) {
          out.push({ title: `第 ${ri + 2} 行`, snippet: line.slice(0, 90), target: { type: 'row', n: ri } });
        }
      });
      return out.slice(0, 150);
    },
    text() { return rows.map((r) => r.join('\t')).join('\n'); },
    setLayout() { },
    destroy() { if (this._stage) this._stage.innerHTML = ''; }
  };
  return viewer;
}
