<script lang="ts">
  import type { B2Input, Locale, Provider, ProviderProfile, ProviderProfileInput, Settings, SettingsUpdate, Theme } from './types';
  import { t, locales } from './i18n.svelte';
  let { settings, onSaved, onClose, onPreview, onPreviewLocale }: {
    settings: Settings; onSaved: (value: Settings) => void; onClose: () => void;
    onPreview: (value: Theme) => void; onPreviewLocale: (value: Locale) => void;
  } = $props();

  type Draft = ProviderProfile & { apiKey: string; clearApiKey: boolean };
  let theme: Theme = $state('warm');
  let locale: Locale = $state('en');
  let activeProfileId = $state('mock');
  let profiles: Draft[] = $state([]);
  let editingId: string | null = $state(null);
  let b2Bucket = $state('');
  let b2Endpoint = $state('');
  let b2KeyId = $state('');
  let b2ApplicationKey = $state('');
  let b2ClearApplicationKey = $state(false);
  $effect(() => {
    theme = settings.theme;
    locale = settings.locale;
    activeProfileId = settings.activeProfileId;
    profiles = settings.profiles.map(p => ({ ...p, apiKey: '', clearApiKey: false }));
    b2Bucket = settings.b2.bucket;
    b2Endpoint = settings.b2.endpoint;
    b2KeyId = settings.b2.keyId;
    b2ApplicationKey = ''; b2ClearApplicationKey = false;
  });
  let saving = $state(false);
  let message = $state('');
  const themes: { id: Theme; label: string; a: string; b: string }[] = [
    { id: 'warm', label: 'Kelus Warm', a: '#211b14', b: '#c8a97f' },
    { id: 'dark', label: 'Dark', a: '#1e1e1e', b: '#4fa6e0' },
    { id: 'light', label: 'Light', a: '#ffffff', b: '#0969da' },
    { id: 'midnight', label: 'Midnight', a: '#0b1220', b: '#5ec8f0' },
    { id: 'dracula', label: 'Dracula', a: '#282a36', b: '#ff79c6' },
    { id: 'nord', label: 'Nord', a: '#2e3440', b: '#88c0d0' },
    { id: 'solarized', label: 'Solarized', a: '#fdf6e3', b: '#268bd2' },
    { id: 'monokai', label: 'Monokai', a: '#272822', b: '#a6e22e' },
    { id: 'high-contrast', label: 'High Contrast', a: '#000000', b: '#3ff23f' }
  ];
  function addProfile() {
    const id = crypto.randomUUID();
    const draft: Draft = { id, name: 'New provider', provider: 'openai-compatible' as Provider, modelUrl: '', modelName: '', hasApiKey: false, apiKey: '', clearApiKey: false };
    profiles = [...profiles, draft];
    editingId = id;
  }
  function removeProfile(id: string) {
    if (id === 'mock') return;
    profiles = profiles.filter(p => p.id !== id);
    if (activeProfileId === id) activeProfileId = 'mock';
    if (editingId === id) editingId = null;
  }
  async function save() {
    saving = true; message = '';
    try {
      const b2: B2Input = {
        bucket: b2Bucket, endpoint: b2Endpoint, keyId: b2KeyId,
        applicationKey: b2ApplicationKey.trim() || undefined, clearApplicationKey: b2ClearApplicationKey
      };
      const input: SettingsUpdate = {
        theme, locale, activeProfileId,
        profiles: profiles.map((p): ProviderProfileInput => ({
          id: p.id, name: p.name, provider: p.provider, modelUrl: p.modelUrl, modelName: p.modelName,
          apiKey: p.apiKey.trim() || undefined, clearApiKey: p.clearApiKey
        })),
        b2
      };
      const updated = await window.kelus.updateSettings(input);
      onSaved(updated); message = t('settings.saved');
    } catch (error) { message = String(error); }
    finally { saving = false; }
  }
</script>

