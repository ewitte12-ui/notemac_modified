import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './Notemac/UI/AppViewPresenter';
import './styles/global.css';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useNotemacStore } from './Notemac/Model/Store';
import type { SessionData } from './Notemac/Commons/Types';

export const AUTOSAVE_SESSION_KEY = 'notemac.autosave-session';

// Vite ?worker imports — each becomes an inline blob: worker in the final bundle.
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker  from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker   from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker  from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker    from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// ─── Monaco local-bundle configuration ───────────────────────────────────────
//
// @monaco-editor/react defaults to loading Monaco from the unpkg CDN.
// In a packaged Electron app there is no guaranteed internet connection, so
// that request fails and the editor stays on its "Loading editor…" splash.
// Pointing the loader at the locally installed monaco-editor package fixes it.
//
loader.config({ monaco });

// Configure Monaco web workers so that language services (TypeScript, CSS,
// JSON, HTML) work correctly in the Vite-bundled / packaged Electron build.
// The ?worker imports above tell Vite to bundle each worker as a blob: URL
// that is self-contained and requires no network access.
//
(window as Window & { MonacoEnvironment?: { getWorker: (_: string, label: string) => Worker } }).MonacoEnvironment = {
    getWorker(_: string, label: string): Worker {
        if ('json' === label)                                          return new JsonWorker();
        if ('css' === label || 'scss' === label || 'less' === label)  return new CssWorker();
        if ('html' === label || 'handlebars' === label || 'razor' === label) return new HtmlWorker();
        if ('typescript' === label || 'javascript' === label)         return new TsWorker();
        return new EditorWorker();
    },
};

// ─── Auto-restore previous session ───────────────────────────────────────────
//
// Restore synchronously BEFORE ReactDOM.createRoot so the Zustand store already
// has the previous tabs when AppViewPresenter first renders.  This prevents the
// "create initial empty tab" guard from firing before the restore effect runs.
//
try
{
    const raw = localStorage.getItem(AUTOSAVE_SESSION_KEY);
    if (raw)
    {
        const session = JSON.parse(raw) as SessionData;
        if (Array.isArray(session.tabs) && session.tabs.length > 0)
            useNotemacStore.getState().loadSession(session);
    }
}
catch
{
    // Corrupt / outdated session data — clear it and start fresh
    localStorage.removeItem(AUTOSAVE_SESSION_KEY);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
