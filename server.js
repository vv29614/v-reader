'use strict';
/**
 * 纸间 Folio · 本地文档阅读器 后端
 * 纯 Node 原生实现，无框架依赖。负责：静态资源、本地文件读取(Range)、书架与阅读状态持久化、文件导入。
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DOCREADER_DATA ? path.resolve(process.env.DOCREADER_DATA) : path.join(ROOT, 'data');
const LIB = path.join(DATA, 'library');
const SHELF_FILE = path.join(DATA, 'shelf.json');
const STATE_FILE = path.join(DATA, 'state.json');

const PORT = Number(process.env.DOCREADER_PORT || 7788);
const HOST = '127.0.0.1';
const MAX_UPLOAD = 1024 * 1024 * 1024; // 1GB 上限

for (const d of [DATA, LIB]) fs.mkdirSync(d, { recursive: true });

const EDITABLE_EXT = ['.md', '.markdown', '.txt', '.log', '.csv', '.json', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.ps1', '.sql', '.xml', '.yaml', '.yml', '.css', '.html', '.htm', '.vue', '.lua', '.kt', '.swift'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip', '.cbz': 'application/vnd.comicbook+zip', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.rtf': 'application/rtf', '.csv': 'text/csv; charset=utf-8',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm'
};

const READABLE_EXT = new Set([
  '.pdf', '.epub', '.docx', '.md', '.markdown', '.txt', '.log', '.html', '.htm', '.xhtml',
  '.rtf', '.csv', '.cbz', '.zip',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.py', '.java', '.c', '.h', '.cpp', '.hpp',
  '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.bash', '.ps1', '.sql', '.json', '.xml', '.yaml', '.yml',
  '.toml', '.ini', '.conf', '.css', '.scss', '.less', '.lua', '.kt', '.swift', '.dart', '.r', '.m'
]);

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico']);

/* ---------------- 小工具 ---------------- */
const jsonReply = (res, obj, status = 200) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};
const fail = (res, msg, status = 400) => jsonReply(res, { ok: false, error: msg }, status);

function readJsonSync(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
async function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}
function safeName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'file';
}
function pretty(p) { return p ? path.resolve(p) : p; }

/* ---------------- 静态文件 ---------------- */
async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.join(PUBLIC, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!full.startsWith(PUBLIC)) return fail(res, 'forbidden', 403);
  let st;
  try { st = await fsp.stat(full); } catch { return notFound(res); }
  if (st.isDirectory()) return notFound(res);
  const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': st.size,
    'Cache-Control': 'no-store, must-revalidate',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(full).pipe(res);
}
function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 找不到该资源');
}

