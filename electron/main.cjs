const { app, BrowserWindow, Menu, dialog, ipcMain, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let windowStateFile = null;

const DEFAULT_WINDOW_WIDTH = 1200;
const DEFAULT_WINDOW_HEIGHT = 800;

function loadWindowState() {
  try {
    if (windowStateFile && fs.existsSync(windowStateFile))
      return JSON.parse(fs.readFileSync(windowStateFile, 'utf-8'));
  } catch {}
  return null;
}

function saveWindowState() {
  if (!mainWindow || !windowStateFile) return;
  try {
    const isMaximized = mainWindow.isMaximized();
    const bounds = mainWindow.getBounds();
    const state = { ...bounds, isMaximized };
    fs.mkdirSync(path.dirname(windowStateFile), { recursive: true });
    fs.writeFileSync(windowStateFile, JSON.stringify(state), 'utf-8');
  } catch {}
}

function isWindowStateOnScreen(state) {
  if (!state || 'number' !== typeof state.x || 'number' !== typeof state.y) return false;
  const displays = screen.getAllDisplays();
  return displays.some(({ workArea: { x, y, width, height } }) =>
    state.x >= x - 100 && state.y >= y - 100 &&
    state.x < x + width && state.y < y + height
  );
}

// ─── Recent Files ────────────────────────────────────────────────

const LIMIT_RECENT_FILES = 10;
let recentFilesPath = null;
let pendingOpenFile = null;

function loadRecentFiles() {
  try {
    if (recentFilesPath && fs.existsSync(recentFilesPath))
      return JSON.parse(fs.readFileSync(recentFilesPath, 'utf-8'));
  } catch {}
  return [];
}

function addToRecentFiles(filePath, name) {
  if (!recentFilesPath) return;
  try {
    const files = loadRecentFiles().filter(f => f.path !== filePath);
    files.unshift({ path: filePath, name });
    if (files.length > LIMIT_RECENT_FILES) files.length = LIMIT_RECENT_FILES;
    fs.mkdirSync(path.dirname(recentFilesPath), { recursive: true });
    fs.writeFileSync(recentFilesPath, JSON.stringify(files), 'utf-8');
  } catch {}
  if (process.platform === 'darwin') app.addRecentDocument(filePath);
  updateMenuAndDock();
}

function clearRecentFiles() {
  if (!recentFilesPath) return;
  try { fs.writeFileSync(recentFilesPath, '[]', 'utf-8'); } catch {}
  if (process.platform === 'darwin') app.clearRecentDocuments();
  updateMenuAndDock();
}

function openRecentFile(filePath) {
  if (!mainWindow) return;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('file-opened', {
      path: filePath,
      content,
      name: path.basename(filePath),
    });
  } catch (err) {
    console.error('Failed to open recent file:', filePath, err);
  }
}

function updateMenuAndDock() {
  buildMenu();
  if (process.platform === 'darwin' && app.dock) {
    const recentFiles = loadRecentFiles();
    const dockItems = recentFiles.map(f => ({
      label: f.name,
      sublabel: f.path,
      click: () => openRecentFile(f.path),
    }));
    if (dockItems.length === 0)
      dockItems.push({ label: 'No Recent Files', enabled: false });
    app.dock.setMenu(Menu.buildFromTemplate(dockItems));
  }
}

