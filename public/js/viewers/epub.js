/* EPUB 查看器：自研解析（container.xml → OPF → spine），支持目录、图片、内部链接、搜索 */
import { el, $, $$, escapeHtml, clamp } from '../util.js';

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', css: 'text/css',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2'
};

function resolvePath(baseDir, rel) {
  if (!rel) return '';
  rel = rel.split('#')[0];
  if (/^[a-z]+:/i.test(rel)) return rel;
  const parts = (baseDir ? baseDir + '/' : '') + rel;
  const out = [];
  for (const p of parts.split('/')) {
    if (p === '.' || p === '') continue;
    if (p === '..') out.pop(); else out.push(p);
  }
  return out.join('/');
}
const dirOf = (p) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';

export async function createEpubViewer({ buffer, name, settings, onUpdate, onActive }) {
  const zip = await window.JSZip.loadAsync(buffer);
  const decoder = new TextDecoder('utf-8');
  const readText = async (p) => {
    const f = zip.file(p) || zip.file(decodeURIComponent(p));
    if (!f) throw new Error('缺少文件: ' + p);
    return decoder.decode(await f.async('uint8array'));
  };
  const exists = (p) => !!(zip.file(p) || zip.file(decodeURIComponent(p)));

  // 1. container.xml
  let opfPath = '';
  try {
    const cxml = await readText('META-INF/container.xml');
    const m = /full-path="([^"]+)"/.exec(cxml);
    if (m) opfPath = m[1];
  } catch { }
  if (!opfPath) {
    const guess = Object.keys(zip.files).find((f) => f.toLowerCase().endsWith('.opf'));
    if (!guess) throw new Error('这不是有效的 EPUB：找不到 OPF 文件');
    opfPath = guess;
  }

  const opfDir = dirOf(opfPath);
  const opfText = await readText(opfPath);
  const opf = new DOMParser().parseFromString(opfText, 'application/xml');

  const q = (sel, root = opf) => root.querySelector(sel);
  const meta = (tag) => {
    const n = opf.getElementsByTagName('dc:' + tag)[0] || opf.getElementsByTagName(tag)[0];
    return n ? n.textContent.trim() : '';
  };

  const title = meta('title') || name;
  const author = meta('creator') || '';
  const language = meta('language') || 'zh';

  // manifest
  const manifest = {};
  for (const item of Array.from(opf.getElementsByTagName('item'))) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!id || !href) continue;
    manifest[id] = {
      id,
      href: resolvePath(opfDir, href),
      mediaType: item.getAttribute('media-type') || '',
      properties: item.getAttribute('properties') || ''
    };
  }

  // spine
  const spineIds = Array.from(opf.getElementsByTagName('itemref')).map((i) => i.getAttribute('idref')).filter(Boolean);
  const spine = spineIds.map((id) => manifest[id]).filter((x) => x && /html|xml/.test(x.mediaType || 'html'));

  /* ---------- 解析单章 ---------- */
  const blobUrls = [];
  async function parseChapter(item, index) {
    let html = '';
    try { html = await readText(item.href); }
    catch { return { index, href: item.href, html: '<p class="dim">（本章内容缺失）</p>', headings: [] }; }

    const dom = new DOMParser().parseFromString(html, 'text/html');
    const body = dom.body;
    if (!body) return { index, href: item.href, html: '', headings: [] };

    // 移除脚本与外部样式，保留结构
    body.querySelectorAll('script, style, link, meta, base, iframe, object, embed').forEach((n) => n.remove());
    body.querySelectorAll('[onclick],[onload],[onerror]').forEach((n) => {
      n.removeAttribute('onclick'); n.removeAttribute('onload'); n.removeAttribute('onerror');
    });

    const chapDir = dirOf(item.href);

    // 图片与 SVG image
    const imgs = Array.from(body.querySelectorAll('img, image'));
    for (const img of imgs) {
      const src = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttribute('href') || '';
      if (!src) continue;
      if (/^(data:|https?:|blob:)/i.test(src)) continue;
      const p = resolvePath(chapDir, src);
      if (!exists(p)) { img.remove(); continue; }
      try {
        const file = zip.file(p) || zip.file(decodeURIComponent(p));
        const blob = await file.async('blob');
        const ext = (p.split('.').pop() || '').toLowerCase();
        const typed = blob.slice(0, blob.size, MIME_BY_EXT[ext] || blob.type || 'application/octet-stream');
        const url = URL.createObjectURL(typed);
        blobUrls.push(url);
        img.setAttribute('src', url);
        img.removeAttribute('xlink:href');
      } catch { img.remove(); }
    }

    // 内部链接改为 hash 跳转
    body.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href) return;
      if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      else if (href.startsWith('#')) { a.setAttribute('href', '#'); a.dataset.anchor = href.slice(1); }
      else {
        const [file, anchor] = href.split('#');
        const p = resolvePath(chapDir, file);
        a.setAttribute('href', '#');
        a.dataset.href = p;
        if (anchor) a.dataset.anchor = anchor;
      }
    });

    // 标题锚点
    const headings = [];
    body.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h, i) => {
      const id = `c${index}-h${i}`;
      h.id = id;
      h.style.scrollMarginTop = '70px';
      headings.push({ id, title: h.textContent.trim(), level: Number(h.tagName[1]) });
    });

    // 章内块索引
    body.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,figcaption').forEach((b, i) => {
      b.dataset.i = `c${index}-b${i}`;
    });

    return { index, href: item.href, html: body.innerHTML, headings };
  }

  const chapters = [];
  for (let i = 0; i < spine.length; i++) {
    chapters.push(await parseChapter(spine[i], i));
  }

  /* ---------- 目录 ---------- */
  let toc = [];
  const navItem = Object.values(manifest).find((m) => (m.properties || '').includes('nav'));
  const ncxItem = Object.values(manifest).find((m) => m.mediaType === 'application/x-dtbncx+xml');
  const chapIndexByHref = new Map();
  chapters.forEach((c, i) => chapIndexByHref.set(c.href, i));

  if (navItem && exists(navItem.href)) {
    try {
      const navHtml = await readText(navItem.href);
      const dom = new DOMParser().parseFromString(navHtml, 'text/html');
      const nav = dom.querySelector('nav[epub\\:type="toc"], nav[*|type="toc"], nav');
      const links = nav ? Array.from(nav.querySelectorAll('a[href]')) : [];
      const navDir = dirOf(navItem.href);
      toc = links.map((a) => {
        const href = a.getAttribute('href') || '';
        const [f, anchor] = href.split('#');
        const full = f ? resolvePath(navDir, f) : navItem.href;
        const ci = chapIndexByHref.get(full);
        return { title: a.textContent.trim(), level: 1, chapter: ci, anchor, target: ci !== undefined ? { type: 'chapter', n: ci, anchor } : null };
      }).filter((x) => x.title);
    } catch { }
  }
  if (!toc.length && ncxItem && exists(ncxItem.href)) {
    try {
      const ncxText = await readText(ncxItem.href);
      const dom = new DOMParser().parseFromString(ncxText, 'application/xml');
      const navDir = dirOf(ncxItem.href);
      const walk = (parent, level) => {
        const out = [];
        for (const np of Array.from(parent.children).filter((c) => c.tagName === 'navPoint')) {
          const label = np.querySelector('navLabel > text')?.textContent.trim() || '';
          const src = np.querySelector('content')?.getAttribute('src') || '';
          const [f, anchor] = src.split('#');
          const full = f ? resolvePath(navDir, f) : '';
          const ci = chapIndexByHref.get(full);
          out.push({ title: label, level, chapter: ci, anchor, target: ci !== undefined ? { type: 'chapter', n: ci, anchor } : null });
          out.push(...walk(np, level + 1));
        }
        return out;
      };
      toc = walk(dom.documentElement, 1).filter((x) => x.title);
    } catch { }
  }
  if (!toc.length) {
    toc = chapters.map((c, i) => ({
      title: (c.headings[0] && c.headings[0].title) || `第 ${i + 1} 节`,
      level: 1, chapter: i, target: { type: 'chapter', n: i }
    }));
  }

  /* ---------- 封面 ---------- */
  let coverHref = '';
  const coverMeta = Array.from(opf.getElementsByTagName('meta')).find((m) => (m.getAttribute('name') || '') === 'cover');
  if (coverMeta) coverHref = manifest[coverMeta.getAttribute('content')]?.href || '';
  if (!coverHref) {
    const prop = Object.values(manifest).find((m) => (m.properties || '').includes('cover-image'));
    if (prop) coverHref = prop.href;
  }

  /* ---------- 查看器 ---------- */
  const viewer = {
    kind: 'epub',
    title,
    author,
    outline: [],
    pageCount: chapters.length,
    chapters,
    _stage: null,
    _index: 0,
    _content: null,
    _onUpdate: onUpdate || (() => { }),
    _onActive: onActive || (() => { }),

    async coverBlob() {
      if (!coverHref || !exists(coverHref)) return null;
      try {
        const f = zip.file(coverHref) || zip.file(decodeURIComponent(coverHref));
        return await f.async('blob');
      } catch { return null; }
    },

    mount(stage) {
      this._stage = stage;
      stage.classList.add('scroll-mode');
      const sheet = el('div', { class: 'paper-sheet' });
      const prose = el('div', { class: 'prose' });
      prose.id = 'epub-content';

      // 书名页
      const head = el('header', { class: 'epub-titlepage' });
      head.innerHTML = `<h1>${escapeHtml(title)}</h1>${author ? `<p class="byline">${escapeHtml(author)}</p>` : ''}<div class="title-rule"></div>`;
      prose.append(head);

      chapters.forEach((c, i) => {
        const sec = el('section', { class: 'epub-chapter', id: `chap-${i}` });
        sec.innerHTML = c.html;
        prose.append(sec);
      });

      sheet.append(prose);
      stage.innerHTML = '';
      stage.append(sheet);
      this._content = prose;

      // 内部链接
      prose.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-anchor],a[data-href]');
        if (!a) return;
        e.preventDefault();
        if (a.dataset.href) {
          const ci = chapIndexByHref.get(a.dataset.href);
          if (ci !== undefined) this.goTo({ type: 'chapter', n: ci, anchor: a.dataset.anchor }, true);
        } else if (a.dataset.anchor) {
          const target = prose.querySelector('#' + CSS.escape(a.dataset.anchor));
          if (target) {
            stage.style.scrollBehavior = 'smooth';
            stage.scrollTop = target.offsetTop - 20;
            setTimeout(() => { stage.style.scrollBehavior = 'auto'; }, 500);
          }
        }
      });

      this.outline = toc.map((t) => ({ ...t, id: t.chapter !== undefined ? 'chap-' + t.chapter : '' }));
      this._sections = $$('.epub-chapter', prose);

      stage.addEventListener('scroll', () => this._handleScroll(), { passive: true });
      setTimeout(() => this._handleScroll(), 60);
    },

    _handleScroll() {
      const st = this._stage;
      if (!st) return;
      const max = st.scrollHeight - st.clientHeight;
      const p = max > 0 ? clamp(st.scrollTop / max, 0, 1) : 0;
      const stTop = st.getBoundingClientRect().top + 110;
      let cur = 0;
      for (let i = 0; i < this._sections.length; i++) {
        if (this._sections[i].getBoundingClientRect().top <= stTop) cur = i; else break;
      }
      if (cur !== this._index) { this._index = cur; this._onActive(cur); }
      this._onUpdate({ type: 'chapter', n: cur, p }, p);
      this._lastP = p;
    },

    goTo(target, smooth = false) {
      const st = this._stage;
      if (!st || !target) return;
      st.style.scrollBehavior = smooth ? 'smooth' : 'auto';
      let node = null;
      if (target.type === 'chapter') {
        const sec = this._sections[target.n];
        if (sec && target.anchor) node = sec.querySelector('#' + CSS.escape(target.anchor)) || sec;
        else node = sec;
      } else if (target.type === 'ratio') {
        st.scrollTop = (st.scrollHeight - st.clientHeight) * (target.v || 0);
        return;
      } else if (target.type === 'anchor') {
        node = this._content.querySelector('#' + CSS.escape(target.id));
      }
      if (node) st.scrollTop = node.offsetTop - 14;
      setTimeout(() => { st.style.scrollBehavior = 'auto'; }, smooth ? 600 : 0);
    },

    progress() {
      const st = this._stage;
      if (!st) return 0;
      const max = st.scrollHeight - st.clientHeight;
      return max > 0 ? clamp(st.scrollTop / max, 0, 1) : 0;
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
      return `第 ${this._index + 1} / ${this.pageCount} 节`;
    },

    search(query) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const results = [];
      const secs = this._sections || [];
      for (let si = 0; si < secs.length; si++) {
        const blocks = $$('[data-i]', secs[si]);
        for (const b of blocks) {
          const txt = b.textContent || '';
          const i = txt.toLowerCase().indexOf(q);
          if (i < 0) continue;
          const s = Math.max(0, i - 28), e = Math.min(txt.length, i + q.length + 36);
          results.push({
            title: (this.outline.find((o) => o.chapter === si) || {}).title || `第 ${si + 1} 节`,
            snippet: (s > 0 ? '…' : '') + txt.slice(s, e).trim() + (e < txt.length ? '…' : ''),
            target: { type: 'anchor', id: b.dataset.i }
          });
          if (results.length >= 150) break;
        }
        if (results.length >= 150) break;
      }
      return results;
    },

    flash(target) {
      if (!target || !target.id) return;
      const node = this._content.querySelector(`[data-i="${CSS.escape(target.id)}"]`);
      if (!node) return;
      node.classList.add('flash-hit');
      setTimeout(() => node.classList.remove('flash-hit'), 1600);
    },

    text() { return this._content ? this._content.innerText : ''; },

    setLayout() { /* EPUB 仅滚动 */ },

    destroy() {
      blobUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch { } });
      if (this._stage) this._stage.innerHTML = '';
    }
  };

  return viewer;
}
