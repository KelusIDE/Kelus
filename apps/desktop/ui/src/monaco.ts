import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  }
};
monaco.editor.defineTheme('kelus', {
  base: 'vs-dark', inherit: true,
  rules: [{ token: 'comment', foreground: '7F8C9F' }],
  colors: { 'editor.background': '#211b14', 'editor.foreground': '#d7cabb',
    'editor.lineHighlightBackground': '#30271b', 'editor.selectionBackground': '#59452c',
    'editorGutter.background': '#211b14', 'editorLineNumber.foreground': '#786b58' }
});
export { monaco };
