const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      windowsHide: true,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`命令执行失败: ${command} ${args.join(' ')} (exit ${code ?? -1})`));
    });
  });
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico');
  const rceditPath = path.join(
    context.packager.projectDir,
    'node_modules',
    'electron-winstaller',
    'vendor',
    'rcedit.exe',
  );
  const executableName = `${context.packager.appInfo.productFilename}.exe`;
  const executablePath = path.join(context.appOutDir, executableName);

  if (!fs.existsSync(iconPath)) {
    throw new Error(`未找到应用图标: ${iconPath}`);
  }

  if (!fs.existsSync(rceditPath)) {
    throw new Error(`未找到 rcedit 工具: ${rceditPath}`);
  }

  if (!fs.existsSync(executablePath)) {
    throw new Error(`未找到待写入资源的可执行文件: ${executablePath}`);
  }

  const appInfo = context.packager.appInfo;
  const productName = appInfo.productName;
  const fileDescription = appInfo.description || 'Windows desktop tool for front-end project packaging.';
  const companyName = productName;
  const productVersion = appInfo.version;
  const fileVersion =
    typeof appInfo.getVersionInWeirdWindowsForm === 'function'
      ? appInfo.getVersionInWeirdWindowsForm()
      : `${productVersion}.0`;
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-build-master-rcedit-'));
  const tempExecutablePath = path.join(tempDirectory, executableName);
  const tempIconPath = path.join(tempDirectory, 'icon.ico');

  const args = [
    tempExecutablePath,
    '--set-icon',
    tempIconPath,
    '--set-file-version',
    fileVersion,
    '--set-product-version',
    productVersion,
    '--set-version-string',
    'CompanyName',
    companyName,
    '--set-version-string',
    'FileDescription',
    fileDescription,
    '--set-version-string',
    'ProductName',
    productName,
    '--set-version-string',
    'InternalName',
    appInfo.productFilename,
    '--set-version-string',
    'OriginalFilename',
    executableName,
    '--set-version-string',
    'LegalTrademarks',
    'Easy Build Master',
    '--set-version-string',
    'ProductVersion',
    productVersion,
    '--set-version-string',
    'FileVersion',
    fileVersion,
  ];

  fs.copyFileSync(executablePath, tempExecutablePath);
  fs.copyFileSync(iconPath, tempIconPath);

  try {
    await runProcess(rceditPath, args);
    fs.copyFileSync(tempExecutablePath, executablePath);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
};
