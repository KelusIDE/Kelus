import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import type { Theme } from './types';

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  }
};
const themes: Record<Theme, { base: 'vs' | 'vs-dark'; background: string; foreground: string; line: string; selection: string; number: string }> = {
  warm: { base: 'vs-dark', background: '#211b14', foreground: '#d7cabb', line: '#30271b', selection: '#59452c', number: '#786b58' },
  dark: { base: 'vs-dark', background: '#1e1e1e', foreground: '#d4d4d4', line: '#2a2d2e', selection: '#264f78', number: '#858585' },
  light: { base: 'vs', background: '#ffffff', foreground: '#24292f', line: '#f4f6f8', selection: '#add6ff', number: '#999999' },
  midnight: { base: 'vs-dark', background: '#0b1220', foreground: '#cbd6ee', line: '#101a2e', selection: '#1d2c49', number: '#5c6c90' },
  dracula: { base: 'vs-dark', background: '#282a36', foreground: '#f8f8f2', line: '#343746', selection: '#44475a', number: '#6272a4' },
  nord: { base: 'vs-dark', background: '#2e3440', foreground: '#e5e9f0', line: '#3b4252', selection: '#434c5e', number: '#7b88a1' },
  solarized: { base: 'vs', background: '#fdf6e3', foreground: '#586e75', line: '#eee8d5', selection: '#e3dcc5', number: '#93a1a1' },
  monokai: { base: 'vs-dark', background: '#272822', foreground: '#f8f8f2', line: '#2d2e27', selection: '#49493f', number: '#75715e' },
  'high-contrast': { base: 'vs-dark', background: '#000000', foreground: '#ffffff', line: '#161616', selection: '#2a2a2a', number: '#b0b0b0' }
};
for (const [name, theme] of Object.entries(themes)) {
  monaco.editor.defineTheme(`kelus-${name}`, {
    base: theme.base, inherit: true, rules: [],
    colors: { 'editor.background': theme.background, 'editor.foreground': theme.foreground,
      'editor.lineHighlightBackground': theme.line, 'editor.selectionBackground': theme.selection,
      'editorGutter.background': theme.background, 'editorLineNumber.foreground': theme.number }
  });
}
export function applyEditorTheme(theme: Theme): void { monaco.editor.setTheme(`kelus-${theme}`); }
const terminalThemes: Record<Theme, { background: string; foreground: string; cursor: string }> = {
  warm: { background: '#241c13', foreground: '#d7cabb', cursor: '#c7a982' },
  dark: { background: '#181818', foreground: '#d4d4d4', cursor: '#aeafad' },
  light: { background: '#ffffff', foreground: '#24292f', cursor: '#0969da' },
  midnight: { background: '#0e1729', foreground: '#cbd6ee', cursor: '#5ec8f0' },
  dracula: { background: '#21222c', foreground: '#f8f8f2', cursor: '#ff79c6' },
  nord: { background: '#272c37', foreground: '#e5e9f0', cursor: '#88c0d0' },
  solarized: { background: '#eee8d5', foreground: '#586e75', cursor: '#268bd2' },
  monokai: { background: '#1e1f1a', foreground: '#f8f8f2', cursor: '#a6e22e' },
  'high-contrast': { background: '#000000', foreground: '#ffffff', cursor: '#3ff23f' }
};
export function terminalTheme(theme: Theme) { return terminalThemes[theme] || terminalThemes.warm; }
export { monaco };
