const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const preloadPath = path.join(__dirname, 'docs-screenshot-preload.cjs');
const outputDir = path.join(rootDir, 'docs', 'images');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureOutputDir() {
  await fs.mkdir(outputDir, { recursive: true });
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

async function startStaticServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent((request.url || '/').split('?')[0]);
    const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
    const targetPath = path.normalize(path.join(distDir, normalizedPath));

    if (!targetPath.startsWith(distDir)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    if (!fsSync.existsSync(targetPath) || fsSync.statSync(targetPath).isDirectory()) {
      response.writeHead(404);
      response.end('Not Found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': getContentType(targetPath),
      'Cache-Control': 'no-store',
    });
    fsSync.createReadStream(targetPath).pipe(response);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('静态服务启动失败');
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function saveCapture(win, fileName, rect) {
  const image = rect ? await win.webContents.capturePage(rect) : await win.webContents.capturePage();
  await fs.writeFile(path.join(outputDir, fileName), image.toPNG());
}

async function setLightTheme(win) {
  await win.webContents.executeJavaScript(`
    localStorage.setItem('front-end-deploy-master-theme', 'light');
    document.documentElement.dataset.theme = 'light';
    true;
  `);
}

async function clickByAria(win, label) {
  return win.webContents.executeJavaScript(`
    (() => {
      const targets = Array.from(document.querySelectorAll('button, [role="button"]'));
      const target = targets.find((element) =>
        element.getAttribute('aria-label') === ${JSON.stringify(label)} ||
        element.getAttribute('title') === ${JSON.stringify(label)}
      );

      if (!target) {
        return false;
      }

      target.click();
      return true;
    })();
  `);
}

async function ensureProjectExpanded(win) {
  const expanded = await win.webContents.executeJavaScript(`
    Boolean(document.querySelector('[aria-label="收起详情"]'));
  `);

  if (expanded) {
    return;
  }

  await clickByAria(win, '展开详情');
  await wait(800);
}

async function getRectFromScript(win, script) {
  return win.webContents.executeJavaScript(script);
}

async function createWindow(width, height, url) {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#f4f9ff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  await win.loadURL(url);
  await wait(1100);
  await setLightTheme(win);
  await wait(800);
  return win;
}

async function captureOverview(win) {
  await saveCapture(win, 'overview.png');
}

async function captureProjectDetail(win) {
  await win.setContentSize(1760, 1650);
  await wait(400);
  await ensureProjectExpanded(win);
  await win.webContents.executeJavaScript(`
    (() => {
      const article = document.querySelector('article');
      if (article) {
        article.scrollIntoView({ block: 'start' });
      }
    })();
  `);
  await wait(500);

  const rect = await getRectFromScript(
    win,
    `(() => {
      const article = document.querySelector('article');
      if (!article) {
        return null;
      }

      const rect = article.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(rect.left - 16)),
        y: Math.max(0, Math.floor(rect.top - 12)),
        width: Math.ceil(Math.min(rect.width + 32, 1080)),
        height: 860,
      };
    })();`,
  );

  await saveCapture(win, 'project-detail.png', rect || { x: 24, y: 96, width: 1080, height: 860 });
}

async function captureCompactRail(win) {
  await win.setContentSize(1760, 980);
  await wait(400);
  await clickByAria(win, '隐藏项目列表');
  await wait(500);
  await saveCapture(win, 'compact-rail.png');
}

async function captureEnvEditor(win) {
  await win.setContentSize(1760, 1650);
  await wait(400);
  const listVisible = await win.webContents.executeJavaScript(`
    Boolean(document.querySelector('[aria-label="隐藏项目列表"]'));
  `);

  if (!listVisible) {
    await clickByAria(win, '显示项目列表');
    await wait(500);
  }

  await ensureProjectExpanded(win);
  await win.webContents.executeJavaScript(`
    (() => {
      const target = Array.from(document.querySelectorAll('p')).find(
        (element) => element.textContent?.trim() === '环境变量',
      );
      const section = target?.closest('section');
      if (section) {
        section.scrollIntoView({ block: 'start' });
      }
    })();
  `);
  await wait(500);

  const rect = await getRectFromScript(
    win,
    `(() => {
      const target = Array.from(document.querySelectorAll('p')).find(
        (element) => element.textContent?.trim() === '环境变量',
      );
      const section = target?.closest('section');
      if (!section) {
        return null;
      }

      const rect = section.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(rect.left - 8)),
        y: Math.max(0, Math.floor(rect.top - 8)),
        width: Math.ceil(Math.min(rect.width + 16, 1100)),
        height: Math.ceil(Math.min(rect.height + 16, 880)),
      };
    })();`,
  );

  await saveCapture(win, 'env-editor.png', rect || { x: 32, y: 320, width: 1100, height: 820 });
}

async function main() {
  await ensureOutputDir();
  const { server, url } = await startStaticServer();

  const win = await createWindow(1760, 980, url);

  try {
    await captureOverview(win);
    await captureProjectDetail(win);
    await captureEnvEditor(win);
    await captureCompactRail(win);
  } finally {
    win.destroy();
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  await app.quit();
}

app.whenReady().then(() => {
  void main();
});

app.on('window-all-closed', () => {
  app.quit();
});
