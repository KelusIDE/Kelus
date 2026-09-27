<script lang="ts">
  let { name, directory = false, expanded = false }: { name: string; directory?: boolean; expanded?: boolean } = $props();

  // Extension -> icon base name, verified against apps/desktop/ui/public/icons/file_type_*.svg.
  const byExtension: Record<string, string> = {
    ts: 'typescript', tsx: 'reactts', mts: 'typescript', cts: 'typescript',
    js: 'js', jsx: 'reactjs', mjs: 'js', cjs: 'js',
    py: 'python', pyw: 'python', json: 'json', jsonc: 'json', ipynb: 'jupyter',
    css: 'css', scss: 'scss', sass: 'sass', less: 'less',
    html: 'html', htm: 'html', svelte: 'svelte', vue: 'vue',
    xml: 'xml', svg: 'svg', md: 'markdown', markdown: 'markdown',
    yml: 'yaml', yaml: 'yaml', sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
    ps1: 'powershell', sql: 'sql', rs: 'rust', go: 'go',
    java: 'java', kt: 'kotlin', kts: 'kotlin',
    c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp',
    cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift', dart: 'dartlang', lua: 'lua',
    toml: 'toml', ini: 'ini', conf: 'ini',
    pl: 'perl', pm: 'perl', r: 'r', m: 'objectivec', mm: 'objectivec',
    scala: 'scala', sc: 'scala', ex: 'elixir', exs: 'elixir',
    fs: 'fsharp', fsx: 'fsharp', graphql: 'graphql', gql: 'graphql',
    png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', ico: 'image', icns: 'image',
    mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio',
    mp4: 'video', mov: 'video', webm: 'video', avi: 'video',
    woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', eot: 'font',
    pdf: 'pdf', zip: 'zip', tar: 'zip', gz: 'zip', '7z': 'zip', rar: 'zip'
  };
  // Exact (lowercase) file name -> icon base name, for files an extension alone can't identify.
  const byName: Record<string, string> = {
    'package.json': 'node', 'package-lock.json': 'npm', 'npm-shrinkwrap.json': 'npm', '.npmrc': 'npm',
    'yarn.lock': 'yarn', '.yarnrc': 'yarn', 'pnpm-lock.yaml': 'pnpm',
    'tsconfig.json': 'typescript', 'jsconfig.json': 'js',
    dockerfile: 'docker', '.dockerignore': 'docker',
    '.gitignore': 'git', '.gitattributes': 'git', '.gitmodules': 'git',
    '.eslintrc': 'eslint', '.eslintrc.json': 'eslint', '.eslintrc.js': 'eslint', '.eslintrc.cjs': 'eslint',
    '.prettierrc': 'prettier', '.prettierrc.json': 'prettier', '.prettierrc.js': 'prettier',
    '.stylelintrc': 'stylelint', '.stylelintrc.json': 'stylelint',
    '.editorconfig': 'editorconfig', '.env': 'dotenv',
    'cargo.toml': 'cargo', 'cargo.lock': 'cargo', 'composer.json': 'composer',
    'cmakelists.txt': 'cmake', gemfile: 'ruby', license: 'license', 'license.md': 'license'
  };
  // Basename prefix -> icon base name, for *.config.* style files.
  const byPrefix: [string, string][] = [
    ['vite.config.', 'vite'], ['tailwind.config.', 'tailwind'], ['babel.config.', 'babel'],
    ['webpack.config.', 'webpack'], ['jest.config.', 'jest'], ['vitest.config.', 'vitest'],
    ['postcss.config.', 'postcss'], ['docker-compose.', 'docker2']
  ];
  // Folder base name -> icon base name.
  const folderByName: Record<string, string> = {
    src: 'src', source: 'src', test: 'test', tests: 'test', __tests__: 'test',
    docs: 'docs', doc: 'docs', '.github': 'github', '.vscode': 'vscode',
    node_modules: 'node', dist: 'dist', build: 'dist', public: 'public',
    assets: 'asset', asset: 'asset', config: 'config', components: 'component', component: 'component',
    controllers: 'controller', controller: 'controller', models: 'model', model: 'model',
    middleware: 'middleware', routes: 'route', route: 'route', views: 'view', view: 'view',
    scripts: 'script', script: 'script', images: 'images', styles: 'style', style: 'style',
    api: 'api', client: 'client', server: 'server', shared: 'shared', common: 'common',
    coverage: 'coverage', log: 'log', logs: 'log', tmp: 'temp', temp: 'temp',
    python: 'python', redux: 'redux', plugins: 'plugin', plugin: 'plugin',
    helpers: 'helper', helper: 'helper', tools: 'tools'
  };

  let basename = $derived(name.split(/[\\/]/).at(-1)?.toLowerCase() || '');
  let extension = $derived(basename.split('.').at(-1) || '');
  let folderIcon = $derived.by(() => {
    const base = folderByName[basename] ? `folder_type_${folderByName[basename]}` : 'default_folder';
    return expanded ? `${base}_opened` : base;
  });
  let fileIcon = $derived.by(() => {
    const prefixed = byPrefix.find(([prefix]) => basename.startsWith(prefix));
    const base = byName[basename] || (prefixed ? prefixed[1] : undefined) || byExtension[extension];
    return base ? `file_type_${base}` : 'default_file';
  });
</script>

{#if directory}
  <img class="file-icon" src={`./icons/${folderIcon}.svg`} alt="" aria-hidden="true"/>
{:else}
  <img class="file-icon" src={`./icons/${fileIcon}.svg`} alt="" aria-hidden="true"/>
{/if}
