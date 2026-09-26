import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type Theme = 'warm' | 'dark' | 'light' | 'midnight' | 'dracula' | 'nord' | 'solarized' | 'monokai' | 'high-contrast';
const themes: Theme[] = ['warm', 'dark', 'light', 'midnight', 'dracula', 'nord', 'solarized', 'monokai', 'high-contrast'];
export type Locale = 'en' | 'ko' | 'fr' | 'es' | 'de' | 'ja' | 'zh';
const locales: Locale[] = ['en', 'ko', 'fr', 'es', 'de', 'ja', 'zh'];
export type Provider = 'mock' | 'openai-compatible';
export type ProviderProfile = {
  id: string;
  name: string;
  provider: Provider;
  modelUrl: string;
  modelName: string;
  encryptedApiKey?: string;
};
export type ProfileInput = {
  id: string;
  name: string;
  provider: Provider;
  modelUrl: string;
  modelName: string;
  apiKey?: string;
  clearApiKey?: boolean;
};
type SettingsData = {
  theme: Theme;
  locale: Locale;
  activeProfileId: string;
  profiles: ProviderProfile[];
};
export type SettingsUpdate = {
  theme: Theme;
  locale: Locale;
  activeProfileId: string;
  profiles: ProfileInput[];
};

const MOCK_PROFILE: ProviderProfile = { id: 'mock', name: 'Mock (local demo)', provider: 'mock', modelUrl: '', modelName: '' };

