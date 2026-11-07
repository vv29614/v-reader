/* electron-builder 钩子：打包后用 rcedit 写入图标与版本信息
   （不依赖 winCodeSign，绕开普通用户无法创建符号链接的问题） */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
  const root = path.join(__dirname, '..');
  const dir = context.appOutDir;

  // 不写死 exe 名：取打包目录里的主程序（排除卸载器）
  let exe = null;
  try {
    exe = fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.exe') && !/^unins/i.test(f))
      .map((f) => path.join(dir, f))[0] || null;
  } catch { }

  if (!exe) {
    console.warn('  · 未找到主 exe，跳过 rcedit');
    return;
  }

  const rcedit = path.join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  const icon = path.join(root, 'build', 'icon.ico');
  const pkg = require(path.join(root, 'package.json'));
  const name = pkg.productName || 'V 阅读器';

  if (!fs.existsSync(rcedit)) { console.warn('  · 缺少 rcedit，跳过'); return; }
  if (!fs.existsSync(icon)) { console.warn('  · 缺少 build/icon.ico，跳过'); return; }

  try {
    execFileSync(rcedit, [
      exe,
      '--set-icon', icon,
      '--set-file-version', pkg.version,
      '--set-product-version', pkg.version,
      '--set-version-string', 'ProductName', name,
      '--set-version-string', 'FileDescription', name,
      '--set-version-string', 'CompanyName', 'V Reader'
    ], { stdio: 'inherit' });
    console.log('  · rcedit applied: ' + path.basename(exe));
  } catch (e) {
    console.warn('  · rcedit failed: ' + e.message);
  }
};
