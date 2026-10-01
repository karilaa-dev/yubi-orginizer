/**
 * Help (#help-dialog) and Estimated filament (#filament-dialog) content, plus the offline,
 * install and update-check status lines shown in Help. Markup is rendered once with the shell,
 * so Help › About (version and build) is always present in the document.
 */
import type { PwaStatus } from '../pwa';
import { dialogHeading } from './app-dialogs';
import { esc } from './dom';

export const IOS_INSTALL_NOTE = 'On iPhone or iPad: Share → Add to Home Screen. The Home Screen app keeps its own projects, separate from Safari, so save project files here and import them there. Safari may clear site data after 7 days without a visit.';

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
  return `yubi-orginizer · Version ${esc(version)} · built ${esc(time)}${commitPart}`;
}

export function helpDialogMarkup(build: BuildInfo): string {
  return `<dialog id="help-dialog" class="dialog help-dialog" aria-labelledby="help-title">
    ${dialogHeading('help-title', 'Help')}
    <div class="help-content">
      <section aria-labelledby="help-printing">
        <h3 id="help-printing">Printing &amp; fit</h3>
        <p>Print at 100% scale. Models are in millimetres and each part rests flat on the bed. Preview keys and colours aren't printed.</p>
        <p>Print one pocket first to check the fit on your printer. The 5Ci pocket has extra side clearance and takes the connector either way.</p>
        <p>Dock fit is still being tuned. Print a one-key dock before a full organizer.</p>
      </section>
      <section aria-labelledby="help-stacking">
        <h3 id="help-stacking" tabindex="-1">Stacking layers</h3>
        <p>Stacked trays need the same size, connection and slide direction on every layer. Use New matching layer in the project menu to copy them. Put the lid on the top layer only.</p>
        <p id="tray-lock-help-text" hidden></p>
      </section>
      <section aria-labelledby="help-saving">
        <h3 id="help-saving">Saving &amp; offline</h3>
        <p>Everything saves automatically in this browser. Save a project file (.json) to back up a design or move it to another device.</p>
        <p id="offline-help-status"></p>
        <p id="help-install" class="help-install" hidden><button type="button" class="button secondary" data-action="install">Install app</button></p>
        <p id="ios-install-note" hidden>${esc(IOS_INSTALL_NOTE)}</p>
      </section>
      <section aria-labelledby="help-changes">
        <h3 id="help-changes">What changed</h3>
        <ul>
          <li>There's no Save button: projects save automatically.</li>
          <li>All projects: select yubi-orginizer at the top left.</li>
          <li>Label settings are in the Keys tab.</li>
          <li>Footprint, height and spacing are in the Size tab. Organizer type and Columns are in the Keys tab.</li>
        </ul>
      </section>
      <section aria-labelledby="help-about">
        <h3 id="help-about">About</h3>
        <p class="about-version">${aboutVersionMarkup(build)}</p>
        <div class="about-update">
          <button type="button" class="button secondary" data-action="check-updates">Check for updates</button>
          <span id="update-check-status" role="status"></span>
          <button type="button" class="button primary" data-action="update-now" hidden>Update now</button>
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
    <p>All printable parts · PLA · 1.75 mm</p>
    <p>5% infill, two 0.42 mm walls, 0.2 mm layers, four top and bottom layers.</p>
    <p>Excludes supports, brim and purge. Your slicer has the final number.</p>`;
}
