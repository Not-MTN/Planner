// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import { currentVersion, RELEASES_PAGE, type WindowsUpdateOffer } from './shared/updates';
import {
  createStartupState,
  StartupProvider,
  type StartupState,
  type StartupUpdatePhase,
} from './shared/startup';

const updater = vi.hoisted(() => ({
  downloadPackagedUpdate: vi.fn(),
  applyPackagedUpdate: vi.fn(),
}));
vi.mock('./shared/updateRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./shared/updateRuntime')>()),
  downloadPackagedUpdate: updater.downloadPackagedUpdate,
  applyPackagedUpdate: updater.applyPackagedUpdate,
}));

/**
 * The packaged notice consumes an offer checked by AccountGate. The updater
 * integration itself is mocked here; manifest selection and native bridges
 * have their own focused tests.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function updateOffer(version: string): WindowsUpdateOffer {
  return {
    platform: 'windows',
    version,
    appId: 'com.notmtn.planner',
    fileName: 'Planner-windows.exe',
    downloadUrl: `https://github.com/Not-MTN/Planner/releases/download/v${version}/Planner-windows.exe`,
    sizeBytes: 1024,
    sha256: 'ab'.repeat(32),
  };
}

function TestPlanner({ phase, version }: { phase: StartupUpdatePhase; version?: string }) {
  const [startup, setStartup] = useState<StartupState>(() => ({
    ...createStartupState(currentVersion(), phase !== 'not-applicable'),
    update: {
      phase,
      availableVersion: version ?? null,
      offer: version ? updateOffer(version) : null,
      progress: null,
      error: null,
      notApplicableReason: null,
    },
  }));
  return (
    <StartupProvider state={startup} setState={setStartup}>
      <App />
    </StartupProvider>
  );
}

async function mountApp(phase: StartupUpdatePhase, version?: string): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <StrictMode>
        <TestPlanner phase={phase} version={version} />
      </StrictMode>,
    );
  });
}

function text(): string {
  return document.body.textContent ?? '';
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  updater.downloadPackagedUpdate.mockReset();
  updater.applyPackagedUpdate.mockReset();
  updater.downloadPackagedUpdate.mockResolvedValue(undefined);
  updater.applyPackagedUpdate.mockResolvedValue(undefined);
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => undefined;
  window.scrollTo = () => undefined;
  localStorage.setItem('planner-tour-done', '1');
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe('the packaged update notice', () => {
  it('offers a verified update and links to its release page', async () => {
    await mountApp('available', '1.0.1');
    expect(text()).toContain('Planner 1.0.1 is available to update.');
    expect(document.querySelector('button.update-download-action')?.textContent).toContain('Download update');
    const link = Array.from(document.querySelectorAll('a')).find((a) => a.getAttribute('href') === RELEASES_PAGE);
    expect(link?.textContent).toContain('Release page');
  });

  it('stays quiet when the installed build is current or the offer was dismissed', async () => {
    await mountApp('current');
    expect(document.querySelector('.update-toast')).toBeNull();
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;

    await mountApp('dismissed', '1.0.1');
    expect(document.querySelector('.update-toast')).toBeNull();
  });

  it('records Later in storage and removes an available notice', async () => {
    await mountApp('available', '1.0.1');
    const later = document.querySelector<HTMLButtonElement>('.update-toast button[aria-label="Later"]');
    expect(later).toBeTruthy();
    act(() => later?.click());
    expect(localStorage.getItem('planner-update-dismissed')).toBe('1.0.1');
    expect(document.querySelector('.update-toast')).toBeNull();
  });

  it('shows byte progress, then offers installation and reopening', async () => {
    let finishDownload: (() => void) | null = null;
    updater.downloadPackagedUpdate.mockImplementation((_offer: WindowsUpdateOffer, onProgress: (progress: { bytesReceived: number; totalBytes: number }) => void) => {
      onProgress({ bytesReceived: 512, totalBytes: 1024 });
      return new Promise<void>((resolve) => { finishDownload = resolve; });
    });
    await mountApp('available', '1.0.1');

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.update-download-action')?.click();
      await Promise.resolve();
    });
    expect(text()).toContain('Downloading update · 50%');
    expect(document.querySelector<HTMLProgressElement>('.update-download-progress')?.value).toBe(512);

    await act(async () => {
      finishDownload?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(text()).toContain('Update ready to install');
    const install = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Install and reopen'));
    expect(install).toBeTruthy();

    await act(async () => {
      install?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(updater.applyPackagedUpdate).toHaveBeenCalledOnce();
    expect(text()).toContain('Update installed. Opening Planner…');
  });

  it('does not offer an update when no eligible platform offer exists', async () => {
    await mountApp('not-applicable');
    expect(document.querySelector('.update-toast')).toBeNull();
  });
});