function createWindow() {
  const savedState = loadWindowState();
  const useState = isWindowStateOnScreen(savedState);

  mainWindow = new BrowserWindow({
    width: useState ? savedState.width : DEFAULT_WINDOW_WIDTH,
    height: useState ? savedState.height : DEFAULT_WINDOW_HEIGHT,
    x: useState ? savedState.x : undefined,
    y: useState ? savedState.y : undefined,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (useState && savedState.isMaximized)
    mainWindow.maximize();

  // app.isPackaged is true when running from a built .app/.dmg,
  // false when running via "electron ." during development.
  // In test mode (NODE_ENV=test), load from built dist/ to avoid needing a dev server.
  if (app.isPackaged || process.env.NODE_ENV === 'test') {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  }

  // Debug: log any load errors
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page loaded successfully');
    // Open any file that was requested before the window finished loading
    // (e.g. via Finder / drag-to-Dock while the app was launching)
    if (pendingOpenFile) {
      const p = pendingOpenFile;
      pendingOpenFile = null;
      openRecentFile(p);
      addToRecentFiles(p, path.basename(p));
    }
  });

  mainWindow.on('close', saveWindowState);

  // Content Security Policy — applied to all HTTP responses in this window's session.
  // For the file:// protocol (packaged app), set via the protocol interceptor below.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' blob:; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
          "style-src 'self' 'unsafe-inline'; " +
          "connect-src * blob:; " +
          "img-src * data: blob:; " +
          "worker-src blob: 'self'; " +
          "font-src 'self' data:;",
        ],
      },
    });
  });

  updateMenuAndDock();
}

