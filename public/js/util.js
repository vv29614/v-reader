/* 通用工具 */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const debounce = (fn, ms = 200) => {
  let t; const w = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  w.cancel = () => clearTimeout(t); return w;
};
export const throttle = (fn, ms = 100) => {
  let last = 0, timer = null, lastArgs;
  return (...a) => {
    lastArgs = a;
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); fn(...lastArgs); }, ms - (now - last));
  };
};

export function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const diff = now - d;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
  if (diff < 86400e3 && d.getDate() === now.getDate()) return '今天 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (diff < 7 * 86400e3) return Math.floor(diff / 86400e3) + ' 天前';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
export const extOf = (name = '') => {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? '.' + m[1].toLowerCase() : '';
};
export const baseName = (p = '') => p.split(/[\\/]/).pop() || p;
export const dirName = (p = '') => p.replace(/[\\/][^\\/]*$/, '');

export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico']);
export const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.py', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.bash', '.ps1', '.sql', '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf', '.css', '.scss', '.less', '.lua', '.kt', '.swift', '.dart', '.r', '.m']);
export const TEXT_EXT = new Set(['.txt', '.log', '.md', '.markdown', '.html', '.htm', '.xhtml', '.rtf', '.csv']);
export const BOOK_EXT = new Set(['.pdf', '.epub', '.docx', '.mobi', '.azw3', '.djvu', '.fb2']);
export const ARCHIVE_EXT = new Set(['.cbz', '.zip']);

export function kindOf(ext, name = '') {
  if (ext === '.pdf') return 'pdf';
  if (ext === '.epub') return 'epub';
  if (ext === '.docx') return 'docx';
  if (ext === '.doc') return 'doc';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.html' || ext === '.htm' || ext === '.xhtml') return 'html';
  if (ext === '.txt' || ext === '.log') return 'txt';
  if (ext === '.rtf') return 'rtf';
  if (ext === '.csv') return 'csv';
  if (ext === '.cbz') return 'comic';
  if (ext === '.zip') return 'zip';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (CODE_EXT.has(ext)) return 'code';
  return 'unknown';
}

export const TYPE_LABEL = {
  pdf: 'PDF', epub: 'EPUB', docx: 'DOCX', doc: 'DOC', markdown: 'MD', html: 'HTML',
  txt: 'TXT', rtf: 'RTF', csv: 'CSV', comic: 'CBZ', zip: 'ZIP', image: 'IMG', code: 'CODE', unknown: 'FILE'
};

/* 封面配色：按文件名稳定哈希 */
const COVER_PALETTES = [
  ['#2f4858', '#33658a'], ['#5b3a29', '#8c5a3c'], ['#3c4f3d', '#6b8f71'],
  ['#4a2c40', '#7d4e6d'], ['#2b3a55', '#54708f'], ['#5c4527', '#9a7b4f'],
  ['#33272a', '#594a4e'], ['#1f3a3d', '#3f7270'], ['#4d3319', '#8a6234'],
  ['#2a2b3d', '#565a8c'], ['#55332c', '#9c5f4e'], ['#263f31', '#4f7a5c']
];
export function coverColors(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const p = COVER_PALETTES[h % COVER_PALETTES.length];
  return { from: p[0], to: p[1] };
}

/* 文本解码（UTF-8 / GBK / UTF-16 自动识别） */
export function decodeText(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length > 2 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder('utf-8').decode(u8.subarray(3));
  if (u8.length > 1 && u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
  if (u8.length > 1 && u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
  catch {
    try { return new TextDecoder('gbk').decode(u8); }
    catch { return new TextDecoder('utf-8').decode(u8); }
  }
}

export const escapeHtml = (s = '') => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('已复制'); }
  catch {
    const ta = el('textarea', { style: { position: 'fixed', opacity: 0 } });
    ta.value = text; document.body.append(ta); ta.select();
    document.execCommand('copy'); ta.remove(); toast('已复制');
  }
}

export function hashId(str) {
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0; h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 + c) >>> 0; h2 = Math.imul(h2, 2246822519) >>> 0;
  }
  return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
}

/* IndexedDB：封面缓存 */
const IDB_NAME = 'folio-reader';
let idbPromise = null;
function idb() {
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return idbPromise;
}
export async function putCover(id, blob) {
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const tx = db.transaction('covers', 'readwrite');
      tx.objectStore('covers').put(blob, id);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch { }
}
export async function getCover(id) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const tx = db.transaction('covers', 'readonly');
      const r = tx.objectStore('covers').get(id);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  } catch { return null; }
}
export async function delCover(id) {
  try {
    const db = await idb();
    await new Promise((res) => {
      const tx = db.transaction('covers', 'readwrite');
      tx.objectStore('covers').delete(id);
      tx.oncomplete = res;
    });
  } catch { }
}

/* 从 HTML 字符串提取大纲 */
export function outlineFromHtml(html, doc = document) {
  const box = doc.createElement('div');
  box.innerHTML = html;
  return Array.from(box.querySelectorAll('h1,h2,h3,h4')).map((h, i) => ({
    id: h.id, title: h.textContent.trim(), level: Number(h.tagName[1]) || 1, index: i
  })).filter((x) => x.title);
}

/* 文件选择：统一读取为 ArrayBuffer / text / blobURL */
export function readAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsArrayBuffer(file);
  });
}

export function textToParagraphs(text) {
  return text.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
}
