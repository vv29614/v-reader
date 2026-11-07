/* 与本地服务通讯 + 全局状态 */
import { debounce, hashId, baseName, extOf, kindOf, toast } from './util.js';

async function req(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch { }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  ping: () => req('/api/ping'),
  shelf: {
    get: () => req('/api/shelf'),
    save: (books) => req('/api/shelf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ books }) })
  },
  state: {
    get: () => req('/api/state'),
    save: (patch) => req('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
  },
  places: () => req('/api/places'),
  dir: (p) => req('/api/dir?path=' + encodeURIComponent(p || '')),
  meta: (p) => req('/api/meta?path=' + encodeURIComponent(p)),
  reveal: (p) => req('/api/reveal?path=' + encodeURIComponent(p), { method: 'POST' }),
  saveNoteFile: (name, content) => req('/api/save-note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content }) }),
  fileUrl: (p) => '/api/file?path=' + encodeURIComponent(p),
  fetchArrayBuffer: async (p, onProgress) => {
    const res = await fetch(api.fileUrl(p));
    if (!res.ok) throw new Error('读取文件失败：' + res.status);
    if (!onProgress || !res.body) return res.arrayBuffer();
    const total = Number(res.headers.get('Content-Length') || 0);
    const reader = res.body.getReader();
    const chunks = []; let got = 0;
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (total) onProgress(Math.min(0.99, got / total));
    }
    const out = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out.buffer;
  },
  upload: (file, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload?name=' + encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        j.ok ? resolve(j) : reject(new Error(j.error || '导入失败'));
      } catch { reject(new Error('导入失败')); }
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.send(file);
  })
};

export const DEFAULT_SETTINGS = {
  theme: 'white',
  font: 'song',
  size: 18,
  lh: 1.85,
  width: 720,
  para: 0.9,
  layout: 'scroll',
  indent: true,
  autohide: true,
  pdfNight: true,
  ttsAuto: false,
  rate: 1.0,
  voice: '',
  aiBase: '',
  aiModel: '',
  aiKey: '',
  autoTransPrompt: true,
  noteArrowStyle: 'curve',
  noteGap: 34,
  noteColor: '#d04a35',
  noteFs: 11.5,
  noteFontSize: 12.5,
  noteFont: 'auto',
  noteInk: '#3d434d',
  noteBg: 'auto',
  noteW: 176
};

export const store = {
  books: [],
  data: { progress: {}, marks: {}, settings: { ...DEFAULT_SETTINGS }, stats: {} },
  currentId: null,

  async init() {
    const [shelf, state] = await Promise.all([
      api.shelf.get().catch(() => ({ books: [] })),
      api.state.get().catch(() => ({ state: {} }))
    ]);
    this.books = shelf.books || [];
    this.data = Object.assign({ progress: {}, marks: {}, settings: {}, stats: {} }, state.state || {});
    this.data.settings = Object.assign({ ...DEFAULT_SETTINGS }, this.data.settings || {});
    return this;
  },

  get settings() { return this.data.settings; },

  saveShelf: debounce(function () {
    api.shelf.save(store.books).catch(() => { });
  }, 350),

  saveState: debounce(function () {
    api.state.save({
      progress: store.data.progress,
      marks: store.data.marks,
      settings: store.data.settings,
      stats: store.data.stats
    }).catch(() => { });
  }, 600),

  /* ── 书架 ── */
  findBook(id) { return this.books.find((b) => b.id === id); },
  findBookByPath(path) { return this.books.find((b) => b.path === path); },

  addBook(info) {
    const id = info.id || hashId(info.path || info.name + Date.now());
    const exists = this.books.find((b) => b.id === id || (info.path && b.path === info.path));
    if (exists) { exists.lastOpened = Date.now(); this.saveShelf(); return exists; }
    const book = {
      id,
      name: info.name || baseName(info.path || '未命名'),
      path: info.path || '',
      ext: info.ext || extOf(info.name || info.path || ''),
      kind: info.kind || kindOf(info.ext || extOf(info.name || info.path || '')),
      size: info.size || 0,
      addedAt: Date.now(),
      lastOpened: 0,
      progress: 0,
      location: null,
      cover: false,
      tags: []
    };
    this.books.unshift(book);
    this.saveShelf();
    return book;
  },

  removeBook(id) {
    const i = this.books.findIndex((b) => b.id === id);
    if (i >= 0) this.books.splice(i, 1);
    delete this.data.progress[id];
    delete this.data.marks[id];
    this.saveShelf(); this.saveState();
  },

  touchBook(id) {
    const b = this.findBook(id);
    if (b) { b.lastOpened = Date.now(); this.saveShelf(); }
    return b;
  },

  /* ── 进度 ── */
  setProgress(id, p, location) {
    const b = this.findBook(id);
    if (b) { b.progress = p; b.lastOpened = Date.now(); if (location) b.location = location; this.saveShelf(); }
    this.data.progress[id] = { p, ts: Date.now(), location: location || null };
    this.saveState();
  },

  getProgress(id) {
    const b = this.findBook(id);
    return b ? (b.progress || 0) : 0;
  },

  getLocation(id) {
    const b = this.findBook(id);
    return (this.data.progress[id] && this.data.progress[id].location) || (b && b.location) || null;
  },

  /* ── 标注 ── */
  marksOf(id) { return this.data.marks[id] || (this.data.marks[id] = []); },
  addMark(id, mark) {
    const list = this.marksOf(id);
    const m = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), createdAt: Date.now(), ...mark };
    list.unshift(m); this.saveState(); return m;
  },
  removeMark(id, markId) {
    const list = this.marksOf(id);
    const i = list.findIndex((m) => m.id === markId);
    if (i >= 0) list.splice(i, 1);
    this.saveState();
  },
  updateMark(id, markId, patch) {
    const m = this.marksOf(id).find((x) => x.id === markId);
    if (m) { Object.assign(m, patch); this.saveState(); }
  },

  /* ── 设置 ── */
  setSetting(key, value) {
    this.data.settings[key] = value;
    this.saveState();
  },

  /* ── 统计 ── */
  addReadingTime(id, ms) {
    if (!this.data.stats) this.data.stats = {};
    const s = this.data.stats[id] || (this.data.stats[id] = { ms: 0 });
    s.ms += ms; this.saveState();
  }
};
