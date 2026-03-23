import React, { useEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react';
import { useNotemacStore } from "../Model/Store";
import { AUTOSAVE_SESSION_KEY } from '../../main';
import { GetTheme, GetCustomTheme } from "../Configs/ThemeConfig";
import { HandleKeyDown } from "../Controllers/AppController";
import { HandleMenuAction } from "../Controllers/MenuActionController";
import { HandleDragOver, HandleDrop, SetupElectronIPC } from "../Controllers/FileController";
import { IsDesktopEnvironment } from "../Services/PlatformBridge";
import { MenuBar } from './MenuBarViewPresenter';
import { Toolbar } from './ToolbarViewPresenter';
import { TabBar } from './TabBarViewPresenter';
import { EditorPanel } from './EditorPanelViewPresenter';
import { StatusBar } from './StatusBarViewPresenter';
import { Sidebar } from './SidebarViewPresenter';
import { FindReplace } from './FindReplaceViewPresenter';
import { WelcomeScreen } from './WelcomeScreenViewPresenter';
import { FeedbackPopup } from './FeedbackPopupViewPresenter';
import { ErrorBoundary } from './ErrorBoundary';

// Lazy-loaded dialogs (rarely shown — improves initial load time)
const SettingsDialog = lazy(() => import('./SettingsDialogViewPresenter').then(m => ({ default: m.SettingsDialog })));
const GoToLineDialog = lazy(() => import('./GoToLineDialogViewPresenter').then(m => ({ default: m.GoToLineDialog })));
const AboutDialog = lazy(() => import('./AboutDialogViewPresenter').then(m => ({ default: m.AboutDialog })));
const RunCommandDialog = lazy(() => import('./RunCommandDialogViewPresenter').then(m => ({ default: m.RunCommandDialog })));
const ColumnEditorDialog = lazy(() => import('./ColumnEditorDialogViewPresenter').then(m => ({ default: m.ColumnEditorDialog })));
const SummaryDialog = lazy(() => import('./SummaryDialogViewPresenter').then(m => ({ default: m.SummaryDialog })));
const CharInRangeDialog = lazy(() => import('./CharInRangeDialogViewPresenter').then(m => ({ default: m.CharInRangeDialog })));
const ShortcutMapperDialog = lazy(() => import('./ShortcutMapperDialogViewPresenter').then(m => ({ default: m.ShortcutMapperDialog })));
const CommandPaletteViewPresenter = lazy(() => import('./CommandPaletteViewPresenter').then(m => ({ default: m.CommandPaletteViewPresenter })));
const QuickOpenViewPresenter = lazy(() => import('./QuickOpenViewPresenter').then(m => ({ default: m.QuickOpenViewPresenter })));
const DiffViewerViewPresenter = lazy(() => import('./DiffViewerViewPresenter').then(m => ({ default: m.DiffViewerViewPresenter })));
const SnippetManagerViewPresenter = lazy(() => import('./SnippetManagerViewPresenter').then(m => ({ default: m.SnippetManagerViewPresenter })));
const TerminalPanelViewPresenter = lazy(() => import('./TerminalPanelViewPresenter').then(m => ({ default: m.TerminalPanelViewPresenter })));
const CloneRepositoryViewPresenter = lazy(() => import('./CloneRepositoryViewPresenter').then(m => ({ default: m.CloneRepositoryViewPresenter })));
const GitSettingsViewPresenter = lazy(() => import('./GitSettingsViewPresenter').then(m => ({ default: m.GitSettingsViewPresenter })));
const AISettingsViewPresenter = lazy(() => import('./AISettingsViewPresenter').then(m => ({ default: m.AISettingsViewPresenter })));
const PluginManagerViewPresenter = lazy(() => import('./PluginManagerViewPresenter').then(m => ({ default: m.PluginManagerViewPresenter })));
const PluginDialogViewPresenter = lazy(() => import('./PluginDialogViewPresenter').then(m => ({ default: m.PluginDialogViewPresenter })));

export default function App()
{
  const tabs = useNotemacStore(s => s.tabs);
  const activeTabId = useNotemacStore(s => s.activeTabId);
  const showStatusBar = useNotemacStore(s => s.showStatusBar);
  const showToolbar = useNotemacStore(s => s.showToolbar);
  const settings = useNotemacStore(s => s.settings);
  const showFindReplace = useNotemacStore(s => s.showFindReplace);
  const showSettings = useNotemacStore(s => s.showSettings);
  const showGoToLine = useNotemacStore(s => s.showGoToLine);
  const showAbout = useNotemacStore(s => s.showAbout);
  const showRunCommand = useNotemacStore(s => s.showRunCommand);
  const showColumnEditor = useNotemacStore(s => s.showColumnEditor);
  const showSummary = useNotemacStore(s => s.showSummary);
  const showCharInRange = useNotemacStore(s => s.showCharInRange);
  const showShortcutMapper = useNotemacStore(s => s.showShortcutMapper);
  const showCommandPalette = useNotemacStore(s => s.showCommandPalette);
  const showQuickOpen = useNotemacStore(s => s.showQuickOpen);
  const showDiffViewer = useNotemacStore(s => s.showDiffViewer);
  const showSnippetManager = useNotemacStore(s => s.showSnippetManager);
  const showTerminalPanel = useNotemacStore(s => s.showTerminalPanel);
  const showCloneDialog = useNotemacStore(s => s.showCloneDialog);
  const showGitSettings = useNotemacStore(s => s.showGitSettings);
  const showAiSettings = useNotemacStore(s => s.showAiSettings);
  const showPluginManager = useNotemacStore(s => s.showPluginManager);
  const pluginDialogComponent = useNotemacStore(s => s.pluginDialogComponent);
  const splitView = useNotemacStore(s => s.splitView);
  const splitTabId = useNotemacStore(s => s.splitTabId);
  const addTab = useNotemacStore(s => s.addTab);
  const zoomLevel = useNotemacStore(s => s.zoomLevel);

  const theme = useMemo(() =>
    settings.theme === 'custom'
      ? GetCustomTheme(settings.customThemeBase, settings.customThemeColors as Record<string, string>)
      : GetTheme(settings.theme),
    [settings.theme, settings.customThemeBase, settings.customThemeColors]);

  // Inject dynamic CSS for pseudo-elements that React inline styles cannot target:
  //   • ::-webkit-scrollbar-track/thumb (scrollbar colors)
  //   • .resizer and .drag-over (use theme accent instead of hardcoded #007acc)
  useEffect(() => {
    const id = 'notemac-dynamic-styles';
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = [
      `::-webkit-scrollbar-track { background: ${theme.scrollbarBg} !important; }`,
      `::-webkit-scrollbar-thumb { background: ${theme.scrollbarThumb} !important; border-radius: 5px; border: 2px solid transparent; background-clip: padding-box; }`,
      `::-webkit-scrollbar-thumb:hover { background: ${theme.scrollbarThumb} !important; filter: brightness(1.25); border: 2px solid transparent; background-clip: padding-box; }`,
      `.resizer:hover, .resizer.active { background-color: ${theme.accent} !important; }`,
      `.drag-over { border-left-color: ${theme.accent} !important; }`,
    ].join('\n');
  }, [theme.scrollbarBg, theme.scrollbarThumb, theme.accent]);

  // Keyboard shortcut handler — delegates to NotemacAppController
  const onKeyDown = useCallback((e: KeyboardEvent) =>
  {
    HandleKeyDown(e, activeTabId, zoomLevel);
  }, [activeTabId, zoomLevel]);

  useEffect(() =>
  {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  // File drag-drop — delegates to NotemacFileController
  useEffect(() =>
  {
    document.addEventListener('dragover', HandleDragOver);
    document.addEventListener('drop', HandleDrop);
    return () =>
    {
      document.removeEventListener('dragover', HandleDragOver);
      document.removeEventListener('drop', HandleDrop);
    };
  }, []);

  // Electron IPC setup — delegates to NotemacFileController
  useEffect(() =>
  {
    SetupElectronIPC();
  }, []);

  // ── Auto-save session ────────────────────────────────────────────────────────
  // Subscribes to all store changes and debounces writes to localStorage so that
  // every tab (including new/unsaved files) is preserved across app restarts.
  // Also saves immediately on window unload (app quit / window close).
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() =>
  {
    function saveSession(): void
    {
      try
      {
        const session = useNotemacStore.getState().saveSession();
        // Skip if the only tab is a blank, untitled, unmodified placeholder
        const hasContent = session.tabs.some(
          t => t.path !== null || (t.content !== undefined && t.content.length > 0),
        );
        if (!hasContent) return;
        localStorage.setItem(AUTOSAVE_SESSION_KEY, JSON.stringify(session));
      }
      catch
      {
        // localStorage full or unavailable — silent fallback
      }
    }

    // Debounced save on any store change (avoids a write on every keystroke)
    const unsubscribe = useNotemacStore.subscribe(() =>
    {
      if (saveDebounceRef.current !== null)
        clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = setTimeout(saveSession, 1500);
    });

    // Immediate save when the app is closed / refreshed
    window.addEventListener('beforeunload', saveSession);

    return () =>
    {
      unsubscribe();
      window.removeEventListener('beforeunload', saveSession);
      if (saveDebounceRef.current !== null)
        clearTimeout(saveDebounceRef.current);
    };
  }, []);

  // ── Reload file-backed tabs from disk after session restore ──────────────────
  // loadSession() stores only the path for disk-backed tabs (not the content).
  // On launch we re-read each such tab from disk and update the editor content.
  // If the file no longer exists, the tab is kept open but marked "(not found)".
  useEffect(() =>
  {
    if (!window.electronAPI) return;

    const store = useNotemacStore.getState();
    for (const tab of store.tabs)
    {
      if (!tab.path) continue; // untitled tabs have their content already

      window.electronAPI.readFile?.(tab.path)
        .then((content: string) =>
        {
          store.updateTabContent(tab.id, content);
          store.updateTab(tab.id, { originalContent: content, isModified: false });
        })
        .catch(() =>
        {
          // File was deleted or moved since last session
          store.updateTab(tab.id, { name: `${tab.name} (not found)`, path: null });
        });
    }
  }, []);

  // Menu action handler — delegates to NotemacMenuActionController
  const handleMenuAction = useCallback((action: string, value?: boolean | string | number) =>
  {
    HandleMenuAction(action, activeTabId, tabs, zoomLevel, value);
  }, [activeTabId, zoomLevel, tabs]);

  // Create initial tab if none exist
  useEffect(() =>
  {
    if (0 === tabs.length)
      addTab({ name: 'new 1', content: '' });
  }, []);

  // Load AI state from persistence
  useEffect(() =>
  {
    useNotemacStore.getState().LoadAIState();
  }, []);

  // Initialize plugin system
  useEffect(() =>
  {
    import('../Controllers/PluginController').then(({ InitializePluginSystem }) =>
    {
      InitializePluginSystem();
    });
  }, []);

  // Auto-collapse sidebar on narrow viewports
  useEffect(() =>
  {
    const handleResize = () =>
    {
      if (window.innerWidth < 768)
      {
        const panel = useNotemacStore.getState().sidebarPanel;
        if (null !== panel) useNotemacStore.getState().setSidebarPanel(null);
      }
    };
    // Collapse immediately if starting on mobile
    if (window.innerWidth < 768)
    {
      const panel = useNotemacStore.getState().sidebarPanel;
      if (null !== panel) useNotemacStore.getState().setSidebarPanel(null);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const activeTab = tabs.find(t => t.id === activeTabId);
  const isDistractionFree = settings.distractionFreeMode;

  const isElectron = IsDesktopEnvironment();

  return (
    <div
      className="notemac-app"
      style={{
        backgroundColor: theme.bg,
        color: theme.text,
        fontSize: settings.fontSize + zoomLevel,
      }}
    >
      {/* Electron: draggable title bar region for window controls */}
      {isElectron && !isDistractionFree && (
        <div
          style={{
            height: 38,
            backgroundColor: theme.menuBg,
            borderBottom: `1px solid ${theme.border}`,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 78,
            flexShrink: 0,
            WebkitAppRegion: 'drag',
          } as React.CSSProperties}
        >
          <span style={{
            fontWeight: 600,
            fontSize: 13,
            color: theme.text,
            opacity: 0.7,
            WebkitAppRegion: 'no-drag',
            userSelect: 'none',
          } as React.CSSProperties}>
            {activeTab ? activeTab.name + (activeTab.isModified ? ' \u2022' : '') + ' \u2014 ' : ''}Notemac++
          </span>
        </div>
      )}

      {!isDistractionFree && !isElectron && (
        <MenuBar theme={theme} onAction={handleMenuAction} isElectron={isElectron} />
      )}

      {showToolbar && !isDistractionFree && <Toolbar theme={theme} onAction={handleMenuAction} />}

      {!isDistractionFree && <TabBar theme={theme} />}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {!isDistractionFree && <Sidebar theme={theme} />}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {showFindReplace && <FindReplace theme={theme} />}

          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: splitView === 'horizontal' ? 'column' : 'row',
            overflow: 'hidden',
          }}>
            {activeTab ? (
              <>
                <ErrorBoundary fallbackMessage="Editor panel encountered an error">
                  <EditorPanel
                    key={activeTab.id}
                    tab={activeTab}
                    theme={theme}
                    settings={settings}
                    zoomLevel={zoomLevel}
                  />
                </ErrorBoundary>
                {splitView !== 'none' && splitTabId && (
                  <>
                    <div style={{
                      width: splitView === 'vertical' ? 4 : undefined,
                      height: splitView === 'horizontal' ? 4 : undefined,
                      backgroundColor: theme.border,
                      cursor: splitView === 'vertical' ? 'col-resize' : 'row-resize',
                    }} />
                    <ErrorBoundary fallbackMessage="Split editor panel encountered an error">
                      <EditorPanel
                        key={splitTabId + '-split'}
                        tab={tabs.find(t => t.id === splitTabId) || activeTab}
                        theme={theme}
                        settings={settings}
                        zoomLevel={zoomLevel}
                      />
                    </ErrorBoundary>
                  </>
                )}
              </>
            ) : (
              <WelcomeScreen theme={theme} />
            )}
          </div>

          {/* Terminal panel — between editor and status bar */}
          {showTerminalPanel && (
            <ErrorBoundary fallbackMessage="Terminal panel failed to load">
              <Suspense fallback={null}>
                <TerminalPanelViewPresenter theme={theme} />
              </Suspense>
            </ErrorBoundary>
          )}
        </div>
      </div>

      {showStatusBar && !isDistractionFree && <StatusBar theme={theme} />}

      {/* Lazy-loaded dialogs */}
      {showSettings && (
        <ErrorBoundary fallbackMessage="Settings failed to load">
          <Suspense fallback={null}>
            <SettingsDialog theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showGoToLine && (
        <ErrorBoundary fallbackMessage="Go to Line dialog failed to load">
          <Suspense fallback={null}>
            <GoToLineDialog theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showAbout && (
        <ErrorBoundary fallbackMessage="About dialog failed to load">
          <Suspense fallback={null}>
            <AboutDialog theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showRunCommand && (
        <ErrorBoundary fallbackMessage="Run Command dialog failed to load">
          <Suspense fallback={null}>
            <RunCommandDialog theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showColumnEditor && (
        <ErrorBoundary fallbackMessage="Column Editor dialog failed to load">
          <Suspense fallback={null}>
            <ColumnEditorDialog theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showSummary && (
        <ErrorBoundary fallbackMessage="Summary dialog failed to load">
          <Suspense fallback={null}>
            <SummaryDialog theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showCharInRange && (
        <ErrorBoundary fallbackMessage="Char in Range dialog failed to load">
          <Suspense fallback={null}>
            <CharInRangeDialog theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showShortcutMapper && (
        <ErrorBoundary fallbackMessage="Shortcut Mapper dialog failed to load">
          <Suspense fallback={null}>
            <ShortcutMapperDialog theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showCommandPalette && (
        <ErrorBoundary fallbackMessage="Command Palette failed to load">
          <Suspense fallback={null}>
            <CommandPaletteViewPresenter theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showQuickOpen && (
        <ErrorBoundary fallbackMessage="Quick Open failed to load">
          <Suspense fallback={null}>
            <QuickOpenViewPresenter theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showDiffViewer && (
        <ErrorBoundary fallbackMessage="Diff Viewer failed to load">
          <Suspense fallback={null}>
            <DiffViewerViewPresenter theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showSnippetManager && (
        <ErrorBoundary fallbackMessage="Snippet Manager failed to load">
          <Suspense fallback={null}>
            <SnippetManagerViewPresenter theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showCloneDialog && (
        <ErrorBoundary fallbackMessage="Clone Repository dialog failed to load">
          <Suspense fallback={null}>
            <CloneRepositoryViewPresenter theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showGitSettings && (
        <ErrorBoundary fallbackMessage="Git Settings failed to load">
          <Suspense fallback={null}>
            <GitSettingsViewPresenter theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showAiSettings && (
        <ErrorBoundary fallbackMessage="AI Settings failed to load">
          <Suspense fallback={null}>
            <AISettingsViewPresenter theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {showPluginManager && (
        <ErrorBoundary fallbackMessage="Plugin Manager failed to load">
          <Suspense fallback={null}>
            <PluginManagerViewPresenter theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      {null !== pluginDialogComponent && (
        <ErrorBoundary fallbackMessage="Plugin dialog failed to load">
          <Suspense fallback={null}>
            <PluginDialogViewPresenter theme={theme} />
          </Suspense>
        </ErrorBoundary>
      )}
      <FeedbackPopup theme={theme} />
    </div>
  );
}
