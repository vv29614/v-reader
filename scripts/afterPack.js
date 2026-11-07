/* electron-builder 钩子：打包后用 rcedit 写入图标与版本信息
   （不依赖 winCodeSign，绕开普通用户无法创建符号链接的问题） */
const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
  const root = path.join(__dirname, '..');
  const exe = path.join(context.appOutDir, 'V编辑器.exe');
  const rcedit = path.join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  const icon = path.join(root, 'build', 'icon.ico');
  try {
    execFileSync(rcedit, [
      exe,
      '--set-icon', icon,
      '--set-file-version', '1.1.0',
      '--set-product-version', '1.1.0',
      '--set-version-string', 'ProductName', 'V 编辑器',
      '--set-version-string', 'FileDescription', 'V 编辑器',
      '--set-version-string', 'CompanyName', 'V Editor'
    ], { stdio: 'inherit' });
    console.log('  • rcedit applied:', exe);
  } catch (e) {
    console.warn('  • rcedit failed:', e.message);
  }
};
