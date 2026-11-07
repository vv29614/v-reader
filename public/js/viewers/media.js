/* 图片与漫画（CBZ/ZIP）查看器 */
import { el, $, $$, clamp, IMAGE_EXT } from '../util.js';

export function createImageViewer({ url, name }) {
  const viewer = {
    kind: 'image',
    title: name,
    author: '',
    outline: [],
    pageCount: 1,
    _scale: 1,
    _rot: 0,
    _onUpdate: () => { },
    _stage: null,

    mount(stage) {
      this._stage = stage;
      stage.classList.remove('scroll-mode');
      stage.innerHTML = '';
      const wrap = el('div', { class: 'img-viewer' });
      const img = el('img', { src: url, alt: name, draggable: 'false' });
      img.style.transform = 'scale(1) rotate(0deg)';
      wrap.append(img);
      stage.append(wrap);
      this._img = img;
      this._wrap = wrap;

      // 滚轮缩放
      wrap.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        this.setScale(this._scale * (e.deltaY > 0 ? 0.9 : 1.1));
      }, { passive: false });

      // 拖拽平移
      let down = false, sx = 0, sy = 0, ox = 0, oy = 0;
      wrap.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        down = true; sx = e.clientX; sy = e.clientY; ox = this._tx || 0; oy = this._ty || 0;
        wrap.style.cursor = 'grabbing';
      });
      window.addEventListener('mousemove', (e) => {
        if (!down) return;
        this._tx = ox + (e.clientX - sx); this._ty = oy + (e.clientY - sy);
        this._apply();
      });
      window.addEventListener('mouseup', () => { down = false; wrap.style.cursor = 'grab'; });
      this._onUpdate({ type: 'ratio', v: 0 }, 0);
    },

    _apply() {
      if (!this._img) return;
      this._img.style.transform = `translate(${this._tx || 0}px, ${this._ty || 0}px) scale(${this._scale}) rotate(${this._rot}deg)`;
    },

    setScale(s) { this._scale = clamp(s, 0.15, 8); this._apply(); },
    zoom(delta) { this.setScale(this._scale * delta); },
    rotate(d) { this._rot = (this._rot + d) % 360; this._apply(); },
    reset() { this._scale = 1; this._rot = 0; this._tx = 0; this._ty = 0; this._apply(); },

    goTo() { },
    next() { },
    prev() { },
    progress() { return 0; },
    label() { return '图片'; },
    search() { return []; },
    text() { return ''; },
    setLayout() { },
    destroy() { if (this._stage) this._stage.innerHTML = ''; }
  };
  return viewer;
}

export async function createComicViewer({ buffer, name, settings, onUpdate, onActive }) {
  const zip = await window.JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((f) => {
    if (f.dir) return false;
    const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
    return IMAGE_EXT.has(ext);
  });
  const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  entries.sort((a, b) => collator.compare(a.name, b.name));

  if (!entries.length) throw new Error('压缩包里没有图片文件');

  const urls = [];
  const pages = [];
  for (const f of entries) {
    try {
      const blob = await f.async('blob');
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const typed = blob.slice(0, blob.size, { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml' }[ext] || blob.type);
      const u = URL.createObjectURL(typed);
      urls.push(u);
      pages.push({ name: f.name, url: u });
    } catch { }
  }

  const viewer = {
    kind: 'comic',
    title: name.replace(/\.[^.]+$/, ''),
    author: '',
    outline: [],
    pageCount: pages.length,
    pages,
    _index: 0,
    _mode: settings?.layout === 'double' ? 'double' : 'single',
    _stage: null,
    _onUpdate: onUpdate || (() => { }),
    _onActive: onActive || (() => { }),

    mount(stage) {
      this._stage = stage;
      stage.classList.remove('scroll-mode');
      stage.innerHTML = '';
      this._wrap = el('div', { class: 'paged' });
      stage.append(this._wrap);
      this._show();
      stage.addEventListener('click', (e) => {
        if (e.target.closest('.comic-page')) {
          const r = stage.getBoundingClientRect();
          if (e.clientX - r.left < r.width * 0.35) this.prev(); else this.next();
        }
      });
    },

    _show() {
      if (!this._wrap) return;
      this._wrap.innerHTML = '';
      const numbers = this._mode === 'double'
        ? (this._index === 0 ? [0] : [this._index, this._index + 1])
        : [this._index];
      const spread = el('div', { class: 'spread' });
      for (const n of numbers) {
        if (n >= pages.length) continue;
        const pe = el('div', { class: 'comic-page' });
        const img = el('img', { src: pages[n].url, alt: pages[n].name, loading: 'eager' });
        pe.append(img);
        spread.append(pe);
      }
      this._wrap.append(spread);
      this._onUpdate({ type: 'page', n: this._index + 1 }, this.progress());
    },

    next() {
      const step = this._mode === 'double' ? 2 : 1;
      this._index = clamp(this._index + step, 0, pages.length - 1);
      this._show();
    },
    prev() {
      const step = this._mode === 'double' ? 2 : 1;
      this._index = clamp(this._index - step, 0, pages.length - 1);
      this._show();
    },
    goTo(t) {
      if (!t) return;
      if (t.type === 'page') this._index = clamp((t.n || 1) - 1, 0, pages.length - 1);
      else if (t.type === 'ratio') this._index = Math.round((pages.length - 1) * (t.v || 0));
      this._show();
    },
    setLayout(mode) {
      if (mode === 'scroll') return;
      this._mode = mode === 'double' ? 'double' : 'single';
      this._show();
    },
    progress() { return pages.length <= 1 ? 0 : this._index / (pages.length - 1); },
    label() { return `${this._index + 1} / ${pages.length}`; },
    search() { return []; },
    text() { return ''; },
    async coverBlob() {
      try {
        const f = zip.file(pages[0].name);
        return f ? await f.async('blob') : null;
      } catch { return null; }
    },
    destroy() {
      urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch { } });
      if (this._stage) this._stage.innerHTML = '';
    }
  };
  return viewer;
}
