/**
 * Hash routes. Pure: no DOM access, so the app can decide what to show before rendering.
 *
 * - `''` (no hash, e.g. the installed app's start URL): resume the last project.
 * - `#/`: Projects.
 * - `#/p/<id>`: the editor for a saved project.
 * - `#/new/<template>`: the editor for a new project that is not saved yet.
 */
import { TEMPLATES } from './config';
import type { TemplateId } from './types';

export type Route =
  | { view: 'none' }
  | { view: 'home' }
  | { view: 'project'; id: string }
  | { view: 'new'; template: TemplateId };

const PROJECT_ROUTE = /^#\/p\/([\w-]{1,80})$/;
const NEW_ROUTE = /^#\/new\/([\w-]+)$/;

export function parseRoute(hash: string): Route {
  if (hash === '') return { view: 'none' };
  const project = PROJECT_ROUTE.exec(hash);
  if (project) return { view: 'project', id: project[1] };
  const created = NEW_ROUTE.exec(hash);
  const template = created && TEMPLATES.find(t => t.id === created[1]);
  if (template) return { view: 'new', template: template.id };
  return { view: 'home' };
}

export function routeHash(route: Exclude<Route, { view: 'none' }>): string {
  switch (route.view) {
    case 'home': return '#/';
    case 'project': return `#/p/${route.id}`;
    case 'new': return `#/new/${route.template}`;
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  return routeKey(a) === routeKey(b);
}

function routeKey(route: Route): string {
  return route.view === 'none' ? '' : routeHash(route);
}