<div class="settings-view">
  <div class="settings-header"><div><h1>{t('settings.title')}</h1><p>{t('settings.subtitle')}</p></div><button aria-label={t('settings.close')} onclick={onClose}>×</button></div>
  <div class="settings-content">
    <section class="settings-group"><h2>{t('settings.appearance')}</h2><span id="theme-label">{t('settings.colorTheme')}</span>
      <div class="theme-grid" role="radiogroup" aria-labelledby="theme-label">
        {#each themes as option}
          <button type="button" class="theme-swatch" class:selected={theme === option.id} role="radio" aria-checked={theme === option.id} onclick={() => { theme = option.id; onPreview(option.id); }}>
            <span class="theme-swatch-dot" style:background={option.a} style:border-color={option.b}></span>{option.label}
          </button>
        {/each}
      </div>
      <span id="language-label" style="margin-top: 12px;">{t('settings.language')}</span>
      <select id="language-select" aria-labelledby="language-label" bind:value={locale} onchange={() => onPreviewLocale(locale)}>
        {#each locales as option}<option value={option.id}>{option.label}</option>{/each}
      </select>
      <p class="settings-hint">{t('settings.languageHint')}</p>
    </section>
    <section class="settings-group">
      <h2>{t('settings.agentModels')}</h2>
      <p class="settings-hint">{t('settings.profileHint')}</p>
      <div class="profile-list">
        {#each profiles as profile (profile.id)}
          <div class="profile-row" class:active={activeProfileId === profile.id}>
            <label class="profile-radio">
              <input type="radio" name="active-profile" checked={activeProfileId === profile.id} onchange={() => activeProfileId = profile.id}/>
              <span class="profile-name">{profile.name}</span>
              <span class="profile-kind">{profile.provider === 'mock' ? t('settings.providerMock') : t('settings.providerOpenAI')}</span>
            </label>
            <div class="profile-row-actions">
              <button type="button" onclick={() => editingId = editingId === profile.id ? null : profile.id}>{editingId === profile.id ? t('common.done') : t('common.edit')}</button>
              {#if profile.id !== 'mock'}<button type="button" class="danger" onclick={() => removeProfile(profile.id)}>{t('common.delete')}</button>{/if}
            </div>
            {#if editingId === profile.id && profile.provider !== 'mock'}
              <div class="profile-form">
                <label for={`name-${profile.id}`}>{t('settings.profileName')}</label>
                <input id={`name-${profile.id}`} bind:value={profile.name} placeholder={t('settings.profileNamePlaceholder')} spellcheck="false"/>
                <label for={`url-${profile.id}`}>{t('settings.apiEndpoint')}</label>
                <input id={`url-${profile.id}`} bind:value={profile.modelUrl} placeholder="https://example.com/v1/chat/completions" spellcheck="false"/>
                <label for={`model-${profile.id}`}>{t('settings.modelNameLabel')}</label>
                <input id={`model-${profile.id}`} bind:value={profile.modelName} placeholder={t('settings.modelIdPlaceholder')} spellcheck="false"/>
                <label for={`key-${profile.id}`}>{t('settings.apiKeyLabel')}</label>
                <input id={`key-${profile.id}`} type="password" bind:value={profile.apiKey} placeholder={profile.hasApiKey ? t('settings.apiKeySaved') : t('settings.apiKeyEnter')} autocomplete="new-password" spellcheck="false"/>
                {#if profile.hasApiKey}<label class="check-row"><input type="checkbox" bind:checked={profile.clearApiKey}/> {t('settings.removeApiKey')}</label>{/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <div class="profile-add"><button type="button" onclick={addProfile}>{t('settings.addProfile')}</button></div>
      <p class="settings-hint">{settings.keyStorage === 'encrypted' ? t('settings.keyStorageEncrypted') : t('settings.keyStorageSession')}</p>
    </section>
    <section class="settings-group">
      <h2>{t('settings.cloudStorage')}</h2>
      <p class="settings-hint">{t('settings.cloudStorageHint')}</p>
      <label for="b2-bucket">{t('settings.b2Bucket')}</label>
      <input id="b2-bucket" bind:value={b2Bucket} placeholder="KelusIDE" spellcheck="false"/>
      <label for="b2-endpoint">{t('settings.b2Endpoint')}</label>
      <input id="b2-endpoint" bind:value={b2Endpoint} placeholder="s3.us-east-005.backblazeb2.com" spellcheck="false"/>
      <label for="b2-keyid">{t('settings.b2KeyId')}</label>
      <input id="b2-keyid" bind:value={b2KeyId} spellcheck="false"/>
      <label for="b2-appkey">{t('settings.b2ApplicationKey')}</label>
      <input id="b2-appkey" type="password" bind:value={b2ApplicationKey} placeholder={settings.b2.hasApplicationKey ? t('settings.apiKeySaved') : t('settings.apiKeyEnter')} autocomplete="new-password" spellcheck="false"/>
      {#if settings.b2.hasApplicationKey}<label class="check-row"><input type="checkbox" bind:checked={b2ClearApplicationKey}/> {t('settings.removeApiKey')}</label>{/if}
    </section>
    <div class="settings-actions"><button class="primary" onclick={save} disabled={saving}>{saving ? t('settings.saving') : t('settings.save')}</button><span role="status">{message}</span></div>
  </div>
</div>
