/* V 阅读器 · 主程序 */
import { $, $$, el, toast, debounce, clamp, throttle, fmtSize, fmtDate, extOf, baseName, kindOf, coverColors, TYPE_LABEL, IMAGE_EXT, CODE_EXT, decodeText, getCover, putCover, delCover, copyText, hashId } from './util.js';
import { api, store } from './store.js';
import { createFlowViewer } from './viewers/flow.js';
import { createPdfViewer } from './viewers/pdf.js';
import { createEpubViewer } from './viewers/epub.js';
import { createImageViewer, createComicViewer } from './viewers/media.js';
import { createCodeViewer, createCsvViewer } from './viewers/code.js';

const state = {
  filter: 'all',
  query: '',
  current: null,
  viewer: null,
  bookmarks: [],
  notes: [],
  searchResults: [],
  progress: 0,
  layoutOverride: null,
  ttsOn: false,
  readStart: Date.now(),
  objectUrl: null
};

/* ═════════════ 设置 ═════════════ */
const FONT_STACKS = {
  song: '"Songti SC", "Noto Serif SC", "SimSun", Georgia, serif',
  hei: '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif',
  kai: '"KaiTi", "Kaiti SC", "STKaiti", "SimSun", serif',
  fangsong: '"FangSong", "仿宋", "STFangsong", "SimSun", serif',
  deng: '"DengXian", "等线", "Microsoft YaHei", sans-serif',
  yuan: '"YouYuan", "幼圆", "Microsoft YaHei", sans-serif',
  lishu: '"LiSu", "隶书", "STLiti", "SimSun", serif',
  xingkai: '"STXingkai", "华文行楷", "KaiTi", "SimSun", serif',
  stxihei: '"STXihei", "华文细黑", "Microsoft YaHei", sans-serif',
  pingfang: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  notoserif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif',
  notosans: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
  mono: '"Cascadia Code", "JetBrains Mono", Consolas, monospace'
};

function applySettings(skipNotes) {
  const s = store.settings;
  document.body.dataset.theme = s.theme;
  document.documentElement.style.setProperty('--read-size', s.size + 'px');
  document.documentElement.style.setProperty('--read-lh', s.lh);
  document.documentElement.style.setProperty('--para-gap', s.para + 'em');
  document.documentElement.style.setProperty('--page-width', s.width + 'px');
  document.documentElement.style.setProperty('--font-read', FONT_STACKS[s.font] || FONT_STACKS.song);

  // 笔记卡片外观（字号 / 字体 / 字色 / 底色）
  document.documentElement.style.setProperty('--note-fs', ((Number(s.noteFontSize) || Number(s.noteFs) || 12.5)) + 'px');
  document.documentElement.style.setProperty('--note-ink', s.noteInk || '#3d434d');
  const nf = s.noteFont || 'auto';
  document.documentElement.style.setProperty('--note-font',
    nf === 'auto' ? (FONT_STACKS[s.font] || FONT_STACKS.song) : (FONT_STACKS[nf] || FONT_STACKS.song));
  const nbg = s.noteBg || 'auto';
  document.documentElement.style.setProperty('--note-bg',
    nbg === 'auto' ? 'color-mix(in srgb, var(--surface) 96%, transparent)' : nbg);

  const dark = ['night', 'black', 'forest', 'abyss'].includes(s.theme);
  $('#hljs-light').disabled = dark;
  $('#hljs-dark').disabled = !dark;
  document.body.classList.toggle('pdf-invert', dark && s.pdfNight !== false);

  const prose = $('#doc .prose, #doc .txt-body');
  $$('#doc .prose').forEach((p) => p.classList.toggle('indent', !!s.indent));

  $('#set-size').value = s.size; $('#out-size').textContent = s.size;
  $('#set-lh').value = s.lh; $('#out-lh').textContent = Number(s.lh).toFixed(2);
  $('#set-width').value = s.width; $('#out-width').textContent = s.width;
  $('#set-para').value = s.para; $('#out-para').textContent = Number(s.para).toFixed(1);
  $('#set-rate').value = s.rate; $('#out-rate').textContent = Number(s.rate).toFixed(1);
  $('#set-indent').checked = !!s.indent;
  $('#set-autohide').checked = !!s.autohide;
  $('#set-pdfnight').checked = s.pdfNight !== false;
  $('#set-tts-auto').checked = !!s.ttsAuto;
  $('#set-ai-base').value = s.aiBase || '';
  $('#set-ai-model').value = s.aiModel || '';
  $('#set-ai-key').value = s.aiKey || '';
  if ($('#font-select')) $('#font-select').value = s.font;
  if ($('#set-notefs')) $('#set-notefs').value = String(s.noteFs || 11.5);
  if ($('#set-notefont')) $('#set-notefont').value = s.noteFont || 'auto';
  if ($('#set-notebg')) $('#set-notebg').value = s.noteBg || 'auto';
  if ($('#set-notew')) $('#set-notew').value = String(s.noteW || 176);
  $$('#set-noteink .color-dot').forEach((b) => b.classList.toggle('on', b.dataset.c === (s.noteInk || '#3d434d')));
  if ($('#set-notearrow')) $('#set-notearrow').value = s.noteArrowStyle || 'curve';
  if ($('#set-notegap')) {
    $('#set-notegap').value = s.noteGap || 34;
    if ($('#out-notegap')) $('#out-notegap').textContent = s.noteGap || 34;
  }
  $$('#layout-select button').forEach((b) => b.classList.toggle('active', b.dataset.layout === s.layout));
  $$('#theme-swatches .swatch').forEach((b) => b.classList.toggle('active', b.dataset.theme === s.theme));
  $('#reader-view').classList.toggle('focusmode', false);

  // 字号 / 行距 / 版心宽度变了，正文重排，笔记卡片要重新对准文字
  if (!skipNotes && state.view === 'reader') requestAnimationFrame(() => { try { renderNoteAnchors(true); } catch { } });
}

/* ═════════════ 书架 ═════════════ */
const FORMAT_GROUP = (book) => {
  if (book.kind === 'pdf') return 'pdf';
  if (book.kind === 'epub') return 'epub';
  if (['image', 'comic'].includes(book.kind)) return 'image';
  return 'text';
};

function renderShelf() {
  const listEl = $('#shelf-list');
  const empty = $('#shelf-empty');
  if (!listEl) return;
  const q = state.query.trim().toLowerCase();
  let list = store.books.slice();
  if (state.filter === 'reading') list = list.filter((b) => b.progress > 0.01 && b.progress < 0.995);
  else if (state.filter !== 'all') list = list.filter((b) => FORMAT_GROUP(b) === state.filter);
  if (state.tag) list = list.filter((b) => (b.tags || []).includes(state.tag));
  if (q) list = list.filter((b) => b.name.toLowerCase().includes(q) || (b.tags || []).some((t) => t.toLowerCase().includes(q)));
  list.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || (b.lastOpened || b.addedAt) - (a.lastOpened || a.addedAt));

  $('#shelf-count').textContent = `${list.length} 个文件`;
  listEl.innerHTML = '';
  renderTagBar();
  $('#shelf-view').classList.toggle('has-tags', list.some((b) => (b.tags || []).length));

  if (!store.books.length) { empty.hidden = false; return; }
  empty.hidden = true;

  if (!list.length) {
    listEl.innerHTML = '<div class="list-empty">没有符合条件的文件</div>';
    return;
  }

  // 分批插入，文件多时不阻塞首屏
  let idx = 0;
  const CHUNK = 60;
  const frag = document.createDocumentFragment();
  const appendChunk = () => {
    for (let k = 0; k < CHUNK && idx < list.length; k++, idx++) {
      frag.append(buildFileRow(list[idx]));
    }
    listEl.append(frag);
    if (idx < list.length) requestAnimationFrame(appendChunk);
  };
  appendChunk();
  renderBulkBar();
}

function buildFileRow(book) {
  const kind = book.kind || 'unknown';
  const pct = Math.round((book.progress || 0) * 100);
  const row = el('div', { class: 'file-row', dataset: { id: book.id } });
  const tags = (book.tags || []).slice(0, 3).map((t) => `<span class="book-tag">${escapeText(t)}</span>`).join('');
  row.innerHTML = `
    <div class="fl-name">
      <input type="checkbox" class="row-check" id="chk-${book.id}" title="勾选后可批量处理">
      <button class="star-btn${book.starred ? ' on' : ''}" title="收藏"><svg class="ic"><use href="#i-star"/></svg></button>
      <span class="file-icon" data-kind="${kind}">${TYPE_LABEL[kind] || 'FILE'}</span>
      <div class="fl-text">
        <div class="file-title">${escapeText(book.name)}</div>
        <div class="file-sub">${TYPE_LABEL[kind] || '文件'}${book.pageCount ? ' · ' + book.pageCount + ' 页' : ''}</div>
      </div>
    </div>
    <div class="fl-tags">${tags}</div>
    <div class="fl-progress">${pct > 0 ? `<div class="pbar"><i style="width:${pct}%"></i></div><span class="pct">${pct}%</span>` : '<span class="pct">—</span>'}</div>
    <div class="fl-size">${fmtSize(book.size)}</div>
    <div class="fl-time">${book.lastOpened ? fmtDate(book.lastOpened) : '—'}</div>
    <div class="fl-act"><button class="row-menu" title="更多"><svg class="ic"><use href="#i-more"/></svg></button></div>`;
  const cbx = row.querySelector('.row-check');
  if (cbx) cbx.checked = !!(state.sel && state.sel.has(book.id));
  return row;
}

function renderTagBar() {
  const bar = $('#shelf-tagbar');
  if (!state.tag) { bar.innerHTML = ''; return; }
  bar.innerHTML = '';
  const b = el('button', { class: 'tag-chip active', text: '× ' + state.tag });
  b.addEventListener('click', () => { state.tag = ''; renderShelf(); });
  bar.append(b);
}

function escapeText(s = '') {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ═════════════ 批量处理 ═════════════ */
let lastSelId = null;

function toggleSel(id, shift) {
  if (!state.sel) state.sel = new Set();
  const visible = [...document.querySelectorAll('#shelf-list .file-row')].map((r) => r.dataset.id);
  if (shift && lastSelId) {
    const ids = visible;
    const a = ids.indexOf(lastSelId);
    const b2 = ids.indexOf(id);
    if (a >= 0 && b2 >= 0) {
      const from = Math.min(a, b2), to = Math.max(a, b2);
      for (let i = from; i <= to; i++) state.sel.add(ids[i]);
      lastSelId = id;
      renderShelf();
      return;
    }
  }
  if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id);
  lastSelId = id;
  renderShelf();
  renderBulkBar();
}

function renderBulkBar() {
  const bar = $("#bulk-bar");
  if (!bar) return;
  const n = state.sel ? state.sel.size : 0;
  bar.hidden = n === 0;
  const c = $("#bulk-count");
  if (c) c.textContent = "已选 " + n + " 个";
  const sv = $("#shelf-view");
  if (sv) sv.classList.toggle("bulk-mode", n > 0);
}

function bulkIds() { return state.sel ? [...state.sel] : []; }

function bulkClear() {
  if (state.sel) state.sel.clear();
  lastSelId = null;
  renderShelf();
}

async function bulkTag(useAI) {
  const ids = bulkIds();
  if (!ids.length) return;
  if (useAI && !store.settings.aiKey) {
    toast("AI 标签要先在设置里填接口与 Key");
    toggleSettings(true);
    return;
  }
  toast("正在给 " + ids.length + " 个文件生成标签…");
  let done = 0;
  for (const id of ids) {
    const b = store.findBook(id);
    if (!b) continue;
    try { await tagBook(b, useAI); done++; } catch { }
  }
  renderShelf();
  toast("已处理 " + done + " 个文件的标签");
}

function bindBulk() {
  const bar = $("#bulk-bar");
  if (!bar) return;
  bar.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-bulk]");
    if (!btn) return;
    const act = btn.dataset.bulk;
    const ids = bulkIds();
    if (act === "all") {
      const visible = [...document.querySelectorAll("#shelf-list .file-row")].map((r) => r.dataset.id);
      if (!state.sel) state.sel = new Set();
      const allOn = visible.length > 0 && visible.every((id) => state.sel.has(id));
      if (allOn) visible.forEach((id) => state.sel.delete(id));
      else visible.forEach((id) => state.sel.add(id));
      renderShelf();
      return;
    }
    if (act === "clear") { bulkClear(); return; }
    if (!ids.length) return;
    if (act === "tag") { await bulkTag(false); return; }
    if (act === "aitag") { await bulkTag(true); return; }
    if (act === "star" || act === "unstar") {
      const on = act === "star";
      ids.forEach((id) => { const b = store.findBook(id); if (b) b.starred = on; });
      store.saveShelf();
      renderShelf();
      toast(on ? "已加星标" : "已取消星标");
      return;
    }
    if (act === "reading") {
      let n = 0;
      ids.forEach((id) => {
        const b = store.findBook(id);
        if (b && !(b.progress > 0.01)) { b.progress = 0.01; n++; }
      });
      store.saveShelf();
      renderShelf();
      toast("已标记 " + n + " 个为在读");
      return;
    }
    if (act === "remove") {
      if (!confirm("把选中的 " + ids.length + " 个文件移出书架？（不会删除原文件）")) return;
      ids.forEach((id) => { store.removeBook(id); try { delCover(id); } catch { } });
      bulkClear();
      toast("已移出 " + ids.length + " 个文件");
      return;
    }
  });
}

/* ═════════════ 书卡交互 ═════════════ */
function bindShelf() {
  $('#shelf-list').addEventListener('click', async (e) => {
    const row = e.target.closest('.file-row');
    if (!row) return;
    const id = row.dataset.id;
    const book = store.findBook(id);
    if (!book) return;
    if (e.target.closest('.star-btn')) {
      book.starred = !book.starred;
      store.saveShelf();
      const btn = row.querySelector('.star-btn');
      btn.classList.toggle('on', !!book.starred);
      toast(book.starred ? '已收藏，排在最前' : '取消收藏');
      return;
    }
    if (e.target.closest('.row-menu')) { openCardMenu(book, e.clientX, e.clientY); return; }
    if (e.target.closest('.row-check')) { toggleSel(id, e.shiftKey); return; }
    if (state.sel && state.sel.size) { toggleSel(id, e.shiftKey); return; }
    openBook(book);
  });
  $('#shelf-list').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.file-row');
    if (!row) return;
    e.preventDefault();
    const book = store.findBook(row.dataset.id);
    if (book) openCardMenu(book, e.clientX, e.clientY);
  });

  // 书架筛选
  $('#shelf-tabs').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    $$('#shelf-tabs .chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderShelf();
  });

  $('#shelf-search').addEventListener('input', debounce((e) => {
    state.query = e.target.value;
    renderShelf();
  }, 160));

  $('#btn-import').addEventListener('click', () => pickFiles());
  $('#btn-import-2')?.addEventListener('click', () => pickFiles());
  $('#btn-batch-tag').addEventListener('click', batchTag);
  $('#btn-settings-shelf').addEventListener('click', () => toggleSettings());
  $('#btn-edit')?.addEventListener('click', toggleEdit);
  $('#btn-open-folder').addEventListener('click', openBrowser);
  $('#btn-folder-2')?.addEventListener('click', openBrowser);
  $('#file-input').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) importFiles(files);
    e.target.value = '';
  });
}

function openCardMenu(book, x, y) {
  closeCtxMenu();
  const menu = el('div', { class: 'ctx-menu', id: 'ctx-menu' });
  const items = [
    { icon: 'i-book', label: '打开', fn: () => openBook(book) },
    { icon: 'i-tag', label: '生成标签（本地）', fn: () => tagBook(book, false) },
    { icon: 'i-tag', label: 'AI 生成标签', fn: () => { if (!store.settings.aiKey) { toast('先在设置里填写 AI 接口与 Key'); toggleSettings(true); return; } tagBook(book, true); } },
    { icon: 'i-info', label: '在资源管理器中显示', fn: () => { window.desktop?.isElectron ? window.desktop.reveal(book.path) : api.reveal(book.path).catch(() => toast('无法定位文件')); } },
    { icon: 'i-trash', label: '移除出书架', fn: () => { store.removeBook(book.id); delCover(book.id); renderShelf(); toast('已移除'); }, danger: true }
  ];
  for (const it of items) {
    const b = el('button', { class: it.danger ? 'danger' : '' });
    b.innerHTML = `<svg class="ic"><use href="#${it.icon}"/></svg><span>${it.label}</span>`;
    b.addEventListener('click', () => { closeCtxMenu(); it.fn(); });
    menu.append(b);
  }
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
  setTimeout(() => document.addEventListener('click', closeCtxMenu, { once: true }), 0);
}
function closeCtxMenu() { $('#ctx-menu')?.remove(); }

/* ═════════════ 导入 ═════════════ */
function pickFiles() {
  if (window.desktop?.isElectron) {
    window.desktop.openFile().then((paths) => { if (paths && paths.length) openPaths(paths); });
  } else {
    $('#file-input').click();
  }
}

async function openPaths(paths) {
  const added = [];
  for (const p of paths) {
    try {
      const meta = await api.meta(p);
      const book = store.addBook({ name: meta.name, path: meta.path, ext: meta.ext, size: meta.size });
      added.push(book);
    } catch {
      // 可能是目录
      try { openBrowser(p); } catch { }
    }
  }
  if (added.length) {
    renderShelf();
    toast(`已加入书架 ${added.length} 本`);
    if (added.length === 1) openBook(added[0]);
  }
}

async function importFiles(files) {
  const readers = files.filter((f) => !f.type.startsWith('video/'));
  if (!readers.length) return;
  toast(`正在导入 ${readers.length} 个文件…`, 1800);
  const books = [];
  for (const file of readers) {
    try {
      const res = await api.upload(file);
      const book = store.addBook({ name: res.name, path: res.path, ext: res.ext, size: res.size });
      books.push(book);
    } catch (err) {
      toast('导入失败：' + file.name + ' · ' + err.message, 3000);
    }
  }
  renderShelf();
  if (books.length) {
    toast(`已导入 ${books.length} 本`);
    if (books.length === 1) openBook(books[0]);
  }
}

/* ═════════════ 打开书籍 ═════════════ */
/* ═════════════ 多标签页 ═════════════ */
function addTab(book) {
  if (!state.tabs) state.tabs = [];
  if (!state.tabs.some((t) => t.id === book.id)) {
    state.tabs.push({ id: book.id, name: book.name });
    if (state.tabs.length > 8) state.tabs.shift();
  }
  state.activeTab = book.id;
  renderTabs();
}

