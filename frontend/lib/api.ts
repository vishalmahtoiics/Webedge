import { cache } from 'react';
import 'server-only';
import { clearSession, getSession, setSession, type Realm } from './session';

const API_BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1';

/** The error envelope every backend response uses. */
export type ApiError = {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

const networkError = (): ApiResult<never> => ({
  ok: false,
  error: {
    code: 'PROVIDER_UNAVAILABLE',
    message: "We couldn't reach the service. Try again in a moment.",
    requestId: 'local',
  },
});

async function parse<T>(response: Response): Promise<ApiResult<T>> {
  if (response.status === 204) return { ok: true, data: undefined as T };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return networkError();
  }

  if (!response.ok) {
    const error = (body as { error?: ApiError }).error;
    return {
      ok: false,
      error: error ?? {
        code: 'OPERATION_FAILED',
        message: 'Something went wrong.',
        requestId: 'unknown',
      },
    };
  }

  return { ok: true, data: body as T };
}

/** Unauthenticated call — sign-in and token refresh. */
export async function apiPublic<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
    return await parse<T>(response);
  } catch {
    return networkError();
  }
}

/**
 * Authenticated call that transparently recovers from an expired access token.
 *
 * Access tokens last 15 minutes, so a customer idling on a page would otherwise
 * be bounced to sign-in mid-task. On a 401 this rotates the refresh token once
 * and replays the request. It retries exactly once: if the replay also fails,
 * the session is genuinely gone and is cleared rather than looped on.
 */
export async function apiAuthed<T>(
  realm: Realm,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const { accessToken } = await getSession(realm);
  if (!accessToken) {
    return { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.', requestId: 'local' } };
  }

  const send = async (token: string): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });

  try {
    let response = await send(accessToken);

    if (response.status === 401) {
      const refreshed = await refreshSession(realm);
      if (!refreshed) {
        await clearSession(realm);
        return {
          ok: false,
          error: { code: 'UNAUTHENTICATED', message: 'Your session expired. Sign in again.', requestId: 'local' },
        };
      }
      response = await send(refreshed);
    }

    return await parse<T>(response);
  } catch {
    return networkError();
  }
}

/**
 * Rotates the refresh token and stores the new pair, once per request.
 *
 * The backend revokes the entire token family when an already-rotated token is
 * replayed. A single call site does not prevent that: a page rendering two
 * `apiAuthed` calls in parallel reaches this twice with the same stored token,
 * the second replays what the first just rotated, and the session is destroyed.
 * The symptom is a page that renders and then bounces to sign-in on the next
 * navigation, which reads as a bug anywhere but here.
 *
 * `cache` from React dedupes by argument **for the duration of one request**,
 * so the two callers share one rotation. Request-scoped is the essential part:
 * a module-level promise would be shared across every user the process serves,
 * and would hand one person's newly minted token to another.
 */
const refreshSession = cache(async (realm: Realm): Promise<string | undefined> => {
  const { refreshToken } = await getSession(realm);
  if (!refreshToken) return undefined;

  const result = await apiPublic<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
    body: { refreshToken },
  });

  if (!result.ok) return undefined;

  await setSession(realm, result.data);
  return result.data.accessToken;
});

export async function login(
  realm: Realm,
  email: string,
  password: string,
): Promise<ApiResult<{ accessToken: string; refreshToken: string }>> {
  const result = await apiPublic<{ accessToken: string; refreshToken: string; expiresIn: string }>(
    `/auth/${realm}/login`,
    { body: { email, password } },
  );

  if (result.ok) await setSession(realm, result.data);
  return result;
}

export async function logout(realm: Realm): Promise<void> {
  const { refreshToken } = await getSession(realm);
  if (refreshToken) await apiPublic('/auth/logout', { body: { refreshToken } });
  await clearSession(realm);
}
