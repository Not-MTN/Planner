import { describe, expect, it } from 'vitest';
import {
  androidSigningBaselineTags,
  LEGACY_TEST_ANDROID_RELEASE_TAGS,
} from './android-signing-baseline.mjs';

describe('Android signing baseline bootstrap', () => {
  it('excludes only the two known test releases signed with ephemeral debug keys', () => {
    expect(LEGACY_TEST_ANDROID_RELEASE_TAGS).toEqual(['v1.0.0', 'v1.0.1']);
    expect(androidSigningBaselineTags([
      'v1.0.1',
      'v1.0.2',
      'v1.0.0',
      'v2.0.0',
    ])).toEqual(['v1.0.2', 'v2.0.0']);
  });

  it('does not exempt newer releases or similarly named tags', () => {
    expect(androidSigningBaselineTags([
      'v1.0.10',
      'v1.0.2-test',
      'v1.0.2',
    ])).toEqual(['v1.0.10', 'v1.0.2-test', 'v1.0.2']);
  });

  it('preserves the release order when filtering', () => {
    expect(androidSigningBaselineTags([
      'v1.1.0',
      'v1.0.1',
      'v1.2.0',
      'v1.0.0',
    ])).toEqual(['v1.1.0', 'v1.2.0']);
  });
});
