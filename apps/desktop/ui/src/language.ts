const extensions: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyw: 'python', json: 'json', jsonc: 'json', ipynb: 'json', css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', svelte: 'html', vue: 'html', xml: 'xml', svg: 'xml',
  md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'powershell',
  sql: 'sql', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'cpp', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  rb: 'ruby', php: 'php', swift: 'swift', dart: 'dart', lua: 'lua',
  toml: 'ini', ini: 'ini', conf: 'ini',
  pl: 'perl', pm: 'perl', r: 'r', m: 'objective-c', mm: 'objective-c',
  scala: 'scala', sc: 'scala', ex: 'elixir', exs: 'elixir',
  fs: 'fsharp', fsx: 'fsharp', graphql: 'graphql', gql: 'graphql'
};
export function language(path: string): string {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() || '';
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile';
  if (name === 'makefile') return 'shell';
  return extensions[name.split('.').at(-1) || ''] || 'plaintext';
}
