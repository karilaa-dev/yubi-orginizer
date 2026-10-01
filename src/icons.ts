const paths: Record<string, string> = {
  rotate: '<path d="M20 9a8 8 0 1 0-1 9M20 3v6h-6"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.8-8.8m-3.5 3.5 2.5 2.5m-5.5.5 2 2"/>',
  ruler: '<path d="M3 16.5 16.5 3 21 7.5 7.5 21z"/><path d="m7.5 12 2 2M10.5 9l2 2m1-5 2 2"/>',
  sliders: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  filament: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M20 12v8h-5M8 5l1.5 4M5 10l4 .7m-2 6 3-2m7 3-3-3m5-8-4 3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  folder: '<path d="M3 6h7l2 3h9v12H3zM3 6V3h7l2 3h7v3"/>',
  back: '<path d="m10 5-7 7 7 7M3 12h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  chevron: '<path d="m8 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M5 16v5h14v-5"/>',
  file: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 13h8m-8 4h6"/>',
  cube: '<path d="m12 2 9 5v10l-9 5-9-5V7zm0 10v10M3 7l9 5 9-5M8 4l9 5v5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  dock: '<path d="M3 15h18v6H3z"/><rect x="5" y="3" width="4" height="12" rx="1"/><rect x="15" y="6" width="4" height="9" rx="1"/>',
  tray: '<rect x="2" y="4" width="20" height="16" rx="3"/><rect x="5" y="7" width="4" height="10" rx="1"/><rect x="11" y="7" width="3" height="6" rx="1"/><rect x="16" y="7" width="3" height="10" rx="1"/>',
  reset: '<path d="M3 10a9 9 0 1 1 1.8 8M3 4v6h6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m3 3 18 18M10 5h2c6 0 10 7 10 7s-1.3 2.3-3.5 4.2M6.5 6.5C3.7 8.7 2 12 2 12s4 7 10 7c1.9 0 3.7-.7 5.2-1.8M10 10a3 3 0 0 0 4 4"/>',
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  settings: '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="9" cy="18" r="2" fill="currentColor"/>',
  shield: '<path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5z"/><path d="m8 11 3 3 5-6"/>',
  offline: '<path d="M5 15a4 4 0 0 1 0-8 7 7 0 0 1 13-1 5 5 0 0 1 1 10M8 16l3 3 5-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  // The same layers as separate paths, so the Explode button can spread them apart.
  explode: '<path class="layer-top" d="m12 3 10 5-10 5L2 8z"/><path d="m2 12 10 5 10-5"/><path class="layer-bottom" d="m2 16 10 5 10-5"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  edit: '<path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  alert: '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>',
  cloudOff: '<path d="m2 2 20 20"/><path d="M5.8 5.8A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.3-.2"/><path d="M21.5 16.5A4.5 4.5 0 0 0 17.5 10h-1.8A7 7 0 0 0 10 5.1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.3-2.5 3.8M12 17h.01"/>',
  sparkle: '<path d="M11 3.5 12.8 8a2 2 0 0 0 1.2 1.2l4.5 1.8-4.5 1.8a2 2 0 0 0-1.2 1.2L11 18.5 9.2 14A2 2 0 0 0 8 12.8L3.5 11 8 9.2A2 2 0 0 0 9.2 8z"/><path d="M19 3v4m-2-2h4M18 17v3m-1.5-1.5h3"/>',
};
export function icon(name: string, className = ''): string {
  return `<svg class="icon ${className}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cube}</svg>`;
}
export function keyIcon(type: string): string {
  // The body colour is themable (--key-ink) so black keys stay visible on dark surfaces.
  const ink = 'var(--key-ink,#263238)', gold = '#d4ae55', metal = '#adb9bc';
  const ring = (y: number, r = 2.7) => `<circle cy="${y}" r="${r}" fill="${gold}"/><circle cy="${y}" r="${r - 0.45}" fill="var(--surface,#fff)"/>`;
  let shape: string, transform: string;
  if (type === 'A' || type === 'C') {
    transform = 'translate(20 55) scale(1.1 -1.1)';
    const connector = type === 'A'
      ? `<rect x="-6" width="12" height="12.2" rx="0.5" fill="${ink}"/>${[-4.15, -1.4, 1.4, 4.15].map(x => `<rect x="${x - 1.02}" y="0.85" width="2.04" height="${Math.abs(x) > 3 ? 7 : 6.25}" rx="0.15" fill="${gold}"/>`).join('')}`
      : `<rect x="-4.125" width="8.25" height="7" rx="1.1" fill="${metal}"/><rect x="-5" y="6.6" width="10" height="6" rx="0.6" fill="${ink}"/>`;
    shape = `${connector}<rect x="-9" y="11.7" width="18" height="33.3" rx="1.65" fill="${ink}"/>${ring(40, 2.71)}<circle cy="24.5" r="4.65" fill="${gold}"/>`;
  } else if (type === 'AN') {
    transform = 'translate(20 18) scale(1.75)';
    shape = `<path d="M-5 13q-1 0-1-1V2C-4-1 4-1 6 2v10q0 1-1 1Z" fill="${ink}"/><path d="M-5.1 1.9Q0-1.8 5.1 1.9Z" fill="${gold}"/><rect x="-1.1" y=".9" width="2.2" height=".7" rx=".25" fill="var(--surface,#fff)"/>${[-4.15, -1.4, 1.4, 4.15].map(x => `<rect x="${x - 1.02}" y="4.3" width="2.04" height="${Math.abs(x) > 3 ? 8 : 7.3}" rx=".15" fill="${gold}"/>`).join('')}<path d="M-5.3 3h10.6" stroke="#526068" stroke-width=".4"/>`;
  } else if (type === 'CN') {
    transform = 'translate(20 20) scale(1.8)';
    shape = `<rect x="-4.125" y="3" width="8.25" height="7.1" rx="1.1" fill="${metal}"/><rect x="-6" width="12" height="3.47" rx="1" fill="${ink}"/><rect x="-1.8" y="1.4" width="3.6" height=".6" rx=".2" fill="${gold}"/>`;
  } else if (type === 'CK') {
    transform = 'translate(20 10) scale(1.4)';
    shape = `<rect x="-4.125" y="22.7" width="8.25" height="6.8" rx="1.1" fill="${metal}"/><path d="M-5.75 23V6a5.75 5.75 0 0 1 11.5 0v17Z" fill="${ink}"/>${ring(5.5, 2.85)}<rect x="-6.25" y="9.8" width=".6" height="3.1" rx=".2" fill="${gold}"/><rect x="5.65" y="9.8" width=".6" height="3.1" rx=".2" fill="${gold}"/>`;
  } else {
    transform = 'translate(20 6) scale(1.18)';
    shape = `<rect x="-3.05" width="6.1" height="6.4" rx=".7" fill="${metal}"/>${[-2.45, -1.75, -1.05, -.35, .35, 1.05, 1.75, 2.45].map(x => `<rect x="${x - .19}" y=".65" width=".38" height="3.5" rx=".1" fill="${gold}"/>`).join('')}<rect x="-4.125" y="33.5" width="8.25" height="6.8" rx="1.1" fill="${metal}"/><rect x="-5.52" y="6.2" width="11.04" height="27.45" rx=".8" fill="${ink}"/>${ring(15.7, 2.85)}<rect x="-6" y="18.8" width=".65" height="3.1" rx=".2" fill="${gold}"/><rect x="5.35" y="18.8" width=".65" height="3.1" rx=".2" fill="${gold}"/>`;
  }
  return `<svg class="key-illustration" viewBox="0 0 40 60" fill="none" aria-hidden="true"><g transform="${transform}">${shape}</g></svg>`;
}
