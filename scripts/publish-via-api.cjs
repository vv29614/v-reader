/**
 * 用 GitHub API 发布 v-editor（不需要 git push，绕开命令行登录）
 *
 * 用法：
 *   1) 把 Personal Access Token（勾 repo 权限）存到  D:\deepseek harness\.gh-token   （纯文本，一行）
 *   2) node publish-via-api.cjs
 *
 * 它会：建仓库（已存在则跳过）→ 提交全部源码 → 打 tag v1.1.0 → 建 Release → 上传安装包
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = 'v-reader';
const OWNER_OVERRIDE = null; // 留空则用 token 对应的账号
const VERSION = '1.1.0';
const SRC = 'D:/deepseek harness/Apps/DocReader';
const TOKEN_FILE = 'D:/deepseek harness/.gh-token';

const token = (() => {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  return '';
})();

if (!token) {
  console.log('缺少 token：请把 GitHub Personal Access Token（勾 repo）写入 ' + TOKEN_FILE);
  process.exit(1);
}

const API = 'https://api.github.com';
const H = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'v-editor-publisher',
  'X-GitHub-Api-Version': '2022-11-28'
};

async function api(method, url, body, raw) {
  const res = await fetch(API + url, {
    method,
    headers: raw ? { ...H, 'Content-Type': raw } : (body ? { ...H, 'Content-Type': 'application/json' } : H),
    body: raw ? body : (body ? JSON.stringify(body) : undefined)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { }
  if (!res.ok) {
    const msg = (json && json.message) || text.slice(0, 300);
    throw new Error(method + ' ' + url + ' -> ' + res.status + ' ' + msg);
  }
  return json;
}

function gitFiles() {
  const out = execSync('git -c core.quotepath=false ls-files', { cwd: SRC, encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean);
}

function readB64(rel) {
  return fs.readFileSync(path.join(SRC, rel)).toString('base64');
}

(async () => {
  let owner = OWNER_OVERRIDE;
  if (!owner) {
    const me = await api('GET', '/user');
    owner = me.login;
    console.log('账号: ' + owner);
  }

  // 1) 仓库
  let repo = null;
  try {
    repo = await api('GET', `/repos/${owner}/${REPO}`);
    console.log('仓库已存在: ' + repo.html_url);
  } catch (e) {
    if (!/404/.test(e.message)) throw e;
    repo = await api('POST', '/user/repos', {
      name: REPO,
      description: '本地优先的多格式文档阅读器（PDF / EPUB / DOCX / Markdown / 代码 / 漫画），带可拖拽笔记卡片、分屏双开与可选 AI 阅读辅助。不上传、无账号、无遥测。',
      private: false,
      has_issues: true,
      has_wiki: false,
      auto_init: false
    });
    console.log('已创建仓库: ' + repo.html_url);
  }

  const branch = repo.default_branch || 'main';
  const files = gitFiles();
  console.log('待提交文件: ' + files.length);

  // 空仓库不能直接建 blob，先用一次 contents 提交把 Git 初始化起来
  try {
    await api('GET', `/repos/${owner}/${REPO}/git/ref/heads/${branch}`);
    console.log('仓库已有提交，继续追加');
  } catch {
    console.log('仓库为空，先写入初始提交…');
    let ok = false;
    for (let i = 0; i < 5 && !ok; i++) {
      try {
        await api('PUT', `/repos/${owner}/${REPO}/contents/README.md`, {
          message: 'init: 初始化仓库',
          content: Buffer.from('# V 阅读器\n\n正在初始化…\n').toString('base64'),
          branch
        });
        ok = true;
      } catch (e) {
        console.log('  重试 ' + (i + 1) + '：' + e.message);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!ok) throw new Error('初始化仓库失败');
    console.log('初始化完成');
  }

  // 2) 逐个上传 blob（已存在同名 sha 的会复用，这里从简全部新建）
  const blobs = [];
  let done = 0;
  for (const f of files) {
    const content = readB64(f);
    const blob = await api('POST', `/repos/${owner}/${REPO}/git/blobs`, { content, encoding: 'base64' });
    blobs.push({ path: f.split(path.sep).join('/'), mode: '100644', type: 'blob', sha: blob.sha });
    done++;
    if (done % 20 === 0) console.log('  已上传 ' + done + '/' + files.length);
  }

  // 3) tree + commit + ref
  const tree = await api('POST', `/repos/${owner}/${REPO}/git/trees`, { tree: blobs });
  console.log('tree: ' + tree.sha);

  let parents = [];
  try {
    const head = await api('GET', `/repos/${owner}/${REPO}/git/ref/heads/${branch}`);
    parents = [head.object.sha];
  } catch { }
  // 空仓库也可能有 refs/heads/main 指向空树，忽略失败

  const commit = await api('POST', `/repos/${owner}/${REPO}/git/commits`, {
    message: 'V 阅读器 1.1.0：本地优先的多格式文档阅读器\n\n-' + ' 阅读：PDF / EPUB / DOCX / MD / TXT / HTML / 代码 / CSV / 图片 / CBZ\n- 笔记：可拖拽卡片、可捏形状的连线、侧栏与导出\n- 双开：同一窗口左右分屏\n- 标签栏：常驻首页、拖排序、拖出分屏\n- AI（可选）：整书问答、划词问、笔记 AI、批量标签\n- 其他：自动滚动与调速、朗读、24 页引导、首页批量处理',
    tree: tree.sha,
    parents
  });
  console.log('commit: ' + commit.sha);

  try {
    await api('POST', `/repos/${owner}/${REPO}/git/refs`, { ref: 'refs/heads/' + branch, sha: commit.sha });
    console.log('已创建分支 ' + branch);
  } catch (e) {
    await api('PATCH', `/repos/${owner}/${REPO}/git/refs/heads/${branch}`, { sha: commit.sha, force: true });
    console.log('已更新分支 ' + branch);
  }

  // 4) Release
  let release = null;
  try { release = await api('GET', `/repos/${owner}/${REPO}/releases/tags/v${VERSION}`); } catch { }
  if (!release) {
    const notes = fs.readFileSync(path.join(SRC, 'RELEASE-NOTES-1.1.0.md'), 'utf8');
    release = await api('POST', `/repos/${owner}/${REPO}/releases`, {
      tag_name: 'v' + VERSION,
      target_commitish: branch,
      name: 'V 阅读器 ' + VERSION,
      body: notes,
      draft: false,
      prerelease: false
    });
    console.log('已创建 Release: ' + release.html_url);
  } else {
    console.log('Release 已存在: ' + release.html_url);
  }

  // 5) 上传安装包
  const exe = path.join(SRC, 'release', 'VReader-Setup-' + VERSION + '.exe');
  const buf = fs.readFileSync(exe);
  const name = path.basename(exe);
  const uploadUrl = release.upload_url.replace('{?name,label}', '') + '?name=' + encodeURIComponent(name);
  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buf.length),
      'User-Agent': 'v-editor-publisher'
    },
    body: buf
  });
  if (!up.ok) {
    const t = await up.text();
    console.log('安装包上传失败: ' + up.status + ' ' + t.slice(0, 200));
  } else {
    const j = await up.json();
    console.log('安装包已上传: ' + j.browser_download_url);
  }

  console.log('\n完成：https://github.com/' + owner + '/' + REPO);
})().catch((e) => {
  console.log('失败: ' + e.message);
  process.exit(1);
});
