import { app, BrowserWindow, Menu, shell } from 'electron';
import { fork, execFile } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const defaultPort = Number(process.env.TABLEFORGE_DESKTOP_PORT || 3000);
const startupTimeoutMs = 30000;

let mainWindow;
let serverProcess;
let serverPort;
let isQuitting = false;

function getPreloadPath() {
  return path.join(__dirname, 'preload.cjs');
}

function getServerEntry() {
  return path.join(appRoot, 'server.js');
}

function getServerCwd() {
  return app.isPackaged ? process.resourcesPath : appRoot;
}

function getDataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: '#101418',
    title: 'Tableforge',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: getPreloadPath(),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function loadSplash() {
  const html = encodeURIComponent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
        <title>Starting Tableforge</title>
        <style>
          :root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101418; color: #f5f7fb; }
          main { width: min(420px, calc(100vw - 48px)); }
          h1 { margin: 0 0 12px; font-size: 28px; }
          p { margin: 0; color: #aeb7c3; line-height: 1.5; }
          .bar { height: 4px; margin-top: 24px; overflow: hidden; border-radius: 999px; background: #26313d; }
          .bar::before { content: ""; display: block; width: 45%; height: 100%; border-radius: inherit; background: #74b9ff; animation: load 1.2s ease-in-out infinite; }
          @keyframes load { 0% { transform: translateX(-120%); } 100% { transform: translateX(240%); } }
        </style>
      </head>
      <body>
        <main>
          <h1>Starting Tableforge</h1>
          <p>Launching the local server and preparing your desktop workspace.</p>
          <div class="bar" aria-hidden="true"></div>
        </main>
      </body>
    </html>
  `);
  mainWindow.loadURL(`data:text/html;charset=utf-8,${html}`);
}

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
          tryPort(port + 1);
          return;
        }
        reject(error);
      });
      server.once('listening', () => {
        server.close(() => resolve(port));
      });
      server.listen(port, '127.0.0.1');
    };

    tryPort(startPort);
  });
}

function waitForHealth(port) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/health',
          timeout: 1000,
        },
        (response) => {
          response.resume();
          if (response.statusCode === 200) {
            resolve();
            return;
          }
          retry();
        },
      );

      request.on('timeout', () => {
        request.destroy();
        retry();
      });
      request.on('error', retry);
    };

    const retry = () => {
      if (Date.now() - startedAt > startupTimeoutMs) {
        reject(new Error('Timed out waiting for the Tableforge server to start.'));
        return;
      }
      setTimeout(check, 250);
    };

    check();
  });
}

async function startServer() {
  serverPort = await findFreePort(defaultPort);
  isQuitting = false;
  serverProcess = fork(getServerEntry(), {
    cwd: getServerCwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(serverPort),
      TABLEFORGE_DATA_DIR: getDataDir(),
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  serverProcess.stdout?.on('data', (chunk) => console.log(`[server] ${chunk.toString().trim()}`));
  serverProcess.stderr?.on('data', (chunk) => console.error(`[server] ${chunk.toString().trim()}`));
  serverProcess.once('exit', (code, signal) => {
    if (!isQuitting) {
      console.error(`Tableforge server exited unexpectedly: code=${code} signal=${signal}`);
    }
    serverProcess = null;
  });

  await waitForHealth(serverPort);
  return `http://127.0.0.1:${serverPort}`;
}

function stopServer() {
  if (!serverProcess?.pid) return;

  isQuitting = true;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(serverProcess.pid), '/T', '/F'], () => {});
  } else {
    serverProcess.kill('SIGTERM');
  }
  serverProcess = null;
}

function installMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function boot() {
  createWindow();
  loadSplash();
  installMenu();

  try {
    const serverUrl = await startServer();
    await mainWindow.loadURL(serverUrl);
  } catch (error) {
    console.error(error);
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
          <title>Tableforge failed to start</title>
          <style>
            body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101418; color: #f5f7fb; font-family: system-ui, sans-serif; }
            main { width: min(560px, calc(100vw - 48px)); }
            pre { white-space: pre-wrap; color: #ffb4b4; }
          </style>
        </head>
        <body>
          <main>
            <h1>Tableforge failed to start</h1>
            <p>The local server did not become available.</p>
            <pre>${String(error.stack || error.message || error).replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char])}</pre>
          </main>
        </body>
      </html>
    `)}`);
  }
}

app.whenReady().then(boot);

app.on('before-quit', () => {
  stopServer();
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    boot();
  }
});