/* 把标签渲染进某个容器（阅读区和书架各有一条标签栏） */
function buildTabsInto(box) {
  const tabs = state.tabs || [];
  const mmTabs = state.mmTabs || [];
  box.innerHTML = '';
  const frag = document.createDocumentFragment();

  // 常驻的「书架」标签：点它回首页，没有关闭按钮、也不能拖走
  const home = el('div', { class: 'tab tab-home' + (state.view === 'shelf' ? ' active' : '') });
  home.append(el('span', { class: 'tab-name', text: '首页' }));
  home.title = '回到首页（书架）';
  home.addEventListener('click', () => { if (state.view !== 'shelf') switchView('shelf'); });
  frag.append(home);

  mmTabs.forEach((t) => {
    const tab = el('div', { class: 'tab mm-tab' + (t.id === state.activeMmTab ? ' active' : '') });
    const nm = el('span', { class: 'tab-name', text: t.title.slice(0, 14) });
    const x = el('button', { class: 'tab-x', text: '×' });
    tab.append(nm, x);
    tab.addEventListener('click', (e) => {
      if (e.target === x) {
        state.mmTabs = mmTabs.filter((m) => m.id !== t.id);
        if (state.activeMmTab === t.id) closeMmSplit();
        else renderTabs();
        return;
      }
      showMmSplit(t.id);
    });
    frag.append(tab);
  });

  tabs.forEach((t) => {
    const tab = el('div', { class: 'tab' + (t.id === state.activeTab ? ' active' : '') });
    const nm = el('span', { class: 'tab-name', text: t.name.replace(/\.[^.]+$/, '') });
    const x = el('button', { class: 'tab-x', text: '×' });
    tab.append(nm, x);

    // 拖动标签：往上拖出标签栏 = 右侧分屏打开（窗口内双开）；左右拖 = 调顺序
    tab.addEventListener('pointerdown', (e) => {
      if (e.target === x || e.button !== 0) return;
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      const move = (ev) => {
        if (!moved && (Math.abs(ev.clientX - sx) > 6 || Math.abs(ev.clientY - sy) > 6)) {
          moved = true;
          tab.classList.add('tab-drag');
        }
        if (moved) tab.classList.toggle('tab-out', ev.clientY - sy > 40);
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        tab.classList.remove('tab-drag', 'tab-out');
        if (!moved) return;
        tab._skipClick = true;
        setTimeout(() => { tab._skipClick = false; }, 400);
        if (ev.clientY - sy > 40) {
          splitOn(t.id, true);
          return;
        }
        const list = [...box.querySelectorAll('.tab:not(.mm-tab):not(.tab-home)')];
        let target = list.findIndex((el2) => {
          const r = el2.getBoundingClientRect();
          return ev.clientX < r.left + r.width / 2;
        });
        if (target < 0) target = list.length;
        moveTabTo(t.id, target);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });

    tab.addEventListener('click', (e) => {
      if (e.target === x) { closeTab(t.id); return; }
      if (tab._skipClick) return;
      const b = store.books.find((b2) => b2.id === t.id);
      if (!b) return;
      // 在书架里点书标签也要能进书，不能因为 activeTab 相同就忽略
      if (t.id === state.activeTab && state.view === 'reader') return;
      openBook(b);
    });
    frag.append(tab);
  });

  box.append(frag);
}

function renderTabs() {
  const boxes = [$('#tabbar'), $('#tabbar-shelf')].filter(Boolean);
  if (!boxes.length) return;
  const v = state.view || 'shelf';
  const show = v === 'reader' || v === 'shelf';
  boxes.forEach((box) => {
    box.hidden = !show;
    if (show) buildTabsInto(box);
  });
  const active = $('#tabbar') && $('#tabbar').querySelector('.tab.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function moveTabTo(id, to) {
  const tabs = state.tabs || [];
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [item] = tabs.splice(i, 1);
  let j = to > i ? to - 1 : to;
  j = Math.max(0, Math.min(tabs.length, j));
  tabs.splice(j, 0, item);
  store.saveState();
  renderTabs();
}

/* ═════════════ 分屏双开（同一窗口左右两栏看同一本书） ═════════════ */
function splitOn(bookId, announce) {
  const pane = $('#split-pane');
  const frame = $('#split-frame');
  if (!pane || !frame) return;
  const bk = bookId ? store.books.find((b) => b.id === bookId) : state.current;
  if (!bk) { toast('先打开一本书再分屏'); return; }
  const samebook = state.current && bk.id === state.current.id;
  const at = samebook ? Math.round(($('#doc')?.scrollTop) || 0) : 0;
  frame.src = `/?pane=1&book=${encodeURIComponent(bk.id)}&at=${at}`;
  pane.hidden = false;
  $('#reader-view').classList.add('split');
  $('#btn-split').classList.add('on');
  toast(announce ? `右侧分屏打开了《${bk.name.replace(/\.[^.]+$/, '')}》` : '右边开了这本书，两边各滚各的，可以对照读');
}

function splitOff() {
  const pane = $('#split-pane');
  const frame = $('#split-frame');
  if (!pane || pane.hidden) return;
  pane.hidden = true;
  $('#reader-view').classList.remove('split');
  $('#btn-split').classList.remove('on');
  if (frame) frame.src = 'about:blank';
}

function bindSplit() {
  $('#btn-split')?.addEventListener('click', () => {
    const pane = $('#split-pane');
    if (pane && !pane.hidden) splitOff(); else splitOn();
  });

  // 拖分隔条改两栏宽度
  const grip = $('#split-grip');
  const pane = $('#split-pane');
  if (grip && pane) {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const total = px($('.workspace').getBoundingClientRect().width);
      const siderW = px(($('.sidebar')?.getBoundingClientRect().width) || 0);
      const move = (ev) => {
        const wr = $('.workspace').getBoundingClientRect();
        const fromRight = px(wr.right - ev.clientX);
        const w = Math.max(280, Math.min(total - siderW - 320, fromRight));
        pane.style.width = Math.round(w) + 'px';
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        store.settings.splitW = Math.round(parseFloat(pane.style.width) || 0);
        store.saveState();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });
  }
}

function closeTab(id) {
  const tabs = state.tabs || [];
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (state.activeTab === id) {
    const next = tabs[i] || tabs[i - 1];
    if (next) {
      const b = store.books.find((b2) => b2.id === next.id);
      if (b) { openBook(b); return; }
    }
    state.activeTab = null;
    switchView('shelf');
  }
  renderTabs();
}

/* ═════════════ 位置历史（前进 / 后退） ═════════════ */
const nav = { stack: [], index: -1 };

function navReset(startLocation) {
  nav.stack = startLocation ? [{ bookId: state.current?.id, loc: startLocation }] : [];
  nav.index = nav.stack.length - 1;
  updateNavButtons();
}

function pushNav(loc) {
  if (!loc || !state.current) return;
  const cur = nav.stack[nav.index];
  if (cur && JSON.stringify(cur.loc) === JSON.stringify(loc)) return;
  // 从中间某步跳转后，丢弃后面的前进记录
  nav.stack = nav.stack.slice(0, nav.index + 1);
  nav.stack.push({ bookId: state.current.id, loc });
  if (nav.stack.length > 60) nav.stack.shift();
  nav.index = nav.stack.length - 1;
  updateNavButtons();
}

function navBack() {
  if (nav.index <= 0) return;
  nav.index--;
  applyNav();
}

function navForward() {
  if (nav.index >= nav.stack.length - 1) return;
  nav.index++;
  applyNav();
}

function applyNav() {
  const item = nav.stack[nav.index];
  updateNavButtons();
  if (!item) return;
  const book = store.books.find((b) => b.id === item.bookId);
  if (!book) return;
  if (state.current && state.current.id === item.bookId && state.viewer) {
    try { state.viewer.goTo(item.loc, true); } catch { }
  } else {
    openBook(book, { location: item.loc, fromNav: true });
  }
}

function updateNavButtons() {
  const back = $('#btn-nav-back');
  const fwd = $('#btn-nav-forward');
  if (back) back.disabled = nav.index <= 0;
  if (fwd) fwd.disabled = nav.index >= nav.stack.length - 1;
}

/* 记录「跳转前」的位置，供后退使用 */
function recordBeforeJump() {
  try {
    const loc = state.viewer && state.viewer._location ? state.viewer._location() : state.lastLocation;
    if (loc) pushNav(loc);
  } catch { }
}

async function openBook(book, opts = {}) {
  if (state.editing) { state.editing = null; $('#btn-edit')?.classList.remove('on'); }
  addTab(book);
  if (state.viewer) { try { state.viewer.destroy(); } catch { } state.viewer = null; }
  if (state.objectUrl) { URL.revokeObjectURL(state.objectUrl); state.objectUrl = null; }
  try { liveTrans.stop(true); liveTrans.on = false; $('#live-trans-on').checked = false; } catch { }
  try { stopAutoScroll(); } catch { }

  switchView('reader');
  $('#sidebar').classList.add('collapsed');   // 默认干净全屏，点目录才展开
  resetZoom();                                // 每本书都从 100% 开始，避免上次缩放带过来发虚
  state.current = book;
  store.touchBook(book.id);
  state.bookmarks = store.marksOf(book.id).filter((m) => m.type === 'bookmark');
  state.notes = store.marksOf(book.id).filter((m) => m.type !== 'bookmark');

  $('#doc-title').textContent = book.name.replace(/\.[^.]+$/, '');
  $('#doc-sub-main').textContent = '读取中…';
  $('#doc').innerHTML = '<div class="state"><div><div class="big">⌛</div>正在打开《' + escapeText(book.name) + '》…</div></div>';
  $('#toc-list').innerHTML = '';
  updateHud(0, '—', '');

  try {
    const viewer = await buildViewer(book);
    state.viewer = viewer;
    viewer._onUpdate = (loc, p) => handleViewerUpdate(loc, p);
    viewer._onActive = (x) => highlightOutline(x);

    const stage = $('#doc');
    stage.scrollTop = 0;
    viewer.mount(stage);
    applyOutline(viewer.outline || []);
    if ((!viewer.outline || !viewer.outline.length) && ['code', 'csv', 'image'].includes(viewer.kind)) {
      switchPanel('info');
    }
    applySettings();
    renderMarksPanel();
    renderInfo(book, viewer);

    $('#doc-sub-main').textContent = [viewer.author, fmtSize(book.size), viewer.pageCount ? viewer.pageCount + (viewer.kind === 'pdf' ? ' 页' : ' 节') : ''].filter(Boolean).join(' · ');

    // 恢复位置
    const loc = opts.location || store.getLocation(book.id);
    if (loc) {
      setTimeout(() => {
        try { viewer.goTo(loc); } catch { }
        if (viewer.flash) { try { viewer.flash(loc); } catch { } }
      }, 120);
    }
    // 打开新书时，历史从这本书的起点重新算；从前进/后退切过来则保留
    if (!opts.fromNav) navReset(loc || null);
    // 恢复标记
    setTimeout(() => applySavedHighlights(viewer), 260);

    // 封面
    if (!book.cover) makeCover(book, viewer);

    // 自动朗读
    if (store.settings.ttsAuto) setTimeout(() => toggleTTS(true), 600);

    // 外文内容提示实时翻译
    setTimeout(() => {
      if (!viewer) return;
      if (viewer.kind === 'pdf') {
        viewer.pageText(1).then((t) => maybePromptTranslate(t)).catch(() => { });
      } else {
        maybePromptTranslate(viewer.text ? viewer.text() : '');
      }
    }, 900);

    state.readStart = Date.now();
  } catch (err) {
    console.error(err);
    $('#doc').innerHTML = `<div class="state"><div><div class="big">!</div>打开失败<br><span class="dim">${escapeText(err.message || String(err))}</span><br><br><button class="btn ghost" onclick="location.reload()">重新加载</button></div></div>`;
    $('#doc-sub-main').textContent = '打开失败';
  }
}

/* ═════════════ 编辑模式（AI 就地改写） ═════════════ */
const EDITABLE_EXT = ['.md', '.markdown', '.txt', '.log', '.csv', '.json', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.ps1', '.sql', '.xml', '.yaml', '.yml', '.css', '.html', '.htm', '.vue', '.lua', '.kt', '.swift'];

const AI_EDIT_PROMPTS = {
  polish: '把下面的文字润色一遍：让表达更通顺自然，去掉冗余和口水词，保持原意与原有信息量，不要增加内容。只输出改写后的正文，不要任何解释。',
  shorten: '把下面的文字精简：保留全部关键信息和数据，删掉铺垫、重复和空话，长度减少三分之一左右。只输出精简后的正文。',
  expand: '把下面的文字扩写：补充必要的细节、例子或过渡，让它更完整易读，不许编造事实。只输出扩写后的正文。',
  formal: '把下面的文字改写成正式书面语：用词准确、去掉口语、结构清楚，适合报告或文档。只输出改写结果。',
  proof: '校对下面的文字：找出错别字、标点误用、语病、前后不一致。先输出问题清单（每行一条，格式「原文 → 问题 → 建议」），空一行，最后输出「修改后全文」。',
  continue: '接着下面这段内容继续往下写，保持同样的语气和风格，写 100 到 250 字，不要重复已有内容，不要解释。只输出新增的内容。'
};

const AI_EDIT_LABEL = { polish: '润色', shorten: '精简', expand: '扩写', formal: '正式', proof: '校对', continue: '续写' };

function canEditDoc() {
  if (!state.current || !state.viewer) return false;
  if (typeof state.viewer.text !== 'function') return false;
  const ext = (state.current.ext || extOf(state.current.name) || '').toLowerCase();
  return EDITABLE_EXT.includes(ext);
}

function toggleEdit() {
  if (state.editing) { exitEdit(); return; }
  if (!canEditDoc()) { toast('这个格式不能直接编辑'); return; }
  enterEdit();
}

function enterEdit() {
  const v = state.viewer;
  const raw = v.text ? v.text() : '';
  if (!raw) { toast('拿不到原文内容'); return; }
  state.editing = { raw, dirty: false };

  const doc = $('#doc');
  doc.innerHTML = '';
  const wrap = el('div', { class: 'doc-edit-wrap' });

  const bar = el('div', { class: 'edit-bar' });
  const count = el('span', { id: 'edit-count' });
  const undoBtn = el('button', { class: 'btn tiny ghost', id: 'btn-undo', title: '回退 (Ctrl+Z)', text: '↶ 回退' });
  const redoBtn = el('button', { class: 'btn tiny ghost', id: 'btn-redo', title: '前进 (Ctrl+Y)', text: '↷ 前进' });
  undoBtn.addEventListener('click', undoStep);
  redoBtn.addEventListener('click', redoStep);
  undoBtn.disabled = true;
  redoBtn.disabled = true;
  const actions = el('div', { class: 'edit-actions' });
  ['polish', 'shorten', 'expand', 'formal', 'proof', 'continue'].forEach((k) => {
    const b = el('button', { class: 'btn tiny ghost', text: AI_EDIT_LABEL[k] });
    b.addEventListener('click', () => aiEditDoc(k));
    actions.append(b);
  });
  const saveBtn = el('button', { class: 'btn tiny primary', text: '保存' });
  saveBtn.addEventListener('click', saveDoc);
  const exitBtn = el('button', { class: 'btn tiny ghost', text: '退出' });
  exitBtn.addEventListener('click', exitEdit);
  bar.append(count, el('span', { class: 'grow' }), undoBtn, redoBtn, actions, saveBtn, exitBtn);

  const ta = el('textarea', { class: 'doc-editor', id: 'editor', spellcheck: 'false' });
  ta.value = raw;
  resetUndo(raw);
  let undoDebounce = null;
  ta.addEventListener('input', () => {
    state.editing.dirty = ta.value !== state.editing.raw;
    updateEditCount();
    // 打字时不要每个字符都存一份，停手 500ms 再记
    clearTimeout(undoDebounce);
    undoDebounce = setTimeout(pushUndoSnapshot, 500);
  });
  ta.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undoStep(); return; }
    if (mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) { e.preventDefault(); redoStep(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveDoc(); }
    if (e.key === 'Escape') { e.preventDefault(); exitEdit(); }
  });

  wrap.append(bar, ta);
  doc.append(wrap);
  $('#btn-edit')?.classList.add('on');
  updateEditCount();
  ta.focus();
}

function updateEditCount() {
  const ta = $('#editor');
  const box = $('#edit-count');
  if (!ta || !box) return;
  const text = ta.value;
  const chars = text.length;
  const lines = text.split('\n').length;
  const dirty = state.editing && state.editing.dirty ? ' · <span class="dirty">未保存</span>' : '';
  box.innerHTML = `${chars} 字 · ${lines} 行${dirty}`;
}

async function saveDoc() {
  const ta = $('#editor');
  if (!ta || !state.current) return;
  try {
    const res = await fetch('/api/save-doc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.current.path, content: ta.value })
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '保存失败');
    state.editing.raw = ta.value;
    state.editing.dirty = false;
    updateEditCount();
    state.current.size = new Blob([ta.value]).size;
    store.saveShelf();
    toast('已保存');
  } catch (e) {
    toast('保存失败：' + e.message);
  }
}

function exitEdit() {
  if (state.editing && state.editing.dirty) {
    if (!confirm('还有未保存的修改，确定退出吗？')) return;
  }
  state.editing = null;
  $('#btn-edit')?.classList.remove('on');
  if (state.current) openBook(state.current, { keepTab: true });
}

async function aiEditDoc(action) {
  const ta = $('#editor');
  if (!ta) { toast('先点「编辑」进入编辑模式'); return; }
  if (!store.settings.aiKey) { toast('先在设置里填 AI 接口'); toggleSettings(true); return; }
  const selStart = ta.selectionStart;
  const selEnd = ta.selectionEnd;
  const sel = ta.value.slice(selStart, selEnd).trim();
  const before = ta.value.slice(Math.max(0, selStart - 4000), selStart);
  const target = sel || (action === 'continue' ? before : ta.value.slice(0, 7000));
  if (!target.trim()) { toast('没有可处理的文字'); return; }

  $('#btn-ai').click();
  const box = $('#ai-messages');
  box.querySelector('.ai-empty')?.remove();
  aiBubble('user', `${AI_EDIT_LABEL[action]}${sel ? '（选中 ' + sel.length + ' 字）' : '（' + (action === 'continue' ? '光标前的段落' : '全文前 7000 字') + '）'}`);
  const thinking = aiBubble('bot', '正在处理…');
  thinking.querySelector('.ai-msg').classList.add('thinking');

  try {
    const ans = await aiCall(`${AI_EDIT_PROMPTS[action]}\n\n${target}`, { maxTokens: 2000, temperature: 0.35 });
    thinking.remove();
    showEditResult(action, ans, Boolean(sel));
  } catch (e) {
    thinking.remove();
    aiBubble('bot error', '处理失败：' + e.message);
  }
}

function parseProofItems(text) {
  const strip = (s) => s
    .replace(/^\s*(原文|问题|建议|修改为|应为|改为|正确)\s*[:：]\s*/, '')
    .replace(/^[「"'《]|[」"'》]$/g, '')
    .trim();
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:\d+\s*[.、)]\s*)?(?:[-*]\s*)?(.{1,110}?)\s*(?:→|->|=>)\s*(.{1,110}?)\s*(?:→|->|=>)\s*(.+)$/);
    if (m) {
      const from = strip(m[1]);
      const to = strip(m[3]);
      if (from && to && from !== to && from.length > 1) out.push({ from, why: strip(m[2]), to });
    }
  }
  return out;
}

function applyProofItem(item, card, btn) {
  const ta = $('#editor');
  if (!ta) return false;
  const idx = ta.value.indexOf(item.from);
  if (idx < 0) return false;
  pushUndoSnapshot();
  ta.focus();
  ta.setSelectionRange(idx, idx + item.from.length);
  document.execCommand('insertText', false, item.to);
  if (state.editing) state.editing.dirty = ta.value !== state.editing.raw;
  updateEditCount();
  pushUndoSnapshot();
  if (card) card.classList.add('done');
  if (btn) { btn.disabled = true; btn.textContent = '已应用'; }
  return true;
}

function showEditResult(action, text, hasSel) {
  const box = $('#ai-messages');
  const wrap = el('div', { class: 'ai-msg-wrap' });
  const d = el('div', { class: 'ai-msg bot' });
  const head = el('div');
  head.style.cssText = 'font-size:11px;color:var(--ink-3);margin-bottom:6px';
  head.textContent = AI_EDIT_LABEL[action] + '结果';

  if (action === 'proof') {
    const items = parseProofItems(text);
    if (items.length) {
      head.textContent = `校对结果 · 找到 ${items.length} 处`;
      const list = el('div', { class: 'proof-list' });
      const btns = [];
      items.forEach((it) => {
        const card = el('div', { class: 'proof-item' });
        const fromEl = el('div', { class: 'from', text: it.from });
        const whyEl = el('div', { class: 'why', text: it.why });
        const toEl = el('div', { class: 'to', text: it.to });
        const btn = el('button', { class: 'btn tiny primary fix', text: '应用这条' });
        btn.addEventListener('click', () => {
          if (!applyProofItem(it, card, btn)) toast('正文里找不到这段原文了');
        });
        btns.push({ it, card, btn });
        card.append(fromEl, whyEl, toEl, btn);
        list.append(card);
      });
      const ops = el('div');
      ops.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap';
      const all = el('button', { class: 'btn tiny primary', text: '全部应用' });
      all.addEventListener('click', () => {
        let ok = 0;
        btns.forEach(({ it, card, btn }) => {
          if (btn.disabled) return;
          if (applyProofItem(it, card, btn)) ok++;
        });
        toast(ok ? `已应用 ${ok} 处修改` : '没有可应用的修改');
      });
      const copy = el('button', { class: 'btn tiny ghost', text: '复制清单' });
      copy.addEventListener('click', () => copyText(text));
      ops.append(all, copy);
      d.append(head, list, ops);
      wrap.append(d);
      box.append(wrap);
      box.scrollTop = box.scrollHeight;
      return;
    }
  }

  const body = el('div');
  body.textContent = text;
  body.style.whiteSpace = 'pre-wrap';
  const ops = el('div', { class: 'ops' });
  ops.style.cssText = 'display:flex;gap:6px;margin-top:10px;flex-wrap:wrap';

  const isInsert = action === 'continue' || !hasSel;
  const applyBtn = el('button', { class: 'btn tiny primary', text: isInsert ? '插入到光标处' : '替换选中' });
  applyBtn.addEventListener('click', () => applyEditText(text, isInsert));
  const copyBtn = el('button', { class: 'btn tiny ghost', text: '复制' });
  copyBtn.addEventListener('click', () => copyText(text));
  ops.append(applyBtn, copyBtn);

  d.append(head, body, ops);
  wrap.append(d);
  box.append(wrap);
  box.scrollTop = box.scrollHeight;
}

/* ═════════════ 回退 / 前进（所有文本改动都走这里） ═════════════ */
const undoStack = { list: [], idx: -1 };

function updateUndoUI() {
  const u = $('#btn-undo'), r = $('#btn-redo');
  if (u) u.disabled = undoStack.idx <= 0;
  if (r) r.disabled = undoStack.idx >= undoStack.list.length - 1;
}

function pushUndoSnapshot() {
  const ta = $('#editor');
  if (!ta) return;
  const v = ta.value;
  if (undoStack.list[undoStack.idx] === v) return;
  undoStack.list = undoStack.list.slice(0, undoStack.idx + 1);
  undoStack.list.push(v);
  if (undoStack.list.length > 100) undoStack.list.shift();
  undoStack.idx = undoStack.list.length - 1;
  updateUndoUI();
}

function applyUndoSnapshot(v) {
  const ta = $('#editor');
  if (!ta || v == null) return;
  ta.value = v;
  if (state.editing) state.editing.dirty = ta.value !== state.editing.raw;
  updateEditCount();
  updateUndoUI();
}

function undoStep() {
  if (undoStack.idx <= 0) { toast('已经到最前面了'); return; }
  undoStack.idx--;
  applyUndoSnapshot(undoStack.list[undoStack.idx]);
}

function redoStep() {
  if (undoStack.idx >= undoStack.list.length - 1) { toast('已经到最后了'); return; }
  undoStack.idx++;
  applyUndoSnapshot(undoStack.list[undoStack.idx]);
}

function resetUndo(baseline) {
  undoStack.list = [baseline];
  undoStack.idx = 0;
  updateUndoUI();
}

/* ═════════════ 缩放（滚轮 + 修饰键） ═════════════ */
function zoomModifierHit(e) {
  const mode = store.settings.zoomKey || 'ctrl';
  if (mode === 'none') return true;
  if (mode === 'ctrl') return e.ctrlKey || e.metaKey;
  if (mode === 'alt') return e.altKey;
  if (mode === 'shift') return e.shiftKey;
  if (mode === 'both') return e.ctrlKey || e.metaKey || e.altKey;
  return e.ctrlKey || e.metaKey;
}

function applyZoom(z, quiet) {
  const next = Math.max(0.5, Math.min(2.5, Math.round(z * 20) / 20));
  state.zoom = next;
  const doc = $('#doc');
  if (doc) doc.style.zoom = next === 1 ? '' : String(next);  const out = $('#out-zoom');
  if (out) out.textContent = Math.round(next * 100) + '%';
  const range = $('#set-zoom');
  if (range && Math.abs(Number(range.value) - next * 100) > 1) range.value = Math.round(next * 100);
  // 缩放后坐标换算会变（卡片在正文里按文档坐标钉住），重算一次
  requestAnimationFrame(() => { try { renderNoteAnchors(true); } catch { } });
  if (!quiet) {
    const t = $('#zoom-hint');
    if (t) {
      t.textContent = Math.round(next * 100) + '%';
      t.classList.add('show');
      clearTimeout(applyZoom._t);
      applyZoom._t = setTimeout(() => t.classList.remove('show'), 900);
    }
  }
}

function resetZoom() { applyZoom(1, true); }

function bindZoom() {
  window.addEventListener('wheel', (e) => {
    if (state.view !== 'reader') return;
    if ($('#mm-modal') && !$('#mm-modal').hidden) return;
    if (!zoomModifierHit(e)) return;
    e.preventDefault();
    const step = e.deltaY > 0 ? -0.1 : 0.1;
    applyZoom((state.zoom || 1) + step);
  }, { passive: false });

  $('#set-zoom')?.addEventListener('input', (e) => applyZoom(Number(e.target.value) / 100, true));
  $('#set-zoomkey')?.addEventListener('change', (e) => { store.settings.zoomKey = e.target.value; store.saveState(); });
  $('#set-notearrow')?.addEventListener('change', (e) => {
    store.settings.noteArrowStyle = e.target.value;
    store.saveState();
    renderNoteAnchors(true);
  });
  // 笔记卡片外观
  $('#set-notefs')?.addEventListener('change', (e) => {
    store.settings.noteFontSize = Number(e.target.value) || 12.5;
    store.saveState();
    applySettings(true);
  });
  $('#set-notefont')?.addEventListener('change', (e) => {
    store.settings.noteFont = e.target.value;
    store.saveState();
    applySettings(true);
  });
  $('#set-notew')?.addEventListener('change', (e) => {
    store.settings.noteW = Number(e.target.value) || 176;
    store.saveState();
    renderNoteAnchors(true);
  });
  $('#set-notebg')?.addEventListener('change', (e) => {
    store.settings.noteBg = e.target.value;
    store.saveState();
    applySettings(true);
  });
  $$('#set-noteink .color-dot').forEach((b) => {
    b.addEventListener('click', () => {
      store.settings.noteInk = b.dataset.c;
      store.saveState();
      $$('#set-noteink .color-dot').forEach((x) => x.classList.toggle('on', x === b));
      applySettings(true);
      renderNoteAnchors(true);
    });
  });
  $('#set-notegap')?.addEventListener('input', (e) => {
    store.settings.noteGap = Number(e.target.value);
    const out = $('#out-notegap');
    if (out) out.textContent = e.target.value;
    renderNoteAnchors();
  });
  $('#set-notegap')?.addEventListener('change', () => store.saveState());
  $$('#set-notecolor .color-dot').forEach((b) => {
    b.addEventListener('click', () => {
      store.settings.noteColor = b.dataset.c;
      store.saveState();
      $$('#set-notecolor .color-dot').forEach((x) => x.classList.toggle('on', x === b));
      renderNoteAnchors();
    });
  });
}

function applyEditText(text, insert) {
  const ta = $('#editor');
  if (!ta) return;
  pushUndoSnapshot();          // 改之前先存一份
  ta.focus();
  if (insert) {
    const pos = ta.selectionStart;
    ta.setSelectionRange(pos, pos);
    const needGap = pos > 0 && ta.value[pos - 1] !== '\n';
    document.execCommand('insertText', false, (needGap ? '\n\n' : '') + text);
  } else {
    document.execCommand('insertText', false, text);
  }
  if (state.editing) state.editing.dirty = ta.value !== state.editing.raw;
  updateEditCount();
  pushUndoSnapshot();          // 改完再存一份，回退才有落脚点
  toast('已应用，点「回退」或 Ctrl+Z 可撤销');
}

async function buildViewer(book) {
  const settings = store.settings;
  const ext = book.ext || extOf(book.name);
  const kind = book.kind || kindOf(ext, book.name);
  const onUpdate = (loc, p) => handleViewerUpdate(loc, p);

  const needBuffer = ['epub', 'docx', 'comic', 'zip'].includes(kind);
  const needText = ['markdown', 'txt', 'html', 'rtf', 'code', 'csv'].includes(kind);

  if (kind === 'pdf') {
    return await createPdfViewer({ url: api.fileUrl(book.path), name: book.name, settings, onUpdate });
  }
  if (kind === 'image') {
    return createImageViewer({ url: api.fileUrl(book.path), name: book.name });
  }

  let buffer = null, text = '';
  if (needBuffer) {
    buffer = await api.fetchArrayBuffer(book.path, (p) => { $('#doc-sub-main').textContent = `读取中 ${Math.round(p * 100)}%`; });
  }
  if (needText || kind === 'rtf') {
    const buf = await api.fetchArrayBuffer(book.path);
    text = decodeText(buf);
  }

  if (kind === 'epub') return await createEpubViewer({ buffer, name: book.name, settings, onUpdate });
  if (kind === 'docx') return await createFlowViewer({ kind, name: book.name, buffer, settings });
  if (kind === 'comic' || kind === 'zip') return await createComicViewer({ buffer, name: book.name, settings, onUpdate });
  if (kind === 'code') return createCodeViewer({ text, ext, name: book.name });
  if (kind === 'csv') return createCsvViewer({ text, name: book.name });
  if (['markdown', 'txt', 'html', 'rtf'].includes(kind)) return await createFlowViewer({ kind, name: book.name, text, settings });

  throw new Error('暂不支持这种格式：' + (ext || book.name.split('.').pop()));
}

function switchView(v) {
  // 先切界面，再做清理。
  // 之前是先 destroy 再切，中间任何一步（停朗读、存进度）抛错就会停在
  // 「阅读器已销毁、书架还没显示」的状态——表现出来就是一片空白。
  state.view = v;
  $('#shelf-view').hidden = v !== 'shelf';
  $('#reader-view').hidden = v !== 'reader';

  if (v === 'shelf') {
    if (state.viewer) {
      try { saveReadingState(true); } catch { }
      try { stopTTS(); } catch { }
      try { state.viewer.destroy(); } catch { }
      state.viewer = null;
      if (state.readStart && state.current) {
        try { store.addReadingTime(state.current.id, Date.now() - state.readStart); } catch { }
        state.readStart = Date.now();
      }
    }
    try { renderShelf(); } catch (e) { console.error('renderShelf', e); }
    state.current = null;
  }
  try { renderTabs(); } catch { }
  try { renderTabs(); } catch { }
}

