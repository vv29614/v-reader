'use strict';
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

/* 单实例 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  /* 数据目录策略
     - 开发（未打包）：源码目录旁的 data/
     - 打包安装版：用户数据目录下的 data/（D:\Roaming\V编辑器\data）
       早期把 data 放在安装目录，覆盖安装时会被安装器清空，导致书库丢失，
       所以安装版一律不写安装目录。
     - 想用便携模式：在程序目录放一个 portable.txt，就会用旁边的 data/（升级前请自行备份） */
  function resolveDataDir() {
    const probe = (dir) => {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, '.write-test');
        fs.writeFileSync(f, '1');
        fs.unlinkSync(f);
        return true;
      } catch { return false; }
    };

    if (!app.isPackaged) {
      const dev = path.join(__dirname, 'data');
      if (probe(dev)) return dev;
    } else {
      const exeDir = path.dirname(process.execPath);
      const portableFlag = path.join(exeDir, 'portable.txt');
      if (fs.existsSync(portableFlag)) {
        const portable = path.join(exeDir, 'data');
        if (probe(portable)) return portable;
      }
    }

    const userData = path.join(app.getPath('userData'), 'data');
    if (probe(userData)) return userData;
    return path.join(path.dirname(process.execPath), 'data');
  }
  const DATA_DIR = resolveDataDir();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  process.env.DOCREADER_DATA = DATA_DIR;

  const { start } = require('./server.js');

  /* 首次运行：放入一本欢迎手册 */
  function ensureStarter() {
    try {
      const libDir = path.join(DATA_DIR, 'library');
      const shelfFile = path.join(DATA_DIR, 'shelf.json');
      fs.mkdirSync(libDir, { recursive: true });
      if (fs.existsSync(shelfFile)) return;
      const src = path.join(__dirname, 'welcome', '欢迎使用V 编辑器.md');
      if (!fs.existsSync(src)) return;
      const dst = path.join(libDir, '欢迎使用V 编辑器.md');
      fs.copyFileSync(src, dst);
      const st = fs.statSync(dst);
      fs.writeFileSync(shelfFile, JSON.stringify({
        books: [{
          id: 'welcome00001',
          name: '欢迎使用V 编辑器.md',
          path: dst,
          ext: '.md',
          kind: 'markdown',
          size: st.size,
          addedAt: Date.now(),
          lastOpened: 0,
          progress: 0,
          location: null,
          cover: false
        }]
      }, null, 2), 'utf8');
    } catch (e) { }
  }
  ensureStarter();

  const LOG = path.join(DATA_DIR, 'main.log');
  const log = (...a) => { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, new Date().toISOString() + ' ' + a.map(String).join(' ') + '\n'); } catch { } };
  process.on('uncaughtException', (e) => { log('UNCAUGHT', e.stack || e.message); });
  process.on('unhandledRejection', (e) => { log('REJECT', (e && e.stack) || String(e)); });

  let win = null;
  let serverPort = 0;

  function createWindow(port) {
    win = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 960,
      minHeight: 640,
      show: false,
      backgroundColor: '#efe9dc',
      title: 'V 编辑器',
      autoHideMenuBar: true,
      icon: path.join(__dirname, 'public', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        sandbox: false
      }
    });

    win.loadURL(`http://127.0.0.1:${port}`);
    win.once('ready-to-show', () => win.show());
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(`http://127.0.0.1:${port}`)) e.preventDefault();
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.on('closed', () => { win = null; });
  }

  function extractFiles(argv) {
    const out = [];
    for (const a of argv.slice(1)) {
      if (!a || a.startsWith('-')) continue;
      try {
        if (fs.existsSync(a) && fs.statSync(a).isFile()) out.push(a);
      } catch { }
    }
    return out;
  }

  function sendOpen(paths) {
    if (!win) return;
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => win.webContents.send('app:open-paths', paths));
    } else {
      win.webContents.send('app:open-paths', paths);
    }
  }

  function buildMenu() {
    const template = [
      {
        label: '文件',
        submenu: [
          {
            label: '导入书籍…', accelerator: 'CmdOrCtrl+O',
            click: async () => {
              const r = await dialog.showOpenDialog(win, {
                title: '选择要阅读的文件',
                properties: ['openFile', 'multiSelections'],
                filters: [
                  { name: '所有支持的文档', extensions: ['pdf', 'epub', 'docx', 'md', 'markdown', 'txt', 'log', 'html', 'htm', 'xhtml', 'rtf', 'csv', 'cbz', 'zip', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'py', 'js', 'ts', 'json', 'java', 'c', 'cpp', 'go', 'rs'] },
                  { name: '所有文件', extensions: ['*'] }
                ]
              });
              if (!r.canceled && r.filePaths.length) sendOpen(r.filePaths);
            }
          },
          {
            label: '打开文件夹…',
            click: async () => {
              const r = await dialog.showOpenDialog(win, { title: '选择书库文件夹', properties: ['openDirectory'] });
              if (!r.canceled && r.filePaths.length) sendOpen(r.filePaths);
            }
          },
          { type: 'separator' },
          { label: '返回书架', click: () => win && win.webContents.send('app:action', 'shelf') },
          { type: 'separator' },
          { label: '退出', role: 'quit' }
        ]
      },
      {
        label: '编辑',
        submenu: [
          { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' },
          { type: 'separator' },
          { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' },
          { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }
        ]
      },
      {
        label: '视图',
        submenu: [
          { label: '放大界面', role: 'zoomIn' },
          { label: '缩小界面', role: 'zoomOut' },
          { label: '实际大小', role: 'resetZoom' },
          { type: 'separator' },
          { label: '全屏', role: 'togglefullscreen' },
          { label: '开发者工具', role: 'toggleDevTools' }
        ]
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '关于V 编辑器',
            click: () => dialog.showMessageBox(win, {
              type: 'info',
              title: '关于V 编辑器',
              message: 'V 编辑器 · 本地文档阅读器',
              detail: `版本 1.0.0\nElectron ${process.versions.electron}\n\n支持 PDF / EPUB / Word / Markdown / TXT / HTML / RTF / CSV / 代码 / 图片 / CBZ 漫画。\n所有文件只在本机解析，书库位置：\n${DATA_DIR}`,
              buttons: ['好']
            })
          }
        ]
      }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  ipcMain.handle('dialog:openFile', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择要阅读的文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '所有支持的文档', extensions: ['pdf', 'epub', 'docx', 'md', 'markdown', 'txt', 'log', 'html', 'htm', 'xhtml', 'rtf', 'csv', 'cbz', 'zip', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'py', 'js', 'ts', 'json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: '选择文件夹', properties: ['openDirectory'] });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('shell:reveal', async (_e, p) => {
    try { shell.showItemInFolder(p); return true; } catch { return false; }
  });

  ipcMain.handle('win:openBook', (_e, bookId, at) => {
    if (!serverPort) return false;
    const q = new URLSearchParams();
    if (bookId) q.set('book', String(bookId));
    if (at) q.set('at', String(Math.round(Number(at) || 0)));
    const extra = new BrowserWindow({
      width: 1180, height: 860, minWidth: 860, minHeight: 560,
      show: false, backgroundColor: '#efe9dc', title: 'V 编辑器（对照窗口）',
      autoHideMenuBar: true, icon: path.join(__dirname, 'public', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false, sandbox: false }
    });
    extra.loadURL('http://127.0.0.1:' + serverPort + '/?' + q.toString());
    extra.once('ready-to-show', () => extra.show());
    extra.webContents.on('will-navigate', (ev, url) => { if (!url.startsWith('http://127.0.0.1:' + serverPort)) ev.preventDefault(); });
    return true;
  });

  ipcMain.handle('win:togglePin', () => {
    if (!win) return false;
    const next = !win.isAlwaysOnTop();
    win.setAlwaysOnTop(next);
    return next;
  });

  ipcMain.handle('app:associate', () => {
    try {
      const { execFileSync } = require('child_process');
      const exe = process.execPath;
      const exts = ['pdf', 'epub', 'docx', 'md', 'txt', 'html', 'rtf', 'csv', 'cbz'];
      const reg = (...args) => execFileSync('reg.exe', args, { windowsHide: true, stdio: 'ignore' });
      reg('add', 'HKCU\\Software\\Classes\\Folio.Document', '/ve', '/d', 'V 编辑器文档', '/f');
      reg('add', 'HKCU\\Software\\Classes\\Folio.Document\\DefaultIcon', '/ve', '/d', `"${exe}",0`, '/f');
      reg('add', 'HKCU\\Software\\Classes\\Folio.Document\\shell\\open\\command', '/ve', '/d', `"${exe}" "%1"`, '/f');
      for (const ext of exts) {
        // 登记为「打开方式」候选，不强制改默认
        reg('add', `HKCU\\Software\\Classes\\.${ext}\\OpenWithProgids`, '/v', 'Folio.Document', '/t', 'REG_SZ', '/d', '', '/f');
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    const files = extractFiles(argv || []);
    if (files.length) sendOpen(files);
  });

  app.whenReady().then(() => {
    buildMenu();
    log('app ready, data dir', DATA_DIR);
    start(7788, 20, (port) => {
      serverPort = port;
      log('server started on', port);
      createWindow(port);
      const files = extractFiles(process.argv);
      if (files.length) {
        log('open from argv', files.join(' | '));
        win.webContents.once('did-finish-load', () => {
          setTimeout(() => sendOpen(files), 800);
        });
      }
    });
  }).catch((e) => log('WHENREADY FAIL', e.stack || e.message));

  app.on('window-all-closed', () => { app.quit(); });
  app.on('activate', () => { if (!win && serverPort) createWindow(serverPort); });
}
