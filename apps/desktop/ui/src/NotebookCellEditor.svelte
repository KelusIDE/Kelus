<script lang="ts">
  import { onMount } from 'svelte';
  import { monaco } from './monaco';

  let { value, language, focusToken = 0, onChange, onRun, onFocus, onEscape }: {
    value: string; language: string; focusToken?: number;
    onChange: (value: string) => void;
    onRun: (mode: 'stay' | 'next' | 'insert') => void;
    onFocus?: () => void; onEscape?: () => void;
  } = $props();
  let host: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;

  $effect(() => { if (focusToken) queueMicrotask(() => editor?.focus()); });

  onMount(() => {
    const model = monaco.editor.createModel(value, language);
    editor = monaco.editor.create(host, {
      model, automaticLayout: true, minimap: { enabled: false }, lineNumbers: 'off', glyphMargin: false, folding: false,
      lineDecorationsWidth: 10, lineNumbersMinChars: 0, scrollBeyondLastLine: false, renderLineHighlight: 'none',
      overviewRulerLanes: 0, hideCursorInOverviewRuler: true, overviewRulerBorder: false,
      scrollbar: { vertical: 'hidden', horizontal: 'auto', alwaysConsumeMouseWheel: false, useShadows: false },
      padding: { top: 8, bottom: 8 }, fontFamily: 'SFMono-Regular, Consolas, monospace', fontSize: 13,
      wordWrap: language === 'markdown' ? 'on' : 'off', tabSize: 4, fixedOverflowWidgets: true,
      contextmenu: true, quickSuggestions: false
    });
    const instance = editor;
    const resize = () => { host.style.height = `${Math.max(instance.getContentHeight(), 34)}px`; instance.layout(); };
    instance.onDidContentSizeChange(resize); resize();
    instance.onDidChangeModelContent(() => onChange(instance.getValue()));
    instance.onDidFocusEditorText(() => onFocus?.());
    instance.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => onRun('next'));
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRun('stay'));
    instance.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Enter, () => onRun('insert'));
    instance.addCommand(monaco.KeyCode.Escape, () => onEscape?.(), '!suggestWidgetVisible && !findWidgetVisible');
    if (focusToken) instance.focus();
    return () => { editor = undefined; instance.dispose(); model.dispose(); };
  });
</script>

<div class="nb-editor" bind:this={host}></div>

<style>
  .nb-editor { width: 100%; min-height: 34px; }
  .nb-editor :global(.monaco-editor), .nb-editor :global(.monaco-editor-background), .nb-editor :global(.monaco-editor .margin) { background-color: var(--bg-surface) !important; }
</style>