/* ═════════════ 进度与 HUD ═════════════ */
let hudRaf = 0;
let hudLast = '';
function handleViewerUpdate(loc, p) {
  state.lastLocation = loc;
  state.progress = p;
  if (!hudRaf) {
    hudRaf = requestAnimationFrame(() => {
      hudRaf = 0;
      const label = state.viewer ? state.viewer.label() : '';
      const pct = Math.round((p || 0) * 100);
      const text = (label ? ' · ' + label : '') + (pct > 0 ? ' · ' + pct + '%' : '');
      if (text !== hudLast) {
        hudLast = text;
        const el = $('#doc-progress');
        if (el) el.textContent = text;
      }
      saveReadingState();
    });
  }
}

const saveReadingState = debounce(() => {
  if (!state.current) return;
  const p = state.viewer ? state.viewer.progress() : state.progress;
  const loc = state.lastLocation || (state.viewer && state.viewer._location ? state.viewer._location() : null);
  store.setProgress(state.current.id, p, loc);
}, 900);

function updateHud(p, label, title) {
  const pct = Math.round((p || 0) * 100);
  const el = $('#doc-progress');
  if (!el) return;
  el.textContent = (label ? ' · ' + label : '') + (pct > 0 ? ' · ' + pct + '%' : '');
}

/* ═════════════ 目录 ═════════════ */
function applyOutline(outline) {
  const box = $('#toc-list');
  box.innerHTML = '';
  tocActiveIdx = -1;
  if (!outline || !outline.length) {
    state.outline = [];          // 换书后必须清空，否则目录面板还显示上一本的
    box.innerHTML = '<div class="toc-empty">这份文档没有目录<br><span class="dim">PDF 可在生成时添加书签，EPUB 自带导航</span></div>';
    return;
  }
  // 不同阅读器给的字段不一致，这里统一补出可跳转的 target
  const list = outline.map((o) => {
    if (o.target) return o;
    if (o.page) return Object.assign({}, o, { target: { type: 'page', n: o.page } });
    if (o.id) return Object.assign({}, o, { target: { type: 'id', id: o.id } });
    if (typeof o.index === 'number') return Object.assign({}, o, { target: { type: 'block', i: o.index } });
    return o;
  });
  state.outline = list;
  const frag = document.createDocumentFragment();
  list.forEach((item, i) => {
    const node = el('a', { class: 'toc-item lvl' + Math.min(4, item.level || 1), dataset: { i } });
    node.innerHTML = `<span class="toc-idx">${String(i + 1).padStart(2, '0')}</span><span>${escapeText(item.title)}</span>`;
    frag.append(node);
  });
  box.append(frag);

  // 事件委托：挂在列表容器上，只绑一次。
  // 这样即使目录被重建、节点被替换，点击也不会失效（之前逐个绑 click 就是这么丢的）
  if (!box._tocBound) {
    box.addEventListener('click', (e) => {
      const node = e.target.closest('.toc-item');
      if (!node) return;
      const i = Number(node.dataset.i);
      const item = (state.outline || [])[i];
      if (!item) return;
      if (!item.target) { toast('这一项没有可跳转的位置'); return; }
      if (!state.viewer) return;
      try {
        state.viewer.goTo(item.target, true);
        setTocActive(i);   // 点的哪项就高亮哪项，不走页码反查
        tocLockUntil = Date.now() + 1600;
        // 跳完再记录位置，历史就是「去过的地方」序列
        setTimeout(() => { try { pushNav(state.viewer && state.viewer._location ? state.viewer._location() : null); } catch { } }, 420);
        setTimeout(() => { try { state.viewer && state.viewer.flash && state.viewer.flash(item.target); } catch { } }, 420);
      } catch (err) {
        toast('跳转失败：' + (err.message || err));
      }
    });
    box._tocBound = true;
  }
}

/* 指定高亮某一项目录（不经过页码反查） */
function setTocActive(index) {
  const box = $('#toc-list');
  if (!box) return;
  const items = box.children;
  if (!items[index]) return;
  const prev = tocActiveIdx >= 0 ? items[tocActiveIdx] : null;
  prev?.classList.remove('active');
  items[index].classList.add('active');
  tocActiveIdx = index;
  const r = items[index].getBoundingClientRect();
  const br = box.getBoundingClientRect();
  if (r.top < br.top || r.bottom > br.bottom) {
    box.scrollTop = items[index].offsetTop - box.clientHeight / 2 + items[index].offsetHeight / 2;
  }
}

let tocActiveIdx = -1;
let tocLockUntil = 0;

function highlightOutline(key) {
  // 刚点完目录的一小段时间内，跳转引发的滚动回调不许改高亮
  if (Date.now() < tocLockUntil) return;
  const outline = state.outline || state.viewer?.outline || [];
  let index = -1;
  if (typeof key === 'number') {
    if (state.viewer && state.viewer.kind === 'pdf') {
      index = outline.findIndex((o) => (o.target && o.target.n === key) || o.page === key);
      if (index < 0) {
        for (let i = 0; i < outline.length; i++) {
          const n = (outline[i].target && outline[i].target.n) || outline[i].page;
          if (n && n <= key) index = i;
        }
      }
    } else {
      index = key;
    }
  } else if (typeof key === 'string') {
    index = outline.findIndex((o) => o.id === key);
  }
  if (index < 0 || index === tocActiveIdx) return;

  // 同一页常挂好几个书签（比如「14.3.2 计数器模式」和「向上计数模式」都在 255 页）。
  // 如果当前高亮项跟要高的项指向同一页，就别抢——保留用户刚点的那一项
  if (tocActiveIdx >= 0 && outline[tocActiveIdx] && outline[index]) {
    const curN = (outline[tocActiveIdx].target && outline[tocActiveIdx].target.n) || outline[tocActiveIdx].page;
    const newN = (outline[index].target && outline[index].target.n) || outline[index].page;
    if (curN && newN && curN === newN) return;
  }

  const box = $('#toc-list');
  if (!box) return;
  const items = box.children;
  if (!items.length) return;
  const prev = tocActiveIdx >= 0 ? items[tocActiveIdx] : null;
  const active = items[index];
  if (!active) return;
  prev?.classList.remove('active');
  active.classList.add('active');
  tocActiveIdx = index;
  const r = active.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  if (r.top < br.top || r.bottom > br.bottom) {
    box.scrollTop = active.offsetTop - box.clientHeight / 2 + active.offsetHeight / 2;
  }
}

/* ═════════════ 侧栏 ═════════════ */
function setSidebar(open, panel) {
  const sb = $('#sidebar');
  if (panel) switchPanel(panel);
  if (open === undefined) open = sb.classList.contains('collapsed');
  sb.classList.toggle('collapsed', !open);
}
function switchPanel(name) {
  $$('.side-tab').forEach((t) => t.classList.toggle('active', t.dataset.panel === name));
  $$('.side-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  if (name === 'search') setTimeout(() => $('#search-input').focus(), 50);
}

/* 工具栏按钮的统一行为：
   侧栏收起 → 打开并切到该面板；
   已经在该面板 → 收起；
   开着别的面板 → 切过去 */
function toggleSidePanel(name) {
  const sb = $('#sidebar');
  const collapsed = sb.classList.contains('collapsed');
  const active = document.querySelector('.side-panel.active');
  const current = active ? active.dataset.panel : null;
  if (collapsed) { switchPanel(name); sb.classList.remove('collapsed'); return; }
  if (current === name) { sb.classList.add('collapsed'); return; }
  switchPanel(name);
}

/* ═════════════ 搜索 ═════════════ */
let searchToken = 0;
async function doSearch(query) {
  if (!state.viewer) return;
  const q = query.trim();
  if (!q) { $('#search-results').innerHTML = ''; $('#search-status').textContent = ''; return; }
  const token = ++searchToken;
  $('#search-status').textContent = '搜索中…';
  $('#search-results').innerHTML = '';
  try {
    const results = await state.viewer.search(q, (p) => { if (token === searchToken) $('#search-status').textContent = `扫描中 ${Math.round(p * 100)}%`; });
    if (token !== searchToken) return;
    state.searchResults = results;
    $('#search-status').textContent = results.length ? `找到 ${results.length} 处` : '没有找到匹配内容';
    const frag = document.createDocumentFragment();
    results.slice(0, 200).forEach((r) => {
      const item = el('div', { class: 'sr-item' });
      item.innerHTML = `<div class="sr-title">${escapeText(r.title || '')}</div><div class="sr-snippet">${escapeText(r.snippet).replace(new RegExp(escapeReg(q), 'gi'), (m) => `<mark>${m}</mark>`)}</div>`;
      item.addEventListener('click', () => {
        state.viewer.goTo(r.target, true);
        setTimeout(() => state.viewer.flash?.(r.target), 320);
      });
      frag.append(item);
    });
    $('#search-results').append(frag);
  } catch (e) {
    $('#search-status').textContent = '搜索失败：' + e.message;
  }
}
const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ═════════════ 跳转定位 ═════════════ */
function openLocate() {
  if (!state.viewer) { toast('先打开一本书'); return; }
  const m = $('#locate-modal');
  m.hidden = false;
  const label = state.viewer.label ? state.viewer.label() : '';
  $('#locate-now').textContent = `当前位置：${label || '—'} · ${Math.round(state.viewer.progress() * 100)}%`;
  $('#locate-input').value = '';
  $('#locate-result').textContent = '';
  setTimeout(() => $('#locate-input').focus(), 60);
}
function closeLocate() { $('#locate-modal').hidden = true; }

async function doLocate() {
  const raw = $('#locate-input').value.trim();
  if (!raw || !state.viewer) return;
  const v = state.viewer;
  const out = $('#locate-result');
  out.textContent = '定位中…';
  try {
    const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(raw);
    if (pct) {
      const val = clamp(parseFloat(pct[1]) / 100, 0, 1);
      v.goTo({ type: 'ratio', v: val }, true);
      out.textContent = `已跳到 ${Math.round(val * 100)}%`;
      setTimeout(closeLocate, 520);
      return;
    }
    if (/^\d+$/.test(raw)) {
      const n = parseInt(raw, 10);
      if ((v.kind === 'pdf' || v.kind === 'comic') && v.pageCount) {
        if (n < 1 || n > v.pageCount) { out.textContent = `页码超出范围（1 – ${v.pageCount}）`; return; }
        v.goTo({ type: 'page', n }, true);
        out.textContent = `已跳到第 ${n} 页`;
        setTimeout(closeLocate, 520);
        return;
      }
      const val = clamp(n / 100, 0, 1);
      v.goTo({ type: 'ratio', v: val }, true);
      out.textContent = `文字类文档按百分比处理，已跳到 ${n}%`;
      setTimeout(closeLocate, 700);
      return;
    }
    const results = await v.search(raw);
    if (!results.length) { out.textContent = '全文里没有找到这段文字'; return; }
    v.goTo(results[0].target, true);
    setTimeout(() => v.flash && v.flash(results[0].target), 380);
    out.textContent = `找到 ${results.length} 处，已定位到第 1 处${results[0].title ? '（' + results[0].title + '）' : ''}`;
    setTimeout(closeLocate, 1100);
  } catch (e) {
    out.textContent = '定位失败：' + e.message;
  }
}

/* ═════════════ 翻译 ═════════════ */
const LANG_NAME = {
  'zh-CN': '中文', 'en-US': '英语', 'ja-JP': '日语', 'ko-KR': '韩语',
  'fr-FR': '法语', 'de-DE': '德语', 'ru-RU': '俄语', 'es-ES': '西班牙语'
};

function openTranslate(text) {
  const panel = $('#translate-panel');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  toggleSettings(false);
  $('#reader-view').classList.add('translate-open');
  if (text && text.trim()) {
    $('#trans-input').value = text.trim();
    runTranslate();
  } else {
    setTimeout(() => $('#trans-input').focus(), 220);
  }
}
function closeTranslate() {
  const panel = $('#translate-panel');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  $('#reader-view').classList.remove('translate-open');
}

async function runTranslate() {
  const text = $('#trans-input').value.trim();
  if (!text) { toast('先输入或选中一段文字'); return; }
  const from = $('#trans-from').value;
  const to = $('#trans-to').value;
  const useAI = $('#trans-ai').checked;
  $('#trans-status').textContent = useAI ? 'AI 翻译中…' : '翻译中…';
  $('#trans-out').textContent = '';
  try {
    if (useAI) {
      const out = await aiTranslateText(text, to);
      $('#trans-out').textContent = out;
      $('#trans-status').textContent = `${LANG_NAME[from] || '自动'} → ${LANG_NAME[to] || to} · AI`;
      return;
    }
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from, to })
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '翻译失败');
    $('#trans-out').textContent = j.translated;
    $('#trans-status').textContent = `${LANG_NAME[j.from] || j.from} → ${LANG_NAME[j.to] || j.to}${j.cached ? ' · 本地缓存' : ''}`;
  } catch (e) {
    $('#trans-status').textContent = '';
    $('#trans-out').textContent = (useAI ? 'AI 翻译失败：' : '翻译服务暂时不可用：') + e.message + '\n\n可以在设置里检查 AI 接口，或换一段更短的文字再试。';
  }
}

/* ═════════════ 新用户功能介绍 ═════════════ */
const GUIDE_PAGES = [
  /* ───────── 入门 ───────── */
  {
    section: '入门', icon: '📖', title: 'V 阅读器是什么',
    desc: '一个本地阅读器 + 笔记工具：书在你自己的电脑上，笔记、进度、设置也都在本机，不上传不联网（除了你自己配的 AI）。',
    points: [
      '支持 txt / md / pdf / epub，另外也能打开 html、csv、图片、代码文件',
      '数据存在用户目录（默认 D:\\Roaming\\V阅读器\\data），覆盖安装不会丢书',
      '首次打开会自动讲一遍这些说明，之后在设置最下面「帮助 → 用法说明」还能重看',
      '窗口置顶按钮可以让它压在别的软件上面读'
    ]
  },
  {
    section: '入门', icon: '📥', title: '把文件导进来',
    desc: '三种方式，任选一种。',
    points: [
      '点首页右上角「导入文件」，选文件（可多选）',
      '直接把文件拖进窗口——拖到窗口任意位置都行，松开就导入',
      '「打开文件夹」可以整个文件夹一次导进来',
      '导入只是登记路径，不复制文件本体，所以原文件挪走就会打不开',
      '首页右键一本书 →「移除出书架」只是从列表里拿掉，不会删除你的文件'
    ]
  },
  {
    section: '入门', icon: '🗂️', title: '首页（书架）怎么用',
    desc: '所有书都在这儿，按你最近读的顺序排。',
    points: [
      '顶部筛选：全部 / 在读 / PDF / EPUB / 文本 / 图像',
      '搜索框按文件名和标签搜；右侧显示当前文件数量',
      '每行显示：名称、标签、阅读进度、大小、最近打开时间',
      '右键一本书有四项：打开、生成标签（本地）、AI 生成标签、在资源管理器中显示、移除出书架',
      '「批量标签」会给所有还没标签的文件一次性生成标签（配了 AI 才走 AI，否则用本地关键词）',
      '最左边能勾选文件，勾上后顶部出现批量条：生成标签 / AI 标签 / 加星 / 标为在读 / 移出书架',
      '第一个标签固定是「首页」，随时点它回到这里'
    ]
  },

  /* ───────── 阅读 ───────── */
  {
    section: '阅读', icon: '🧭', title: '阅读界面：顶栏每个按钮是什么',
    desc: '从左到右：返回、位置前进后退、书名与进度；右侧一排工具。',
    points: [
      '← 返回书架（Esc）；旁边两个箭头是「回到上一个位置 / 前进」（Alt + ← / →）',
      '两栏图标：分屏双开；列表图标：目录（Tab）',
      '放大镜：全文搜索（/）；准星：跳转定位（Ctrl+G，可跳页码或百分比）',
      '书签图标：书签与笔记侧栏（B）',
      '翻译（Ctrl+Shift+T）、AI（问这篇文档）、播放（自动滚动 Ctrl+Shift+O）',
      '图钉：窗口置顶；喇叭：朗读（R）；月牙：切主题（T）；齿轮：阅读设置（S）；四角：全屏（F）'
    ]
  },
  {
    section: '阅读', icon: '🔤', title: '把版面调到舒服',
    desc: '设置 → 排版，改完立刻生效，下次打开保持。',
    points: [
      '字号、行距、段间距、版心宽度、字体都能单独调',
      '「版心宽度」决定每行多长——太长眼睛容易串行，一般 640～760 比较舒服',
      '顶栏的「A」可以快速切字号，不用每次开设置',
      '主题三种：白天 / 夜间 / 护眼；夜间是整页变暗，不是简单反色',
      '「选中文字的颜色」决定高亮的默认色，划词时也能临时选黄 / 红 / 绿 / 蓝'
    ]
  },
  {
    section: '阅读', icon: '🔎', title: '目录、搜索、跳转',
    desc: '长文档三个最常用的定位方式。',
    points: [
      '目录（Tab）：PDF 用书签目录，文本/EPUB 按标题层级自动生成，点一下跳过去',
      '全文搜索（/）：输入关键词回车，结果列表按出现位置排，点结果直接跳并高亮',
      '跳转定位（Ctrl+G）：输入页码（PDF）或百分比（文本），适合「大概读到一半」这种',
      '搜索框右侧会显示「第 n 条 / 共 m 条」，可以连续回车在结果间跳'
    ]
  },
  {
    section: '阅读', icon: '🔍', title: '缩放与滚动',
    desc: '两种缩放方式，互不干扰。',
    points: [
      '顶栏倍率（右下角那个百分比）能点着改；也能用 Ctrl + 滚轮缩放',
      '设置 →「滚轮缩放时按住的键」可以改成 Shift 或 Alt，避免和触控板冲突',
      '缩放只影响显示，不改文件；关掉书再打开会回到默认倍率',
      '滚轮本身是滚动；PDF 里滚动到页尾会自动翻到下一页'
    ]
  },
  {
    section: '阅读', icon: '🔊', title: '朗读（听书）',
    desc: '让系统语音把正文念出来，适合通勤或者眼睛累的时候。',
    points: [
      '顶栏喇叭（R）开始/暂停朗读',
      '划词工具条上的「朗读」只念选中的那一段',
      '设置 →「朗读」里能调语速，以及「翻到新章节自动接着念」',
      '朗读用的是系统语音，不同电脑音色不同；念到段落结尾会自然停顿'
    ]
  },
  {
    section: '阅读', icon: '🔖', title: '书签、位置历史、阅读进度',
    desc: '不会读完就找不回来。',
    points: [
      '顶栏书签图标（B）打开侧栏，能看到「书签」和「笔记」两组',
      '加书签：Ctrl+D 或侧栏里的加号，会给当前位置起个名字',
      '点书签/笔记条目会直接跳回原文，并闪一下高亮帮你定位',
      '位置前进后退（Alt+← / →）像浏览器一样在「跳过的位置」之间来回',
      '关掉书、关掉程序，下次打开会回到上次读到的地方'
    ]
  },

  /* ───────── 笔记 ───────── */
  {
    section: '笔记', icon: '✍️', title: '划词之后会发生什么',
    desc: '选中正文里的文字，会浮出一个小工具条，九个动作都在上面。',
    points: [
      '左边四个圆点是高亮颜色：黄 / 红 / 绿 / 蓝',
      '高亮：给选中的字加底色；笔记：选中并打开写笔记的窗口',
      '翻译：弹出译文（配了 AI 走 AI，没配走免费通道）',
      'AI：五种现成问法（解释 / 概括 / 改写 / 术语 / 就这段提问）',
      '导图：把这段内容画成思维导图，显示在右侧分屏',
      '编辑：进入整篇文档的编辑模式（Ctrl+E）；朗读：念选中这段；复制：复制文字'
    ]
  },
  {
    section: '笔记', icon: '📝', title: '写一条笔记',
    desc: '笔记由「摘录 + 你自己写的话」两部分组成。',
    points: [
      '划词后点「笔记」，弹窗里上半部分是摘录（自动带上选中的文字），下面写你的想法',
      '保存后原文会留下高亮，右侧出现一张笔记卡片',
      '卡片上的 ✎ 可以随时改内容，× 删除（原文的高亮也一起去掉）',
      '笔记保存在数据目录里，和书绑定；书移除出书架后笔记仍在，重新加回来还在',
      '一条笔记可以只写一句话，也可以写一大段，卡片会自己长高'
    ]
  },
  {
    section: '笔记', icon: '🃏', title: '笔记卡片的操作',
    desc: '卡片不是固定的，位置和大小都能改。',
    points: [
      '按住卡片空白处拖动 → 松手出现 ✓ / ✕：✓ 记住新位置，✕ 回到原位置',
      '拖右下角的斜纹小三角 → 同时改宽和高，松手记住',
      '卡片上五个按钮：✎ 编辑、⌁ 单独调这条连线、AI 用 AI 处理这条笔记、◈ 画成导图、× 删除',
      '卡片左边那条彩色竖条就是连线颜色，一眼能看出哪张对应哪条线',
      '窗口变小或正文放大到没位置时，卡片会先收起来不挡字，侧栏「笔记」里仍然都在'
    ]
  },
  {
    section: '笔记', icon: '🧵', title: '连线的形状自己捏',
    desc: '每张卡片都用一条虚线指向原文，这条线是软的。',
    points: [
      '点一下线 → 线上的小圆点都冒出来，每个点都能拖',
      '两端的点：起点控制「从卡片哪出来」，终点控制「指到哪个字」，拖它们就是改长度和落点',
      '双击线 → 在点击处插入一个新节点；双击中间的点 → 删掉它',
      '卡片上的 ⌁ 单独改这条线的样式：弯曲线 / 直线 / 折线 / 不画线',
      '设置 →「笔记连线」里统一改所有线的样式、颜色、粗细，以及卡片离正文的距离',
      '松手即保存，重开书、重启都保持'
    ]
  },
  {
    section: '笔记', icon: '📤', title: '笔记侧栏与导出',
    desc: '一屏放不下的都在侧栏里。',
    points: [
      '顶栏书签图标（B）打开侧栏，下半部分就是这本书的全部笔记',
      '点一条笔记跳到原文，并闪一下帮你找到位置',
      '「导出笔记」把这本书的笔记导成 Markdown，可以贴到别处',
      '侧栏上方还有书签组，同样可以点着跳'
    ]
  },

  /* ───────── AI ───────── */
  {
    section: 'AI', icon: '🤖', title: '先把 AI 接上（可选）',
    desc: 'AI 不是必须的：不填也能读书、记笔记、做标签，只是没有 AI 那几样功能。',
    points: [
      '设置 →「AI 服务（可选）」，填三样：接口地址（如 https://api.deepseek.com）、模型名（如 deepseek-chat）、API Key',
      '接口要是 OpenAI 兼容格式（/chat/completions），大多数国产模型都支持',
      '没填就点 AI，会提示「先在设置里填 AI 接口」并自动打开设置',
      'Key 只存在本机数据目录，不经过任何第三方服务器'
    ]
  },
  {
    section: 'AI', icon: '💬', title: 'AI 用法一：划词就问',
    desc: '不用自己组织语言，选好文字点 AI，五种问法直接用。',
    points: [
      '解释：用通俗的话说清这段在讲什么',
      '概括：三条以内提炼要点',
      '改写：换成更好懂的说法，保持原意',
      '术语：把这段的专业词整理成「术语 | 解释」表格',
      '就这段提问：带着选中内容打开对话，你可以接着追问',
      '每次只问选中的一段，比整篇丢给 AI 准得多'
    ]
  },
  {
    section: 'AI', icon: '📚', title: 'AI 用法二：整本书问答',
    desc: '顶栏的「AI」按钮（问这篇文档）打开对话面板，它知道你正在读哪本书、在哪一章。',
    points: [
      '直接问：「这一章讲了什么」「把这一节的重点列出来」「这个词在书里是什么意思」',
      '它会带上当前章节的上下文回答，可以连着追问三四轮',
      '长文档建议先问「这一节的要点」，再逐点追问，比一次问一大段准',
      '回答可以复制出去，也可以顺手写成笔记'
    ]
  },
  {
    section: 'AI', icon: '🪄', title: 'AI 用法三：帮你写笔记',
    desc: '笔记卡片上的「AI」按钮，把 AI 用在笔记本身。',
    points: [
      '展开成一段：把你的一句话扩成完整段落',
      '润色这条笔记：理顺表达、去掉口水词',
      '浓缩成一句：反过来压缩',
      '和正文连起来想：结合原文那段，帮你想出关联',
      '基于这条提问：带着这条笔记继续追问'
    ]
  },
  {
    section: 'AI', icon: '✏️', title: 'AI 用法四：改正文、打标签、画导图',
    desc: '除了笔记，AI 还能作用在文档和文件管理上。',
    points: [
      '编辑模式（Ctrl+E）里选中一段，可让 AI「润色 / 精简 / 扩写 / 改正式 / 校对 / 续写」',
      '首页「批量标签」：给还没有标签的文件自动生成标签（配了 AI 才走 AI）',
      '划词工具条的「导图」：把这段内容画成思维导图，在右侧分屏显示',
      '所有 AI 结果都当草稿看，落笔前自己过一遍'
    ]
  },

  /* ───────── 多窗口与标签 ───────── */
  {
    section: '多窗口', icon: '🪟', title: '一个窗口里双开',
    desc: '同一本书并排看两处，左边原文右边注释。',
    points: [
      '把标签往上拖出标签栏 → 右边立刻分出一栏显示这本书',
      '或点顶栏两栏图标，对当前这本书分屏；再点一次收起',
      '两栏各滚各的，中间的分隔线可以左右拖调宽度',
      '分屏那一栏是干净模式：只有正文，不带工具栏和侧栏',
      '两栏共用同一份数据，笔记和进度是通的'
    ]
  },
  {
    section: '多窗口', icon: '🗃️', title: '标签栏像浏览器一样用',
    desc: '第一个标签固定是「首页」。',
    points: [
      '点「首页」回书架，点书标签回那本书（在书架里点书标签也能直接进书）',
      '标签可以左右拖动换顺序，× 关掉；关掉当前标签会自动切到旁边那本',
      '同一个文件可以开多个标签，各自记住阅读位置',
      '标签栏在书架页也有，所以随时能切回刚才那本书'
    ]
  },

  /* ───────── 其他 ───────── */
  {
    section: '其他', icon: '▶️', title: '自动滚动',
    desc: '让文字自己往下走，看长文不累手。',
    points: [
      '点顶栏播放图标（Ctrl+Shift+O）开始，再点一次停',
      '运行中按 - 减速、按 = 加速，屏幕会提示当前速度',
      '设置 →「自动滚动速度」细调，范围 5～300 像素每秒',
      '滚到底会自动停；已经在底部时点按钮会从头开始',
      'PDF 里也能用（会自动找到真正能滚的那一层）'
    ]
  },
  {
    section: '其他', icon: '⌨️', title: '快捷键都能改',
    desc: '常用操作有默认键，全部可以在设置 →「快捷键」里改成顺手的。',
    points: [
      'Tab 目录、/ 搜索、B 书签与笔记、R 朗读、T 主题、S 设置、F 全屏',
      'Alt + ← / → 位置前进后退；Ctrl + G 跳转；Ctrl + E 编辑文档',
      'Ctrl + Shift + O 自动滚动、Ctrl + Shift + T 翻译',
      '点「快捷键」里某一项，按下新组合即可改；有冲突会提示',
      '记不住也没关系：鼠标悬停在按钮上会显示对应快捷键'
    ]
  },
  {
    section: '其他', icon: '💾', title: '数据在哪、怎么搬走',
    desc: '所有东西都在一个文件夹里，拷走就等于备份。',
    points: [
      '数据目录：默认在用户目录下的「V阅读器\\data」，包含书库清单、笔记、进度、设置',
      '想便携：在程序目录放一个 portable.txt，数据就改用程序旁边的 data 文件夹',
      '换电脑：把整个 data 文件夹拷到新机器同一位置即可，书路径变了需要重新导入',
      '覆盖安装升级不会清空这个目录（安装前建议还是备份一份）'
    ]
  }
];