/* ---------------- 本地文件（支持 Range） ---------------- */
async function serveLocalFile(req, res, filePath) {
  if (!filePath) return fail(res, 'missing path');
  const full = path.resolve(filePath);
  let st;
  try { st = await fsp.stat(full); } catch { return fail(res, '文件不存在或不可访问: ' + full, 404); }
  if (st.isDirectory()) return fail(res, '这是一个目录', 400);

  const ext = path.extname(full).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const baseHeaders = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(full))}`
  };

  const range = req.headers.range;
  if (range && /^bytes=/.test(range)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.split(',')[0].trim());
    if (m) {
      let start = m[1] === '' ? null : parseInt(m[1], 10);
      let end = m[2] === '' ? null : parseInt(m[2], 10);
      if (start === null && end !== null) { start = Math.max(0, st.size - end); end = st.size - 1; }
      if (start !== null && end === null) end = st.size - 1;
      if (start === null || end === null || start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...baseHeaders, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(full, { start, end }).pipe(res);
    }
  }
  res.writeHead(200, { ...baseHeaders, 'Content-Length': st.size });
  fs.createReadStream(full).pipe(res);
}

/* ---------------- 目录浏览 ---------------- */
function quickPlaces() {
  const places = [];
  const home = os.homedir();
  const add = (label, p) => { try { if (p && fs.existsSync(p)) places.push({ label, path: path.resolve(p) }); } catch { } };
  add('桌面', path.join(home, 'Desktop'));
  try {
    const desk = require('child_process').execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v Desktop', { encoding: 'utf8' });
    const m = /REG_(?:EXPAND_)?SZ\s+(.+)/.exec(desk);
    if (m) add('桌面', m[1].replace(/%USERPROFILE%/gi, home).trim());
  } catch { }
  add('文档', path.join(home, 'Documents'));
  add('下载', path.join(home, 'Downloads'));
  add('D 盘', 'D:\\');
  add('DeepSeek Harness', 'D:\\deepseek harness');
  add('书库(导入)', LIB);
  return places;
}

async function listDir(dir) {
  const target = dir ? path.resolve(dir) : os.homedir();
  const st = await fsp.stat(target);
  if (!st.isDirectory()) throw new Error('不是目录');
  const entries = await fsp.readdir(target, { withFileTypes: true });
  const dirs = [], files = [];
  for (const e of entries) {
    if (e.name.startsWith('$') || e.name === 'System Volume Information') continue;
    const full = path.join(target, e.name);
    try {
      if (e.isDirectory()) { dirs.push({ name: e.name, path: full }); }
      else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        let size = 0, mtime = 0;
        try { const s = await fsp.stat(full); size = s.size; mtime = s.mtimeMs; } catch { }
        files.push({ name: e.name, path: full, ext, size, mtime, readable: READABLE_EXT.has(ext) || IMAGE_EXT.has(ext) });
      }
    } catch { }
  }
  const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  dirs.sort((a, b) => collator.compare(a.name, b.name));
  files.sort((a, b) => collator.compare(a.name, b.name));
  const parent = path.dirname(target);
  return { path: target, parent: parent === target ? null : parent, dirs, files, drives: listDrives() };
}

function listDrives() {
  const out = [];
  for (let i = 65; i <= 90; i++) {
    const d = String.fromCharCode(i) + ':\\';
    try { if (fs.existsSync(d)) out.push(d); } catch { }
  }
  return out;
}

/* ---------------- 上传 ---------------- */
function handleUpload(req, res, name) {
  const clean = safeName(name);
  const ext = path.extname(clean);
  const stem = path.basename(clean, ext);
  let target = path.join(LIB, clean);
  let i = 1;
  while (fs.existsSync(target)) { target = path.join(LIB, `${stem} (${i++})${ext}`); }

  const tmp = target + '.part';
  const ws = fs.createWriteStream(tmp);
  let size = 0, aborted = false;
  req.on('data', (c) => { size += c.length; if (size > MAX_UPLOAD) { aborted = true; req.destroy(); } });
  req.pipe(ws);
  ws.on('finish', async () => {
    if (aborted) { try { await fsp.unlink(tmp); } catch { } return fail(res, '文件超过 1GB 上限', 413); }
    try {
      await fsp.rename(tmp, target);
      const st = await fsp.stat(target);
      jsonReply(res, { ok: true, path: target, name: path.basename(target), size: st.size, ext: path.extname(target).toLowerCase() });
    } catch (e) { fail(res, '保存失败: ' + e.message, 500); }
  });
  ws.on('error', (e) => fail(res, '写入失败: ' + e.message, 500));
}

/* ---------------- 翻译 ---------------- */
const TRANS_CACHE_FILE = path.join(DATA, 'translate-cache.json');
let transCache = readJsonSync(TRANS_CACHE_FILE, {});
let transCacheDirty = false;
setInterval(() => {
  if (!transCacheDirty) return;
  transCacheDirty = false;
  const keys = Object.keys(transCache);
  if (keys.length > 600) {
    for (const k of keys.slice(0, keys.length - 600)) delete transCache[k];
  }
  writeJsonAtomic(TRANS_CACHE_FILE, transCache).catch(() => { });
}, 4000);

function detectLang(t) {
  const totalChars = t.replace(/\s/g, '').length || 1;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const kana = (t.match(/[\u3040-\u30ff]/g) || []).length;
  const hangul = (t.match(/[\uac00-\ud7af]/g) || []).length;
  if (kana / totalChars > 0.04) return 'ja-JP';
  if (hangul / totalChars > 0.04) return 'ko-KR';
  if (cjk / totalChars > 0.18) return 'zh-CN';
  if ((t.match(/[\u0400-\u04ff]/g) || []).length / totalChars > 0.2) return 'ru-RU';
  return 'en-US';
}

function splitForTranslate(text, max = 420) {
  const parts = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (buf.length >= max) {
      const cut = Math.max(
        buf.lastIndexOf('。'), buf.lastIndexOf('！'), buf.lastIndexOf('？'),
        buf.lastIndexOf('. '), buf.lastIndexOf('; '), buf.lastIndexOf('，'), buf.lastIndexOf(', ')
      );
      if (cut > max * 0.45) { parts.push(buf.slice(0, cut + 1)); buf = buf.slice(cut + 1); }
      else { parts.push(buf); buf = ''; }
    }
  }
  if (buf.trim()) parts.push(buf);
  return parts.filter((p) => p.trim());
}

async function mymemoryTranslate(text, from, to) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(from + '|' + to)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('翻译服务返回 ' + res.status);
  const j = await res.json();
  if (j.responseStatus && j.responseStatus !== 200) throw new Error(j.responseDetails || '翻译失败');
  const t = j.responseData && j.responseData.translatedText;
  if (!t) throw new Error('翻译结果为空');
  return t;
}

async function handleTranslate(req, res) {
  const body = await readBody(req, 1024 * 1024);
  let data = {};
  try { data = JSON.parse(body || '{}'); } catch { }
  const text = String(data.text || '').trim();
  if (!text) return fail(res, '没有要翻译的内容');
  if (text.length > 6000) return fail(res, '一次最多翻译 6000 字');

  const from = data.from && data.from !== 'auto' ? data.from : detectLang(text);
  let to = data.to || (from.startsWith('zh') ? 'en-US' : 'zh-CN');
  if (to === from) to = to.startsWith('zh') ? 'en-US' : 'zh-CN';

  const key = `${from}|${to}|${text}`;
  if (transCache[key]) return jsonReply(res, { ok: true, translated: transCache[key], from, to, cached: true });

  try {
    const chunks = splitForTranslate(text);
    const out = [];
    for (const c of chunks) {
      out.push(await mymemoryTranslate(c, from, to));
      if (chunks.length > 1) await new Promise((r) => setTimeout(r, 120));
    }
    const translated = out.join(' ');
    transCache[key] = translated;
    transCacheDirty = true;
    jsonReply(res, { ok: true, translated, from, to, chunks: chunks.length });
  } catch (e) {
    fail(res, '翻译失败：' + e.message, 502);
  }
}

/* ---------------- AI 代理（OpenAI 兼容） ---------------- */
async function handleAiChat(req, res) {
  const body = await readBody(req, 2 * 1024 * 1024);
  let data = {};
  try { data = JSON.parse(body || '{}'); } catch { }
  const baseUrl = String(data.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const apiKey = String(data.apiKey || '');
  const model = String(data.model || 'deepseek-chat');
  const messages = Array.isArray(data.messages) ? data.messages : [];
  if (!messages.length) return fail(res, '缺少 messages');
  if (!apiKey) return fail(res, '还没有填写 API Key', 400);
  try {
    const r = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages, temperature: data.temperature ?? 0.3, max_tokens: data.maxTokens || 800 }),
      signal: AbortSignal.timeout(60000)
    });
    const txt = await r.text();
    if (!r.ok) return fail(res, `接口返回 ${r.status}：${txt.slice(0, 300)}`, 502);
    const j = JSON.parse(txt);
    const content = j.choices?.[0]?.message?.content || '';
    jsonReply(res, { ok: true, content });
  } catch (e) {
    fail(res, 'AI 请求失败：' + e.message, 502);
  }
}

/* ---------------- 主服务 ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const p = u.pathname;
  try {
    if (p.startsWith('/api/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
        return res.end();
      }
      if (p === '/api/ping') return jsonReply(res, { ok: true, name: '纸间 Folio', version: '1.0.0', pid: process.pid });

      if (p === '/api/shelf' && req.method === 'GET') return jsonReply(res, { ok: true, books: readJsonSync(SHELF_FILE, []).books || [] });
      if (p === '/api/shelf' && req.method === 'POST') {
        const body = await readBody(req, 8 * 1024 * 1024);
        const data = JSON.parse(body || '{}');
        await writeJsonAtomic(SHELF_FILE, { books: Array.isArray(data.books) ? data.books : [] });
        return jsonReply(res, { ok: true });
      }
      if (p === '/api/state' && req.method === 'GET') return jsonReply(res, { ok: true, state: readJsonSync(STATE_FILE, {}) });
      if (p === '/api/state' && req.method === 'POST') {
        const body = await readBody(req, 32 * 1024 * 1024);
        const incoming = JSON.parse(body || '{}');
        const cur = readJsonSync(STATE_FILE, {});
        const merged = { ...cur, ...incoming };
        if (incoming.progress) merged.progress = { ...(cur.progress || {}), ...incoming.progress };
        if (incoming.marks) merged.marks = { ...(cur.marks || {}), ...incoming.marks };
        if (incoming.notes) merged.notes = { ...(cur.notes || {}), ...incoming.notes };
        await writeJsonAtomic(STATE_FILE, merged);
        return jsonReply(res, { ok: true });
      }
      if (p === '/api/places') return jsonReply(res, { ok: true, places: quickPlaces(), home: os.homedir(), drives: listDrives() });
      if (p === '/api/dir') {
        try { return jsonReply(res, { ok: true, ...(await listDir(u.searchParams.get('path') || '')) }); }
        catch (e) { return fail(res, e.message, 400); }
      }
      if (p === '/api/file') return serveLocalFile(req, res, u.searchParams.get('path'));
      if (p === '/api/meta') {
        const fp = u.searchParams.get('path');
        if (!fp) return fail(res, 'missing path');
        try {
          const st = await fsp.stat(fp);
          return jsonReply(res, { ok: true, path: path.resolve(fp), name: path.basename(fp), size: st.size, mtime: st.mtimeMs, ext: path.extname(fp).toLowerCase() });
        } catch { return fail(res, '文件不存在', 404); }
      }
      if (p === '/api/upload' && req.method === 'POST') return handleUpload(req, res, u.searchParams.get('name'));
      if (p === '/api/translate' && req.method === 'POST') return handleTranslate(req, res);
      if (p === '/api/ai/chat' && req.method === 'POST') return handleAiChat(req, res);
      if (p === '/api/reveal' && req.method === 'POST') {
        const fp = u.searchParams.get('path');
        if (!fp) return fail(res, 'missing path');
        const { spawn } = require('child_process');
        spawn('explorer.exe', ['/select,', path.resolve(fp)], { detached: true, stdio: 'ignore' }).unref();
        return jsonReply(res, { ok: true });
      }
      if (p === '/api/save-doc' && req.method === 'POST') {
        const body = await readBody(req, 32 * 1024 * 1024);
        const { path: fp, content } = JSON.parse(body || '{}');
        if (!fp) return fail(res, 'missing path');
        const target = path.resolve(fp);
        const ext = path.extname(target).toLowerCase();
        if (!EDITABLE_EXT.includes(ext)) return fail(res, '这个格式不支持编辑保存', 400);
        // 只允许写书库里登记过的文件，避免任意路径写入
        let allowed = false;
        try {
          const shelf = JSON.parse(await fsp.readFile(path.join(DATA, 'shelf.json'), 'utf8'));
          allowed = (shelf.books || []).some((b) => b.path && path.resolve(b.path) === target);
        } catch { }
        if (!allowed) return fail(res, '这个文件不在书库里，拒绝写入', 403);
        try {
          const st = await fsp.stat(target);
          if (st.size > 32 * 1024 * 1024) return fail(res, '文件太大', 400);
        } catch { return fail(res, '文件不存在', 404); }
        // 保存前留一份 .bak（只保留最近一份），防止写坏了没法回退
        const bak = target + '.bak';
        try { await fsp.copyFile(target, bak); } catch { }
        await fsp.writeFile(target, content || '', 'utf8');
        return jsonReply(res, { ok: true, path: target, size: (content || '').length });
      }
      if (p === '/api/save-note' && req.method === 'POST') {
        const body = await readBody(req, 16 * 1024 * 1024);
        const { name, content } = JSON.parse(body || '{}');
        const out = path.join(DATA, 'exports');
        await fsp.mkdir(out, { recursive: true });
        const file = path.join(out, safeName(name || 'notes.md'));
        await fsp.writeFile(file, content || '', 'utf8');
        return jsonReply(res, { ok: true, path: file });
      }
      return fail(res, 'unknown api', 404);
    }
    return serveStatic(req, res, p);
  } catch (e) {
    console.error('[error]', p, e);
    if (!res.headersSent) fail(res, e.message || '内部错误', 500);
    else try { res.end(); } catch { }
  }
});

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* 端口占用自动顺延 */
let serverReady = false;
function start(port, attempts = 12, onReady) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempts > 0) {
      console.log(`端口 ${port} 被占用，尝试 ${port + 1} ...`);
      setTimeout(() => start(port + 1, attempts - 1, onReady), 150);
    } else {
      console.error('启动失败:', e.message);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => {
    const addr = server.address();
    console.log('');
    console.log('  ┌────────────────────────────────────────────┐');
    console.log('  │   纸间 Folio · 本地文档阅读器已启动        │');
    console.log('  └────────────────────────────────────────────┘');
    console.log(`  地址:  http://${HOST}:${addr.port}`);
    console.log(`  书库:  ${LIB}`);
    console.log('  关闭本窗口即可退出。');
    console.log('');
    try {
      fs.mkdirSync(DATA, { recursive: true });
      fs.writeFileSync(path.join(DATA, 'runtime.json'), JSON.stringify({ port: addr.port, pid: process.pid, startedAt: Date.now() }));
    } catch { }
    if (typeof onReady === 'function' && !serverReady) {
      serverReady = true;
      onReady(addr.port);
    }
  });
}

module.exports = { start, server, DATA, LIB };

if (require.main === module) start(PORT);
