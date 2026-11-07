/* PDF 查看器：连续滚动 / 单页 / 双页 + 文本层 + 大纲 + 全文搜索 */
import { el, $, $$, clamp, debounce } from '../util.js';

/* PDF 文本层常在字符之间插入空格，展示时清理掉 */
const cleanPdfText = (s) => {
  const spaces = (s.match(/\s/g) || []).length;
  const dense = spaces / Math.max(1, s.length) > 0.2;
  let t = s.replace(/\s+/g, ' ');
  if (dense) t = t.replace(/ /g, '');
  else t = t.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1');
  return t.trim();
};

export async function createPdfViewer({ url, name, settings, onUpdate, onActive }) {
  const pdfjsLib = window.pdfjsLib || await window.loadPdfJs();
  if (!pdfjsLib) throw new Error('PDF 引擎未加载');

  const loadingTask = pdfjsLib.getDocument({
    url,
    cMapUrl: 'vendor/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'vendor/standard_fonts/',
    enableXfa: true
  });
  const pdf = await loadingTask.promise;

  const viewer = {
    kind: 'pdf',
    title: name,
    author: '',
    pdf,
    outline: [],
    pageCount: pdf.numPages,
    _stage: null,
    _mode: settings?.layout === 'single' || settings?.layout === 'double' ? settings.layout : 'scroll',
    _zoom: 1,
    _pageEls: [],
    _rendered: new Map(),
    _sizes: new Map(),
    _index: 0,
    _textCache: new Map(),
    _onUpdate: onUpdate || (() => { }),
    _onActive: onActive || (() => { }),
    _io: null,
    _resize: null,
    _renderQueue: new Set(),
    _active: 0,
    _pending: [],
    _tops: [],
    _pruneTimer: null,
    MAX_CONCURRENT: 2,

    async init() {
      const info = await pdf.getMetadata().catch(() => ({ info: {} }));
      this.author = (info.info && info.info.Author) || '';
      this.meta = info.info || {};
      const p1 = await pdf.getPage(1);
      this._base = p1.getViewport({ scale: 1 });
      this._sizes.set(1, { w: this._base.width, h: this._base.height });
      try { this.outline = await this._buildOutline(); } catch { this.outline = []; }
      return this;
    },

    async _buildOutline() {
      const raw = await pdf.getOutline();
      if (!raw || !raw.length) return this._pageOutline();
      const out = [];
      const walk = async (items, level) => {
        for (const it of items) {
          let page = null;
          let destTop = null;
          let destType = '';
          try {
            let dest = it.dest;
            if (typeof dest === 'string') dest = await pdf.getDestination(dest);
            if (Array.isArray(dest) && dest[0]) {
              const idx = await pdf.getPageIndex(dest[0]);
              page = idx + 1;
              // dest = [ref, {name:'XYZ'|'FitH'|...}, left, top, zoom]
              // top 是 PDF 坐标（页面底部为 0，向上为正）；FitH 时 dest[3] 有效
              if (dest[1] && typeof dest[1] === 'object') destType = dest[1].name || '';
              if (['XYZ', 'FitH', 'FitBH', 'FitR'].includes(destType)) {
                if (destType === 'FitR') destTop = Array.isArray(dest[4]) ? dest[4] : null;
                else if (typeof dest[3] === 'number') destTop = dest[3];
              }
            }
          } catch { }
          const target = page
            ? { type: 'page', n: page, destTop: typeof destTop === 'number' ? destTop : null, destType }
            : null;
          out.push({ title: (it.title || '').trim(), level, page, target });
          if (it.items && it.items.length && level < 4) await walk(it.items, level + 1);
        }
      };
      await walk(raw, 1);
      return out.filter((x) => x.title);
    },

    _pageOutline() {
      const out = [];
      const total = this.pageCount;
      const step = total <= 60 ? 1 : 10;
      for (let i = 1; i <= total; i += step) {
        const end = Math.min(total, i + step - 1);
        out.push({
          title: step === 1 ? `第 ${i} 页` : `第 ${i}–${end} 页`,
          level: 1,
          page: i,
          target: { type: 'page', n: i }
        });
      }
      return out;
    },

    mount(stage) {
      this._stage = stage;
      stage.classList.add('scroll-mode');
      this._applyLayout(true);
      this._resize = debounce(() => {
        if (!this._stage) return;
        this._applyLayout(false);
      }, 220);
      window.addEventListener('resize', this._resize);
      stage.addEventListener('scroll', () => this._handleScroll(), { passive: true });
    },

    _stageWidth() {
      const st = this._stage;
      return st ? st.clientWidth : 900;
    },

    _targetWidth() {
      const avail = this._stageWidth() - 76;
      return clamp(avail * this._zoom, 240, 1700);
    },

    _scaleFor(pageW) {
      return this._targetWidth() / pageW;
    },

    async _applyLayout(initial) {
      if (this._mode === 'scroll') await this._buildScroll(initial);
      else await this._buildPaged(initial);
    },

    async _buildScroll(keepPos) {
      const st = this._stage;
      if (!st) return;
      const ratio = keepPos ? 0 : (st.scrollHeight ? st.scrollTop / st.scrollHeight : 0);
      if (this._io) this._io.disconnect();
      st.innerHTML = '';
      const frag = document.createDocumentFragment();
      this._pageEls = [];
      this._pageSizes = [];
      const w = this._targetWidth();
      const scale = this._scaleFor(this._base.width);

      for (let n = 1; n <= this.pageCount; n++) {
        const size = this._sizes.get(n) || { w: this._base.width, h: this._base.height };
        const pw = Math.floor(size.w * scale);
        const ph = Math.floor(size.h * scale);
        this._pageSizes.push({ w: pw, h: ph, rawH: size.h });
        const pageEl = el('div', { class: 'pdf-page placeholder', dataset: { page: n }, style: { width: pw + 'px', height: ph + 'px' } });
        this._pageEls.push(pageEl);
        frag.append(pageEl);
      }
      st.append(frag);
      this._rendered.clear();
      this._active = 0;
      this._pending = [];

      this._io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const n = Number(e.target.dataset.page);
          if (e.isIntersecting) this._renderPage(n);
        }
      }, { root: st, rootMargin: '800px 0px' });
      this._pageEls.forEach((p) => this._io.observe(p));
      if (!keepPos && ratio) st.scrollTop = ratio * st.scrollHeight;
      setTimeout(() => { this._cacheTops(); this._handleScroll(); }, 60);
      this._startPrune();
    },

    _cacheTops() {
      const st = this._stage;
      if (!st) return;
      const base = st.getBoundingClientRect().top - st.scrollTop;
      this._tops = [];
      this._heights = [];
      for (const el of this._pageEls) {
        const r = el.getBoundingClientRect();
        this._tops.push(r.top - base);
        this._heights.push(r.height);
      }
    },

    /* 回收远离视口的画布。
       只看「已经渲染出来的那十几页」，逐个取实时位置（成本很低），
       不用整页的缓存坐标——缓存一旦不准就会把正在看的页误删，表现就是白屏 */
    _startPrune() {
      clearInterval(this._pruneTimer);
      this._pruneTimer = setInterval(() => {
        const st = this._stage;
        if (!st || this._mode !== 'scroll') return;
        if (this._rendered.size <= 12) return;
        const stTop = st.getBoundingClientRect().top;
        const stBottom = stTop + st.clientHeight;
        const dead = [];
        for (const [n] of this._rendered) {
          if (n === this._index + 1) continue;          // 当前页永不回收
          const el = this._pageEls[n - 1];
          if (!el || !el.querySelector('canvas')) continue;
          const r = el.getBoundingClientRect();
          const far = r.bottom < stTop - 6000 || r.top > stBottom + 6000;
          if (far) dead.push(n);
        }
        for (const n of dead) {
          const el = this._pageEls[n - 1];
          if (!el) continue;
          el.innerHTML = '';
          el.classList.add('placeholder');
          this._rendered.delete(n);
        }
      }, 2500);
    },

    async _buildPaged() {
      const st = this._stage;
      if (!st) return;
      if (this._io) { this._io.disconnect(); this._io = null; }
      st.innerHTML = '';
      const wrap = el('div', { class: 'paged' });
      st.append(wrap);
      this._pageEls = [];
      this._rendered.clear();
      await this._showSpread();
    },

    _currentSpread() {
      if (this._mode === 'double') {
        let n = this._index + 1;
        if (n === 1) return [1];
        if (n % 2 === 0) return [n, n + 1 > this.pageCount ? null : n + 1].filter(Boolean);
        return [n, n + 1 > this.pageCount ? null : n + 1].filter(Boolean);
      }
      return [this._index + 1];
    },

    async _showSpread() {
      const wrap = $('.paged', this._stage);
      if (!wrap) return;
      wrap.innerHTML = '';
      this._pageEls = [];
      const pages = this._currentSpread();
      for (const n of pages) {
        const pageEl = el('div', { class: 'pdf-page', dataset: { page: n } });
        wrap.append(pageEl);
        this._pageEls.push(pageEl);
        await this._renderPage(n, pageEl);
      }
      this._emit();
    },

    /* 低清预览：滚动过程中画一张粗糙的，几十毫秒就能出来，
       停手后 _renderPage 会用高清覆盖掉（先清空 pageEl，不会叠两层） */
    async _renderQuick(n) {
      const pageEl = this._pageEls[n - 1];
      if (!pageEl) return;
      const st = this._rendered.get(n);
      if (st === 'done' || st === 'loading' || st === 'quick') return;
      this._rendered.set(n, 'quick');
      try {
        const page = await this.pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = this._scaleFor(base.width);
        const vp = page.getViewport({ scale });
        const q = 0.42;
        const canvas = el('canvas');
        canvas.width = Math.max(1, Math.floor(vp.width * q));
        canvas.height = Math.max(1, Math.floor(vp.height * q));
        canvas.style.width = Math.floor(vp.width) + 'px';
        canvas.style.height = Math.floor(vp.height) + 'px';
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvasContext: ctx,
          viewport: vp,
          transform: [q, 0, 0, q, 0, 0],
          intent: 'display'
        }).promise;
        pageEl.classList.remove('placeholder', 'loading');
        pageEl.innerHTML = '';
        pageEl.append(canvas);
      } catch {
        this._rendered.delete(n);
      }
    },

    async _renderPage(n, node) {
      const st = this._stage;
      if (!st || this._rendered.get(n) === 'done' || this._rendered.get(n) === 'loading') return;
      const pageEl = node || this._pageEls[n - 1];
      if (!pageEl) return;

      // 正在滚动：先画一张低清预览（三四十毫秒），停手后再换成高清。
      // 这样滚的时候既跟手、又不至于看到空白灰块。
      if (this._scrolling) {
        if (this._rendered.get(n) === 'done' || this._rendered.get(n) === 'loading') return;
        this._renderQuick(n);
        return;
      }

      if (this._active >= this.MAX_CONCURRENT) {
        if (!this._pending.some((p) => p[0] === n)) this._pending.push([n, node]);
        return;
      }
      this._active++;
      this._rendered.set(n, 'loading');
      try {
        const page = await pdf.getPage(n);
        if (!this._stage) return;
        const base = page.getViewport({ scale: 1 });
        this._sizes.set(n, { w: base.width, h: base.height });
        const scale = this._scaleFor(base.width);
        const vp = page.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        if (this._mode === 'scroll') {
          pageEl.style.width = Math.floor(vp.width) + 'px';
          pageEl.style.height = Math.floor(vp.height) + 'px';
        }

        const canvas = el('canvas');
        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = Math.floor(vp.width) + 'px';
        canvas.style.height = Math.floor(vp.height) + 'px';
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const task = page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null, intent: 'display' });
        this._renderQueue.add(task);
        await task.promise;
        this._renderQueue.delete(task);
        pageEl.classList.remove('placeholder', 'loading');
        pageEl.innerHTML = '';
        pageEl.append(canvas);

        // 文本层
        try {
          const textDiv = el('div', { class: 'textLayer' });
          textDiv.style.setProperty('--scale-factor', vp.scale);
          pageEl.append(textDiv);
          const tl = new pdfjsLib.TextLayer({
            textContentSource: page.streamTextContent({ includeMarkedContent: true }),
            container: textDiv,
            viewport: vp
          });
          await tl.render();
        } catch (e) { /* 文本层失败不影响阅读 */ }

        const num = el('div', { class: 'page-num', text: String(n) });
        if (this._mode !== 'scroll') num.style.display = 'none';
        pageEl.append(num);
        this._rendered.set(n, 'done');
      } catch (e) {
        console.warn('render page fail', n, e);
        this._rendered.delete(n);
        pageEl.classList.remove('loading');
      } finally {
        this._active--;
        const next = this._pending.shift();
        if (next) setTimeout(() => this._renderPage(next[0], next[1]), 0);
      }
      this._emit();
    },

    _handleScroll() {
      const st = this._stage;
      if (!st || this._mode !== 'scroll') return;

      // 滚动中挂起渲染，停手后统一补上
      this._scrolling = true;
      clearTimeout(this._scrollEndTimer);
      this._scrollEndTimer = setTimeout(() => {
        this._scrolling = false;
        this._pending = [];
        // 停手后把视口附近补齐并升级成高清
        const cur = this._index + 1;
        const from = Math.max(1, cur - 2);
        const to = Math.min(this.pageCount, cur + 3);
        for (let i = from; i <= to; i++) {
          if (this._rendered.get(i) === 'quick') this._rendered.delete(i);
          this._renderPage(i);
        }
      }, 120);

      const max = st.scrollHeight - st.clientHeight;
      const p = max > 0 ? clamp(st.scrollTop / max, 0, 1) : 0;
      // 当前页：在缓存好的 offsetTop 上二分，避免每帧读 DOM 触发重排
      const mid = st.scrollTop + st.clientHeight * 0.35;
      let cur = 1;
      const tops = this._tops;
      if (tops && tops.length === this._pageEls.length) {
        let lo = 0, hi = tops.length - 1, ans = 0;
        while (lo <= hi) {
          const m = (lo + hi) >> 1;
          if (tops[m] <= mid) { ans = m; lo = m + 1; } else hi = m - 1;
        }
        cur = ans + 1;
      }
      if (cur !== this._index + 1) {
        this._index = cur - 1;
        this._onActive(cur);
      }
      // 保险：当前页前后 2 页必须在渲染，谁回收了就补回来
      const from = Math.max(1, cur - 2);
      const to = Math.min(this.pageCount, cur + 2);
      for (let i = from; i <= to; i++) {
        if (this._rendered.get(i) !== 'done' && this._rendered.get(i) !== 'loading') this._renderPage(i);
      }
      this._emit(p);
    },

    _emit(p) {
      const prog = p !== undefined ? p : this.progress();
      this._onUpdate(this._location(), prog);
    },

    _location() {
      if (this._mode === 'scroll') return { type: 'pageScroll', n: this._index + 1, p: this.progress() };
      return { type: 'page', n: this._index + 1 };
    },

    goTo(target, smooth = false) {
      if (!target) return;
      const st = this._stage;
      if (target.type === 'page' || target.type === 'pageScroll') {
        const n = clamp(target.n || 1, 1, this.pageCount);
        if (this._mode === 'scroll') {
          const pe = this._pageEls[n - 1];
          if (pe) {
            st.style.scrollBehavior = 'auto';
            const y = (this._tops && this._tops[n - 1] != null) ? this._tops[n - 1] : pe.offsetTop;
            st.scrollTop = Math.max(0, y - 8);

            const applyDestTop = () => {
              if (typeof target.destTop !== 'number' || !this._pageSizes || !this._pageSizes[n - 1]) return;
              const sz = this._pageSizes[n - 1];
              const rawH = sz.rawH || sz.h;         // PDF 原始页高（坐标基准）
              const rendered = sz.h;
              const top = target.destTop;
              if (rawH > 0 && top > 0 && top <= rawH && rendered > 0) {
                const ratio = Math.max(0, Math.min(1, (rawH - top) / rawH));
                const dy = Math.max(0, Math.min(rendered - 60, ratio * rendered - 20));
                if (dy > 4) st.scrollTop = Math.max(0, st.scrollTop + dy);
              }
            };

            // 缓存 offsetTop 会随页数累积 floor 误差，落到目标页后用实测位置校正一次
            requestAnimationFrame(() => {
              const delta = pe.getBoundingClientRect().top - st.getBoundingClientRect().top - 8;
              if (Math.abs(delta) > 2) st.scrollTop = Math.max(0, st.scrollTop + delta);
              applyDestTop();
            });
          }
          this._index = n - 1;
          // 跳转是用户明确操作，立刻渲染，不受滚动挂起影响
          this._scrolling = false;
          clearTimeout(this._scrollEndTimer);
          this._pending = [];
          this._renderPage(n);
          this._renderPage(Math.max(1, n - 1));
          this._renderPage(Math.min(this.pageCount, n + 1));
          this._onActive && this._onActive(n);
        } else {
          this._index = n - 1;
          this._showSpread();
        }
      } else if (target.type === 'ratio') {
        if (this._mode === 'scroll') st.scrollTop = (st.scrollHeight - st.clientHeight) * (target.v || 0);
        else { this._index = Math.round((this.pageCount - 1) * (target.v || 0)); this._showSpread(); }
      }
    },

    next() {
      if (this._mode === 'scroll') {
        const n = Math.min(this.pageCount, this._index + 2);
        this.goTo({ type: 'page', n }, true);
      } else {
        const step = this._mode === 'double' ? 2 : 1;
        this._index = clamp(this._index + step, 0, this.pageCount - 1);
        this._showSpread();
        this._emit(1);
      }
    },

    prev() {
      if (this._mode === 'scroll') {
        const n = Math.max(1, this._index);
        this.goTo({ type: 'page', n }, true);
      } else {
        const step = this._mode === 'double' ? 2 : 1;
        this._index = clamp(this._index - step, 0, this.pageCount - 1);
        this._showSpread();
        this._emit(0);
      }
    },

    setLayout(mode) {
      if (mode !== 'scroll' && mode !== 'single' && mode !== 'double') return;
      const cur = this._index + 1;
      this._mode = mode;
      this._rendered.clear();
      this._applyLayout();
      if (mode !== 'scroll') { this._index = cur - 1; this._showSpread(); }
    },

    setZoom(z) {
      this._zoom = clamp(z, 0.4, 3);
      this._rendered.clear();
      this._applyLayout();
      if (this._mode !== 'scroll') this._showSpread();
    },

    progress() {
      if (!this._stage) return 0;
      if (this._mode !== 'scroll') return this.pageCount ? (this._index + 1) / this.pageCount : 0;
      const max = this._stage.scrollHeight - this._stage.clientHeight;
      return max > 0 ? clamp(this._stage.scrollTop / max, 0, 1) : 0;
    },

    label() {
      return `${this._index + 1} / ${this.pageCount}`;
    },

    async pageText(n) {
      if (this._textCache.has(n)) return this._textCache.get(n);
      const page = await pdf.getPage(n);
      const tc = await page.getTextContent();
      let last = null; let s = '';
      for (const item of tc.items) {
        if (!item.str) continue;
        if (last !== null && Math.abs(item.transform[5] - last) > 4) s += '\n';
        s += item.str;
        last = item.transform[5];
      }
      this._textCache.set(n, s);
      return s;
    },

    async search(query, onProgress) {
      const q = query.trim();
      if (!q) return [];
      const lower = q.toLowerCase();
      const results = [];
      const total = this.pageCount;
      const started = Date.now();
      for (let n = 1; n <= total; n++) {
        if (Date.now() - started > 15000) break;
        let txt = '';
        try { txt = await this.pageText(n); } catch { continue; }
        // PDF 文本层常在汉字间夹空格，这里建立「去空白」索引再匹配
        let compact = '';
        const map = [];
        for (let i = 0; i < txt.length; i++) {
          if (!/\s/.test(txt[i])) { compact += txt[i]; map.push(i); }
        }
        const lowerCompact = compact.toLowerCase();
        let from = 0, count = 0;
        while (count < 3) {
          const i = lowerCompact.indexOf(lower, from);
          if (i < 0) break;
          const startOrig = map[i];
          const endIdx = map[Math.min(map.length - 1, i + q.length - 1)];
          const endOrig = (endIdx === undefined ? startOrig : endIdx) + 1;
          const s = Math.max(0, startOrig - 32), e = Math.min(txt.length, endOrig + 44);
          results.push({
            title: `第 ${n} 页`,
            snippet: cleanPdfText((s > 0 ? '…' : '') + txt.slice(s, e) + (e < txt.length ? '…' : '')),
            target: { type: 'page', n }
          });
          from = i + Math.max(1, q.length);
          count++;
          if (results.length >= 300) break;
        }
        if (results.length >= 300) break;
        if (n % 8 === 0 && onProgress) onProgress(n / total);
      }
      return results;
    },

    text() {
      if (this._fullText) return this._fullText;
      return '';
    },

    async fullText(onProgress) {
      let out = '';
      for (let n = 1; n <= this.pageCount; n++) {
        out += (await this.pageText(n)) + '\n';
        if (onProgress && n % 5 === 0) onProgress(n / this.pageCount);
      }
      return out;
    },

    destroy() {
      clearInterval(this._pruneTimer);
      this._pending = [];
      try { this._io && this._io.disconnect(); } catch { }
      if (this._resize) window.removeEventListener('resize', this._resize);
      try { this._renderQueue.forEach((t) => t.cancel()); } catch { }
      try { pdf.destroy(); } catch { }
      if (this._stage) this._stage.innerHTML = '';
    }
  };

  await viewer.init();
  return viewer;
}
