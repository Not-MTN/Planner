/**
 * Client for the personal access token API.
 *
 * These calls run inside the signed-in app and reuse the session-cookie
 * client, so they carry the same same-origin rules as every other account
 * route. The plaintext token returned by `createApiToken` is available once,
 * at creation: the server stores only its hash, so the settings screen shows
 * it immediately and never asks for it again.
 */
import { request } from './session';
import type { ApiTokenCreated, ApiTokenInfo, ApiTokenScope, CreateApiTokenRequest } from '../shared/authContract';

export async function listApiTokens(): Promise<ApiTokenInfo[]> {
  const result = await request<{ tokens: ApiTokenInfo[] }>('/api/auth/api-tokens');
  return result.tokens;
}

export async function createApiToken(input: CreateApiTokenRequest): Promise<ApiTokenCreated> {
  return request<ApiTokenCreated>('/api/auth/api-tokens', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function revokeApiToken(id: string): Promise<void> {
  await request<{ ok: boolean }>('/api/auth/api-tokens', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  });
}

export type { ApiTokenScope };