const guide = { i: 0, pages: GUIDE_PAGES };

function renderGuide() {
  const p = guide.pages[guide.i];
  if (!p) return;
  $('#guide-step').textContent = `${guide.i + 1} / ${guide.pages.length}`;
  if ($('#guide-section')) $('#guide-section').textContent = p.section || '';
  if ($('#guide-bar')) $('#guide-bar').style.width = Math.round(((guide.i + 1) / guide.pages.length) * 100) + '%';
  $('#guide-icon').textContent = p.icon;
  $('#guide-title').textContent = p.title;
  $('#guide-desc').textContent = p.desc;
  const ul = $('#guide-points');
  ul.innerHTML = '';
  p.points.forEach((t) => ul.append(el('li', { text: t })));
  const dots = $('#guide-dots');
  if (dots) {
    dots.innerHTML = '';
    guide.pages.forEach((_, k) => {
      const d = el('span', { class: 'guide-dot' + (k === guide.i ? ' on' : '') });
      d.addEventListener('click', () => { guide.i = k; renderGuide(); });
      dots.append(d);
    });
  }
  $('#guide-prev').disabled = guide.i === 0;
  $('#guide-next').textContent = guide.i === guide.pages.length - 1 ? '开始使用' : '下一步';
}

function openGuide(startAt) {
  guide.i = Math.max(0, Math.min(guide.pages.length - 1, Number(startAt) || 0));
  renderGuide();
  $('#guide').hidden = false;
  document.body.classList.add('guide-open');
}

function closeGuide() {
  $('#guide').hidden = true;
  document.body.classList.remove('guide-open');
  try {
    store.data.settings.guideSeen = true;
    store.saveState();
  } catch { }
}

function bindGuide() {
  $('#btn-guide')?.addEventListener('click', () => openGuide(0));
  $('#btn-guide-settings')?.addEventListener('click', () => {
    try { toggleSettings(false); } catch { }
    setTimeout(() => openGuide(0), 200);
  });
  $('#guide-x')?.addEventListener('click', closeGuide);
  $('#guide-prev')?.addEventListener('click', () => {
    if (guide.i > 0) { guide.i--; renderGuide(); }
  });
  $('#guide-next')?.addEventListener('click', () => {
    if (guide.i < guide.pages.length - 1) { guide.i++; renderGuide(); }
    else closeGuide();
  });
  $('#guide')?.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'guide') closeGuide();
  });
  document.addEventListener('keydown', (e) => {
    if ($('#guide').hidden) return;
    if (e.key === 'Escape') { closeGuide(); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (guide.i < guide.pages.length - 1) { guide.i++; renderGuide(); }
      else closeGuide();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      if (guide.i > 0) { guide.i--; renderGuide(); }
      e.preventDefault();
    }
  });
}

/* ═════════════ 自动滚动 ═════════════ */
const autoScroll = { on: false, raf: null, last: 0, pos: 0, el: null };

/* 找真正能滚的那一层：长文书是 #doc，PDF 可能是里面的卷轴层 */
function scrollerOf() {
  const cands = ['#doc', '#stage .pdf-scroll', '#stage .pdf-stage', '.pdf-stage', '#stage'];
  for (const sel of cands) {
    const e = $(sel);
    if (e && e.scrollHeight > e.clientHeight + 4) return e;
  }
  return $('#doc');
}

function autoScrollSpeed() {
  const v = Number(store.data.settings.scrollSpeed);
  return Math.max(2, Math.min(400, v || 30));
}

function stopAutoScroll() {
  autoScroll.on = false;
  if (autoScroll.raf) cancelAnimationFrame(autoScroll.raf);
  autoScroll.raf = null;
  $('#btn-autoscroll')?.classList.remove('active-play');
}

function toggleAutoScroll() {
  if (autoScroll.on) { stopAutoScroll(); toast('已停止自动滚动'); return; }
  if (!state.viewer) { toast('先打开一个文件'); return; }
  const el = scrollerOf();
  if (!el) { toast('这页没有可滚动的内容'); return; }
  if (el.scrollHeight <= el.clientHeight + 4) { toast('这一页不够长，不用滚'); return; }
  // 已经到底就从头开始，免得点了看着没反应
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) el.scrollTop = 0;
  autoScroll.on = true;
  autoScroll.el = el;
  autoScroll.pos = el.scrollTop;
  autoScroll.last = performance.now();
  $('#btn-autoscroll')?.classList.add('active-play');
  toast('自动滚动中 · ' + autoScrollSpeed() + ' 像素/秒（按 - 或 = 调速，再点按钮停止）');
  const step = (t) => {
    if (!autoScroll.on) return;
    const dt = Math.min(0.05, (t - autoScroll.last) / 1000);
    autoScroll.last = t;
    const e = autoScroll.el || scrollerOf();
    if (!e) { stopAutoScroll(); return; }
    autoScroll.pos += autoScrollSpeed() * dt;
    e.scrollTop = autoScroll.pos;
    if (autoScroll.pos + e.clientHeight >= e.scrollHeight - 2) {
      stopAutoScroll();
      toast('已经到底了');
      return;
    }
    autoScroll.raf = requestAnimationFrame(step);
  };
  autoScroll.raf = requestAnimationFrame(step);
}

function nudgeScrollSpeed(d) {
  const v = Math.max(5, Math.min(300, autoScrollSpeed() + d));
  store.data.settings.scrollSpeed = v;
  store.saveState();
  if ($('#set-scrollspeed')) $('#set-scrollspeed').value = v;
  if ($('#out-scroll')) $('#out-scroll').textContent = v;
  toast('滚动速度 ' + v + ' 像素/秒');
}


/* ═════════════ AI 文档问答 ═════════════ */
const aiChat = { history: [], busy: false };

function aiBubble(role, text) {
  const box = $('#ai-messages');
  if (role === 'bot') {
    const wrap = el('div', { class: 'ai-msg-wrap' });
    const d = el('div', { class: 'ai-msg bot' });
    d.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text || ''));
    linkPageRefs(d);
    const tools = el('div', { class: 'ai-tools' });
    const b1 = el('button', { text: '复制' });
    b1.addEventListener('click', () => copyText(d.textContent));
    const b2 = el('button', { text: '存为笔记' });
    b2.addEventListener('click', () => saveAiToNote(text));
    tools.append(b1, b2);
    wrap.append(d, tools);
    box.append(wrap);
    box.scrollTop = box.scrollHeight;
    return wrap;
  }
  const d = el('div', { class: 'ai-msg ' + role });
  d.textContent = text;
  box.append(d);
  box.scrollTop = box.scrollHeight;
  return d;
}

/* AI 回答里的「第 N 页」变成可点的跳转 */
function linkPageRefs(root) {
  const re = /第\s*(\d+)\s*页|\[?p\.?\s*(\d+)\]?/gi;
  const targets = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    re.lastIndex = 0;
    if (re.test(n.nodeValue)) targets.push(n);
  }
  for (const node of targets) {
    const str = node.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(str))) {
      if (m.index > last) frag.append(document.createTextNode(str.slice(last, m.index)));
      const num = Number(m[1] || m[2]);
      if (num > 0 && num <= 20000) {
        const a = el('span', { class: 'ai-page-ref', text: m[0].trim() });
        a.dataset.page = num;
        a.title = '跳到第 ' + num + ' 页';
        a.addEventListener('click', () => {
          if (!state.viewer) return;
          state.viewer.goTo({ type: 'page', n: num });
          toast('已跳到第 ' + num + ' 页');
        });
        frag.append(a);
      } else {
        frag.append(document.createTextNode(m[0]));
      }
      last = m.index + m[0].length;
    }
    if (last < str.length) frag.append(document.createTextNode(str.slice(last)));
    node.replaceWith(frag);
  }
}

function saveAiToNote(text) {
  if (!state.current) { toast('先在书里打开一页'); return; }
  store.addMark(state.current.id, {
    type: 'note', text: '', color: 'blue',
    note: '【AI】' + String(text).slice(0, 900),
    target: currentTarget()
  });
  refreshMarks();
  toast('已存为笔记');
}

async function aiCall(prompt, opts = {}) {
  const s = store.settings;
  if (!s.aiKey) throw new Error('还没有填写 AI 接口');
  const messages = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: prompt });
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: s.aiBase || 'https://api.deepseek.com',
      apiKey: s.aiKey,
      model: s.aiModel || 'deepseek-chat',
      temperature: opts.temperature ?? 0.3,
      maxTokens: opts.maxTokens || 800,
      messages
    })
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || '请求失败');
  return (j.content || '').trim();
}

async function getDocContext(mode = 'near') {
  const v = state.viewer;
  if (!v) return '';
  const LIMIT = 11000;
  if (v.kind === 'pdf') {
    const cur = (v._index || 0) + 1;
    let from = mode === 'all' ? 1 : Math.max(1, cur - 2);
    let to = mode === 'all' ? Math.min(v.pageCount, 12) : Math.min(v.pageCount, cur + 8);
    let out = '';
    for (let i = from; i <= to; i++) {
      out += (await v.pageText(i)) + '\n';
      if (out.length > LIMIT) break;
    }
    return out.slice(0, LIMIT);
  }
  const full = (v.text ? v.text() : '') || '';
  if (!full) return '';
  if (mode === 'all') return full.slice(0, LIMIT);
  const p = v.progress ? v.progress() : 0;
  const center = Math.floor(full.length * p);
  const start = Math.max(0, center - 3200);
  return full.slice(start, start + LIMIT);
}

async function askAI(question, opts = {}) {
  if (!store.settings.aiKey) { toast('先在设置里填 AI 接口和 Key'); toggleSettings(true); return; }
  if (!state.viewer) { toast('先打开一个文件'); return; }
  if (aiChat.busy) { toast('上一个问题还在回答'); return; }
  aiChat.busy = true;
  const box = $('#ai-messages');
  box.querySelector('.ai-empty')?.remove();
  aiBubble('user', opts.focus ? `【${opts.label || '选中内容'}】${question}` : question);
  const thinking = aiBubble('bot', opts.thinking || '正在读文档…');
  thinking.querySelector('.ai-msg').classList.add('thinking');

  try {
    let userContent;
    if (opts.docContext === false) {
      userContent = `内容：\n${opts.focus}\n\n任务：${question}`;
    } else {
      const context = await getDocContext(opts.mode || 'near');
      userContent = (opts.focus ? `选中的原文：\n${opts.focus}\n\n` : '') + `文档内容：\n${context}\n\n问题：${question}`;
    }
    const sys = opts.system || '你在回答关于一篇文档的问题。只依据给出的文档内容回答，不要编造；文档里没有的信息就直说没找到。用中文，回答简洁，必要时分点。凡是引用文档里的具体内容，都要标注出处：PDF 用「第 N 页」，文字类文档用「§章节名」。';
    const messages = [
      { role: 'system', content: sys },
      ...aiChat.history.slice(-4),
      { role: 'user', content: userContent }
    ];
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: store.settings.aiBase || 'https://api.deepseek.com',
        apiKey: store.settings.aiKey,
        model: store.settings.aiModel || 'deepseek-chat',
        temperature: 0.3,
        maxTokens: opts.maxTokens || 1200,
        messages
      })
    });
    const j = await res.json();
    thinking.remove();
    if (!j.ok) throw new Error(j.error || '请求失败');
    const answer = (j.content || '').trim();
    aiBubble('bot', answer);
    aiChat.history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
    if (aiChat.history.length > 12) aiChat.history = aiChat.history.slice(-12);
  } catch (e) {
    thinking.remove();
    aiBubble('bot error', '出错了：' + e.message);
  } finally {
    aiChat.busy = false;
  }
}
/* ═════════════ AI 衍生能力 ═════════════ */
function showAiPop(text, x, y) {
  const pop = $('#ai-pop');
  pop.hidden = false;
  pop.dataset.text = text || '';
  // 先量尺寸，再决定放鼠标左边还是右边
  const w = pop.offsetWidth || 140;
  const h = pop.offsetHeight || 170;
  const gap = 14;
  let left = x + gap;
  if (left + w > window.innerWidth - 10) left = x - w - gap;   // 右边放不开就翻到左边
  if (left < 10) left = 10;
  let top = y - h / 2;
  if (top < 10) top = 10;
  if (top + h > window.innerHeight - 10) top = window.innerHeight - h - 10;
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
}

function aiSelectionAction(action, text) {
  if (!store.settings.aiKey) { toast('先在设置里填 AI 接口'); toggleSettings(true); return; }
  if (!text) return;
  $('#btn-ai').click();
  const focus = text.slice(0, 3000);
  switch (action) {
    case 'explain':
      askAI('解释这段内容，用通俗的话讲清楚它在说什么。', { focus, docContext: false, label: '解释' });
      break;
    case 'summary':
      askAI('用 3 条以内概括这段内容的要点。', { focus, docContext: false, label: '概括' });
      break;
    case 'rewrite':
      askAI('把这段改写成更通俗的中文，保持原意，只输出改写后的文字。', { focus, docContext: false, label: '改写' });
      break;
    case 'terms':
      askAI('提取这段里的专业术语，用 markdown 两列表格输出：术语 | 解释。', { focus, docContext: false, label: '术语' });
      break;
    case 'ask':
      state.aiFocus = focus;
      $('#ai-input').value = '';
      $('#ai-input').placeholder = '就选中的这段提问，回车发送';
      setTimeout(() => $('#ai-input').focus(), 160);
      toast('已带上选中的内容，输入问题即可');
      break;
  }
}

function collectChapters(limit = 8) {
  const v = state.viewer;
  if (!v) return [];
  if (v.kind === 'pdf') {
    const heads = (v.outline || []).filter((o) => o.page && (o.level === 1 || o.level === 2)).slice(0, limit);
    return heads.map((h, i) => ({
      title: h.title,
      page: h.page,
      endPage: heads[i + 1]?.page ? heads[i + 1].page - 1 : Math.min(v.pageCount, h.page + 6)
    }));
  }
  const nodes = [...document.querySelectorAll('#doc .prose h1, #doc .prose h2')].slice(0, limit);
  return nodes.map((n) => ({ title: n.textContent.trim(), el: n }));
}

async function chapterText(c) {
  const v = state.viewer;
  if (c.page) {
    let t = '';
    for (let p = c.page; p <= c.endPage; p++) {
      t += (await v.pageText(p)) + '\n';
      if (t.length > 3200) break;
    }
    return t.slice(0, 3200);
  }
  let out = '';
  let node = c.el.nextElementSibling;
  while (node && !/^H[12]$/.test(node.tagName)) {
    out += (node.textContent || '').trim() + '\n';
    if (out.length > 3200) break;
    node = node.nextElementSibling;
  }
  return out.slice(0, 3200);
}

async function chapterSummary() {
  if (!store.settings.aiKey) { toast('先在设置里填 AI 接口'); toggleSettings(true); return; }
  if (!state.viewer) { toast('先打开一个文件'); return; }
  if (aiChat.busy) { toast('上一个任务还没结束'); return; }
  const chapters = collectChapters(8);
  if (!chapters.length) { toast('这份文档没有可识别的章节'); return; }
  const box = $('#ai-messages');
  box.querySelector('.ai-empty')?.remove();
  aiBubble('user', `给这 ${chapters.length} 个章节各写一句摘要`);
  const wrap = aiBubble('bot', '准备中…');
  const msgEl = wrap.querySelector('.ai-msg');
  msgEl.classList.add('thinking');
  aiChat.busy = true;
  const results = [];
  try {
    for (let i = 0; i < chapters.length; i++) {
      msgEl.textContent = `正在总结 ${i + 1}/${chapters.length}：${chapters[i].title}`;
      const text = await chapterText(chapters[i]);
      if (!text.trim()) { results.push({ title: chapters[i].title, summary: '（没有可提取的文字）' }); continue; }
      const ans = await aiCall(`用一句不超过 35 字的话概括这一章讲什么，只输出这句话：\n\n${text}`, { maxTokens: 100 });
      results.push({ title: chapters[i].title, summary: ans.replace(/^["「]|["」]$/g, '') });
    }
    wrap.remove();
    const list = el('ol', { class: 'ai-chapter-list' });
    results.forEach((r) => {
      const li = el('li');
      li.innerHTML = `<b>${escapeText(r.title)}</b><br>${escapeText(r.summary)}`;
      list.append(li);
    });
    const outWrap = el('div', { class: 'ai-msg-wrap' });
    const d = el('div', { class: 'ai-msg bot' });
    d.append(list);
    outWrap.append(d);
    box.append(outWrap);
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    wrap.remove();
    aiBubble('bot error', '章节摘要失败：' + e.message);
  } finally {
    aiChat.busy = false;
  }
}

async function organizeNotes() {
  if (!store.settings.aiKey) { toast('先在设置里填 AI 接口'); toggleSettings(true); return; }
  if (!state.current) { toast('先打开一个文件'); return; }
  const marks = store.marksOf(state.current.id).filter((m) => m.type !== 'bookmark' && (m.text || m.note));
  if (!marks.length) { toast('这个文件还没有高亮或笔记'); return; }
  const box = $('#ai-messages');
  box.querySelector('.ai-empty')?.remove();
  aiBubble('user', `把我做的 ${marks.length} 条标注整理成读书笔记`);
  const wrap = aiBubble('bot', '正在整理…');
  wrap.querySelector('.ai-msg').classList.add('thinking');
  try {
    const src = marks.slice(0, 40).map((m, i) => {
      const t = m.text ? `原文：「${m.text.slice(0, 160)}」` : '';
      const n = m.note ? ` 笔记：${m.note.slice(0, 200)}` : '';
      return `${i + 1}. ${t}${n}`;
    }).join('\n');
    const ans = await aiCall(
      `下面是我阅读时做的标注。请整理成结构化读书笔记：按主题分 2–4 组，每组一个标题和若干要点，保留关键原句，用 markdown 输出。\n\n${src}`,
      { maxTokens: 1500, temperature: 0.4 }
    );
    wrap.remove();
    aiBubble('bot', ans);
  } catch (e) {
    wrap.remove();
    aiBubble('bot error', '整理失败：' + e.message);
  }
}

async function termTable() {
  if (!store.settings.aiKey) { toast('先在设置里填 AI 接口'); toggleSettings(true); return; }
  if (!state.viewer) { toast('先打开一个文件'); return; }
  const box = $('#ai-messages');
  box.querySelector('.ai-empty')?.remove();
  aiBubble('user', '提取这份文档里的专业术语');
  const wrap = aiBubble('bot', '正在提取…');
  wrap.querySelector('.ai-msg').classList.add('thinking');
  try {
    const ctx = await getDocContext('near');
    const ans = await aiCall(
      `从下面的技术内容里提取 8–15 个专业术语、缩写或参数名，用 markdown 表格输出，两列：术语 | 中文解释。只输出表格，不要前后说明。\n\n${ctx}`,
      { maxTokens: 1200, temperature: 0.2 }
    );
    wrap.remove();
    aiBubble('bot', ans);
  } catch (e) {
    wrap.remove();
    aiBubble('bot error', '提取失败：' + e.message);
  }
}

/* ═════════════ 标签 ═════════════ */
const STOPWORDS = new Set(('的 了 是 在 我 你 他 她 它 我们 你们 他们 这 那 就 都 而 及 与 着 或 一个 一种 没有 可以 如果 因为 所以 但是 已经 这个 那个 什么 时候 这样 那样 不是 还是 只是 就是 以及 其中 通过 进行 对于 关于 由于 然后 现在 自己 他们 她们 它们 一样 一些 这些 那些 这里 那里 怎么 为什么 如何 也是 还有 不过 而且 并且 因此 于是 虽然 然而 或者 以为 觉得 知道 看到 听到 想要 需要 应该 可能 一定 非常 特别 十分 比较 更加 一直 总是 从来 曾经 正在 将要 起来 出来 过来 下去 上去 的话 方面 情况 问题 方法 过程 结果 原因 各种 有关 内容 部分 之间 之后 之前 以上 以下 左右 怎样 大家 东西 事情 地方 时间 人们').split(/\s+/));

function localTags(text, n = 6, boost = '') {
  const clean = (text || '').replace(/\s+/g, ' ').slice(0, 60000);
  if (!clean.trim()) return [];
  const boostSet = new Set();
  if (boost) {
    try {
      const bs = new Intl.Segmenter('zh-Hans', { granularity: 'word' });
      for (const x of bs.segment(boost)) if (x.isWordLike && x.segment.length >= 2) boostSet.add(x.segment);
    } catch { }
  }
  const counts = new Map();
  try {
    const seg = new Intl.Segmenter('zh-Hans', { granularity: 'word' });
    for (const s of seg.segment(clean)) {
      if (!s.isWordLike) continue;
      const w = s.segment.trim();
      if (w.length < 2 || w.length > 8) continue;
      if (STOPWORDS.has(w)) continue;
      if (/^[\d\p{P}\s]+$/u.test(w)) continue;
      counts.set(w, (counts.get(w) || 0) + (boostSet.has(w) ? 4 : 1));
    }
  } catch {
    const words = clean.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
    words.forEach((w) => { if (!STOPWORDS.has(w)) counts.set(w, (counts.get(w) || 0) + (boostSet.has(w) ? 4 : 1)); });
  }
  let arr = [...counts.entries()]
    .filter(([w, c]) => c >= 2)
    .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length));
  if (arr.length < 3) {
    arr = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length));
  }
  const picked = [];
  for (const [w] of arr) {
    if (picked.some((p) => p.includes(w) || w.includes(p))) continue;
    picked.push(w);
    if (picked.length >= n) break;
  }
  return picked;
}

