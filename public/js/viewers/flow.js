/* 流式文档查看器：Markdown / TXT / HTML / DOCX / RTF */
import { el, $, $$, escapeHtml, outlineFromHtml } from '../util.js';

const CHAP_RE = /^\s*(?:第[零一二三四五六七八九十百千万0-9]+[章节回卷篇部集]|Chapter\s+\d+|CHAPTER\s+[IVXLCDM]{1,7}\b|\d{1,4}[\.、]\s*\S|[（(][一二三四五六七八九十]{1,3}[）)]|序章|楔子|尾声|后记|番外)/;

function slugify(text, i) {
  return 'sec-' + i;
}

/* ───────── Markdown ───────── */
function renderMarkdown(text) {
  const marked = window.marked;
  marked.setOptions({ gfm: true, breaks: false, headerIds: false, mangle: false });
  return marked.parse(text);
}

/* ───────── HTML ───────── */
function renderHtml(text) {
  return window.DOMPurify.sanitize(text, {
    WHOLE_DOCUMENT: false,
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['target', 'allowfullscreen'],
    FORBID_TAGS: ['script', 'form', 'input', 'button', 'style'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick']
  });
}

/* ───────── TXT ───────── */
function renderTxt(text) {
  const raw = text.replace(/\r\n?/g, '\n');
  const lines = raw.split('\n');
  const out = [];

  // 估算"空行分段"占比
  const blank = lines.filter((l) => !l.trim()).length;
  const useBlank = blank / Math.max(1, lines.length) > 0.06;

  const emitPara = (t) => {
    const s = t.trim();
    if (!s) return;
    if (CHAP_RE.test(s) && s.length < 42) {
      out.push(`<h2 class="chap">${escapeHtml(s)}</h2>`);
      return;
    }
    out.push(`<p>${escapeHtml(s)}</p>`);
  };

  if (useBlank) {
    let buf = [];
    for (const line of lines) {
      if (!line.trim()) {
        if (buf.length) { emitPara(buf.join('\n')); buf = []; }
      } else buf.push(line);
    }
    if (buf.length) emitPara(buf.join('\n'));
  } else {
    let buf = [];
    for (const line of lines) {
      const s = line.trim();
      if (!s) { if (buf.length) { emitPara(buf.join(' ')); buf = []; } continue; }
      if (CHAP_RE.test(s) && s.length < 42) {
        if (buf.length) { emitPara(buf.join(' ')); buf = []; }
        out.push(`<h2 class="chap">${escapeHtml(s)}</h2>`);
        continue;
      }
      buf.push(s);
      if (/[。！？…”』」]$/.test(s) && s.length > 12) { emitPara(buf.join('')); buf = []; }
    }
    if (buf.length) emitPara(buf.join(' '));
  }
  return `<div class="txt-body">${out.join('\n')}</div>`;
}

/* ───────── RTF 简易转换 ───────── */
function renderRtf(text) {
  let s = text;
  // 去掉字体表 / 颜色表 / 样式表 / 信息组
  s = s.replace(/\{\\\*?\\(?:fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}\s*\}?/g, '');
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(((Number(n) % 65536) + 65536) % 65536));
  s = s.replace(/\\par[d]?\b/g, '\n\n');
  s = s.replace(/\\line\b/g, '\n');
  s = s.replace(/\\tab\b/g, '\t');
  s = s.replace(/\\[a-zA-Z]+-?\d*\s?/g, '');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\\\*/g, '');
  return `<div class="txt-body">${s.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p.replace(/\n/g, ' ').trim())}</p>`).join('')}</div>`;
}

/* ───────── DOCX ───────── */
async function renderDocx(buffer) {
  const res = await window.mammoth.convertToHtml(
    { arrayBuffer: buffer },
    {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Heading 1'] => h2:fresh",
        "p[style-name='Heading 2'] => h3:fresh",
        "p[style-name='Heading 3'] => h4:fresh",
        "p[style-name='标题 1'] => h2:fresh",
        "p[style-name='标题 2'] => h3:fresh",
        "p[style-name='标题 3'] => h4:fresh"
      ],
      convertImage: window.mammoth.images.imgElement((img) =>
        img.read('base64').then((data) => ({ src: `data:${img.contentType};base64,${data}` }))
      )
    }
  );
  return res.value;
}

/* ───────── 主查看器 ───────── */
export async function createFlowViewer({ kind, name, text, buffer, settings }) {
  const viewer = {
    kind: 'flow',
    title: name,
    author: '',
    outline: [],
    pageCount: 0,
    el: null,
    _blocks: [],
    _blockTops: [],
    _stage: null,
    _content: null,
    _onUpdate: () => { },
    _lastProgress: 0,
    _topbarH: 56,

    async load() {
      let html = '';
      if (kind === 'markdown') html = renderMarkdown(text);
      else if (kind === 'html') html = renderHtml(text);
      else if (kind === 'txt') html = renderTxt(text);
      else if (kind === 'rtf') html = renderRtf(text);
      else if (kind === 'docx') html = await renderDocx(buffer);
      else html = `<pre>${escapeHtml(text || '')}</pre>`;
      this._rawHtml = html;
    },

    mount(stage) {
      this._stage = stage;
      const sheet = el('div', { class: 'paper-sheet' });
      const prose = el('div', { class: 'prose' });
      prose.innerHTML = this._rawHtml;

      // 标题锚点
      const heads = $$('h1,h2,h3,h4', prose);
      heads.forEach((h, i) => {
        if (!h.id) h.id = slugify(h.textContent, i);
        h.style.scrollMarginTop = '14px';
      });

      // 给块元素编号，供搜索与定位
      const blocks = $$('p,li,h1,h2,h3,h4,blockquote,pre,td,figcaption', prose);
      blocks.forEach((b, i) => b.dataset.i = i);
      this._blocks = blocks;

      // 外链新窗口
      $$('a[href]', prose).forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      });

      // 代码高亮
      if (window.hljs) {
        $$('pre code', prose).forEach((code) => {
          try { window.hljs.highlightElement(code); } catch { }
        });
      }

      sheet.append(prose);
      stage.innerHTML = '';
      stage.append(sheet);
      stage.classList.add('scroll-mode');
      this.el = stage;
      this._content = prose;

      // 目录
      this.outline = heads.map((h, i) => ({
        id: h.id,
        title: h.textContent.trim(),
        level: Number(h.tagName[1]) || 1,
        index: i
      })).filter((x) => x.title);

      // 缓存标题位置，滚动时用二分查找，避免每帧读 DOM
      this._heads = heads;
      this._cacheHeadTops();
      this._resize = () => this._cacheHeadTops();
      window.addEventListener('resize', this._resize);

      // 滚动监听（用 rAF 节流，长文档滚动时不会每像素都算一遍）
      let raf = 0;
      stage.addEventListener('scroll', () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; this._handleScroll(); });
      }, { passive: true });
      setTimeout(() => this._handleScroll(), 60);
      this._onUpdate(this._location(), 0);
    },

    _cacheHeadTops() {
      const st = this._stage;
      if (!st || !this._heads) return;
      const base = st.getBoundingClientRect().top - st.scrollTop;
      this._headTops = this._heads.map((h) => h.getBoundingClientRect().top - base);
    },

    _handleScroll() {
      const st = this._stage;
      if (!st) return;
      const max = st.scrollHeight - st.clientHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, st.scrollTop / max)) : 0;
      if (Math.abs(p - this._lastProgress) > 0.001) {
        this._lastProgress = p;
        this._onUpdate(this._location(), p);
      }
      this._syncActiveHeading();
    },

    _syncActiveHeading() {
      if (!this._headTops || !this._heads) return;
      const top = this._stage.scrollTop + 120;
      let lo = 0, hi = this._headTops.length - 1, ans = -1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        if (this._headTops[m] <= top) { ans = m; lo = m + 1; } else hi = m - 1;
      }
      const active = ans >= 0 ? this._heads[ans].id : null;
      if (active !== this._activeId) {
        this._activeId = active;
        this._onActive && this._onActive(active);
      }
    },

    _location() {
      const st = this._stage;
      if (!st) return { type: 'ratio', v: 0 };
      const top = st.scrollTop;
      let best = 0;
      for (let i = 0; i < this._blocks.length; i++) {
        const b = this._blocks[i];
        if (b.offsetTop - 90 <= top) best = i; else break;
      }
      const max = st.scrollHeight - st.clientHeight;
      return { type: 'block', i: best, p: max > 0 ? top / max : 0 };
    },

    goTo(target, smooth = false) {
      const st = this._stage;
      if (!st || !target) return;
      const jump = (node) => {
        if (!node) return;
        // 远距离跳转不平滑：平滑滚动要滚几千像素，又慢又卡
        const dist = Math.abs(node.getBoundingClientRect().top - st.getBoundingClientRect().top);
        const useSmooth = smooth && dist < st.clientHeight * 2;
        node.scrollIntoView({ block: 'start', behavior: useSmooth ? 'smooth' : 'auto' });
      };
      if (target.type === 'anchor' || target.type === 'id') {
        jump(this._content.querySelector('#' + CSS.escape(target.id)));
      } else if (target.type === 'block') {
        jump(this._blocks[target.i] || this._blocks[0]);
      } else if (target.type === 'ratio') {
        st.scrollTop = (st.scrollHeight - st.clientHeight) * (target.v || 0);
      }
    },

    progress() {
      const st = this._stage;
      if (!st) return 0;
      const max = st.scrollHeight - st.clientHeight;
      return max > 0 ? Math.min(1, st.scrollTop / max) : 0;
    },

    next() {
      const st = this._stage;
      if (!st) return;
      st.scrollTo({ top: st.scrollTop + st.clientHeight * 0.88, behavior: 'smooth' });
    },

    prev() {
      const st = this._stage;
      if (!st) return;
      st.scrollTo({ top: Math.max(0, st.scrollTop - st.clientHeight * 0.88), behavior: 'smooth' });
    },

    label() {
      const st = this._stage;
      if (!st) return '';
      const p = Math.round(this.progress() * 100);
      return p + '%';
    },

    /* 搜索：块级元素匹配 */
    search(query) {
      const q = query.trim();
      if (!q) return [];
      const lower = q.toLowerCase();
      const results = [];
      const heads = $$('h1,h2,h3,h4', this._content);
      const findHeading = (node) => {
        let cur = node;
        let title = '';
        while (cur && cur !== this._content) {
          if (/^H[1-4]$/.test(cur.tagName)) { title = cur.textContent.trim(); break; }
          cur = cur.previousElementSibling || cur.parentElement;
        }
        return title || name;
      };
      for (const b of this._blocks) {
        const txt = b.textContent || '';
        const idx = txt.toLowerCase().indexOf(lower);
        if (idx < 0) continue;
        const start = Math.max(0, idx - 28), end = Math.min(txt.length, idx + q.length + 34);
        results.push({
          title: findHeading(b),
          snippet: (start > 0 ? '…' : '') + txt.slice(start, end).trim() + (end < txt.length ? '…' : ''),
          target: { type: 'block', i: Number(b.dataset.i) },
          score: 1
        });
        if (results.length >= 120) break;
      }
      return results;
    },

    flash(target) {
      if (!target) return;
      const node = this._blocks[target.i];
      if (!node) return;
      node.classList.add('flash-hit');
      setTimeout(() => node.classList.remove('flash-hit'), 1600);
    },

    text() {
      return this._content ? this._content.innerText : '';
    },

    destroy() {
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._stage) this._stage.innerHTML = '';
      this._blocks = [];
      this._heads = null;
      this._headTops = null;
    }
  };

  await viewer.load();
  return viewer;
}
