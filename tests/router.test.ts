import { describe, expect, it } from 'vitest';
import { parseRoute, routeHash, sameRoute, type Route } from '../src/router';

describe('parseRoute', () => {
  it('treats a missing hash as "resume"', () => {
    expect(parseRoute('')).toEqual({ view: 'none' });
  });

  it('reads the Projects route', () => {
    expect(parseRoute('#')).toEqual({ view: 'home' });
    expect(parseRoute('#/')).toEqual({ view: 'home' });
  });

  it('reads project ids', () => {
    expect(parseRoute('#/p/3f2a9c1e-7b0d-4c1e-9a55-0c2f6d1e8b77')).toEqual({ view: 'project', id: '3f2a9c1e-7b0d-4c1e-9a55-0c2f6d1e8b77' });
    expect(parseRoute('#/p/keyform-draft-abc_1')).toEqual({ view: 'project', id: 'keyform-draft-abc_1' });
    expect(parseRoute(`#/p/${'a'.repeat(80)}`)).toEqual({ view: 'project', id: 'a'.repeat(80) });
  });

  it('reads new-project routes for known organizer types only', () => {
    expect(parseRoute('#/new/inventory_tray')).toEqual({ view: 'new', template: 'inventory_tray' });
    expect(parseRoute('#/new/desktop_dock')).toEqual({ view: 'new', template: 'desktop_dock' });
    expect(parseRoute('#/new/modular_rail')).toEqual({ view: 'home' });
    expect(parseRoute('#/new/')).toEqual({ view: 'home' });
  });

  it('sends anything else to Projects', () => {
    for (const hash of ['#/p/', '#/p/a b', '#/p/a/b', `#/p/${'a'.repeat(81)}`, '#/p/<script>', '#/unknown', '#p/abc', '#/P/abc', '#/p/abc/']) {
      expect(parseRoute(hash), hash).toEqual({ view: 'home' });
    }
  });
});

describe('routeHash', () => {
  it('builds every route', () => {
    expect(routeHash({ view: 'home' })).toBe('#/');
    expect(routeHash({ view: 'project', id: 'abc-1' })).toBe('#/p/abc-1');
    expect(routeHash({ view: 'new', template: 'desktop_dock' })).toBe('#/new/desktop_dock');
  });

  it('round-trips through parseRoute', () => {
    const routes: Exclude<Route, { view: 'none' }>[] = [
      { view: 'home' }, { view: 'project', id: 'x_Y-9' }, { view: 'new', template: 'inventory_tray' }, { view: 'new', template: 'desktop_dock' },
    ];
    for (const route of routes) expect(parseRoute(routeHash(route))).toEqual(route);
  });

  it('compares routes', () => {
    expect(sameRoute(parseRoute('#'), { view: 'home' })).toBe(true);
    expect(sameRoute({ view: 'project', id: 'a' }, { view: 'project', id: 'b' })).toBe(false);
    expect(sameRoute({ view: 'none' }, { view: 'home' })).toBe(false);
  });
});
