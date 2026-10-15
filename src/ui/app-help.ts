/**
 * Help (#help-dialog) and Estimated filament (#filament-dialog) content, plus the offline,
 * install and update-check status lines shown in Help. Markup is rendered once with the shell,
 * so Help › About (version and build) is always present in the document.
 */
import type { PwaStatus } from '../pwa';
import { dialogHeading } from './app-dialogs';
import { esc } from './dom';
import { icon } from '../icons';

export const IOS_INSTALL_NOTE = 'On iPhone or iPad: Share → Add to Home Screen. The Home Screen app keeps its own projects, so move them with project files.';

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone / iPad Safari (including iPadOS reporting as a Mac). */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** The Saving & offline status line. */
export function offlineStatusText(status: Pick<PwaStatus, 'supported' | 'offlineReady'> & Partial<Pick<PwaStatus, 'registrationFailed'>>, standalone: boolean): string {
  const base = !status.supported || status.registrationFailed ? "Offline use isn't available in this browser."
    : status.offlineReady ? 'Works offline on this device.' : 'Getting ready for offline use…';
  return standalone ? `${base} Running as an installed app.` : base;
}

/** About › update check line after "Check for updates" (or while an update is waiting). */
export function updateCheckText(status: Pick<PwaStatus, 'online' | 'downloading' | 'updateReady' | 'applying'>, checking: boolean): string {
  if (status.applying) return 'Updating…';
  if (status.updateReady) return 'Update ready.';
  if (!status.online) return 'Connect to the internet to check for updates.';
  if (checking) return 'Checking…';
  if (status.downloading) return 'Downloading an update…';
  return "You're up to date.";
}

export interface BuildInfo { version: string; time: string; commit: string; commitUrl: string }

/** "Version 1.0.0 · built 2026-09-30 17:40 UTC · commit 40e2627" (the commit links to GitHub when known). */
export function aboutVersionMarkup({ version, time, commit, commitUrl }: BuildInfo): string {
  const short = esc(commit.slice(0, 7));
  const commitPart = !commit ? ''
    : commitUrl ? ` · commit <a href="${esc(commitUrl)}" target="_blank" rel="noopener" title="${esc(commit)}">${short}</a>`
    : ` · commit <span title="${esc(commit)}">${short}</span>`;
  return `Version ${esc(version)} · built ${esc(time)}${commitPart}`;
}

/** Source code, issues and releases. */
export const REPO_URL = 'https://github.com/karilaa-dev/yubi-orginizer';

const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function shortcutsMarkup(): string {
  const mod = isMac() ? '⌘' : 'Ctrl+';
  const rows = [['Undo', `${mod}Z`], ['Redo', isMac() ? '⇧⌘Z' : 'Ctrl+Shift+Z']];
  return `<dl class="shortcut-list">${rows.map(([action, keys]) => `<div><dt>${action}</dt><dd><kbd>${keys}</kbd></dd></div>`).join('')}</dl>`;
}

export function helpDialogMarkup(build: BuildInfo): string {
  return `<dialog id="help-dialog" class="dialog help-dialog" aria-labelledby="help-title">
    ${dialogHeading('help-title', 'Help')}
    <div class="help-content">
      <section aria-labelledby="help-printing">
        <h3 id="help-printing">Printing</h3>
        <p>Print at 100% scale. Print a single pocket first to check the fit on your printer. Keys and colours in the preview aren't printed.</p>
      </section>
      <section aria-labelledby="help-stacking">
        <h3 id="help-stacking" tabindex="-1">Stacking layers</h3>
        <p>Add trays and a lid in the Layers tab. All layers share one size and connection; the lid always goes on top.</p>
        <p id="tray-lock-help-text" hidden></p>
      </section>
      <section aria-labelledby="help-saving">
        <h3 id="help-saving">Saving &amp; offline</h3>
        <p>Projects save automatically in this browser. Save a project file (.json) to back up a design or move it to another device.</p>
        <p id="offline-help-status"></p>
        <p id="help-install" class="help-install" hidden><button type="button" class="button secondary" data-action="install">Install app</button></p>
        <p id="ios-install-note" hidden>${esc(IOS_INSTALL_NOTE)}</p>
      </section>
      <section aria-labelledby="help-shortcuts">
        <h3 id="help-shortcuts">Shortcuts</h3>
        ${shortcutsMarkup()}
      </section>
      <section class="about" aria-labelledby="help-about">
        <h3 id="help-about">About</h3>
        <p>yubi-orginizer is free and open source. Everything runs on your device.</p>
        <div class="about-links">
          <a class="button secondary" href="${REPO_URL}" target="_blank" rel="noopener">${icon('github')}View on GitHub</a>
          <a class="button quiet" href="${REPO_URL}/issues" target="_blank" rel="noopener">Report an issue${icon('external')}</a>
        </div>
        <p class="about-version">${aboutVersionMarkup(build)}</p>
        <div class="about-update">
          <button type="button" class="button secondary compact" data-action="check-updates">Check for updates</button>
          <span id="update-check-status" role="status"></span>
          <button type="button" class="button primary compact" data-action="update-now" hidden>Update now</button>
        </div>
      </section>
    </div>
  </dialog>`;
}

export function filamentDialogMarkup(): string {
  return `<dialog id="filament-dialog" class="dialog small-dialog" aria-labelledby="filament-title">
    ${dialogHeading('filament-title', 'Estimated filament')}
    <div id="filament-detail" class="help-content"></div>
  </dialog>`;
}

export function filamentDetailMarkup(grams: number, meters: number): string {
  return `<p class="estimate-total">≈ ${grams.toFixed(1)} g <span>· ${meters.toFixed(2)} m</span></p>
    <p>All parts in PLA (1.75 mm) at 5% infill, 0.2 mm layers. Your slicer has the final number.</p>`;
}
