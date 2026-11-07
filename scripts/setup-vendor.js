/* 从 node_modules 把前端库复制到 public/vendor
   仓库不提交 vendor（含大量二进制字体），克隆后跑一次 npm run setup 即可 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = path.join(root, 'public', 'vendor');

fs.mkdirSync(out, { recursive: true });

const copy = (src, destName) => {
  if (!fs.existsSync(src)) {
    console.warn('  missing:', src);
    return false;
  }
  fs.cpSync(src, path.join(out, destName), { recursive: true, force: true });
  return true;
};

const steps = [
  ['pdf.js 主程序', () => copy(nm('pdfjs-dist', 'build', 'pdf.min.mjs'), 'pdf.min.mjs')],
  ['pdf.js worker', () => copy(nm('pdfjs-dist', 'build', 'pdf.worker.min.mjs'), 'pdf.worker.min.mjs')],
  ['pdf.js 中文字体映射', () => copy(nm('pdfjs-dist', 'cmaps'), 'cmaps')],
  ['pdf.js 标准字体', () => copy(nm('pdfjs-dist', 'standard_fonts'), 'standard_fonts')],
  ['JSZip', () => copy(nm('jszip', 'dist', 'jszip.min.js'), 'jszip.min.js')],
  ['mammoth', () => copy(nm('mammoth', 'mammoth.browser.min.js'), 'mammoth.browser.min.js')],
  ['marked', () => copy(nm('marked', 'lib', 'marked.umd.js'), 'marked.umd.js')],
  ['DOMPurify', () => copy(nm('dompurify', 'dist', 'purify.min.js'), 'purify.min.js')],
  ['highlight.js', () => copy(nm('@highlightjs', 'cdn-assets', 'highlight.min.js'), 'hljs.min.js')],
  ['highlight.js 亮色主题', () => copy(nm('@highlightjs', 'cdn-assets', 'styles', 'github.min.css'), 'hljs-light.css')],
  ['highlight.js 暗色主题', () => copy(nm('@highlightjs', 'cdn-assets', 'styles', 'github-dark.min.css'), 'hljs-dark.css')]
];

let ok = 0;
for (const [name, fn] of steps) {
  const done = fn();
  console.log(`  ${done ? '✓' : '✗'} ${name}`);
  if (done) ok++;
}

/* 图标：base64 文本还原成 ico */
const b64 = path.join(root, 'build', 'icon.ico.b64');
if (fs.existsSync(b64)) {
  const data = fs.readFileSync(b64, 'utf8').replace(/\s+/g, '');
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.from(data, 'base64'));
  console.log('  ✓ build/icon.ico（从 base64 还原）');
}

console.log(`\n完成：${ok}/${steps.length} 个资源已就绪`);