async function getBookSample(book) {
  if (state.current && state.current.id === book.id && state.viewer && state.viewer.text) {
    const t = state.viewer.text();
    if (t && t.trim().length > 200) return t;
  }
  const kind = book.kind;
  if (['markdown', 'txt', 'html', 'rtf', 'code', 'csv'].includes(kind)) {
    const buf = await api.fetchArrayBuffer(book.path);
    return decodeText(buf).slice(0, 50000);
  }
  if (kind === 'pdf') {
    const lib = window.pdfjsLib || await window.loadPdfJs();
    const pdf = await lib.getDocument({ url: api.fileUrl(book.path) }).promise;
    let out = '';
    const max = Math.min(6, pdf.numPages);
    for (let i = 1; i <= max; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      out += tc.items.map((x) => x.str).join('') + '\n';
    }
    try { pdf.destroy(); } catch { }
    return out;
  }
  return '';
}

async function aiTags(book, text) {
  const s = store.settings;
  if (!s.aiKey) return null;
  const sample = (text || '').slice(0, 4000);
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: s.aiBase || 'https://api.deepseek.com',
      apiKey: s.aiKey,
      model: s.aiModel || 'deepseek-chat',
      maxTokens: 200,
      messages: [
        { role: 'system', content: '你是中文图书分类助手。只输出 JSON 字符串数组，不要解释。3-5 个标签，每个 2-5 个字，覆盖题材、主题或风格。' },
        { role: 'user', content: `书名：${book.name}\n\n摘录：\n${sample}` }
      ]
    })
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'AI 请求失败');
  const m = /\[[\s\S]*\]/.exec(j.content || '');
  const arr = JSON.parse(m ? m[0] : '[]');
  return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, 6) : [];
}

async function tagBook(book, useAI = false, opts = {}) {
  const card = document.querySelector(`.book-card[data-id="${CSS.escape(book.id)}"]`);
  card?.classList.add('busy');
  try {
    const text = await getBookSample(book);
    if (!text || text.trim().length < 60) {
      if (!opts.silent) toast('这本书提取不到足够的文字，先打开读一下再生成');
      return [];
    }
    let tags = null;
    if (useAI) {
      try { tags = await aiTags(book, text); }
      catch (e) { if (!opts.silent) toast('AI 标签失败，改用本地关键词：' + e.message, 3200); }
    }
    if (!tags || !tags.length) {
      const boost = [book.name.replace(/\.[^.]+$/, ''), ...((state.viewer && state.current && state.current.id === book.id && state.viewer.outline) || []).map((o) => o.title)].join(' ');
      tags = localTags(text, 6, boost);
    }
    book.tags = tags;
    store.saveShelf();
    if (!opts.silent) {
      renderShelf();
      toast(tags.length ? '标签：' + tags.join(' · ') : '没能提取出标签');
    }
    return tags;
  } catch (e) {
    if (!opts.silent) toast('生成标签失败：' + e.message, 3200);
    return [];
  } finally {
    card?.classList.remove('busy');
  }
}

let batchRunning = false;
async function batchTag() {
  if (batchRunning) return;
  if (!store.settings.aiKey) { toast('批量打标签需要先在设置里填写 AI 接口'); toggleSettings(true); return; }
  const targets = store.books.filter((b) => !(b.tags && b.tags.length));
  if (!targets.length) { toast('每本书都有标签了'); return; }
  batchRunning = true;
  const bar = $('#batch-bar');
  bar.hidden = false;
  let ok = 0, fail = 0;
  for (let i = 0; i < targets.length; i++) {
    $('#batch-text').textContent = `AI 生成标签 ${i + 1}/${targets.length} · ${targets[i].name}`;
    $('#batch-fill').style.width = (i / targets.length * 100) + '%';
    const tags = await tagBook(targets[i], true, { silent: true });
    if (tags && tags.length) ok++; else fail++;
    renderShelf();
    await new Promise((r) => setTimeout(r, 250));
  }
  $('#batch-fill').style.width = '100%';
  $('#batch-text').textContent = `完成：${ok} 本成功${fail ? `，${fail} 本跳过` : ''}`;
  batchRunning = false;
  setTimeout(() => { bar.hidden = true; $('#batch-fill').style.width = '0'; }, 2400);
}

async function aiTranslateText(text, to) {
  const s = store.settings;
  if (!s.aiKey) throw new Error('还没有填写 AI 接口');
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: s.aiBase || 'https://api.deepseek.com',
      apiKey: s.aiKey,
      model: s.aiModel || 'deepseek-chat',
      temperature: 0.2,
      maxTokens: 2000,
      messages: [
        { role: 'system', content: '你是专业翻译。只输出译文，不要解释、不要加引号，保持原有段落换行。' },
        { role: 'user', content: `把下面内容翻译成${LANG_NAME[to] || to}：\n\n${text}` }
      ]
    })
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'AI 翻译失败');
  return (j.content || '').trim();
}

/* ═════════════ 实时翻译（滚动到哪翻到哪） ═════════════ */
function detectLangText(t) {
  const total = (t || '').replace(/\s/g, '').length || 1;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const kana = (t.match(/[\u3040-\u30ff]/g) || []).length;
  const hangul = (t.match(/[\uac00-\ud7af]/g) || []).length;
  if (kana / total > 0.04) return 'ja-JP';
  if (hangul / total > 0.04) return 'ko-KR';
  if (cjk / total > 0.18) return 'zh-CN';
  return 'en-US';
}
const hashText = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + s.length.toString(36);
};

const liveTrans = {
  on: false,
  mode: 'bilingual',
  target: 'zh-CN',
  io: null,
  queue: [],
  active: 0,
  concurrency: 3,
  cache: new Map(),
  _cacheKey: '',
  _saveTimer: null,
  count: 0,

  cacheLoad(lang) {
    this._cacheKey = 'folio:tr:' + lang;
    this.cache = new Map();
    try {
      const raw = localStorage.getItem(this._cacheKey);
      if (raw) {
        const obj = JSON.parse(raw);
        Object.keys(obj).forEach((k) => this.cache.set(k, obj[k]));
      }
    } catch { }
  },
  cacheSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        const obj = {};
        let i = 0;
        for (const [k, v] of this.cache) { obj[k] = v; if (++i > 4000) break; }
        localStorage.setItem(this._cacheKey, JSON.stringify(obj));
      } catch { }
    }, 1200);
  },

  start(mode) {
    if (!state.viewer) { toast('先打开一本书'); return; }
    if (mode) this.mode = mode;
    this.target = $('#trans-to').value || 'zh-CN';
    this.stop(true);
    this.on = true;
    this.count = 0;
    this.cacheLoad(this.target);
    $('#live-trans-on').checked = true;
    $('#doc').classList.toggle('tr-only', this.mode === 'only');
    this.scan();
    toast('实时翻译已开启：滚动到哪里就翻到哪里' + (store.settings.aiKey ? '' : '（免费通道，额度有限）'));
  },

  stop(silent) {
    this.on = false;
    if (this.io) { this.io.disconnect(); this.io = null; }
    this.queue = [];
    if (!silent) {
      $('#live-trans-on').checked = false;
      $('#doc').classList.remove('tr-only');
      this.clear();
      toast('已关闭实时翻译');
    }
  },

  clear() {
    $$('#doc .tr-block, #doc .pdf-trans').forEach((n) => n.remove());
    $$('#doc [data-tr]').forEach((n) => delete n.dataset.tr);
  },

  scan() {
    const doc = $('#doc');
    if (!doc) return;
    const viewer = state.viewer;
    if (viewer && viewer.kind === 'pdf') { this.scanPdf(); return; }

    const blocks = $$('.prose p, .prose h1, .prose h2, .prose h3, .prose h4, .prose blockquote p', doc)
      .filter((el) => !el.closest('.tr-block') && !el.closest('li') && (el.textContent || '').trim().length > 2);
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        this.enqueue(e.target);
      }
    }, { root: doc, rootMargin: '500px 0px 700px 0px' });
    blocks.forEach((b) => this.io.observe(b));
    // 首屏立即排一批
    blocks.slice(0, 6).forEach((b) => this.enqueue(b));
  },

  scanPdf() {
    const doc = $('#doc');
    const pages = $$('.pdf-page', doc);
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        this.enqueuePage(e.target);
      }
    }, { root: doc, rootMargin: '200px 0px 300px 0px' });
    pages.forEach((p) => this.io.observe(p));
  },

  enqueue(el) {
    if (!this.on) return;
    if (el.dataset.tr === '1' || el.dataset.trQueued === '1') return;
    const text = (el.textContent || '').trim();
    if (!text || text.length < 2) return;
    el.dataset.trQueued = '1';
    this.queue.push({ el, text });
    this.pump();
  },

  enqueuePage(pageEl) {
    if (!this.on || !state.viewer || state.viewer.kind !== 'pdf') return;
    if (pageEl.dataset.tr === '1' || pageEl.dataset.trQueued === '1') return;
    pageEl.dataset.trQueued = '1';
    this.queue.push({ pageEl, page: Number(pageEl.dataset.page) });
    this.pump();
  },

  pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      this.run(job).finally(() => { this.active--; this.pump(); });
    }
  },

  async run(job) {
    try {
      if (job.pageEl) {
        const txt = await state.viewer.pageText(job.page);
        const clean = (txt || '').replace(/\s+/g, ' ').trim();
        if (!clean) { job.pageEl.dataset.tr = '1'; return; }
        const out = await this.translateText(clean);
        this.insertPage(job.pageEl, out);
        job.pageEl.dataset.tr = '1';
        return;
      }
      const out = await this.translateText(job.text);
      this.insert(job.el, out);
      job.el.dataset.tr = '1';
    } catch (e) {
      const node = job.el ? job.el : null;
      if (node && !node.dataset.tr) {
        const d = document.createElement('div');
        d.className = 'tr-block tr-error';
        d.textContent = '（这一段翻译失败：' + (e.message || '网络问题') + '）';
        node.after(d);
      }
    } finally {
      if (job.el) delete job.el.dataset.trQueued;
      if (job.pageEl) delete job.pageEl.dataset.trQueued;
    }
  },

  async translateText(text) {
    const key = hashText(text);
    if (this.cache.has(key)) return this.cache.get(key);
    let out;
    if (store.settings.aiKey) {
      out = await aiTranslateText(text, this.target);
    } else {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, to: this.target })
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || '翻译失败');
      out = j.translated;
    }
    this.cache.set(key, out);
    this.cacheSave();
    this.count++;
    $('#live-hint').textContent = `已翻译 ${this.count} 段 · 结果会记住，重开这本书不用再翻。`;
    return out;
  },

  insert(el, text) {
    if (!text || !el.parentElement) return;
    if (el.nextElementSibling && el.nextElementSibling.classList.contains('tr-block')) return;
    const d = document.createElement('div');
    d.className = 'tr-block';
    d.textContent = text;
    el.after(d);
  },

  insertPage(pageEl, text) {
    if (!text) return;
    if (pageEl.nextElementSibling && pageEl.nextElementSibling.classList.contains('pdf-trans')) return;
    const d = document.createElement('div');
    d.className = 'pdf-trans';
    d.innerHTML = '<span class="pt-label">本页译文 · AI</span>';
    d.append(document.createTextNode(text));
    pageEl.after(d);
  },

  setMode(mode) {
    if (mode === 'only' && !document.querySelector('#doc .tr-block, #doc .pdf-trans')) {
      if (!this.on) {
        toast('先开启实时翻译，再切到只看译文');
        $$('#live-trans-mode button').forEach((x) => x.classList.toggle('active', x.dataset.mode === 'bilingual'));
        return;
      }
    }
    this.mode = mode;
    $('#doc')?.classList.toggle('tr-only', mode === 'only');
  }
};

function maybePromptTranslate(text) {
  const banner = $('#trans-banner');
  banner.hidden = true;
  if (!store.settings.autoTransPrompt) return;
  if (!text) return;
  const sample = String(text).slice(0, 1500);
  if (sample.trim().length < 80) return;
  const lang = detectLangText(sample);
  if (lang.startsWith('zh')) return;
  if (lang !== 'en-US' && lang !== 'ja-JP' && lang !== 'ko-KR') return;
  $('#trans-banner-text').textContent = `检测到${LANG_NAME[lang] || '外文'}内容，要实时翻译吗？`;
  banner.hidden = false;
  banner.dataset.lang = lang;
  clearTimeout(state._bannerTimer);
  state._bannerTimer = setTimeout(() => { banner.hidden = true; }, 12000);
}

/* ═════════════ 标注 ═════════════ */
/* ═════════════ 侧栏笔记（箭头指向所在段落） ═════════════ */
/* 编辑一条已有的笔记 */
function openNoteEditor(m) {
  const modal = $('#note-modal');
  $('#note-quote').textContent = (m.text || '').slice(0, 260);
  $('#note-text').value = m.note || '';
  modal.hidden = false;
  modal.dataset.quote = m.text || '';
  modal._range = null;
  modal._editing = m;
  setTimeout(() => $('#note-text').focus(), 60);
}

/* 笔记卡片上的 AI 菜单 */
/* 单条笔记的连线样式：有些笔记标的是一句话，直线会横穿半行字，这条可以单独换 */
function showNoteLineMenu(card, m, anchorBtn) {
  document.querySelectorAll('.nf-ai-menu').forEach((x) => x.remove());
  const menu = el('div', { class: 'nf-ai-menu' });
  const cur = m.lineStyle || store.settings.noteArrowStyle || 'curve';
  const opts = [
    ['curve', '弯曲线（绕开文字）'],
    ['line', '直线（穿过去）'],
    ['step', '折线'],
    ['none', '这条不画线']
  ];
  opts.forEach(([v, label]) => {
    const b = el('button', { text: (cur === v ? '✓ ' : '') + label });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      store.updateMark(state.current.id, m.id, { lineStyle: v });
      m.lineStyle = v;
      renderNoteAnchors(true);
      toast(v === 'none' ? '这条笔记不再画线' : '这条笔记的连线已换');
    });
    menu.append(b);
  });
  const r = anchorBtn.getBoundingClientRect();
  menu.style.left = Math.min(window.innerWidth - 150, Math.round(r.left)) + 'px';
  menu.style.top = Math.round(r.bottom + 4) + 'px';
  document.body.append(menu);
  setTimeout(() => {
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    document.addEventListener('mousedown', close);
  }, 10);
}

function showNoteAiMenu(card, m, anchorBtn) {
  document.querySelectorAll('.nf-ai-menu').forEach((x) => x.remove());
  const menu = el('div', { class: 'nf-ai-menu' });
  const acts = [
    ['expand', '展开成一段'],
    ['polish', '润色这条笔记'],
    ['connect', '和正文连起来想'],
    ['question', '基于这条提问'],
    ['summarize', '浓缩成一句']
  ];
  acts.forEach(([k, label]) => {
    const b = el('button', { text: label });
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.remove();
      await runNoteAi(card, m, k);
    });
    menu.append(b);
  });
  const r = anchorBtn.getBoundingClientRect();
  menu.style.left = Math.round(r.left) + 'px';
  menu.style.top = Math.round(r.bottom + 4) + 'px';
  document.body.append(menu);
  setTimeout(() => {
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    document.addEventListener('mousedown', close);
  }, 10);
}

/* 对一条笔记跑 AI，结果显示在卡片里的展开区 */
async function runNoteAi(card, m, kind) {
  const box = card.querySelector('.nf-ai');
  box.hidden = false;
  box.textContent = 'AI 正在想…';
  const promptMap = {
    expand: `把这条读书笔记展开成一段 120 字左右的文字，保持第一人称，不要空话。\n摘录：${m.text}\n笔记：${m.note}`,
    polish: `把这条笔记润色得更清楚、更有信息量，长度相近。只输出润色后的笔记本身。\n笔记：${m.note}`,
    connect: `结合下面这段原文，说说这条笔记和作者观点之间的关系（可以指出补充、反驳或延伸），100 字内。\n原文：${m.text}\n我的笔记：${m.note}`,
    question: `基于这段原文和我的笔记，提 3 个值得继续追问的问题，每条一行。\n原文：${m.text}\n笔记：${m.note}`,
    summarize: `把这条笔记浓缩成一句不超过 20 字的话，只输出这句话。\n笔记：${m.note}`
  };
  try {
    const out = await aiCall(promptMap[kind] || m.note, { temperature: 0.5 });
    box.innerHTML = '';
    const txt = el('div', { class: 'nf-ai-text', text: out.trim() });
    const row = el('div', { class: 'nf-ai-row' });
    const save = el('button', { class: 'btn tiny ghost', text: '存进笔记' });
    save.addEventListener('click', (e) => {
      e.stopPropagation();
      const patch = kind === 'summarize' ? out.trim() : (m.note + '\n\n' + out.trim());
      store.updateMark(state.current.id, m.id, { note: patch });
      refreshMarks();
      toast('已存进笔记');
    });
    const mk = el('button', { class: 'btn tiny ghost', text: '做成导图' });
    mk.addEventListener('click', (e) => { e.stopPropagation(); mmFromText(out.trim(), '笔记导图'); });
    const close = el('button', { class: 'btn tiny ghost', text: '收起' });
    close.addEventListener('click', (e) => { e.stopPropagation(); box.hidden = true; });
    row.append(save, mk, close);
    box.append(txt, row);
  } catch (e) {
    box.textContent = 'AI 失败：' + (e.message || e);
  }
}

/* 用任意文本生成导图（笔记、AI 结果都能用） */
async function mmFromText(text, title) {
  const modal = $('#mm-modal');
  const canvas = $('#mm-canvas');
  $('#mm-title').textContent = (title || '导图') + ' · 思维导图';
  canvas.innerHTML = '<div class="mm-empty">正在梳理…</div>';
  modal.hidden = false;
  mm.scale = 1; mm.tx = 0; mm.ty = 0;
  const prompt = `把下面的内容整理成思维导图大纲。
规则：
1. 第一行用「# 主题」写中心主题，不超过 14 字
2. 用 ## ### #### 表示层级，最多 4 层
3. 每个节点不超过 16 字，用内容里的具体词
4. 只输出大纲，不要解释

内容：
${text}`;
  try {
    const outline = await aiCall(prompt, { temperature: 0.3, maxTokens: 1200 });
    const tree = parseOutline(outline);
    if (!tree) { canvas.innerHTML = '<div class="mm-empty">没能提炼出结构</div>'; return; }
    mm.root = tree;
    renderMindMap(tree);
  } catch (e) {
    canvas.innerHTML = '<div class="mm-empty">生成失败：' + escapeText(String(e.message || e)) + '</div>';
  }
}

function findParagraphOf(text) {
  const doc = $('#doc');
  if (!doc || !text) return null;
  const norm = (s) => (s || '').replace(/\s+/g, '');
  const full = norm(text);
  if (full.length < 2) return null;
  // 选「包含这段文字、且自身最短」的元素：PDF 文本层一段会被切成很多 span，
  // 只按长前缀匹配会跳过 span 落在大容器上，卡片就会飘。
  const cands = doc.querySelectorAll('p, li, h1, h2, h3, h4, td, blockquote, pre, .textLayer span');
  for (const len of [12, 8, 5, 3]) {
    const probe = full.slice(0, len);
    if (probe.length < 2) break;
    let best = null, bestLen = Infinity;
    for (const el2 of cands) {
      const body = norm(el2.textContent);
      if (!body.includes(probe)) continue;
      if (body.length < bestLen) { bestLen = body.length; best = el2; }
      if (best === el2 && bestLen === probe.length) break;
    }
    if (best) return best;
  }
  // 兜底：任何包含这段文字的小块
  for (const el2 of doc.querySelectorAll('*')) {
    if (el2.children.length > 6) continue;
    const body = norm(el2.textContent);
    if (body.includes(full.slice(0, 6))) return el2;
  }
  return null;
}

/* ═════════════ 笔记锚点：卡片与虚线箭头钉在正文上，随内容滚动 ═════════════ */

/* 找到一条笔记要挂靠的位置：优先它自己的高亮文字，其次整段 */
function noteAnchorOf(mark) {
  const doc = $('#doc');
  if (!doc || !mark) return null;
  if (mark.id) {
    const hit = doc.querySelector('.hl-mark[data-mid="' + mark.id + '"]');
    if (hit) return { el: hit, exact: true };
  }
  const para = findParagraphOf(mark.text || '');
  return para ? { el: para, exact: false } : null;
}

/* 笔记层放进 #doc 里：卡片从此属于正文内容，滚动时天然跟着文字走 */
function noteLayerInDoc(doc) {
  let layer = document.getElementById('note-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'note-layer';
    layer.className = 'note-layer';
  }
  if (layer.parentElement !== doc) doc.append(layer);
  return layer;
}