let cached: SettingsData | null = null;
const sessionApiKeys = new Map<string, string>();
function defaultData(): SettingsData {
  return { theme: 'warm', locale: 'en', activeProfileId: 'mock', profiles: [{ ...MOCK_PROFILE }] };
}
function location(): string { return path.join(app.getPath('userData'), 'settings.json'); }
function secureStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const backend = (safeStorage as typeof safeStorage & { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend;
  if (process.platform === 'linux' && typeof backend !== 'function') return false;
  return typeof backend !== 'function' || backend() !== 'basic_text';
}
function normalizeProfile(raw: unknown): ProviderProfile {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProviderProfile>;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : randomUUID(),
    name: typeof value.name === 'string' && value.name ? value.name : 'Untitled',
    provider: value.provider === 'openai-compatible' ? 'openai-compatible' : 'mock',
    modelUrl: typeof value.modelUrl === 'string' ? value.modelUrl : '',
    modelName: typeof value.modelName === 'string' ? value.modelName : '',
    encryptedApiKey: typeof value.encryptedApiKey === 'string' ? value.encryptedApiKey : undefined
  };
}
async function load(): Promise<SettingsData> {
  if (cached) return cached;
  try {
    const stored = JSON.parse(await fs.readFile(location(), 'utf8')) as Partial<SettingsData> & {
      provider?: string; modelUrl?: string; modelName?: string; encryptedApiKey?: string;
    };
    const theme = themes.includes(stored.theme as Theme) ? (stored.theme as Theme) : 'warm';
    const locale = locales.includes(stored.locale as Locale) ? (stored.locale as Locale) : 'en';
    if (Array.isArray(stored.profiles) && stored.profiles.length) {
      const profiles = stored.profiles.map(normalizeProfile);
      const activeProfileId = typeof stored.activeProfileId === 'string' && profiles.some(p => p.id === stored.activeProfileId)
        ? stored.activeProfileId : profiles[0].id;
      cached = { theme, locale, activeProfileId, profiles };
    } else if (stored.provider) {
      // Migrate the pre-profile single-provider shape into a profile.
      const migrated: ProviderProfile = {
        id: 'default',
        name: stored.provider === 'openai-compatible' ? 'My provider' : 'Mock (local demo)',
        provider: stored.provider === 'openai-compatible' ? 'openai-compatible' : 'mock',
        modelUrl: typeof stored.modelUrl === 'string' ? stored.modelUrl : '',
        modelName: typeof stored.modelName === 'string' ? stored.modelName : '',
        encryptedApiKey: typeof stored.encryptedApiKey === 'string' ? stored.encryptedApiKey : undefined
      };
      cached = { theme, locale, activeProfileId: migrated.id, profiles: migrated.provider === 'mock' ? [migrated] : [{ ...MOCK_PROFILE }, migrated] };
    } else {
      cached = defaultData();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    cached = defaultData();
  }
  if (!cached.profiles.some(p => p.id === 'mock')) cached.profiles.unshift({ ...MOCK_PROFILE });
  return cached;
}
function apiKeyFor(profile: ProviderProfile): string | null {
  if (sessionApiKeys.has(profile.id)) return sessionApiKeys.get(profile.id)!;
  if (!profile.encryptedApiKey || !secureStorageAvailable()) return null;
  return safeStorage.decryptString(Buffer.from(profile.encryptedApiKey, 'base64'));
}
export async function publicSettings() {
  const data = await load();
  return {
    theme: data.theme,
    locale: data.locale,
    activeProfileId: data.activeProfileId,
    profiles: data.profiles.map(p => ({
      id: p.id, name: p.name, provider: p.provider, modelUrl: p.modelUrl, modelName: p.modelName,
      hasApiKey: Boolean(apiKeyFor(p))
    })),
    keyStorage: secureStorageAvailable() ? 'encrypted' : 'session-only'
  };
}
export async function updateSettings(input: SettingsUpdate) {
  if (!themes.includes(input.theme)) throw new Error('Invalid theme');
  if (!locales.includes(input.locale)) throw new Error('Invalid language');
  if (!Array.isArray(input.profiles) || input.profiles.length === 0) throw new Error('At least one provider profile is required');
  const data = await load();
  const seenIds = new Set<string>();
  const nextProfiles: ProviderProfile[] = [];
  for (const raw of input.profiles) {
    if (!raw.id || seenIds.has(raw.id)) throw new Error('Each provider profile needs a unique id');
    seenIds.add(raw.id);
    if (!['mock', 'openai-compatible'].includes(raw.provider)) throw new Error('Invalid model provider');
    const modelUrl = raw.modelUrl.trim();
    if (modelUrl) {
      const url = new URL(modelUrl);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
        throw new Error('Model URL must use HTTPS, or HTTP on localhost');
      }
    }
    const existing = data.profiles.find(p => p.id === raw.id);
    const profile: ProviderProfile = {
      id: raw.id,
      name: raw.name.trim() || 'Untitled',
      provider: raw.provider,
      modelUrl,
      modelName: raw.modelName.trim(),
      encryptedApiKey: existing?.encryptedApiKey
    };
    if (raw.clearApiKey) { sessionApiKeys.delete(raw.id); profile.encryptedApiKey = undefined; }
    if (raw.apiKey?.trim()) {
      const key = raw.apiKey.trim();
      sessionApiKeys.set(raw.id, key);
      profile.encryptedApiKey = secureStorageAvailable() ? safeStorage.encryptString(key).toString('base64') : undefined;
    }
    nextProfiles.push(profile);
  }
  if (!nextProfiles.some(p => p.id === 'mock')) nextProfiles.unshift({ ...MOCK_PROFILE });
  if (!nextProfiles.some(p => p.id === input.activeProfileId)) throw new Error('activeProfileId must match a profile');
  data.theme = input.theme;
  data.locale = input.locale;
  data.activeProfileId = input.activeProfileId;
  data.profiles = nextProfiles;
  await fs.mkdir(path.dirname(location()), { recursive: true });
  const temporary = `${location()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, location());
  return publicSettings();
}
export async function modelEnvironment(): Promise<Record<string, string>> {
  const data = await load();
  const profile = data.profiles.find(p => p.id === data.activeProfileId) ?? data.profiles[0];
  if (profile.provider === 'mock') return {};
  const key = apiKeyFor(profile);
  if (!profile.modelUrl || !profile.modelName || !key) {
    throw new Error(`Set the model URL, model name, and API key for the "${profile.name}" provider profile in Settings first`);
  }
  return { KELUS_MODEL_URL: profile.modelUrl, KELUS_MODEL_NAME: profile.modelName, KELUS_MODEL_API_KEY: key };
}
