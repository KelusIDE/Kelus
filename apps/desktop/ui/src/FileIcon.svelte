<script lang="ts">
  export let name: string;
  export let directory = false;

  const icons: Record<string, string> = {
    ts: 'devicon-typescript-plain', tsx: 'devicon-react-original',
    js: 'devicon-javascript-plain', jsx: 'devicon-react-original',
    py: 'devicon-python-plain', svelte: 'devicon-svelte-plain',
    json: 'devicon-json-plain', css: 'devicon-css3-plain',
    scss: 'devicon-sass-original', html: 'devicon-html5-plain',
    md: 'devicon-markdown-plain', yaml: 'devicon-yaml-plain',
    yml: 'devicon-yaml-plain', sh: 'devicon-bash-plain',
    ps1: 'devicon-powershell-plain', rs: 'devicon-rust-plain',
    go: 'devicon-go-plain', java: 'devicon-java-plain',
    cs: 'devicon-csharp-plain', cpp: 'devicon-cplusplus-plain',
    php: 'devicon-php-plain', rb: 'devicon-ruby-plain',
    swift: 'devicon-swift-plain', kt: 'devicon-kotlin-plain',
    vue: 'devicon-vuejs-plain'
  };
  $: basename = name.split(/[\\/]/).at(-1)?.toLowerCase() || '';
  $: extension = basename.split('.').at(-1) || '';
  $: icon = basename === 'package.json' ? 'devicon-nodejs-plain'
    : basename === 'tsconfig.json' ? 'devicon-typescript-plain'
    : basename === 'dockerfile' ? 'devicon-docker-plain'
    : basename === '.gitignore' || basename === '.gitattributes' ? 'devicon-git-plain'
    : basename.startsWith('vite.config.') ? 'devicon-vitejs-plain'
    : icons[extension];
</script>

{#if directory}
  <svg class="file-icon folder-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4h5l1.3 1.5h6.7v7.8h-13z"/></svg>
{:else if icon}
  <i class="file-icon devicon {icon} colored" aria-hidden="true"></i>
{:else if ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico', 'icns'].includes(extension)}
  <span class="file-icon generic-image" aria-hidden="true">▧</span>
{:else}
  <span class="file-icon generic-file" aria-hidden="true">◇</span>
{/if}