/* 把若干点连成平滑曲线（Catmull-Rom 转三次贝塞尔） */
function smoothPathD(pts) {
  if (!pts || pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/* 拖线上的任意一个小圆点，把这条线捏成任意形状（存进 mark.linePts） */
function startPtDrag(ev, box, idx, base, def, path, hit, handles, head, drawHead, baseS, baseT) {
  ev.preventDefault();
  ev.stopPropagation();
  const doc = $('#doc');
  if (!doc) return;
  const dr = doc.getBoundingClientRect();
  const zoom = state.zoom || 1;
  const n = base.length;

  // 中间点统一记成「相对首尾等分位置的偏移」，拖动与松手重建用同一套算法，才不会跳
  const offsets = [];
  for (let i = 1; i < n - 1; i++) {
    const t = i / (n - 1);
    const px = base[0][0] + (base[n - 1][0] - base[0][0]) * t;
    const py = base[0][1] + (base[n - 1][1] - base[0][1]) * t;
    offsets.push([base[i][0] - px, base[i][1] - py]);
  }

  const syncMid = () => {
    for (let i = 1; i < n - 1; i++) {
      const t = i / (n - 1);
      base[i] = [
        base[0][0] + (base[n - 1][0] - base[0][0]) * t + offsets[i - 1][0],
        base[0][1] + (base[n - 1][1] - base[0][1]) * t + offsets[i - 1][1]
      ];
      if (handles[i]) {
        handles[i].setAttribute('cx', base[i][0]);
        handles[i].setAttribute('cy', base[i][1]);
      }
    }
  };

  const redraw = () => {
    const d = smoothPathD(base);
    path.setAttribute('d', d);
    hit.setAttribute('d', d);
    if (drawHead) {
      drawHead(base[n - 2][0], base[n - 2][1], base[n - 1][0], base[n - 1][1]);
    }
  };

  const move = (e) => {
    const cx = (e.clientX - dr.left) / zoom + doc.scrollLeft;
    const cy = (e.clientY - dr.top) / zoom + doc.scrollTop;
    base[idx] = [cx, cy];
    if (handles[idx]) {
      handles[idx].setAttribute('cx', cx);
      handles[idx].setAttribute('cy', cy);
    }
    if (idx === 0 || idx === n - 1) {
      syncMid();                       // 拖端点：中间点跟着新首尾走
    } else {
      const t = idx / (n - 1);
      offsets[idx - 1] = [
        cx - (base[0][0] + (base[n - 1][0] - base[0][0]) * t),
        cy - (base[0][1] + (base[n - 1][1] - base[0][1]) * t)
      ];
    }
    redraw();
  };

  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    const midPts = offsets.map((o) => ({ dx: Math.round(o[0] * 10) / 10, dy: Math.round(o[1] * 10) / 10 }));
    const patch = { linePts: midPts };
    if (baseS) {
      patch.lineStart = { dx: Math.round((base[0][0] - baseS[0]) * 10) / 10, dy: Math.round((base[0][1] - baseS[1]) * 10) / 10 };
    }
    if (baseT) {
      patch.lineEnd = { dx: Math.round((base[n - 1][0] - baseT[0]) * 10) / 10, dy: Math.round((base[n - 1][1] - baseT[1]) * 10) / 10 };
    }
    store.updateMark(state.current.id, box.item.id, patch);
    box.item.linePts = midPts;
    if (patch.lineStart) box.item.lineStart = patch.lineStart;
    if (patch.lineEnd) box.item.lineEnd = patch.lineEnd;
    renderNoteAnchors(true);
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
}

/* 拖完卡片后问一句：确认还是放回原处 */
function showCardConfirm(card, item, dx, dy) {
  card.querySelectorAll('.nf-confirm').forEach((n) => n.remove());
  const bar = el('div', { class: 'nf-confirm' });
  const ok = el('button', { class: 'ok', text: '✓', title: '就放这里' });
  const no = el('button', { class: 'no', text: '✕', title: '回到原来的位置' });
  const done = (save) => {
    bar.remove();
    if (save) {
      const pos = { dx: Math.round(dx), dy: Math.round(dy) };
      store.updateMark(state.current.id, item.id, { cardPos: pos });
      item.cardPos = pos;
      toast('这条笔记的位置已确认');
    } else {
      toast('已放回原来的位置');
    }
    renderNoteAnchors(true);
  };
  ok.addEventListener('click', (e) => { e.stopPropagation(); done(true); });
  no.addEventListener('click', (e) => { e.stopPropagation(); done(false); });
  bar.append(ok, no);
  card.append(bar);
}

function renderNoteAnchors(force) {
  const doc = $('#doc');
  if (!doc) return;
  const layer = noteLayerInDoc(doc);
  const notes = (state.notes || []).filter((m) => m.note && m.note.trim());

  // 正在划选文字时不重建卡片：重建 DOM 会打断选区，选区高亮就会闪
  if (!force) {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount && doc.contains(sel.anchorNode)) {
      clearTimeout(renderNoteAnchors._st);
      renderNoteAnchors._st = setTimeout(() => renderNoteAnchors(), 500);
      return;
    }
  }

  const docRect = doc.getBoundingClientRect();
  const zoom = state.zoom || 1;

  // 滚动只挪了一点时不重建（避免闪）；跨过半屏、笔记变了、宽度变了才重算
  const bucket = Math.round(doc.scrollTop / Math.max(80, (docRect.height / zoom) * 0.55));
  const key = [
    state.current && state.current.id,
    Math.round(docRect.width / zoom),
    bucket,
    notes.map((m) => m.id).join(',')
  ].join('|');
  if (!force && renderNoteAnchors._key === key && layer.childElementCount) return;
  renderNoteAnchors._key = key;

  layer.innerHTML = '';
  if (!notes.length) return;

  const color = store.settings.noteColor || '#d04a35';
  document.documentElement.style.setProperty('--note-line', color);

  // CSS zoom 会把 rect 一起放大，这里换算回文档坐标
  const px = (v) => v / zoom;
  const localX = (v) => px(v - docRect.left) + doc.scrollLeft;
  const localY = (v) => px(v - docRect.top) + doc.scrollTop;

  const paper = doc.querySelector('.paper-sheet') || doc.querySelector('.prose') || doc;
  const pRect = paper.getBoundingClientRect();
  const paperL = localX(pRect.left);
  const paperR = localX(pRect.right);
  const docW = px(docRect.width);

  const baseW = Math.max(130, Math.min(320, Number(store.settings.noteW) || 176));
  const gap = Math.max(8, Math.min(200, Number(store.settings.noteGap) || 34));
  const edge = 12;

  const defaultLine = store.settings.noteArrowStyle || 'curve';
  const boxes = [];
  const slots = { left: [], right: [] };

  notes.forEach((item, idx) => {
    const anchor = noteAnchorOf(item);
    if (!anchor) return;
    const aRect = anchor.el.getBoundingClientRect();
    // 精确到「划选的那一行」：mark 跨行时 getClientRects 给出每行矩形，用第一行
    let lineRect = aRect;
    try {
      const rs = anchor.el.getClientRects && anchor.el.getClientRects();
      if (rs && rs.length) lineRect = rs[0];
    } catch { }
    const lx1 = localX(lineRect.left);
    const lx2 = localX(lineRect.right);
    const ly1 = localY(lineRect.top);
    const lh = px(lineRect.height);

    // 只画视口附近的笔记，且每侧最多 4 张：笔记一多，全部铺开会糊成一片
    const viewH = px(docRect.height);
    if (ly1 < doc.scrollTop - viewH * 0.5 || ly1 > doc.scrollTop + viewH * 1.3) return;

    // 卡片放哪一侧按所在段落判断；箭头只认文字位置，不再指到段落边缘
    const blockEl = anchor.el.closest('p, li, h1, h2, h3, h4, blockquote, td, pre, .pdf-page') || anchor.el;
    const bRect = blockEl.getBoundingClientRect();
    const bx1 = localX(bRect.left);
    const bx2 = localX(bRect.right);

    // 卡片两侧都放不下时，这条笔记这次就不显示（宁可不显示，也不压正文）
    const ownW = Math.max(130, Math.min(420, Number(item.cardSize && item.cardSize.w) || baseW));
    const roomR = docW - bx2 - edge >= Math.min(baseW, ownW) + 12;
    const roomL = bx1 - edge >= Math.min(baseW, ownW) + 12;
    if (!roomR && !roomL) return;
    const side = (roomR && roomL)
      ? (idx % 2 === 1 ? 'left' : 'right')
      : (roomR ? 'right' : 'left');
    const cardWidth = ownW;
    let x = side === 'right'
      ? Math.min(docW - cardWidth - edge, bx2 + gap)
      : Math.max(edge, bx1 - gap - cardWidth);

    // 每侧最多 4 张，超出的这次不显示（侧栏列表里仍然都在）
    if (slots[side].length >= 4) return;

    // 卡片顶部对齐这一行（略高 12px），多张重叠时往下让
    let y = Math.max(2, ly1 - 12);
    const slot = slots[side];
    let guard = 0;
    // 卡片高约 100，间隔留够，别叠在一起
    while (slot.some((v) => Math.abs(v - y) < 112) && guard < 40) { y += 104; guard++; }
    slot.push(y);

    // 手动拖过位置的笔记：按相对默认位置的偏移放
    if (item.cardPos) {
      x = Math.max(8, Math.min(docW - cardWidth - 8, x + (Number(item.cardPos.dx) || 0)));
      y = Math.max(2, y + (Number(item.cardPos.dy) || 0));
    }

    const card = el('div', { class: 'note-float ' + side });
    card.style.width = Math.round(cardWidth) + 'px';
    card.style.left = Math.round(x) + 'px';
    card.style.top = Math.round(y) + 'px';
    card.dataset.mid = item.id || '';
    if (item.cardSize && item.cardSize.h) card.style.height = Math.round(Number(item.cardSize.h)) + 'px';
    card.innerHTML = `
      <div class="nf-quote">${escapeText((item.text || '').slice(0, 22))}</div>
      <div class="nf-body">${escapeText(item.note.trim())}</div>
      <div class="nf-acts">
        <button data-a="edit" title="编辑这条笔记">✎</button>
        <button data-a="line" title="单独调这条笔记的连线">⌁</button>
        <button data-a="ai" title="用 AI 处理这条笔记">AI</button>
        <button data-a="map" title="把这条笔记画成导图">◈</button>
        <button data-a="del" title="删除">×</button>
      </div>
      <div class="nf-ai" hidden></div>`;

    // 右下角手柄：按住拖就能改这张卡片的大小
    const grip = el('div', { class: 'nf-grip', title: '拖这里改大小' });
    card.append(grip);
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const w0 = card.offsetWidth;
      const h0 = card.offsetHeight;
      const x0 = e.clientX;
      const y0 = e.clientY;
      const move = (ev) => {
        const w1 = Math.max(120, Math.min(440, w0 + (ev.clientX - x0) / zoom));
        const h1 = Math.max(46, Math.min(640, h0 + (ev.clientY - y0) / zoom));
        card.style.width = Math.round(w1) + 'px';
        card.style.height = Math.round(h1) + 'px';
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        const size = { w: Math.round(card.offsetWidth), h: Math.round(card.offsetHeight) };
        store.updateMark(state.current.id, item.id, { cardSize: size });
        item.cardSize = size;
        renderNoteAnchors(true);
        toast('这张卡片的大小记住了');
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });

    // 按住卡片可以拖到任意位置，松手后出现 ✓ / ✕
    let drag = null;
    card.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target.closest && e.target.closest('button'))) return;
      drag = {
        x0: e.clientX, y0: e.clientY,
        l0: parseFloat(card.style.left) || x,
        t0: parseFloat(card.style.top) || y,
        moved: false
      };
      try { card.setPointerCapture(e.pointerId); } catch { }
    });
    card.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const ddx = (e.clientX - drag.x0) / zoom;
      const ddy = (e.clientY - drag.y0) / zoom;
      if (!drag.moved && Math.abs(ddx) < 4 && Math.abs(ddy) < 4) return;
      drag.moved = true;
      card.classList.add('dragging');
      card.style.left = Math.round(drag.l0 + ddx) + 'px';
      card.style.top = Math.round(drag.t0 + ddy) + 'px';
    });
    card.addEventListener('pointerup', () => {
      if (!drag) return;
      const wasMoved = drag.moved;
      drag = null;
      card.classList.remove('dragging');
      if (!wasMoved) return;
      card._skipClick = true;
      setTimeout(() => { card._skipClick = false; }, 350);
      // 拖到页面外时拉回来
      const nl = Math.max(8, Math.min(docW - cardWidth - 8, parseFloat(card.style.left) || x));
      const nt = Math.max(2, parseFloat(card.style.top) || y);
      card.style.left = Math.round(nl) + 'px';
      card.style.top = Math.round(nt) + 'px';
      showCardConfirm(card, item, nl - x, nt - y);
    });

    card.addEventListener('click', async (e) => {
      if (card._skipClick) return;
      const btn = e.target.closest('.nf-acts button');
      if (btn) {
        e.stopPropagation();
        const act = btn.dataset.a;
        if (act === 'del') {
          store.removeMark(state.current.id, item.id);
          removeHighlightByText(item.text);
          refreshMarks();
          toast('已删除这条笔记');
          return;
        }
        if (act === 'edit') { openNoteEditor(item); return; }
        if (act === 'line') { showNoteLineMenu(card, item, btn); return; }
        if (act === 'map') {
          mmFromText(`【摘录】${item.text || ''}\n【笔记】${item.note || ''}`, (item.note || '笔记').slice(0, 14));
          return;
        }
        if (act === 'ai') { showNoteAiMenu(card, item, btn); return; }
      }
      try { anchor.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { }
      anchor.el.classList.add('note-flash');
      setTimeout(() => anchor.el.classList.remove('note-flash'), 1200);
    });

    layer.append(card);
    boxes.push({
      card, side, x, y, cardWidth, lx1, lx2, ly1, lh, bx1, bx2, item,
      style: item.lineStyle || defaultLine,
      bend: Number(item.curveBend) || 0
    });
  });

  if (!boxes.length) return;

  // 连线：虚线 + 末端实心箭头，箭头尖落在被标注的文字上
  // 样式按笔记取：单条改过就用单条的，没改过才用全局默认
  if (boxes.some((b) => b.style !== 'none')) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'note-svg');
    const H = Math.max(px(docRect.height), doc.scrollHeight, 1);
    svg.setAttribute('width', Math.round(docW));
    svg.setAttribute('height', Math.round(H));
    svg.setAttribute('viewBox', `0 0 ${Math.round(docW)} ${Math.round(H)}`);
    layer.append(svg);

    boxes.forEach((b) => {
      if (b.style === 'none') return;
      const ch = b.card.offsetHeight || 60;
      // 起点跟着卡片走；首尾都可以拖（改长度/改落点）
      const baseS = [b.side === 'right' ? b.x : b.x + b.cardWidth, b.y + Math.min(ch / 2, 26)];
      const baseT = [b.side === 'right' ? b.lx2 - 2 : b.lx1 + 2, b.ly1 + Math.min(b.lh * 0.45, 14)];
      const oS = b.item.lineStart || null;
      const oT = b.item.lineEnd || null;
      const S = [baseS[0] + (Number(oS && oS.dx) || 0), baseS[1] + (Number(oS && oS.dy) || 0)];
      const T = [baseT[0] + (Number(oT && oT.dx) || 0), baseT[1] + (Number(oT && oT.dy) || 0)];

      const savedPts = Array.isArray(b.item.linePts) ? b.item.linePts : null;
      const nMid = savedPts && savedPts.length ? savedPts.length : 3;
      const def = [S];
      const base = [S];
      for (let i = 1; i <= nMid; i++) {
        const t = i / (nMid + 1);
        const px0 = S[0] + (T[0] - S[0]) * t;
        const py0 = S[1] + (T[1] - S[1]) * t;
        def.push([px0, py0]);
        const o = savedPts ? savedPts[i - 1] : (i === Math.ceil(nMid / 2) && b.bend ? { dx: 0, dy: b.bend } : null);
        base.push(o ? [px0 + (Number(o.dx) || 0), py0 + (Number(o.dy) || 0)] : [px0, py0]);
      }
      def.push(T);
      base.push(T);

      let d;
      if (b.style === 'line') d = `M ${S[0]} ${S[1]} L ${T[0]} ${T[1]}`;
      else if (b.style === 'step') {
        const elbow = T[0] - (b.side === 'right' ? -18 : 18);
        d = `M ${S[0]} ${S[1]} H ${elbow} V ${T[1]} H ${T[0]}`;
      } else {
        d = smoothPathD(base);
      }

      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'nline');
      svg.append(path);

      const hit = document.createElementNS(NS, 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('class', 'nhit');
      hit.dataset.mid = b.item.id || '';
      svg.append(hit);

      // 箭头（跟着最后一个节点的位置和方向）
      const head = document.createElementNS(NS, 'polygon');
      head.setAttribute('class', 'nhead');
      const drawHead = (bx0, by0, tipX, tipY) => {
        const ang = Math.atan2(tipY - by0, tipX - bx0);
        const L = 9, W = 4.6;
        const bx = tipX - Math.cos(ang) * L;
        const by = tipY - Math.sin(ang) * L;
        const nx = -Math.sin(ang) * W;
        const ny = Math.cos(ang) * W;
        head.setAttribute('points', `${tipX.toFixed(1)},${tipY.toFixed(1)} ${(bx + nx).toFixed(1)},${(by + ny).toFixed(1)} ${(bx - nx).toFixed(1)},${(by - ny).toFixed(1)}`);
      };
      drawHead(base[base.length - 2][0], base[base.length - 2][1], T[0], T[1]);
      svg.append(head);

      if (b.style === 'curve') {
        const handles = [];
        const show = state.bendEditing === b.item.id;
        for (let i = 0; i < base.length; i++) {
          const h = document.createElementNS(NS, 'circle');
          h.setAttribute('cx', base[i][0]);
          h.setAttribute('cy', base[i][1]);
          h.setAttribute('r', i === 0 || i === base.length - 1 ? 4.5 : 4);
          h.setAttribute('class', 'nhandle' + (i === 0 ? ' nstart' : i === base.length - 1 ? ' ntip' : ''));
          h.dataset.mid = b.item.id || '';
          h.style.display = show ? '' : 'none';
          h.addEventListener('pointerdown', (ev) => startPtDrag(ev, b, i, base, def, path, hit, handles, head, drawHead, baseS, baseT));
          h.addEventListener('dblclick', (ev) => {
            ev.stopPropagation();
            if (i === 0 || i === base.length - 1) return;
            const kept = base.filter((_, k) => k !== i);
            const pts = kept.slice(1, -1).map((p, k) => ({
              dx: Math.round(p[0] - (S[0] + (T[0] - S[0]) * ((k + 1) / (kept.length - 1)))),
              dy: Math.round(p[1] - (S[1] + (T[1] - S[1]) * ((k + 1) / (kept.length - 1))))
            }));
            store.updateMark(state.current.id, b.item.id, { linePts: pts });
            b.item.linePts = pts;
            renderNoteAnchors(true);
            toast('已删掉这个节点');
          });
          svg.append(h);
          handles.push(h);
        }

        hit.addEventListener('click', (ev) => {
          ev.stopPropagation();
          state.bendEditing = b.item.id;
          handles.forEach((h) => { h.style.display = ''; });
          toast('线上的点都能拖；双击线可以加一个点，双击点上可删掉');
        });

        // 双击线：在最近的那一段里插一个节点
        hit.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          const dr0 = doc.getBoundingClientRect();
          const z = state.zoom || 1;
          const cx = (ev.clientX - dr0.left) / z + doc.scrollLeft;
          const cy = (ev.clientY - dr0.top) / z + doc.scrollTop;
          let bestI = 0, bestD = Infinity;
          for (let i = 0; i < base.length - 1; i++) {
            const mx = (base[i][0] + base[i + 1][0]) / 2;
            const my = (base[i][1] + base[i + 1][1]) / 2;
            const dist = Math.hypot(mx - cx, my - cy);
            if (dist < bestD) { bestD = dist; bestI = i; }
          }
          const insertAt = bestI + 1;
          const next = base.slice();
          next.splice(insertAt, 0, [cx, cy]);
          const pts = next.slice(1, -1).map((p, k) => ({
            dx: Math.round(p[0] - (S[0] + (T[0] - S[0]) * ((k + 1) / (next.length - 1)))),
            dy: Math.round(p[1] - (S[1] + (T[1] - S[1]) * ((k + 1) / (next.length - 1))))
          }));
          store.updateMark(state.current.id, b.item.id, { linePts: pts });
          b.item.linePts = pts;
          state.bendEditing = b.item.id;
          renderNoteAnchors(true);
          toast('加了一个点，可以接着拖');
        });
      } else {
        hit.addEventListener('click', (ev) => {
          ev.stopPropagation();
          store.updateMark(state.current.id, b.item.id, { lineStyle: 'curve' });
          b.item.lineStyle = 'curve';
          state.bendEditing = b.item.id;
          renderNoteAnchors(true);
          toast('已换成弯曲线，点线可以拖出任意形状');
        });
      }
    });
  }

  if (renderNoteAnchors._w) window.removeEventListener('resize', renderNoteAnchors._w);
  renderNoteAnchors._w = () => renderNoteAnchors(true);
  window.addEventListener('resize', renderNoteAnchors._w);

  // 点到别处就收起调弧度的手柄
  if (!renderNoteAnchors._out) {
    renderNoteAnchors._out = (e) => {
      if (!state.bendEditing) return;
      const inSvg = e.target && e.target.closest && e.target.closest('.note-svg');
      if (inSvg) return;
      state.bendEditing = null;
      document.querySelectorAll('.note-svg circle.nhandle').forEach((c) => { c.style.display = 'none'; });
    };
    document.addEventListener('click', renderNoteAnchors._out);
  }

  // 滚动停下后补算：滚进视口的笔记出现、滚出的消失
  if (renderNoteAnchors._s) doc.removeEventListener('scroll', renderNoteAnchors._s);
  renderNoteAnchors._s = () => {
    clearTimeout(renderNoteAnchors._st);
    renderNoteAnchors._st = setTimeout(() => renderNoteAnchors(), 240);
  };
  doc.addEventListener('scroll', renderNoteAnchors._s, { passive: true });

  const sb = $('#sidebar');
  if (sb && !sb._noteBound) {
    sb.addEventListener('transitionend', () => renderNoteAnchors());
    sb._noteBound = true;
  }
}
function renderMarksPanel() {
  const bm = state.bookmarks || [], nt = state.notes || [];
  $('#mark-count').textContent = bm.length;
  $('#note-count').textContent = nt.length;

  const bl = $('#bookmark-list');
  bl.innerHTML = bm.length ? '' : '<div class="toc-empty" style="padding:12px">还没有书签<br>按 B 添加当前位置</div>';
  bm.forEach((m) => {
    const item = el('div', { class: 'mark-item' });
    item.innerHTML = `<div>${escapeText(m.label || '书签')}</div><div class="mi-meta">${fmtDate(m.createdAt)}</div><button class="mi-del"><svg class="ic" style="width:13px;height:13px"><use href="#i-close"/></svg></button>`;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.mi-del')) { store.removeMark(state.current.id, m.id); refreshMarks(); return; }
      if (m.target) { state.viewer.goTo(m.target, true); }
    });
    bl.append(item);
  });

  const nl = $('#note-list');
  nl.innerHTML = nt.length ? '' : '<div class="toc-empty" style="padding:12px">选中文字即可添加高亮与笔记</div>';
  nt.forEach((m) => {
    const item = el('div', { class: 'mark-item' });
    item.innerHTML = `<div>${escapeText(m.text ? (m.text.length > 80 ? m.text.slice(0, 80) + '…' : m.text) : '（无摘录）')}</div>
      ${m.note ? `<div class="mi-meta" style="color:var(--ink-2)">${escapeText(m.note)}</div>` : ''}
      <div class="mi-meta">${fmtDate(m.createdAt)}</div>
      <button class="mi-del"><svg class="ic" style="width:13px;height:13px"><use href="#i-close"/></svg></button>`;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.mi-del')) {
        store.removeMark(state.current.id, m.id);
        removeHighlightByText(m.text);
        refreshMarks();
        return;
      }
      // 先按文字找回原文位置（卡片能对准，跳转就会落在那里）
      const anchor = noteAnchorOf(m);
      if (anchor) {
        try { anchor.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { }
        anchor.el.classList.add('note-flash');
        setTimeout(() => anchor.el.classList.remove('note-flash'), 1200);
        return;
      }
      if (m.target) { state.viewer.goTo(m.target, true); setTimeout(() => state.viewer.flash?.(m.target), 300); }
    });
    nl.append(item);
  });
}
function refreshMarks() {
  state.bookmarks = store.marksOf(state.current.id).filter((m) => m.type === 'bookmark');
  state.notes = store.marksOf(state.current.id).filter((m) => m.type !== 'bookmark');
  renderMarksPanel();
  renderNoteAnchors();
}

/* ═════════════ 导出 ═════════════ */
function buildNotesMarkdown() {
  const book = state.current;
  const notes = (state.notes || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const bms = (state.bookmarks || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const lines = [];
  lines.push(`# ${book.name.replace(/\.[^.]+$/, '')} · 读书笔记`, '');
  lines.push(`> 导出自 V 阅读器 · ${new Date().toLocaleString('zh-CN')}`, '');
  if (notes.length) {
    lines.push(`## 标注与笔记（${notes.length}）`, '');
    notes.forEach((m, i) => {
      const anchor = m.label || (m.target && m.target.page ? `第 ${m.target.page} 页` : '');
      lines.push(`### ${i + 1}. ${anchor || '摘录'}`);
      if (m.text) lines.push('', `> ${m.text.replace(/\n+/g, ' ')}`);
      if (m.note) lines.push('', m.note);
      lines.push('');
    });
  }
  if (bms.length) {
    lines.push(`## 书签（${bms.length}）`, '');
    bms.forEach((m) => lines.push(`- ${m.label || '位置'}${m.target && m.target.page ? `（第 ${m.target.page} 页）` : ''}`));
    lines.push('');
  }
  if (!notes.length && !bms.length) lines.push('（这本书还没有标注）');
  return lines.join('\n');
}

function buildQuotesMarkdown() {
  const book = state.current;
  const notes = (state.notes || []).filter((m) => m.text);
  const lines = [`# ${book.name.replace(/\.[^.]+$/, '')} · 摘录`, ''];
  notes.forEach((m) => {
    lines.push(`- ${m.text.replace(/\n+/g, ' ')}`);
  });
  return lines.join('\n');
}

async function saveExport(content, name) {
  try {
    const res = await fetch('/api/save-note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content })
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '导出失败');
    toast('已导出到 exports 文件夹');
    if (j.path) fetch('/api/reveal?path=' + encodeURIComponent(j.path), { method: 'POST' }).catch(() => { });
  } catch (e) {
    toast('导出失败：' + e.message);
  }
}

function exportNotes() {
  if (!state.current) return;
  const book = state.current;
  if (!(state.notes || []).length && !(state.bookmarks || []).length) { toast('这本书还没有标注'); return; }
  const base = book.name.replace(/\.[^.]+$/, '');
  saveExport(buildNotesMarkdown(), `${base}-读书笔记.md`);
}

function exportQuotes() {
  if (!state.current) return;
  const book = state.current;
  if (!(state.notes || []).filter((m) => m.text).length) { toast('还没有摘录'); return; }
  const base = book.name.replace(/\.[^.]+$/, '');
  saveExport(buildQuotesMarkdown(), `${base}-摘录.md`);
}

function currentTarget() {
  if (!state.viewer) return null;
  if (state.viewer._location) return state.viewer._location();
  return state.lastLocation;
}

function addBookmark() {
  if (!state.current) return;
  const label = state.viewer ? state.viewer.label() : '';
  store.addMark(state.current.id, { type: 'bookmark', label: '书签 · ' + (label || ''), target: currentTarget() });
  refreshMarks();
  toast('已添加书签');
}

/* 选区工具条 */
function bindSelection() {
  const bar = $('#selbar');
  let savedRange = null;

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { bar.hidden = true; return; }
    if (state.view !== 'reader') { bar.hidden = true; return; }
    const text = sel.toString().trim();
    if (!text || text.length < 1) { bar.hidden = true; return; }
    const range = sel.getRangeAt(0);
    if (!document.getElementById('doc').contains(range.commonAncestorContainer)) { bar.hidden = true; return; }
    savedRange = range.cloneRange();
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) { bar.hidden = true; return; }
    // 位置只在真的变了才写：拖选时 selectionchange 每帧都触发，
    // 反复写 left/top 会让工具条和选区一起抖
    const nx = Math.round(clamp(rect.left + rect.width / 2, 120, window.innerWidth - 120));
    const ny = Math.round(Math.max(60, rect.top - 10));
    if (bar._x !== nx) { bar.style.left = nx + 'px'; bar._x = nx; }
    if (bar._y !== ny) { bar.style.top = ny + 'px'; bar._y = ny; }
    if (bar.hidden) bar.hidden = false;
  });

  bar.addEventListener('mousedown', (e) => e.preventDefault());
  $('#hl-dots').addEventListener('click', (e) => {
    const dot = e.target.closest('.hl-dot');
    if (!dot) return;
    state.hlColor = dot.dataset.color;
    $$('#hl-dots .hl-dot').forEach((d) => d.classList.toggle('on', d === dot));
    e.stopPropagation();
  });
  bar.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || !btn.dataset.act) return;
    const act = btn.dataset.act;
    const text = savedRange ? savedRange.toString().trim() : '';
    if (act === 'ai') {
      showAiPop(text, e.clientX, e.clientY);
      bar.hidden = true;
      return;
    }
    if (act === 'map') {
      bar.hidden = true;
      if (text.length < 20) { toast('选的太少，多选几句'); return; }
      makeMindMap('selection');
      return;
    }
    bar.hidden = true;

    if (act === 'copy') { copyText(text); return; }
    if (act === 'tts') { speakText(text); return; }
    if (act === 'translate') { openTranslate(text); return; }
    if (act === 'ai') { showAiPop(text, bar); return; }
    if (act === 'highlight') {
      // 选区已经在高亮里 → 再点一次就是取消
      const host = savedRange && savedRange.startContainer
        && (savedRange.startContainer.nodeType === 1 ? savedRange.startContainer : savedRange.startContainer.parentElement);
      const exist = host && host.closest ? host.closest('mark.hl-mark') : null;
      if (exist) {
        const txt = exist.textContent;
        unwrapHighlight(exist);
        const norm = (s) => (s || '').replace(/\s+/g, '');
        const rec = store.marksOf(state.current.id).find((x) => x.type !== 'bookmark' && norm(x.text).slice(0, 40) === norm(txt).slice(0, 40));
        if (rec) store.removeMark(state.current.id, rec.id);
        refreshMarks();
        bar.hidden = true;
        window.getSelection().removeAllRanges();
        toast('已取消高亮');
        return;
      }
      const hl = highlightRange(savedRange, state.hlColor);
      const m = store.addMark(state.current.id, { type: 'note', text, note: '', color: state.hlColor, target: currentTarget() });
      if (hl && m) hl.dataset.mid = m.id;
      refreshMarks();
      toast('已高亮');
      return;
    }
    if (act === 'note') {
      openNoteModal(text, savedRange);
    }
  });
}