function buildMenu() {
  const template = [
    {
      label: 'Notemac++',
      submenu: [
        { label: 'About Notemac++', role: 'about' },
        { type: 'separator' },
        { label: 'Preferences...', accelerator: 'Cmd+,', click: () => mainWindow.webContents.send('menu-action', 'preferences') },
        { label: 'Shortcut Mapper...', click: () => mainWindow.webContents.send('menu-action', 'shortcut-mapper') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('menu-action', 'new') },
        { type: 'separator' },
        { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: () => handleFileOpen() },
        { label: 'Open Folder as Workspace', click: () => handleOpenFolder() },
        {
          label: 'Open Recent',
          submenu: (() => {
            const files = loadRecentFiles();
            const items = files.map(f => ({
              label: f.name,
              click: () => openRecentFile(f.path),
            }));
            if (items.length === 0)
              items.push({ label: 'No Recent Files', enabled: false });
            items.push({ type: 'separator' });
            items.push({ label: 'Clear Recent Files', click: () => clearRecentFiles() });
            return items;
          })(),
        },
        { label: 'Reload from Disk', click: () => mainWindow.webContents.send('menu-action', 'reload-from-disk') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('menu-action', 'save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('menu-action', 'save-as') },
        { label: 'Save Copy As...', click: () => mainWindow.webContents.send('menu-action', 'save-copy-as') },
        { label: 'Save All', click: () => mainWindow.webContents.send('menu-action', 'save-all') },
        { type: 'separator' },
        { label: 'Rename...', click: () => mainWindow.webContents.send('menu-action', 'rename-file') },
        { label: 'Delete from Disk', click: () => mainWindow.webContents.send('menu-action', 'delete-file') },
        { type: 'separator' },
        { label: 'Restore Last Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => mainWindow.webContents.send('menu-action', 'restore-last-closed') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => mainWindow.webContents.send('menu-action', 'close-tab') },
        { label: 'Close All', click: () => mainWindow.webContents.send('menu-action', 'close-all') },
        { label: 'Close Others', click: () => mainWindow.webContents.send('menu-action', 'close-others') },
        { label: 'Close Tabs to Left', click: () => mainWindow.webContents.send('menu-action', 'close-tabs-to-left') },
        { label: 'Close Tabs to Right', click: () => mainWindow.webContents.send('menu-action', 'close-tabs-to-right') },
        { label: 'Close Unchanged', click: () => mainWindow.webContents.send('menu-action', 'close-unchanged') },
        { label: 'Close All but Pinned', click: () => mainWindow.webContents.send('menu-action', 'close-all-but-pinned') },
        { type: 'separator' },
        { label: 'Pin Tab', click: () => mainWindow.webContents.send('menu-action', 'pin-tab') },
        { type: 'separator' },
        { label: 'Load Session...', click: () => mainWindow.webContents.send('menu-action', 'load-session') },
        { label: 'Save Session...', click: () => mainWindow.webContents.send('menu-action', 'save-session') },
        { type: 'separator' },
        { label: 'Print...', accelerator: 'CmdOrCtrl+P', click: () => mainWindow.webContents.send('menu-action', 'print') },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Duplicate Line', accelerator: 'CmdOrCtrl+D', click: () => mainWindow.webContents.send('menu-action', 'duplicate-line') },
        { label: 'Delete Line', accelerator: 'CmdOrCtrl+Shift+K', click: () => mainWindow.webContents.send('menu-action', 'delete-line') },
        { label: 'Transpose Line', click: () => mainWindow.webContents.send('menu-action', 'transpose-line') },
        { label: 'Move Line Up', accelerator: 'Alt+Up', click: () => mainWindow.webContents.send('menu-action', 'move-line-up') },
        { label: 'Move Line Down', accelerator: 'Alt+Down', click: () => mainWindow.webContents.send('menu-action', 'move-line-down') },
        { label: 'Split Lines', click: () => mainWindow.webContents.send('menu-action', 'split-lines') },
        { label: 'Join Lines', click: () => mainWindow.webContents.send('menu-action', 'join-lines') },
        { type: 'separator' },
        { label: 'Toggle Comment', accelerator: 'CmdOrCtrl+/', click: () => mainWindow.webContents.send('menu-action', 'toggle-comment') },
        { label: 'Block Comment', accelerator: 'CmdOrCtrl+Shift+A', click: () => mainWindow.webContents.send('menu-action', 'block-comment') },
        { type: 'separator' },
        { label: 'UPPERCASE', accelerator: 'CmdOrCtrl+Shift+U', click: () => mainWindow.webContents.send('menu-action', 'uppercase') },
        { label: 'lowercase', accelerator: 'CmdOrCtrl+U', click: () => mainWindow.webContents.send('menu-action', 'lowercase') },
        { label: 'Proper Case', click: () => mainWindow.webContents.send('menu-action', 'proper-case') },
        { label: 'Sentence Case', click: () => mainWindow.webContents.send('menu-action', 'sentence-case') },
        { label: 'Invert Case', click: () => mainWindow.webContents.send('menu-action', 'invert-case') },
        { label: 'Random Case', click: () => mainWindow.webContents.send('menu-action', 'random-case') },
        { type: 'separator' },
        { label: 'Insert Date/Time', click: () => mainWindow.webContents.send('menu-action', 'insert-datetime') },
        { type: 'separator' },
        { label: 'Column Editor...', accelerator: 'Alt+C', click: () => mainWindow.webContents.send('menu-action', 'column-editor') },
        { label: 'Clipboard History', accelerator: 'CmdOrCtrl+Shift+V', click: () => mainWindow.webContents.send('menu-action', 'clipboard-history') },
        { label: 'Character Panel', click: () => mainWindow.webContents.send('menu-action', 'char-panel') },
        { type: 'separator' },
        { label: 'Copy File Path', click: () => mainWindow.webContents.send('menu-action', 'copy-file-path') },
        { label: 'Copy File Name', click: () => mainWindow.webContents.send('menu-action', 'copy-file-name') },
        { label: 'Copy File Dir', click: () => mainWindow.webContents.send('menu-action', 'copy-file-dir') },
        { type: 'separator' },
        { label: 'Set Read-Only', click: () => mainWindow.webContents.send('menu-action', 'toggle-readonly') },
      ],
    },
    {
      label: 'Search',
      submenu: [
        { label: 'Find...', accelerator: 'CmdOrCtrl+F', click: () => mainWindow.webContents.send('menu-action', 'find') },
        { label: 'Replace...', accelerator: 'CmdOrCtrl+H', click: () => mainWindow.webContents.send('menu-action', 'replace') },
        { label: 'Find in Files...', accelerator: 'CmdOrCtrl+Shift+F', click: () => mainWindow.webContents.send('menu-action', 'find-in-files') },
        { label: 'Incremental Search', click: () => mainWindow.webContents.send('menu-action', 'incremental-search') },
        { type: 'separator' },
        { label: 'Mark...', click: () => mainWindow.webContents.send('menu-action', 'mark') },
        { label: 'Clear All Marks', click: () => mainWindow.webContents.send('menu-action', 'clear-marks') },
        { type: 'separator' },
        { label: 'Go to Line...', accelerator: 'CmdOrCtrl+G', click: () => mainWindow.webContents.send('menu-action', 'goto-line') },
        { label: 'Go to Matching Bracket', accelerator: 'CmdOrCtrl+Shift+\\', click: () => mainWindow.webContents.send('menu-action', 'goto-bracket') },
        { type: 'separator' },
        { label: 'Toggle Bookmark', accelerator: 'CmdOrCtrl+F2', click: () => mainWindow.webContents.send('menu-action', 'toggle-bookmark') },
        { label: 'Next Bookmark', accelerator: 'F2', click: () => mainWindow.webContents.send('menu-action', 'next-bookmark') },
        { label: 'Previous Bookmark', accelerator: 'Shift+F2', click: () => mainWindow.webContents.send('menu-action', 'prev-bookmark') },
        { label: 'Clear All Bookmarks', click: () => mainWindow.webContents.send('menu-action', 'clear-bookmarks') },
        { type: 'separator' },
        { label: 'Find Characters in Range...', click: () => mainWindow.webContents.send('menu-action', 'find-char-in-range') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Word Wrap', type: 'checkbox', click: (item) => mainWindow.webContents.send('menu-action', 'word-wrap', item.checked) },
        { type: 'separator' },
        { label: 'Show Whitespace', type: 'checkbox', click: (item) => mainWindow.webContents.send('menu-action', 'show-whitespace', item.checked) },
        { label: 'Show End of Line', type: 'checkbox', click: (item) => mainWindow.webContents.send('menu-action', 'show-eol', item.checked) },
        { label: 'Show Non-Printable Characters', type: 'checkbox', click: (item) => mainWindow.webContents.send('menu-action', 'show-non-printable', item.checked) },
        { label: 'Show Wrap Symbol', type: 'checkbox', click: (item) => mainWindow.webContents.send('menu-action', 'show-wrap-symbol', item.checked) },
        { label: 'Show Indent Guides', type: 'checkbox', checked: true, click: (item) => mainWindow.webContents.send('menu-action', 'indent-guide', item.checked) },
        { label: 'Show Line Numbers', type: 'checkbox', checked: true, click: (item) => mainWindow.webContents.send('menu-action', 'show-line-numbers', item.checked) },
        { label: 'Show Minimap', type: 'checkbox', checked: true, click: (item) => mainWindow.webContents.send('menu-action', 'toggle-minimap', item.checked) },
        { type: 'separator' },
        { label: 'Fold All', click: () => mainWindow.webContents.send('menu-action', 'fold-all') },
        { label: 'Unfold All', click: () => mainWindow.webContents.send('menu-action', 'unfold-all') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => mainWindow.webContents.send('menu-action', 'zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => mainWindow.webContents.send('menu-action', 'zoom-out') },
        { label: 'Restore Default Zoom', accelerator: 'CmdOrCtrl+0', click: () => mainWindow.webContents.send('menu-action', 'zoom-reset') },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => mainWindow.webContents.send('menu-action', 'toggle-sidebar') },
        { label: 'Document List', click: () => mainWindow.webContents.send('menu-action', 'show-doc-list') },
        { label: 'Function List', click: () => mainWindow.webContents.send('menu-action', 'show-function-list') },
        { label: 'Project Panel', click: () => mainWindow.webContents.send('menu-action', 'show-project-panel') },
        { type: 'separator' },
        { label: 'Distraction-Free Mode', type: 'checkbox', click: (item) => mainWindow.webContents.send('menu-action', 'distraction-free', item.checked) },
        { label: 'Always on Top', type: 'checkbox', click: (item) => mainWindow.webContents.send('menu-action', 'always-on-top', item.checked) },
        { type: 'separator' },
        { label: 'Split Editor Right', click: () => mainWindow.webContents.send('menu-action', 'split-right') },
        { label: 'Split Editor Down', click: () => mainWindow.webContents.send('menu-action', 'split-down') },
        { label: 'Close Split', click: () => mainWindow.webContents.send('menu-action', 'close-split') },
        { type: 'separator' },
        { label: 'Summary...', click: () => mainWindow.webContents.send('menu-action', 'show-summary') },
        { label: 'Monitoring (tail -f)', click: () => mainWindow.webContents.send('menu-action', 'toggle-monitoring') },
        { type: 'separator' },
        { label: 'Toggle Full Screen', accelerator: 'Ctrl+Cmd+F', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Encoding',
      submenu: [
        { label: 'UTF-8', type: 'radio', click: () => mainWindow.webContents.send('menu-action', 'encoding', 'utf-8') },
        { label: 'UTF-8 with BOM', type: 'radio', click: () => mainWindow.webContents.send('menu-action', 'encoding', 'utf-8-bom') },
        { label: 'UTF-16 LE', type: 'radio', click: () => mainWindow.webContents.send('menu-action', 'encoding', 'utf-16le') },
        { label: 'UTF-16 BE', type: 'radio', click: () => mainWindow.webContents.send('menu-action', 'encoding', 'utf-16be') },
        { label: 'ISO 8859-1 (Latin)', type: 'radio', click: () => mainWindow.webContents.send('menu-action', 'encoding', 'iso-8859-1') },
        { label: 'Windows-1252', type: 'radio', click: () => mainWindow.webContents.send('menu-action', 'encoding', 'windows-1252') },
        { type: 'separator' },
        { label: 'Line Ending: LF (Unix/Mac)', click: () => mainWindow.webContents.send('menu-action', 'line-ending', 'LF') },
        { label: 'Line Ending: CRLF (Windows)', click: () => mainWindow.webContents.send('menu-action', 'line-ending', 'CRLF') },
        { label: 'Line Ending: CR (Old Mac)', click: () => mainWindow.webContents.send('menu-action', 'line-ending', 'CR') },
      ],
    },
    {
      label: 'Language',
      submenu: [
        { label: 'Plain Text', click: () => mainWindow.webContents.send('menu-action', 'language', 'plaintext') },
        { type: 'separator' },
        { label: 'C', click: () => mainWindow.webContents.send('menu-action', 'language', 'c') },
        { label: 'C++', click: () => mainWindow.webContents.send('menu-action', 'language', 'cpp') },
        { label: 'C#', click: () => mainWindow.webContents.send('menu-action', 'language', 'csharp') },
        { label: 'CSS', click: () => mainWindow.webContents.send('menu-action', 'language', 'css') },
        { label: 'Go', click: () => mainWindow.webContents.send('menu-action', 'language', 'go') },
        { label: 'HTML', click: () => mainWindow.webContents.send('menu-action', 'language', 'html') },
        { label: 'Java', click: () => mainWindow.webContents.send('menu-action', 'language', 'java') },
        { label: 'JavaScript', click: () => mainWindow.webContents.send('menu-action', 'language', 'javascript') },
        { label: 'JSON', click: () => mainWindow.webContents.send('menu-action', 'language', 'json') },
        { label: 'Markdown', click: () => mainWindow.webContents.send('menu-action', 'language', 'markdown') },
        { label: 'PHP', click: () => mainWindow.webContents.send('menu-action', 'language', 'php') },
        { label: 'Python', click: () => mainWindow.webContents.send('menu-action', 'language', 'python') },
        { label: 'Ruby', click: () => mainWindow.webContents.send('menu-action', 'language', 'ruby') },
        { label: 'Rust', click: () => mainWindow.webContents.send('menu-action', 'language', 'rust') },
        { label: 'SQL', click: () => mainWindow.webContents.send('menu-action', 'language', 'sql') },
        { label: 'Swift', click: () => mainWindow.webContents.send('menu-action', 'language', 'swift') },
        { label: 'TypeScript', click: () => mainWindow.webContents.send('menu-action', 'language', 'typescript') },
        { label: 'XML', click: () => mainWindow.webContents.send('menu-action', 'language', 'xml') },
        { label: 'YAML', click: () => mainWindow.webContents.send('menu-action', 'language', 'yaml') },
      ],
    },
    {
      label: 'Line Ops',
      submenu: [
        { label: 'Sort Lines Ascending', click: () => mainWindow.webContents.send('menu-action', 'sort-asc') },
        { label: 'Sort Lines Descending', click: () => mainWindow.webContents.send('menu-action', 'sort-desc') },
        { label: 'Sort Lines Case Insensitive (Asc)', click: () => mainWindow.webContents.send('menu-action', 'sort-asc-ci') },
        { label: 'Sort Lines Case Insensitive (Desc)', click: () => mainWindow.webContents.send('menu-action', 'sort-desc-ci') },
        { label: 'Sort Lines by Length (Asc)', click: () => mainWindow.webContents.send('menu-action', 'sort-len-asc') },
        { label: 'Sort Lines by Length (Desc)', click: () => mainWindow.webContents.send('menu-action', 'sort-len-desc') },
        { type: 'separator' },
        { label: 'Remove Duplicate Lines', click: () => mainWindow.webContents.send('menu-action', 'remove-duplicates') },
        { label: 'Remove Consecutive Duplicate Lines', click: () => mainWindow.webContents.send('menu-action', 'remove-consecutive-duplicates') },
        { label: 'Remove Empty Lines', click: () => mainWindow.webContents.send('menu-action', 'remove-empty-lines') },
        { label: 'Remove Empty Lines (Containing Blank)', click: () => mainWindow.webContents.send('menu-action', 'remove-blank-lines') },
        { type: 'separator' },
        { label: 'Trim Trailing Spaces', click: () => mainWindow.webContents.send('menu-action', 'trim-trailing') },
        { label: 'Trim Leading Spaces', click: () => mainWindow.webContents.send('menu-action', 'trim-leading') },
        { label: 'Trim Leading and Trailing Spaces', click: () => mainWindow.webContents.send('menu-action', 'trim-both') },
        { label: 'EOL to Space', click: () => mainWindow.webContents.send('menu-action', 'eol-to-space') },
        { type: 'separator' },
        { label: 'TAB to Space', click: () => mainWindow.webContents.send('menu-action', 'tab-to-space') },
        { label: 'Space to TAB (Leading)', click: () => mainWindow.webContents.send('menu-action', 'space-to-tab-leading') },
        { label: 'Space to TAB (All)', click: () => mainWindow.webContents.send('menu-action', 'space-to-tab-all') },
        { type: 'separator' },
        { label: 'Insert Blank Line Above', click: () => mainWindow.webContents.send('menu-action', 'insert-blank-above') },
        { label: 'Insert Blank Line Below', click: () => mainWindow.webContents.send('menu-action', 'insert-blank-below') },
        { label: 'Reverse Line Order', click: () => mainWindow.webContents.send('menu-action', 'reverse-lines') },
      ],
    },
    {
      label: 'Macro',
      submenu: [
        { label: 'Start Recording', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow.webContents.send('menu-action', 'macro-start') },
        { label: 'Stop Recording', click: () => mainWindow.webContents.send('menu-action', 'macro-stop') },
        { label: 'Playback', accelerator: 'CmdOrCtrl+Shift+P', click: () => mainWindow.webContents.send('menu-action', 'macro-playback') },
        { type: 'separator' },
        { label: 'Run Macro Multiple Times...', click: () => mainWindow.webContents.send('menu-action', 'macro-run-multiple') },
        { label: 'Save Recorded Macro...', click: () => mainWindow.webContents.send('menu-action', 'macro-save') },
      ],
    },
    {
      label: 'Run',
      submenu: [
        { label: 'Run Command...', click: () => mainWindow.webContents.send('menu-action', 'run-command') },
        { type: 'separator' },
        { label: 'Search on Google', click: () => mainWindow.webContents.send('menu-action', 'search-google') },
        { label: 'Search on Wikipedia', click: () => mainWindow.webContents.send('menu-action', 'search-wikipedia') },
        { label: 'Open in Browser', click: () => mainWindow.webContents.send('menu-action', 'open-in-browser') },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'MD5 - Generate', click: () => mainWindow.webContents.send('menu-action', 'hash-md5') },
        { label: 'MD5 - Copy to Clipboard', click: () => mainWindow.webContents.send('menu-action', 'hash-md5-clipboard') },
        { label: 'SHA-1 - Generate', click: () => mainWindow.webContents.send('menu-action', 'hash-sha1') },
        { label: 'SHA-1 - Copy to Clipboard', click: () => mainWindow.webContents.send('menu-action', 'hash-sha1-clipboard') },
        { label: 'SHA-256 - Generate', click: () => mainWindow.webContents.send('menu-action', 'hash-sha256') },
        { label: 'SHA-256 - Copy to Clipboard', click: () => mainWindow.webContents.send('menu-action', 'hash-sha256-clipboard') },
        { label: 'SHA-512 - Generate', click: () => mainWindow.webContents.send('menu-action', 'hash-sha512') },
        { label: 'SHA-512 - Copy to Clipboard', click: () => mainWindow.webContents.send('menu-action', 'hash-sha512-clipboard') },
        { type: 'separator' },
        { label: 'MD5 - Generate from File', click: () => mainWindow.webContents.send('menu-action', 'hash-md5-file') },
        { label: 'SHA-256 - Generate from File', click: () => mainWindow.webContents.send('menu-action', 'hash-sha256-file') },
        { type: 'separator' },
        { label: 'Base64 Encode', click: () => mainWindow.webContents.send('menu-action', 'base64-encode') },
        { label: 'Base64 Decode', click: () => mainWindow.webContents.send('menu-action', 'base64-decode') },
        { type: 'separator' },
        { label: 'URL Encode', click: () => mainWindow.webContents.send('menu-action', 'url-encode') },
        { label: 'URL Decode', click: () => mainWindow.webContents.send('menu-action', 'url-decode') },
        { type: 'separator' },
        { label: 'JSON Format', click: () => mainWindow.webContents.send('menu-action', 'json-format') },
        { label: 'JSON Minify', click: () => mainWindow.webContents.send('menu-action', 'json-minify') },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── File Dialog Handlers ────────────────────────────────────────

async function handleFileOpen() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Text Files', extensions: ['txt', 'md', 'log'] },
      { name: 'Source Code', extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'c', 'cpp', 'h', 'java', 'swift', 'php'] },
      { name: 'Web Files', extensions: ['html', 'css', 'json', 'xml', 'yaml', 'yml'] },
    ],
  });

  if (!result.canceled) {
    for (const filePath of result.filePaths) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const name = path.basename(filePath);
        mainWindow.webContents.send('file-opened', { path: filePath, content, name });
        addToRecentFiles(filePath, name);
      } catch (err) {
        console.error('Failed to read file:', filePath, err);
        mainWindow.webContents.send('file-open-error', { path: filePath, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

async function handleOpenFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    const tree = buildFileTree(folderPath);
    mainWindow.webContents.send('folder-opened', { path: folderPath, tree });
  }
}

function buildFileTree(dirPath, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 5) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter(function(e) { return !e.name.startsWith('.') && e.name !== 'node_modules'; })
    .sort(function(a, b) {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    })
    .map(function(entry) {
      return {
        name: entry.name,
        path: path.join(dirPath, entry.name),
        isDirectory: entry.isDirectory(),
        children: entry.isDirectory() ? buildFileTree(path.join(dirPath, entry.name), depth + 1) : undefined,
      };
    });
}

async function handleFileSaveAs(content, suggestedName) {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: suggestedName || 'untitled.txt',
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Text Files', extensions: ['txt'] },
    ],
  });

  if (!result.canceled && result.filePath) {
    if (content !== undefined && content !== null) {
      fs.writeFileSync(result.filePath, content, 'utf-8');
    }
    mainWindow.webContents.send('file-saved', {
      path: result.filePath,
      name: path.basename(result.filePath),
    });
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────

// Renderer-invoked file dialog requests
ipcMain.on('open-file-dialog', () => handleFileOpen());
ipcMain.on('open-folder-dialog', () => handleOpenFolder());
ipcMain.on('save-file-as-dialog', (_, data) => handleFileSaveAs(data.content, data.suggestedName));
ipcMain.on('set-always-on-top', (_, value) => mainWindow.setAlwaysOnTop(value));
ipcMain.on('rename-file', (_, data) => {
  try {
    if ('string' !== typeof data.oldPath || 'string' !== typeof data.newName)
      throw new Error('rename-file: oldPath and newName must be strings');

    // Reject newName containing path separators or traversal sequences
    if (/[/\\]/.test(data.newName) || data.newName.includes('..'))
      throw new Error(`rename-file: newName contains illegal path characters: "${data.newName}"`);

    if (0 === data.newName.trim().length)
      throw new Error('rename-file: newName must not be empty');

    const newPath = path.join(path.dirname(data.oldPath), data.newName);
    // Ensure the resolved new path stays in the same directory as the original
    if (path.dirname(path.resolve(newPath)) !== path.dirname(path.resolve(data.oldPath)))
      throw new Error('rename-file: resolved path escapes the original directory');

    fs.renameSync(data.oldPath, newPath);
    mainWindow.webContents.send('file-saved', {
      path: newPath,
      name: data.newName,
    });
  } catch (err) {
    console.error('Failed to rename file:', err);
    mainWindow.webContents.send('rename-file-error', { error: err instanceof Error ? err.message : String(err) });
  }
});

// File read/write IPC handles
const MAX_READ_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

ipcMain.handle('read-file', async function(_, filePath) {
  if ('string' !== typeof filePath || 0 === filePath.trim().length)
    throw new Error('read-file: filePath must be a non-empty string');

  const stat = fs.statSync(filePath);
  if (stat.size > MAX_READ_FILE_SIZE)
    throw new Error(`read-file: file exceeds maximum allowed size (${MAX_READ_FILE_SIZE / 1024 / 1024} MB)`);

  return fs.readFileSync(filePath, 'utf-8');
});

ipcMain.handle('write-file', async function(_, filePath, content) {
  if ('string' !== typeof filePath || 0 === filePath.trim().length)
    throw new Error('write-file: filePath must be a non-empty string');
  if ('string' !== typeof content)
    throw new Error('write-file: content must be a string');

  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
});

ipcMain.handle('read-dir', async function(_, dirPath) {
  if ('string' !== typeof dirPath || 0 === dirPath.trim().length)
    throw new Error('read-dir: dirPath must be a non-empty string');

  return buildFileTree(dirPath);
});

ipcMain.on('add-recent-file', (_, data) => {
  if (data && 'string' === typeof data.path && 'string' === typeof data.name)
    addToRecentFiles(data.path, data.name);
});

// ─── App Lifecycle ───────────────────────────────────────────────

// Must be registered before app.whenReady() to catch files opened at startup
// (Finder double-click, drag to Dock icon, Open With, etc.)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    openRecentFile(filePath);
    addToRecentFiles(filePath, path.basename(filePath));
  } else {
    pendingOpenFile = filePath;
  }
});

app.whenReady().then(() => {
  windowStateFile = path.join(app.getPath('userData'), 'window-state.json');
  recentFilesPath = path.join(app.getPath('userData'), 'recent-files.json');
  createWindow();
});
app.on('window-all-closed', function() { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', function() { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
