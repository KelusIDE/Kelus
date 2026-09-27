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
  /** Optional USD prices per million tokens, used only to estimate cost in the usage panel. */
  inputPrice?: number;
  outputPrice?: number;
  encryptedApiKey?: string;
};
export type ProfileInput = {
  id: string;
  name: string;
  provider: Provider;
  modelUrl: string;
  modelName: string;
  inputPrice?: number | null;
  outputPrice?: number | null;
  apiKey?: string;
  clearApiKey?: boolean;
};
export type AgentConfig = {
  debate: boolean; coderId: string; criticIds: string[]; judgeId: string;
  panel: boolean; panelIds: string[]; panelRounds: number;
  computer: { enabled: boolean; profileId: string; confirmEachAction: boolean; maxSteps: number };
};
type SettingsData = {
  theme: Theme;
  locale: Locale;
  activeProfileId: string;
  profiles: ProviderProfile[];
  agent: AgentConfig;
  /** Monthly spending alert in USD; 0 means off. */
  monthlyBudget: number;
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
  return {
    theme: 'warm', locale: 'en', activeProfileId: 'mock', profiles: [{ ...MOCK_PROFILE }],
    agent: normalizeAgent(undefined), monthlyBudget: 0
  };
}
const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
function normalizeAgent(raw: unknown): AgentConfig {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<AgentConfig>;
  const ids = (list: unknown, max: number) => Array.isArray(list) ? [...new Set(list.filter((id): id is string => typeof id === 'string' && !!id))].slice(0, max) : [];
  const computer = (value.computer && typeof value.computer === 'object' ? value.computer : {}) as Partial<AgentConfig['computer']>;
  return {
    debate: value.debate === true,
    coderId: typeof value.coderId === 'string' ? value.coderId : '',
    criticIds: ids(value.criticIds, 2),
    judgeId: typeof value.judgeId === 'string' ? value.judgeId : '',
    panel: value.panel === true,
    panelIds: ids(value.panelIds, 4),
    panelRounds: clamp(value.panelRounds, 1, 3, 2),
    computer: {
      enabled: computer.enabled === true,
      profileId: typeof computer.profileId === 'string' ? computer.profileId : '',
      confirmEachAction: computer.confirmEachAction !== false,
      maxSteps: clamp(computer.maxSteps, 1, 100, 30)
    }
  };
}
function location(): string { return path.join(app.getPath('userData'), 'settings.json'); }
function secureStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const backend = (safeStorage as typeof safeStorage & { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend;
  if (process.platform === 'linux' && typeof backend !== 'function') return false;
  return typeof backend !== 'function' || backend() !== 'basic_text';
}
const price = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
function normalizeProfile(raw: unknown): ProviderProfile {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProviderProfile>;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : randomUUID(),
    name: typeof value.name === 'string' && value.name ? value.name : 'Untitled',
    provider: value.provider === 'openai-compatible' ? 'openai-compatible' : 'mock',
    modelUrl: typeof value.modelUrl === 'string' ? value.modelUrl : '',
    modelName: typeof value.modelName === 'string' ? value.modelName : '',
    inputPrice: price(value.inputPrice),
    outputPrice: price(value.outputPrice),
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
    const agent = normalizeAgent(stored.agent);
    const budget = price(stored.monthlyBudget) ?? 0;
    if (Array.isArray(stored.profiles) && stored.profiles.length) {
      const profiles = stored.profiles.map(normalizeProfile);
      const activeProfileId = typeof stored.activeProfileId === 'string' && profiles.some(p => p.id === stored.activeProfileId)
        ? stored.activeProfileId : profiles[0].id;
      cached = { theme, locale, activeProfileId, profiles, agent, monthlyBudget: budget };
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
      cached = {
        theme, locale, activeProfileId: migrated.id, profiles: migrated.provider === 'mock' ? [migrated] : [{ ...MOCK_PROFILE }, migrated],
        agent, monthlyBudget: budget
      };
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
  // A key encrypted by another build (dev vs packaged use different Keychain entries) reads as "not set".
  try { return safeStorage.decryptString(Buffer.from(profile.encryptedApiKey, 'base64')); } catch { return null; }
}
export async function publicSettings() {
  const data = await load();
  return {
    theme: data.theme,
    locale: data.locale,
    activeProfileId: data.activeProfileId,
    profiles: data.profiles.map(p => ({
      id: p.id, name: p.name, provider: p.provider, modelUrl: p.modelUrl, modelName: p.modelName,
      inputPrice: p.inputPrice ?? null, outputPrice: p.outputPrice ?? null,
      hasApiKey: Boolean(apiKeyFor(p))
    })),
    monthlyBudget: data.monthlyBudget,
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
      inputPrice: price(raw.inputPrice), outputPrice: price(raw.outputPrice),
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
  await persist(data);
  return publicSettings();
}
async function persist(data: SettingsData): Promise<void> {
  await fs.mkdir(path.dirname(location()), { recursive: true });
  const temporary = `${location()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, location());
}

export async function setActiveProfile(id: string) {
  const data = await load();
  if (!data.profiles.some(p => p.id === id)) throw new Error('Unknown provider profile');
  data.activeProfileId = id;
  await persist(data);
  return publicSettings();
}
export async function setMonthlyBudget(amount: number) {
  const data = await load();
  data.monthlyBudget = price(amount) ?? 0;
  await persist(data);
  return publicSettings();
}
export async function pricing(): Promise<{ profiles: { name: string; modelName: string; inputPrice?: number; outputPrice?: number }[]; monthlyBudget: number }> {
  const data = await load();
  return { profiles: data.profiles.map(p => ({ name: p.name, modelName: p.modelName, inputPrice: p.inputPrice, outputPrice: p.outputPrice })), monthlyBudget: data.monthlyBudget };
}
export async function agentConfig(): Promise<AgentConfig> { return (await load()).agent; }
export async function updateAgentConfig(input: unknown): Promise<AgentConfig> {
  const data = await load();
  const next = normalizeAgent(input);
  const known = (id: string) => data.profiles.some(p => p.id === id);
  next.criticIds = next.criticIds.filter(known);
  next.panelIds = next.panelIds.filter(known);
  if (next.coderId && !known(next.coderId)) next.coderId = '';
  if (next.judgeId && !known(next.judgeId)) next.judgeId = '';
  if (next.computer.profileId && !known(next.computer.profileId)) next.computer.profileId = '';
  if (next.panel && next.panelIds.length < 2) throw new Error('Pick at least two models for the planning panel');
  data.agent = next;
  await persist(data);
  return next;
}
type SeatConfig = { name: string; provider: Provider; url?: string; key?: string; model?: string };
/** Local servers such as Ollama ignore the API key, so one is not required for localhost URLs. */
function isLocalUrl(url: string): boolean {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname); } catch { return false; }
}
function keyFor(profile: ProviderProfile): string | null {
  return apiKeyFor(profile) || (isLocalUrl(profile.modelUrl) ? 'local' : null);
}
export async function useLocalVisionModel(model: string, url: string): Promise<void> {
  const data = await load();
  let profile = data.profiles.find(p => p.provider === 'openai-compatible' && isLocalUrl(p.modelUrl) && p.modelName === model);
  if (!profile) {
    profile = { id: `local-${model.replace(/[^a-z0-9]+/gi, '-')}`, name: `${model} (free, on this Mac)`, provider: 'openai-compatible', modelUrl: url, modelName: model, inputPrice: 0, outputPrice: 0 };
    data.profiles.push(profile);
  }
  data.agent.computer.profileId = profile.id;
  await persist(data);
}
function seatFor(data: SettingsData, id: string): SeatConfig {
  const profile = data.profiles.find(p => p.id === id) ?? data.profiles.find(p => p.id === data.activeProfileId) ?? data.profiles[0];
  if (profile.provider === 'mock') return { name: profile.name, provider: 'mock' };
  const key = keyFor(profile);
  if (!profile.modelUrl || !profile.modelName || !key) {
    throw new Error(`Set the model URL, model name, and API key for the "${profile.name}" provider profile in Settings first`);
  }
  return { name: profile.name, provider: profile.provider, url: profile.modelUrl, key, model: profile.modelName };
}
/** Environment for the agent engine: a KELUS_TEAM seating plan when debate or the panel is on, else the classic single model. */
export async function teamEnvironment(): Promise<Record<string, string>> {
  const data = await load();
  const agent = data.agent;
  if (!agent.debate && !agent.panel) return modelEnvironment();
  const coderId = agent.coderId || data.activeProfileId;
  const team = {
    debate: agent.debate,
    coder: seatFor(data, coderId),
    critics: (agent.debate && agent.criticIds.length ? agent.criticIds : [coderId]).map(id => seatFor(data, id)),
    judge: agent.debate && agent.judgeId ? seatFor(data, agent.judgeId) : null,
    panel: agent.panel ? agent.panelIds.map(id => seatFor(data, id)) : [],
    panelRounds: agent.panelRounds
  };
  return { KELUS_TEAM: JSON.stringify(team) };
}
export async function visionModel(): Promise<{ name: string; url: string; key: string; model: string }> {
  const data = await load();
  const active = data.profiles.find(p => p.id === data.activeProfileId);
  const fallback = active && active.provider !== 'mock' ? active.id : data.profiles.find(p => p.provider !== 'mock')?.id ?? data.activeProfileId;
  const seat = seatFor(data, data.agent.computer.profileId || fallback);
  if (seat.provider === 'mock' || !seat.url || !seat.key || !seat.model) {
    throw new Error('Computer control needs a real vision model. Pick an OpenAI-compatible profile (for example gpt-4o) for it.');
  }
  return { name: seat.name, url: seat.url, key: seat.key, model: seat.model };
}
export async function modelEnvironment(): Promise<Record<string, string>> {
  const data = await load();
  const profile = data.profiles.find(p => p.id === data.activeProfileId) ?? data.profiles[0];
  if (profile.provider === 'mock') return {};
  const key = keyFor(profile);
  if (!profile.modelUrl || !profile.modelName || !key) {
    throw new Error(`Set the model URL, model name, and API key for the "${profile.name}" provider profile in Settings first`);
  }
  return { KELUS_MODEL_URL: profile.modelUrl, KELUS_MODEL_NAME: profile.modelName, KELUS_MODEL_API_KEY: key };
}