/* 把某个高亮元素拆掉，只留文字 */
function unwrapHighlight(node) {
  if (!node || !node.parentNode) return;
  const parent = node.parentNode;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
  parent.normalize();
}

/* 按文字内容把页面上的高亮去掉（标注列表里删记录时用） */
function removeHighlightByText(text) {
  if (!text) return false;
  const norm = (s) => (s || '').replace(/\s+/g, '');
  const key = norm(text).slice(0, 40);
  if (!key) return false;
  let removed = false;
  $$('#doc mark.hl-mark, #doc .hl-mark').forEach((mk) => {
    const body = norm(mk.textContent).slice(0, 40);
    if (body && (body === key || body.startsWith(key.slice(0, 12)) || key.startsWith(body.slice(0, 12)))) {
      unwrapHighlight(mk);
      removed = true;
    }
  });
  return removed;
}

function highlightRange(range, color = 'yellow') {
  if (!range) return null;
  try {
    const mark = document.createElement('mark');
    mark.className = 'hl-mark';
    mark.dataset.color = color;
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
    window.getSelection().removeAllRanges();
    return mark;
  } catch (e) { return null; }
}

function openNoteModal(quote, range) {
  const modal = $('#note-modal');
  $('#note-quote').textContent = quote.length > 260 ? quote.slice(0, 260) + '…' : quote;
  $('#note-text').value = '';
  modal.hidden = false;
  modal.dataset.quote = quote;
  modal._range = range;
  modal._editing = null;
  // 恢复上次拖到的位置和大小
  const pos = store.settings.noteModalPos;
  const card = modal.querySelector('.modal-card');
  if (pos && card) {
    if (pos.left) { card.style.position = 'fixed'; card.style.margin = '0'; card.style.left = pos.left; card.style.top = pos.top; }
    if (pos.w) card.style.width = pos.w;
    if (pos.h) card.style.height = pos.h;
  }
  setTimeout(() => $('#note-text').focus(), 60);
}
function closeNoteModal() { $('#note-modal').hidden = true; $('#note-modal')._range = null; }

/* 载入时恢复高亮（按文本匹配） */
function applySavedHighlights(viewer) {
  if (!state.notes || !state.notes.length) return;
  const root = $('#doc');
  for (const note of state.notes) {
    if (!note.text || note.text.length < 2) continue;
    if (root.querySelector('.hl-mark[data-mid="' + note.id + '"]')) continue;
    try { wrapText(root, note.text, note.id, note.color || 'yellow'); } catch { }
  }
}

function wrapText(root, needle, mid, color) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !n.nodeValue.includes(needle)) return NodeFilter.FILTER_REJECT;
      if (n.parentElement.closest('.hl-mark, script, style, .page-num, .textLayer, .tr-block')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node = walker.nextNode();
  if (!node) return false;
  const idx = node.nodeValue.indexOf(needle);
  if (idx < 0) return false;
  const range = document.createRange();
  range.setStart(node, idx);
  range.setEnd(node, idx + needle.length);
  const mark = document.createElement('mark');
  mark.className = 'hl-mark';
  mark.dataset.mid = mid;
  if (color) mark.dataset.color = color;
  try {
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
    return true;
  } catch { return false; }
}

/* ═════════════ 朗读 ═════════════ */
const tts = {
  chunks: [], idx: 0, playing: false, utter: null,

  start(text) {
    this.stop();
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (!clean) { toast('没有可朗读的文字'); return; }
    this.chunks = splitSentences(clean);
    this.idx = 0;
    this.playing = true;
    setTTSIcon(true);
    this._next();
  },
  _next() {
    if (!this.playing) return;
    if (this.idx >= this.chunks.length) { this.stop(); toast('朗读结束'); return; }
    const s = store.settings;
    const u = new SpeechSynthesisUtterance(this.chunks[this.idx]);
    u.rate = Number(s.rate) || 1;
    u.lang = 'zh-CN';
    const voices = speechSynthesis.getVoices();
    const v = s.voice ? voices.find((x) => x.name === s.voice) : voices.find((x) => /zh[-_]CN/i.test(x.lang));
    if (v) u.voice = v;
    u.onend = () => { if (!this.playing) return; this.idx++; this._next(); };
    u.onerror = () => { if (!this.playing) return; this.idx++; this._next(); };
    this.utter = u;
    speechSynthesis.speak(u);
  },
  pause() { this.playing = false; speechSynthesis.cancel(); setTTSIcon(false); },
  stop() { this.playing = false; speechSynthesis.cancel(); setTTSIcon(false); }
};

function splitSentences(text) {
  const out = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (/[。！？!?；;…\n]/.test(ch) && buf.length > 24) { out.push(buf); buf = ''; }
    else if (buf.length > 180) { out.push(buf); buf = ''; }
  }
  if (buf.trim()) out.push(buf);
  return out.length ? out : [text];
}

function setTTSIcon(on) {
  state.ttsOn = on;
  const btn = $('#btn-tts');
  btn.classList.toggle('active', on);
  btn.innerHTML = `<svg class="ic"><use href="#${on ? 'i-pause' : 'i-volume'}"/></svg>`;
}

function getReadText(fromCurrent = true) {
  if (!state.viewer) return '';
  const v = state.viewer;
  if (v.kind === 'pdf') {
    const n = v._index + 1;
    v.pageText(n).then((t) => { tts.start(t); });
    return null;
  }
  return v.text ? v.text() : '';
}

function toggleTTS(force) {
  if (tts.playing) { tts.stop(); toast('已停止朗读'); return; }
  const text = getReadText();
  if (text === null) return;
  if (!text) { toast('这份文档没有可朗读的文字'); return; }
  tts.start(text);
  toast('开始朗读');
}

/* 切走时把朗读停下来（之前 switchView 调了这个名字，但函数从来没定义过，
   每次都抛 ReferenceError，结果就是点返回后白屏） */
function stopTTS() {
  try { tts.stop(); } catch { }
  try { window.speechSynthesis.cancel(); } catch { }
}

function speakText(text) {
  tts.start(text);
  toast('朗读选中内容');
}

/* ═════════════ 信息面板 ═════════════ */
function renderInfo(book, viewer) {
  const rows = [
    ['文件名', book.name],
    ['格式', (TYPE_LABEL[book.kind] || book.ext || '').toUpperCase()],
    ['大小', fmtSize(book.size)],
    ['位置', book.path],
    ['页/节数', viewer.pageCount || '—'],
    ['作者', viewer.author || '—'],
    ['加入时间', fmtDate(book.addedAt)],
    ['阅读进度', Math.round((book.progress || 0) * 100) + '%'],
    ['标签', (book.tags && book.tags.length) ? book.tags.slice(0, 4).join(' · ') : '—'],
    ['累计阅读', fmtDuration(store.data.stats?.[book.id]?.ms || 0)]
  ];
  $('#info-body').innerHTML = rows.map(([k, v]) => `<div class="info-row"><dt>${k}</dt><dd>${escapeText(String(v))}</dd></div>`).join('')
    + `<button class="btn tiny ghost" id="btn-info-tag" style="margin-top:12px"><svg class="ic"><use href="#i-tag"/></svg>${store.settings.aiKey ? 'AI 生成标签' : '生成标签'}</button>`;
  const tagBtn = $('#btn-info-tag');
  if (tagBtn) tagBtn.addEventListener('click', () => tagBook(book, !!store.settings.aiKey));

  // 相似书籍：按共享标签数排序
  if (book.tags && book.tags.length) {
    const similar = store.books
      .filter((b) => b.id !== book.id)
      .map((b) => ({ b, score: (b.tags || []).filter((t) => book.tags.includes(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    if (similar.length) {
      const box = el('div', { class: 'similar-box' });
      box.innerHTML = '<h4>相似的书</h4>';
      similar.forEach(({ b, score }) => {
        const row = el('button', { class: 'similar-item' });
        row.innerHTML = `<span class="si-name">${escapeText(b.name.replace(/\.[^.]+$/, ''))}</span><span class="si-score">${score} 个共同标签</span>`;
        row.addEventListener('click', () => openBook(b));
        box.append(row);
      });
      $('#info-body').append(box);
    }
  }
}
function fmtDuration(ms) {
  if (ms < 60000) return '不到 1 分钟';
  const m = Math.round(ms / 60000);
  if (m < 60) return m + ' 分钟';
  return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
}

/* ═════════════ 封面生成 ═════════════ */
async function makeCover(book, viewer) {
  try {
    let blob = null;
    if (viewer.coverBlob) blob = await viewer.coverBlob();
    if (!blob && viewer.kind === 'pdf') {
      const page = await viewer.pdf.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const scale = 380 / vp.width;
      const v2 = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = v2.width; canvas.height = v2.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: v2 }).promise;
      blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.78));
    }
    if (!blob && viewer.kind === 'image') {
      const res = await fetch(api.fileUrl(book.path));
      const raw = await res.blob();
      blob = await shrinkImage(raw, 380);
    }
    if (blob) {
      await putCover(book.id, blob);
      book.cover = true;
      store.saveShelf();
      if (state.view === 'shelf') renderShelf();
    }
  } catch { }
}

function shrinkImage(blob, maxW) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth, 560 / img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => resolve(b), 'image/jpeg', 0.78);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/* ═════════════ 文件浏览器 ═════════════ */
async function openBrowser(startPath) {
  const modal = $('#browser-modal');
  modal.hidden = false;
  if (!modal.dataset.loaded) {
    try {
      const { places, drives } = await api.places();
      const box = $('#browser-places');
      box.innerHTML = '';
      places.forEach((p) => {
        const b = el('button', { class: 'place-chip', text: p.label });
        b.addEventListener('click', () => loadDir(p.path));
        box.append(b);
      });
      drives.forEach((d) => {
        if (places.some((p) => p.path === d)) return;
        const b = el('button', { class: 'place-chip', text: d });
        b.addEventListener('click', () => loadDir(d));
        box.append(b);
      });
    } catch { }
    modal.dataset.loaded = '1';
  }
  loadDir(startPath || '');
}

let browserPath = '';
async function loadDir(p) {
  const list = $('#browser-list');
  list.innerHTML = '<div class="dim" style="padding:18px">读取中…</div>';
  try {
    const data = await api.dir(p);
    browserPath = data.path;
    $('#browser-path-input').value = data.path;
    $('#browser-status').textContent = `${data.dirs.length} 个文件夹 · ${data.files.filter((f) => f.readable).length} 个可读文件`;
    const all = $('#browser-all').checked;
    const frag = document.createDocumentFragment();

    if (data.parent) {
      const up = el('div', { class: 'browser-row' });
      up.innerHTML = `<svg class="ic"><use href="#i-folder"/></svg><span class="bi-name">.. 上一级</span>`;
      up.addEventListener('click', () => loadDir(data.parent));
      frag.append(up);
    }
    data.dirs.forEach((d) => {
      const row = el('div', { class: 'browser-row' });
      row.innerHTML = `<svg class="ic"><use href="#i-folder"/></svg><span class="bi-name">${escapeText(d.name)}</span>`;
      row.addEventListener('click', () => loadDir(d.path));
      frag.append(row);
    });
    data.files.forEach((f) => {
      if (!f.readable && !all) return;
      const row = el('div', { class: 'browser-row' + (f.readable ? '' : ' disabled') });
      row.innerHTML = `<svg class="ic"><use href="#${f.ext === '.pdf' ? 'i-book' : 'i-note'}"/></svg>
        <span class="bi-name">${escapeText(f.name)}</span>
        <span class="bi-ext">${f.ext.replace('.', '')}</span>
        <span class="bi-size">${fmtSize(f.size)}</span>`;
      row.addEventListener('click', () => {
        $('#browser-modal').hidden = true;
        const book = store.addBook({ name: f.name, path: f.path, ext: f.ext, size: f.size });
        openBook(book);
      });
      frag.append(row);
    });
    list.innerHTML = '';
    list.append(frag);
  } catch (e) {
    list.innerHTML = `<div class="dim" style="padding:18px">无法读取：${escapeText(e.message)}</div>`;
  }
}

/* ═════════════ 设置交互 ═════════════ */
function bindSettings() {
  const set = (k, v) => { store.setSetting(k, v); applySettings(); };

  $('#theme-swatches').addEventListener('click', (e) => {
    const b = e.target.closest('.swatch');
    if (!b) return;
    set('theme', b.dataset.theme);
    applySettings();
  });
  $('#font-select').addEventListener('change', (e) => {
    set('font', e.target.value);
  });
  $('#layout-select').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const layout = b.dataset.layout;
    store.data.settings.layout = layout;
    store.saveState();
    $$('#layout-select button').forEach((x) => x.classList.toggle('active', x === b));
    if (state.viewer && state.viewer.setLayout) state.viewer.setLayout(layout);
    if (layout !== 'scroll' && state.viewer && state.viewer.kind === 'flow') toast('文字类文档使用连续滚动阅读');
  });

  $('#set-size').addEventListener('input', (e) => { $('#out-size').textContent = e.target.value; store.data.settings.size = Number(e.target.value); applySettings(); store.saveState(); });
  $('#set-lh').addEventListener('input', (e) => { $('#out-lh').textContent = Number(e.target.value).toFixed(2); store.data.settings.lh = Number(e.target.value); applySettings(); store.saveState(); });
  $('#set-width').addEventListener('input', (e) => { $('#out-width').textContent = e.target.value; store.data.settings.width = Number(e.target.value); applySettings(); store.saveState(); });
  $('#set-para').addEventListener('input', (e) => { $('#out-para').textContent = Number(e.target.value).toFixed(1); store.data.settings.para = Number(e.target.value); applySettings(); store.saveState(); });
  $('#set-rate').addEventListener('input', (e) => { $('#out-rate').textContent = Number(e.target.value).toFixed(1); store.data.settings.rate = Number(e.target.value); store.saveState(); });

  $('#set-indent').addEventListener('change', (e) => set('indent', e.target.checked));
  $('#set-autohide').addEventListener('change', (e) => set('autohide', e.target.checked));
  $('#set-pdfnight').addEventListener('change', (e) => set('pdfNight', e.target.checked));
  $('#set-ai-base').addEventListener('change', (e) => set('aiBase', e.target.value.trim()));
  $('#set-ai-model').addEventListener('change', (e) => set('aiModel', e.target.value.trim()));
  $('#set-ai-key').addEventListener('change', (e) => set('aiKey', e.target.value.trim()));
  $('#set-scrollspeed').addEventListener('input', (e) => {
    $('#out-scroll').textContent = e.target.value;
    store.data.settings.scrollSpeed = Number(e.target.value);
    store.saveState();
  });
  $('#btn-assoc').addEventListener('click', async () => {
    if (!window.desktop?.associate) { toast('仅桌面版支持文件关联'); return; }
    try {
      const r = await window.desktop.associate();
      toast(r && r.ok ? '已关联，双击常见文档会用V 阅读器打开' : '关联失败：' + (r && r.error), 4000);
    } catch (e) { toast('关联失败：' + e.message, 4000); }
  });
  $('#set-tts-auto').addEventListener('change', (e) => set('ttsAuto', e.target.checked));
  $('#set-voice').addEventListener('change', (e) => set('voice', e.target.value));

  $('#btn-settings').addEventListener('click', () => toggleSettings());
  $('#btn-settings-close').addEventListener('click', () => toggleSettings(false));
  $('#btn-theme').addEventListener('click', cycleTheme);

  // 语音列表
  const fillVoices = () => {
    const sel = $('#set-voice');
    const voices = speechSynthesis.getVoices().filter((v) => /zh|cmn|Chinese/i.test(v.lang + v.name));
    sel.innerHTML = '<option value="">自动（中文）</option>' + voices.map((v) => `<option value="${escapeText(v.name)}">${escapeText(v.name)}</option>`).join('');
    if (store.settings.voice) sel.value = store.settings.voice;
  };
  fillVoices();
  speechSynthesis.onvoiceschanged = fillVoices;

  renderKeymapEditor();
  $('#btn-keymap-reset').addEventListener('click', () => {
    store.data.settings.keymap = {};
    store.saveState();
    renderKeymapEditor();
    toast('快捷键已恢复默认');
  });
}

function toggleSettings(force) {
  const s = $('#settings');
  const open = force === undefined ? !s.classList.contains('open') : force;
  s.classList.toggle('open', open);
  s.setAttribute('aria-hidden', open ? 'false' : 'true');
  $('#btn-settings').classList.toggle('active', open);
  $('#reader-view').classList.toggle('settings-open', open);
  if (open) closeTranslate();
}

const THEMES = ['white', 'sepia', 'green', 'sky', 'lilac', 'sage', 'dusk', 'warm', 'kraft', 'coffee', 'forest', 'abyss', 'night', 'black'];
const THEME_NAME = { white: '白', sepia: '米', night: '夜读', black: '纯黑' };
function cycleTheme() {
  const i = THEMES.indexOf(store.settings.theme);
  const next = THEMES[(i + 1) % THEMES.length];
  store.setSetting('theme', next);
  applySettings();
  toast('主题：' + (THEME_NAME[next] || next));
}

/* ═════════════ 阅读器交互 ═════════════ */
function bindReader() {
  $('#btn-back').addEventListener('click', () => switchView('shelf'));
  $('#btn-nav-back').addEventListener('click', navBack);
  $('#btn-nav-forward').addEventListener('click', navForward);

  /* 思维导图：关闭 / 缩放 / 拖动 / 导出 */
  /* 选中文字颜色 */
  {
    // 亮度决定选中文字用黑还是白：避免选中色和字色撞在一起看不清
    const lum = (hex) => {
      const h = hex.replace('#', '');
      const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      const r = parseInt(v.slice(0, 2), 16) / 255;
      const g = parseInt(v.slice(2, 4), 16) / 255;
      const b = parseInt(v.slice(4, 6), 16) / 255;
      const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const applySel = (c) => {
      if (!c) return;
      const root = document.documentElement;
      root.style.setProperty('--sel-bg', c);
      // 背景亮就用深色字，背景暗就用白字
      root.style.setProperty('--sel-fg', lum(c) > 0.45 ? '#15181c' : '#ffffff');
      const pick = $('#set-selcolor-pick');
      if (pick) pick.value = c;
      $$('#set-selcolor .color-dot').forEach((b) => b.classList.toggle('on', b.dataset.c.toLowerCase() === c.toLowerCase()));
    };
    applySel(store.settings.selBg || '#b9d7ff');
    $$('#set-selcolor .color-dot').forEach((b) => {
      b.addEventListener('click', () => {
        store.settings.selBg = b.dataset.c;
        store.saveState();
        applySel(b.dataset.c);
      });
    });
    $('#set-selcolor-pick')?.addEventListener('input', (e) => {
      store.settings.selBg = e.target.value;
      store.saveState();
      applySel(e.target.value);
    });
  }

  $('#mm-close').addEventListener('click', () => { $('#mm-modal').hidden = true; });
  $('#ai-map')?.addEventListener('click', () => makeMindMap('all'));
  $('#mm-zoom-in').addEventListener('click', () => { mm.scale = Math.min(2.6, mm.scale * 1.2); applyMmTransform(); });
  $('#mm-zoom-out').addEventListener('click', () => { mm.scale = Math.max(0.25, mm.scale / 1.2); applyMmTransform(); });
  $('#mm-save').addEventListener('click', saveMmSvg);
  $('#mm-to-tab')?.addEventListener('click', mmToTab);
  $('#sm-close')?.addEventListener('click', closeMmSplit);
  $('#sm-pin')?.addEventListener('click', () => $('#split-map').classList.toggle('wide'));
  {
    const cv = $('#mm-canvas');
    let drag = null;
    cv.addEventListener('mousedown', (e) => {
      drag = { x: e.clientX, y: e.clientY, tx: mm.tx, ty: mm.ty };
      cv.classList.add('dragging');
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      mm.tx = drag.tx + (e.clientX - drag.x);
      mm.ty = drag.ty + (e.clientY - drag.y);
      applyMmTransform();
    });
    window.addEventListener('mouseup', () => { drag = null; cv.classList.remove('dragging'); });
    cv.addEventListener('wheel', (e) => {
      if ($('#mm-modal').hidden) return;
      e.preventDefault();
      mm.scale = Math.max(0.25, Math.min(2.6, mm.scale * (e.deltaY > 0 ? 0.92 : 1.08)));
      applyMmTransform();
    }, { passive: false });
  }
  $('#btn-toc').addEventListener('click', () => toggleSidePanel('toc'));
  $('#btn-search').addEventListener('click', () => toggleSidePanel('search'));
  $('#btn-locate').addEventListener('click', openLocate);
  $('#btn-marks').addEventListener('click', () => toggleSidePanel('marks'));
  $('#btn-translate').addEventListener('click', () => {
    const panel = $('#translate-panel');
    if (panel.classList.contains('open')) closeTranslate();
    else openTranslate('');
  });
  $('#btn-ai').addEventListener('click', () => {
    setSidebar(true, 'ai');
    if (!$('#ai-messages').children.length) {
      $('#ai-messages').innerHTML = '<div class="ai-empty">问它任何关于这篇文档的问题<br>比如「第 3 章讲了什么」「这个参数什么意思」</div>';
    }
    setTimeout(() => $('#ai-input').focus(), 120);
  });
  $('#btn-autoscroll').addEventListener('click', toggleAutoScroll);
  $('#btn-pin').addEventListener('click', async () => {
    if (!window.desktop?.togglePin) { toast('仅桌面版支持窗口置顶'); return; }
    const pinned = await window.desktop.togglePin();
    $('#btn-pin').classList.toggle('active', !!pinned);
    toast(pinned ? '窗口已置顶' : '已取消置顶');
  });

  // AI 问答
  $('#ai-send').addEventListener('click', () => {
    const v = $('#ai-input').value.trim();
    if (!v) return;
    $('#ai-input').value = '';
    const focus = state.aiFocus || '';
    state.aiFocus = '';
    $('#ai-input').placeholder = '问这篇文档里的任何事，回车发送';
    askAI(v, focus ? { focus } : {});
  });
  $('#ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#ai-send').click();
    }
  });
  $('#ai-summary').addEventListener('click', () => {
    $('#ai-messages').querySelector('.ai-empty')?.remove();
    askAI('请用 5 条以内总结这篇文档的要点，每条一句话。', { mode: 'all' });
  });
  $('#ai-chapters').addEventListener('click', chapterSummary);
  $('#ai-notes').addEventListener('click', organizeNotes);
  $('#ai-terms').addEventListener('click', termTable);
  $('#ai-pop').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-ai]');
    if (!btn) return;
    const text = $('#ai-pop').dataset.text || '';
    $('#ai-pop').hidden = true;
    aiSelectionAction(btn.dataset.ai, text);
  });
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#ai-pop') && !e.target.closest('#selbar')) $('#ai-pop').hidden = true;
  });
  $('#ai-clear').addEventListener('click', () => {
    aiChat.history = [];
    $('#ai-messages').innerHTML = '<div class="ai-empty">对话已清空</div>';
    toast('已清空');
  });
  $('#btn-tts').addEventListener('click', () => toggleTTS());
  $('#btn-fullscreen').addEventListener('click', toggleFullscreen);

  // 翻译面板
  $('#trans-close').addEventListener('click', closeTranslate);
  $('#trans-run').addEventListener('click', runTranslate);
  $('#trans-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runTranslate(); }
  });
  $('#trans-swap').addEventListener('click', () => {
    const a = $('#trans-from'), b = $('#trans-to');
    if (a.value === 'auto') { a.value = b.value; b.value = 'zh-CN'; }
    else { const t = a.value; a.value = b.value; b.value = t; }
    if ($('#trans-input').value.trim()) runTranslate();
  });
  $('#trans-copy').addEventListener('click', () => {
    const t = $('#trans-out').textContent.trim();
    if (t) copyText(t); else toast('还没有译文');
  });
  $('#trans-insert').addEventListener('click', () => {
    const out = $('#trans-out').textContent.trim();
    const src = $('#trans-input').value.trim();
    if (!out) { toast('还没有译文'); return; }
    if (!state.current) { toast('先在书里打开一页'); return; }
    store.addMark(state.current.id, { type: 'note', text: src.slice(0, 200), note: '【译文】' + out.slice(0, 400), target: currentTarget() });
    refreshMarks();
    toast('已存为笔记');
  });

  // 定位
  $('#locate-close').addEventListener('click', closeLocate);
  $('#locate-cancel').addEventListener('click', closeLocate);
  $('#locate-go').addEventListener('click', doLocate);
  $('#locate-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLocate(); });

  // 实时翻译
  $('#live-trans-on').addEventListener('change', (e) => {
    if (e.target.checked) {
      if (!state.current) { e.target.checked = false; toast('先打开一本书'); return; }
      liveTrans.start();
    } else {
      liveTrans.stop();
    }
  });
  $('#live-trans-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#live-trans-mode button').forEach((x) => x.classList.toggle('active', x === b));
    liveTrans.setMode(b.dataset.mode);
  });
  $('#trans-banner-yes').addEventListener('click', () => {
    $('#trans-banner').hidden = true;
    const lang = $('#trans-banner').dataset.lang || 'en-US';
    $('#trans-to').value = lang.startsWith('zh') ? 'en-US' : 'zh-CN';
    liveTrans.start('bilingual');
  });
  $('#trans-banner-no').addEventListener('click', () => {
    $('#trans-banner').hidden = true;
    store.setSetting('autoTransPrompt', false);
  });

  $$('.side-tab').forEach((t) => t.addEventListener('click', () => switchPanel(t.dataset.panel)));
  $$('.side-panel[data-panel]').forEach(() => { });

  $('#toc-filter').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('#toc-list .toc-item').forEach((n) => {
      n.style.display = !q || n.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch(e.target.value);
  });
  $('#search-input').addEventListener('input', debounce((e) => { if (e.target.value.trim().length >= 2) doSearch(e.target.value); }, 500));

  $('#turn-prev')?.addEventListener('click', () => state.viewer?.prev?.());
  $('#turn-next')?.addEventListener('click', () => state.viewer?.next?.());

  // 自动隐藏工具栏
  let hideTimer = null;
  const showUI = () => {
    $('#reader-view').classList.remove('autohide');
    clearTimeout(hideTimer);
    if (!store.settings.autohide || state.view !== 'reader') return;
    hideTimer = setTimeout(() => {
      if (window.getSelection()?.toString()) return;
      if ($('#settings').classList.contains('open')) return;
      $('#reader-view').classList.add('autohide');
    }, 2600);
  };
  ['mousemove', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, showUI, { passive: true }));

  // 笔记弹窗
  $('#note-close').addEventListener('click', closeNoteModal);
  $('#note-cancel').addEventListener('click', closeNoteModal);

  /* 笔记弹窗可以拖着走：按住标题栏拖动，记住位置 */
  {
    const modal = $('#note-modal');
    const head = modal.querySelector('.modal-head');
    const card = modal.querySelector('.modal-card');
    let drag = null;
    head?.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const r = card.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      modal.classList.add('dragging');
      card.style.position = 'fixed';
      card.style.margin = '0';
      card.style.left = r.left + 'px';
      card.style.top = r.top + 'px';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const r = card.getBoundingClientRect();
      const x = Math.max(6, Math.min(window.innerWidth - r.width - 6, e.clientX - drag.dx));
      const y = Math.max(6, Math.min(window.innerHeight - r.height - 6, e.clientY - drag.dy));
      card.style.left = x + 'px';
      card.style.top = y + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      modal.classList.remove('dragging');
      try {
        store.settings.noteModalPos = { left: card.style.left, top: card.style.top, w: card.style.width, h: card.style.height };
        store.saveState();
      } catch { }
    });
  }
  $('#note-save').addEventListener('click', () => {
    const modal = $('#note-modal');
    const text = modal.dataset.quote || '';
    const note = $('#note-text').value.trim();
    // 编辑已有笔记：只改内容，不新增
    if (modal._editing) {
      store.updateMark(state.current.id, modal._editing.id, { note });
      modal._editing = null;
      refreshMarks();
      closeNoteModal();
      toast('笔记已更新');
      return;
    }
    const hl = modal._range ? highlightRange(modal._range, state.hlColor) : null;
    const saved = store.addMark(state.current.id, { type: 'note', text, note, color: state.hlColor, target: currentTarget() });
    // 记下高亮对应哪条笔记，卡片连线才能精确指到这行字
    if (hl && saved) hl.dataset.mid = saved.id;
    refreshMarks();
    closeNoteModal();
    toast('笔记已保存');
  });

  $('#btn-export-notes').addEventListener('click', exportNotes);
  $('#btn-tts').addEventListener('click', () => { });

  // 文件浏览器
  $('#browser-close').addEventListener('click', () => { $('#browser-modal').hidden = true; });
  $('#browser-up').addEventListener('click', async () => {
    const p = $('#browser-path-input').value;
    try { const d = await api.dir(p); if (d.parent) loadDir(d.parent); } catch { }
  });
  $('#browser-go').addEventListener('click', () => loadDir($('#browser-path-input').value));
  $('#browser-path-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadDir(e.target.value); });
  $('#browser-all').addEventListener('change', () => loadDir(browserPath));

  $$('.modal').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m) m.hidden = true; }));
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

