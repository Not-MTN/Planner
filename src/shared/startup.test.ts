import { describe, expect, it } from 'vitest';
import { createStartupState, dismissStartupUpdate, withAccountCheck, withUpdateCheck } from './startup';

describe('shared startup state', () => {
  it('starts account and connection checks alongside the installed version and update lookup', () => {
    expect(createStartupState('1.2.3', true)).toEqual({
      account: 'checking',
      connection: 'checking',
      installedVersion: '1.2.3',
      update: {
        phase: 'checking',
        availableVersion: null,
        offer: null,
        progress: null,
        error: null,
        notApplicableReason: null,
      },
    });
  });

  it('does not run the packaged updater for a browser build', () => {
    expect(createStartupState('1.2.3', false).update.phase).toBe('not-applicable');
  });

  it('updates one check without overwriting the result of another', () => {
    const initial = createStartupState('1.2.3', true);
    const accountDone = withAccountCheck(initial, 'ready', 'connected');
    const updateDone = withUpdateCheck(accountDone, { status: 'available', version: '1.3.0' });

    expect(updateDone.account).toBe('ready');
    expect(updateDone.connection).toBe('connected');
    expect(updateDone.installedVersion).toBe('1.2.3');
    expect(updateDone.update).toEqual({
      phase: 'available',
      availableVersion: '1.3.0',
      offer: null,
      progress: null,
      error: null,
      notApplicableReason: null,
    });
    // Updates are immutable so the account gate can safely hand this state to
    // the planner while a request that began during boot is still resolving.
    expect(initial.update.phase).toBe('checking');
  });

  it('keeps the selected version in the state when the user dismisses its notice', () => {
    const state = withUpdateCheck(createStartupState('1.2.3', true), {
      status: 'available',
      version: '1.3.0',
    });

    expect(dismissStartupUpdate(state).update).toMatchObject({
      phase: 'dismissed',
      availableVersion: '1.3.0',
      progress: null,
    });
  });
});
