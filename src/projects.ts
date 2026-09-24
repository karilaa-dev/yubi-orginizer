import { validateConfig } from './config';
import type { HolderConfig } from './types';

export const PROJECTS_KEY = 'keyform.projects.v1';
export const ACTIVE_PROJECT_KEY = 'keyform.active-project.v1';
export const DRAFT_KEY = 'keyform.draft.v1';
export interface LocalProject { id: string; name: string; createdAt: string; updatedAt: string; config: HolderConfig }
export interface LocalDraft { version: 1; config: HolderConfig; projectId?: string }
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;

function draftRecord(config: unknown, projectId?: unknown): LocalDraft {
  if (projectId !== undefined && (typeof projectId !== 'string' || !projectId.trim())) {
    throw new Error('Draft project ID must be a non-empty string.');
  }
  return {
    version: 1,
    config: validateConfig(config),
    ...(projectId !== undefined ? { projectId: projectId as string } : {}),
  };
}

/** The draft and its owner are a single record; never infer ownership from a
 * separately written active-project key. Legacy migration belongs to the caller. */
export function readDraft(storage: StorageAccess): LocalDraft | undefined {
  const raw = storage.getItem(DRAFT_KEY);
  if (raw === null) return undefined;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1) throw new Error();
    return draftRecord(data.config, data.projectId);
  } catch { throw new Error('Your saved draft could not be read. Existing data has been kept.'); }
}

export function writeDraft(storage: StorageAccess, config: HolderConfig, projectId?: string): LocalDraft {
  const draft = draftRecord(config, projectId);
  // localStorage setItem is atomic: failure leaves the prior config/owner pair
  // intact, so opening a different project cannot misassign a recovered draft.
  try { storage.setItem(DRAFT_KEY, JSON.stringify(draft)); }
  catch { throw new Error('Browser storage is full or unavailable. This draft could not be saved.'); }
  return draft;
}

export function readProjects(storage: StorageAccess): LocalProject[] {
  const raw = storage.getItem(PROJECTS_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.projects)) throw new Error();
    const ids = new Set<string>();
    return data.projects.map((p: LocalProject) => {
      if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80 || !Number.isFinite(Date.parse(p.createdAt)) || !Number.isFinite(Date.parse(p.updatedAt))) throw new Error();
      ids.add(p.id);
      return { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, config: validateConfig(p.config) };
    }).sort((a: LocalProject, b: LocalProject) => b.updatedAt.localeCompare(a.updatedAt));
  } catch { throw new Error('Saved projects could not be read. Existing data has been kept.'); }
}

export function saveProject(storage: StorageAccess, config: HolderConfig, name: string, id?: string): LocalProject {
  name = name.trim();
  if (!name || name.length > 80) throw new Error('Enter a project name with 1–80 characters.');
  const projects = readProjects(storage);
  const existing = id ? projects.find(p => p.id === id) : undefined;
  if (id && !existing) throw new Error('This saved project no longer exists. Save it as a new project.');
  const now = new Date().toISOString();
  const project = { id: existing?.id ?? crypto.randomUUID(), name, createdAt: existing?.createdAt ?? now, updatedAt: now, config: validateConfig(config) };
  const next = [project, ...projects.filter(p => p.id !== project.id)];
  try { storage.setItem(PROJECTS_KEY, JSON.stringify({ version: 1, projects: next })); }
  catch { throw new Error('Browser storage is full or unavailable. This project could not be saved.'); }
  return project;
}
