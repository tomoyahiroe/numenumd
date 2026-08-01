// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { KeyRouter } from './router';

const ev = (key: string, mods: Partial<KeyboardEvent> = {}) =>
  new KeyboardEvent('keydown', { key, ...mods });

describe('KeyRouter', () => {
  it('routes to handlers in priority order (lower number first)', () => {
    const r = new KeyRouter();
    const calls: string[] = [];
    r.register(10, () => (calls.push('low'), false));
    r.register(1, () => (calls.push('high'), false));
    r.route(ev('a'));
    expect(calls).toEqual(['high', 'low']);
  });

  it('stops at the first handler that consumes the event', () => {
    const r = new KeyRouter();
    const calls: string[] = [];
    r.register(1, () => (calls.push('first'), true));
    r.register(2, () => (calls.push('second'), false));
    expect(r.route(ev('a'))).toBe(true);
    expect(calls).toEqual(['first']);
  });

  it('returns false when no handler consumes', () => {
    expect(new KeyRouter().route(ev('a'))).toBe(false);
  });

  it('unregister removes the handler', () => {
    const r = new KeyRouter();
    const off = r.register(1, () => true);
    off();
    expect(r.route(ev('a'))).toBe(false);
  });
});