/* ═════════════ 快捷键 ═════════════ */
/* ═════════════ 快捷键（全部可自定义） ═════════════ */
const KEY_ACTIONS = [
  { id: 'next', name: '下一页', def: 'ArrowRight' },
  { id: 'prev', name: '上一页', def: 'ArrowLeft' },
  { id: 'space', name: '空格翻页', def: 'Space' },
  { id: 'navBack', name: '上一位置', def: 'Alt+ArrowLeft' },
  { id: 'navForward', name: '下一位置', def: 'Alt+ArrowRight' },
  { id: 'locate', name: '跳转定位', def: 'Ctrl+G' },
  { id: 'search', name: '搜索', def: '/' },
  { id: 'toc', name: '侧栏目录', def: 'Tab' },
  { id: 'bookmark', name: '加书签', def: 'B' },
  { id: 'translate', name: '翻译面板', def: 'Ctrl+Shift+T' },
  { id: 'ai', name: 'AI 问答', def: 'Ctrl+Shift+A' },
  { id: 'edit', name: '编辑模式', def: 'Ctrl+E' },
  { id: 'tts', name: '朗读', def: 'R' },
  { id: 'theme', name: '切换主题', def: 'T' },
  { id: 'settings', name: '设置面板', def: 'S' },
  { id: 'fullscreen', name: '全屏', def: 'F' },
  { id: 'autoscroll', name: '自动滚动', def: 'Ctrl+Shift+O' },
  { id: 'speeddown', name: '滚动速度 -', def: '-' },
  { id: 'speedup', name: '滚动速度 +', def: '=' },
  { id: 'zoomin', name: '放大 / 加字号', def: '+' },
  { id: 'zoomout', name: '缩小 / 减字号', def: '-' },
  { id: 'import', name: '导入文件', def: 'Ctrl+O' },
  { id: 'pin', name: '窗口置顶', def: 'Ctrl+Shift+P' }
];

let recordingId = null;

function comboFromEvent(e) {
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  let key = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
  if (key === ' ') key = 'Space';
  else if (key === 'Esc') key = 'Escape';
  else if (key.length === 1) key = key.toUpperCase();
  if (mods.length === 1 && mods[0] === 'Shift' && '+-_{}|:"<>?'.includes(key)) mods.pop();
  mods.push(key);
  return mods.join('+');
}

function getKeymap() {
  const base = {};
  KEY_ACTIONS.forEach((a) => { base[a.id] = a.def; });
  return Object.assign(base, store.settings.keymap || {});
}

function zoomIn() {
  if (state.viewer?.kind === 'pdf') state.viewer.setZoom(state.viewer._zoom * 1.12);
  else if (state.viewer?.kind === 'image') state.viewer.zoom(1.15);
  else changeSize(1);
}
function zoomOut() {
  if (state.viewer?.kind === 'pdf') state.viewer.setZoom(state.viewer._zoom / 1.12);
  else if (state.viewer?.kind === 'image') state.viewer.zoom(1 / 1.15);
  else changeSize(-1);
}

function runKeyAction(id) {
  switch (id) {
    case 'next': state.viewer?.next?.(); break;
    case 'prev': state.viewer?.prev?.(); break;
    case 'space': state.viewer?.next?.(); break;
    case 'navBack': navBack(); break;
    case 'navForward': navForward(); break;
    case 'locate': openLocate(); break;
    case 'search':
      if (state.view === 'reader') setSidebar(true, 'search');
      else $('#shelf-search').focus();
      break;
    case 'toc': setSidebar(undefined, 'toc'); break;
    case 'bookmark': addBookmark(); break;
    case 'translate': openTranslate(''); break;
    case 'ai': $('#btn-ai').click(); break;
    case 'edit': toggleEdit(); break;
    case 'tts': toggleTTS(); break;
    case 'theme': cycleTheme(); break;
    case 'settings': toggleSettings(); break;
    case 'fullscreen': toggleFullscreen(); break;
    case 'autoscroll': toggleAutoScroll(); break;
    case 'speeddown': nudgeScrollSpeed(-5); break;
    case 'speedup': nudgeScrollSpeed(5); break;
    case 'zoomin': zoomIn(); break;
    case 'zoomout': zoomOut(); break;
    case 'import': pickFiles(); break;
    case 'pin': $('#btn-pin').click(); break;
  }
}

function renderKeymapEditor() {
  const box = $('#keymap-editor');
  if (!box) return;
  const km = getKeymap();
  box.innerHTML = '';
  KEY_ACTIONS.forEach((a) => {
    const row = el('div', { class: 'keymap-row' });
    row.append(el('span', { text: a.name }));
    const key = el('button', {
      class: 'keymap-key' + (recordingId === a.id ? ' recording' : ''),
      text: recordingId === a.id ? '按下按键…' : (km[a.id] || '未设置')
    });
    key.addEventListener('click', () => { recordingId = a.id; renderKeymapEditor(); });
    row.append(key);
    box.append(row);
  });
}

function bindKeyRecorder() {
  document.addEventListener('keydown', (e) => {
    if (!recordingId) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      recordingId = null;
      renderKeymapEditor();
      return;
    }
    const combo = comboFromEvent(e);
    if (!combo) return;
    const km = getKeymap();
    const dup = Object.keys(km).find((k) => k !== recordingId && km[k] === combo);
    const kmap = Object.assign({}, store.settings.keymap || {});
    kmap[recordingId] = combo;
    if (dup) {
      delete kmap[dup];
      const other = KEY_ACTIONS.find((a) => a.id === dup);
      if (other) toast(`「${other.name}」原来用这个键，已让给你`);
    }
    store.data.settings.keymap = kmap;
    store.saveState();
    recordingId = null;
    renderKeymapEditor();
  }, true);
}

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    if (recordingId) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

    if (e.key === 'Escape') {
      if (!$('#browser-modal').hidden) { $('#browser-modal').hidden = true; return; }
      if (!$('#note-modal').hidden) { closeNoteModal(); return; }
      if (!$('#ai-pop').hidden) { $('#ai-pop').hidden = true; return; }
      if (!$('#locate-modal').hidden) { closeLocate(); return; }
      if ($('#settings').classList.contains('open')) { toggleSettings(false); return; }
      if ($('#translate-panel').classList.contains('open')) { closeTranslate(); return; }
      if (typing) { e.target.blur(); return; }
      if (state.view === 'reader') switchView('shelf');
      return;
    }

    if (typing) return;

    const combo = comboFromEvent(e);
    if (!combo) return;
    const km = getKeymap();
    const id = Object.keys(km).find((k) => km[k] === combo);
    if (!id) return;
    e.preventDefault();
    if (id === 'space' && e.shiftKey) { state.viewer?.prev?.(); return; }
    runKeyAction(id);
  });
}
function changeSize(d) {
  const s = store.settings;
  s.size = clamp(s.size + d, 13, 32);
  applySettings(); store.saveState();
  toast('字号 ' + s.size);
}

/* ═════════════ 拖拽导入 ═════════════ */
function bindDrop() {
  let depth = 0;
  const hint = () => $('#drop-hint');
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    depth++;
    if (state.view === 'reader') hint().hidden = false;
  });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) hint().hidden = true; });
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); depth = 0; hint().hidden = true;
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) importFiles(files);
  });
}

/* ═════════════ 思维导图 ═════════════ */
const mm = { scale: 1, tx: 0, ty: 0, root: null };

async function makeMindMap(scope) {
  let text = '';
  let label = '思维导图';
  if (scope === 'selection') {
    text = (window.getSelection() || '').toString().trim();
    label = '这段内容的思维导图';
  } else {
    text = getDocContext(9000) || '';
    label = '全文思维导图';
  }
  if (!text || text.length < 20) { toast('内容太少，选一段或换一篇'); return; }

  const modal = $('#mm-modal');
  const canvas = $('#mm-canvas');
  $('#mm-title').textContent = label;
  canvas.innerHTML = '<div class="mm-empty">正在梳理结构…</div>';
  modal.hidden = false;
  mm.scale = 1; mm.tx = 0; mm.ty = 0;

  const prompt = `把下面的内容整理成思维导图大纲。
规则：
1. 第一行用「# 主题」写中心主题，必须是这篇内容真正的主题词，不超过 14 字
2. 用 ## ### #### 表示层级，最多 4 层
3. 每个节点不超过 16 字，必须是内容里出现过的具体词（名词、术语、做法），不要用「核心主题」「关键要点」「主要内容」这类空泛词
4. 分支 3–7 个，太碎的合并
5. 只输出大纲本身，不要任何解释、不要代码块

内容：
${text}`;

  let outline = '';
  try {
    outline = await aiCall(prompt, { temperature: 0.3, maxTokens: 1400 });
  } catch (e) {
    canvas.innerHTML = '<div class="mm-empty">生成失败：' + escapeText(String(e.message || e)) + '</div>';
    return;
  }
  const tree = parseOutline(outline);
  if (!tree) {
    canvas.innerHTML = '<div class="mm-empty">AI 没给出可用的结构，再试一次</div>';
    return;
  }
  mm.root = tree;
  renderMindMap(tree);
}

/* 把 # 开头的行解析成树；兼容 AI 偶尔用的 - 列表 */
function parseOutline(raw) {
  const lines = (raw || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const root = { title: '', level: 0, children: [] };
  const stack = [root];
  for (const line of lines) {
    if (/^(```|我是|以下是|好的|当然)/.test(line)) continue;
    const m = line.match(/^(#{1,6})\s*(.+)$/);
    let level = 0;
    let title = '';
    if (m) {
      level = m[1].length;
      title = m[2].trim();
    } else if (/^[-*+]\s+/.test(line)) {
      const indent = line.match(/^\s*/)[0].length;
      level = 3 + Math.min(2, Math.floor(indent / 2));
      title = line.replace(/^[-*+]\s+/, '').trim();
    } else {
      continue;
    }
    title = title.replace(/[*`]/g, '').replace(/^[\d.、]+\s*/, '').slice(0, 26);
    if (!title) continue;
    const node = { title, level, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  // 顶层只有一个就把它当根，多个则造一个虚拟根
  const tops = root.children;
  if (!tops.length) return null;
  if (tops.length === 1) return tops[0];
  return { title: (state.current && state.current.name || '导图').replace(/\.[^.]+$/, ''), level: 0, children: tops };
}

const MM = { PAD_X: 62, PAD_Y: 34, NODE_H: 30, MIN_W: 70, MAX_W: 230 };

function mmMeasure(text, level) {
  const fs = level === 0 ? 14 : 12.5;
  let w = 0;
  for (const ch of text) w += /[\x00-\xff]/.test(ch) ? fs * 0.56 : fs;
  return Math.min(MM.MAX_W, Math.max(MM.MIN_W, w + (level === 0 ? 34 : 26)));
}

function renderMindMap(tree) {
  const nodes = [];
  const edges = [];
  let leafY = 0;

  (function walk(node, depth) {
    node.depth = depth;
    node.w = mmMeasure(node.title, depth);
    node.h = MM.NODE_H;
    if (node.children && node.children.length) {
      node.children.forEach((c) => walk(c, depth + 1));
      const first = node.children[0];
      const last = node.children[node.children.length - 1];
      node.y = (first.y + last.y) / 2;
    } else {
      node.y = leafY;
      leafY += MM.PAD_Y;
    }
    node.x = depth * 0;   // 稍后统一算
    nodes.push(node);
  })(tree, 0);

  // 每层的 x = 前面所有层最大宽度累加
  const levelW = [];
  nodes.forEach((n) => { levelW[n.depth] = Math.max(levelW[n.depth] || 0, n.w); });
  const levelX = [];
  let acc = 0;
  for (let d = 0; d < levelW.length; d++) { levelX[d] = acc; acc += (levelW[d] || 0) + MM.PAD_X; }
  nodes.forEach((n) => { n.x = levelX[n.depth]; });

  (function collect(node) {
    (node.children || []).forEach((c) => {
      edges.push({ from: node, to: c });
      collect(c);
    });
  })(tree);

  const maxX = Math.max(...nodes.map((n) => n.x + n.w)) + 60;
  const maxY = Math.max(...nodes.map((n) => n.y + n.h)) + 60;
  const minY = Math.min(...nodes.map((n) => n.y)) - 40;

  const canvas = $('#mm-canvas');
  canvas.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `-40 ${minY} ${maxX + 40} ${maxY - minY}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const gEdges = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  for (const e of edges) {
    const x1 = e.from.x + e.from.w;
    const y1 = e.from.y + e.from.h / 2;
    const x2 = e.to.x;
    const y2 = e.to.y + e.to.h / 2;
    const mid = (x1 + x2) / 2;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('class', 'mm-edge');
    p.setAttribute('d', `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`);
    gEdges.appendChild(p);
  }
  svg.appendChild(gEdges);

  const gNodes = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  for (const n of nodes) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'mm-node' + (n.depth === 0 ? ' root' : (n.depth === 1 ? ' lv2' : '')));
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', n.x); rect.setAttribute('y', n.y);
    rect.setAttribute('width', n.w); rect.setAttribute('height', n.h);
    rect.setAttribute('rx', 5);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', n.x + (n.depth === 0 ? 17 : 13));
    t.setAttribute('y', n.y + n.h / 2 + 1);
    t.textContent = n.title;
    g.appendChild(rect); g.appendChild(t);
    gNodes.appendChild(g);
  }
  svg.appendChild(gNodes);
  canvas.appendChild(svg);

  mm.svg = svg;
  mm.nodes = nodes;
  applyMmTransform();
}

function applyMmTransform() {
  if (!mm.svg) return;
  mm.svg.style.transform = `translate(${mm.tx}px, ${mm.ty}px) scale(${mm.scale})`;
  $('#mm-zoom-label').textContent = Math.round(mm.scale * 100) + '%';
}
/* 导出 SVG：CSS 类在外部文件里不随导出走，所以把样式直接写进属性 */
function saveMmSvg() {
  if (!mm.svg) { toast('还没有导图'); return; }
  const clone = mm.svg.cloneNode(true);
  clone.style.transform = '';
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', clone.viewBox.baseVal.width);
  clone.setAttribute('height', clone.viewBox.baseVal.height);
  clone.querySelectorAll('.mm-edge').forEach((p) => {
    p.setAttribute('stroke', '#c9ccd1'); p.setAttribute('fill', 'none'); p.setAttribute('stroke-width', '1.4');
  });
  clone.querySelectorAll('.mm-node rect').forEach((r) => {
    r.setAttribute('fill', '#ffffff'); r.setAttribute('stroke', '#c9ccd1'); r.setAttribute('stroke-width', '1.2');
  });
  clone.querySelectorAll('.mm-node.root rect').forEach((r) => {
    r.setAttribute('fill', '#1b1b1b'); r.setAttribute('stroke', '#1b1b1b');
  });
  clone.querySelectorAll('.mm-node.lv2 rect').forEach((r) => r.setAttribute('fill', '#f2f4f7'));
  clone.querySelectorAll('.mm-node text').forEach((t) => {
    t.setAttribute('fill', '#222');
    t.setAttribute('font-family', 'system-ui,-apple-system,"Microsoft YaHei",sans-serif');
    t.setAttribute('font-size', '12.5');
    t.removeAttribute('dominant-baseline');
  });
  clone.querySelectorAll('.mm-node.root text').forEach((t) => {
    t.setAttribute('fill', '#fff'); t.setAttribute('font-size', '14');
  });
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const a = document.createElement('a');
  const title = (mm.root && mm.root.title) || 'mindmap';
  a.href = URL.createObjectURL(blob);
  a.download = title.replace(/[\\/:*?"<>|]/g, '_') + '-思维导图.svg';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('已导出 SVG');
}

/* ═════════════ 导图标签（分屏） ═════════════ */
function mmToTab() {
  if (!mm.svg) { toast('还没有导图'); return; }
  const id = 'mm-' + Date.now();
  const title = (mm.root && mm.root.title) || '思维导图';
  const svgXml = new XMLSerializer().serializeToString(mm.svg.cloneNode(true));
  state.mmTabs = state.mmTabs || [];
  state.mmTabs.push({ id, title, svg: svgXml });
  state.activeMmTab = id;
  $('#mm-modal').hidden = true;
  renderTabs();
  showMmSplit(id);
  toast('已存到标签栏，可以分屏看');
}

function showMmSplit(id) {
  const t = (state.mmTabs || []).find((x) => x.id === id);
  if (!t) return;
  state.activeMmTab = id;
  const box = $('#split-map');
  const body = $('#sm-body');
  $('#sm-title').textContent = t.title;
  body.innerHTML = t.svg;
  const svg = body.querySelector('svg');
  if (svg) {
    svg.removeAttribute('style');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }
  box.hidden = false;
  document.body.classList.add('has-split');
  renderTabs();
}

function closeMmSplit() {
  $('#split-map').hidden = true;
  $('#sm-body').innerHTML = '';
  state.activeMmTab = null;
  document.body.classList.remove('has-split');
  renderTabs();
}

/* ═════════════ 启动 ═════════════ */
async function boot() {
  applySettings();
  try {
    await store.init();
  } catch (e) {
    console.error(e);
    toast('无法连接本地服务，功能可能受限', 4000);
  }
  // 旧版本主题迁移
  if (store.settings.theme === 'paper') store.settings.theme = 'white';
  applySettings();
  bindShelf();
  bindBulk();
  bindReader();
  bindSettings();
  bindSelection();
  bindKeys();
  bindZoom();
  bindKeyRecorder();
  bindDrop();
  bindSplit();
  bindGuide();
  renderShelf();
  try { renderTabs(); } catch { }

  // URL 直接打开：?open=<path>
  const params = new URLSearchParams(location.search);
  const openPath = params.get('open');
  if (openPath) {
    try {
      const meta = await api.meta(openPath);
      const book = store.addBook({ name: meta.name, path: meta.path, ext: meta.ext, size: meta.size });
      renderShelf();
      openBook(book);
    } catch (e) { toast('无法打开文件：' + e.message); }
  }

  setTimeout(() => $('#boot').classList.add('hide'), 260);

  // 第一次打开的人先看一遍功能介绍
  try {
    if (!store.data.settings.guideSeen) setTimeout(() => { try { openGuide(0); } catch { } }, 900);
  } catch { }
  if (params.get('shelf') === '1') switchView('shelf');

  // 分屏 iframe：只留正文，不显示工具栏/侧栏/标签
  if (params.get('pane') === '1') document.body.classList.add('is-pane');

  // 分窗口打开：?book=<id>&at=<滚动位置>
  const qBook = params.get('book');
  if (qBook) {
    const bk = store.books.find((b) => b.id === qBook);
    if (bk) {
      await openBook(bk);
      const at = Number(params.get('at'));
      if (at > 0) {
        setTimeout(() => {
          const d = $('#doc');
          if (d) d.scrollTop = at;
        }, 700);
      }
    }
  }

  // 桌面端桥接
  if (window.desktop?.isElectron) {
    document.body.classList.add('is-desktop');
    window.desktop.onOpenPaths((paths) => openPaths(paths));
    window.desktop.onAction((action) => { if (action === 'shelf') switchView('shelf'); });
  }
}

boot();

/* 调试/自动化入口（不影响正常使用） */
window.__folio = { store, api, state, openBook, renderShelf, switchView, makeMindMap, renderNoteAnchors, applyZoom, undoStep, redoStep };

/* 窗口关闭前保存 */
window.addEventListener('beforeunload', () => {
  if (state.current && state.viewer) {
    try {
      store.setProgress(state.current.id, state.viewer.progress(), state.viewer._location?.() || null);
    } catch { }
  }
});
