import { type EnvType } from './env';

type Provider = 'github' | 'gitlab' | 'bitbucket' | 'unknown';

interface OutputHTMLContentSuccess {
  provider: Provider;
  token: string;
}

interface OutputHTMLContentError {
  provider: Provider;
  error: string;
  errorCode?: string;
}

type OutputHTMLContent = OutputHTMLContentSuccess | OutputHTMLContentError;

interface OutputHTMLOptions {
  provider?: Provider;
  token?: string;
  error?: string;
  errorCode?: string;
}

type CloudflareEnv = EnvType;

/**
 * List of supported OAuth providers.
 */
const supportedProviders: readonly string[] = ['github', 'gitlab', 'bitbucket'];

/**
 * Escape the given string for safe use in a regular expression.
 * @param str - Original string.
 * @returns Escaped string.
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions#escaping
 */
const escapeRegExp = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Output HTML response that communicates with the window opener.
 * @param options - Options.
 * @param env - Environment variables.
 * @returns Response with HTML.
 */
const outputHTML = (
  { provider = 'unknown', token, error, errorCode }: OutputHTMLOptions,
  env?: CloudflareEnv
): Response => {
  const state = error ? 'error' : 'success';
  const content: OutputHTMLContent = error
    ? { provider, error, errorCode }
    : { provider, token: token! };

  // Allow disabling Secure cookie for local testing by setting INSECURE_COOKIES=1
  const insecureCookies = env?.INSECURE_COOKIES === '1';
  const secureAttr = insecureCookies ? '' : '; Secure';

  return new Response(
    `
      <!doctype html><html><body><script>
        (() => {
          window.addEventListener('message', ({ data, origin }) => {
            if (data === 'authorizing:${provider}') {
              window.opener?.postMessage(
                'authorization:${provider}:${state}:${JSON.stringify(content)}',
                origin
              );
            }
          });
          window.opener?.postMessage('authorizing:${provider}', '*');
        })();
      </script></body></html>
    `,
    {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        // Delete CSRF token
        'Set-Cookie': `csrf-token=deleted; HttpOnly; Max-Age=0; Path=/; SameSite=Lax${secureAttr}`,
      },
    }
  );
};

/**
 * Handle the `auth` method, which is the first request in the authorization flow.
 * @param request - HTTP request.
 * @param env - Environment variables.
 * @returns HTTP response.
 */
const handleAuth = async (
  request: Request,
  env: CloudflareEnv
): Promise<Response> => {
  const { url } = request;
  const { origin, searchParams } = new URL(url);
  const provider = searchParams.get('provider');
  const domain = searchParams.get('site_id');

  const reqProvider: Provider = supportedProviders.includes(provider ?? '')
    ? (provider as Provider)
    : 'unknown';

  if (!provider || !supportedProviders.includes(provider)) {
    return outputHTML(
      {
        error: 'Your Git backend is not supported by the authenticator.',
        errorCode: 'UNSUPPORTED_BACKEND',
      },
      env
    );
  }

  const {
    ALLOWED_DOMAINS,
    GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET,
    GITHUB_HOSTNAME = 'github.com',
    GITLAB_CLIENT_ID,
    GITLAB_CLIENT_SECRET,
    GITLAB_HOSTNAME = 'gitlab.com',
    //@ts-expect-error because it's a TODO feature
    _BITBUCKET_CLIENT_ID,
    //@ts-expect-error because it's a TODO feature
    _BITBUCKET_CLIENT_SECRET,
    //@ts-expect-error because it's a TODO feature
    _BITBUCKET_HOSTNAME = 'bitbucket.com',
  } = env;

  // Check if the domain is whitelisted
  if (
    ALLOWED_DOMAINS &&
    !ALLOWED_DOMAINS.split(/,/).some((str) =>
      // Escape the input, then replace a wildcard for regex
      (domain ?? '').match(
        new RegExp(`^${escapeRegExp(str.trim()).replace('\\*', '.+')}$`)
      )
    )
  ) {
    return outputHTML(
      {
        provider: reqProvider,
        error: 'Your domain is not allowed to use the authenticator.',
        errorCode: 'UNSUPPORTED_DOMAIN',
      },
      env
    );
  }

  // Generate a random string for CSRF protection
  const csrfToken = crypto.randomUUID().replaceAll('-', '');
  const cookieProvider = supportedProviders.includes(provider)
    ? provider
    : 'unknown';
  let authURL = '';

  // GitHub
  if (provider === 'github') {
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      return outputHTML(
        {
          provider: reqProvider,
          error: 'OAuth app client ID or secret is not configured.',
          errorCode: 'MISCONFIGURED_CLIENT',
        },
        env
      );
    }

    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      scope: 'repo,user',
      state: csrfToken,
    });

    authURL = `https://${GITHUB_HOSTNAME}/login/oauth/authorize?${params.toString()}`;
  }

  // GitLab
  if (provider === 'gitlab') {
    if (!GITLAB_CLIENT_ID || !GITLAB_CLIENT_SECRET) {
      return outputHTML(
        {
          provider: reqProvider,
          error: 'OAuth app client ID or secret is not configured.',
          errorCode: 'MISCONFIGURED_CLIENT',
        },
        env
      );
    }

    const params = new URLSearchParams({
      client_id: GITLAB_CLIENT_ID,
      redirect_uri: `${origin}/callback`,
      response_type: 'code',
      scope: 'api',
      state: csrfToken,
    });

    authURL = `https://${GITLAB_HOSTNAME}/oauth/authorize?${params.toString()}`;
  }

  // bitbucket
  if (provider === 'bitbucket') {
    return outputHTML(
      {
        provider: reqProvider,
        error: 'Bitbucket OAuth is not yet supported.',
        errorCode: 'UNSUPPORTED_BACKEND',
      },
      env
    );
  }

  // Redirect to the authorization server
  return new Response('', {
    status: 302,
    headers: {
      Location: authURL,
      // Cookie expires in 10 minutes; Use `SameSite=Lax` to make sure the cookie is sent by the
      // browser after redirect
      'Set-Cookie':
        `csrf-token=${cookieProvider}_${csrfToken}; ` +
        `HttpOnly; Path=/; Max-Age=600; SameSite=Lax; Secure`,
    },
  });
};

/**
 * Handle the `callback` method, which is the second request in the authorization flow.
 * @param request - HTTP request.
 * @param env - Environment variables.
 * @returns HTTP response.
 */
const handleCallback = async (
  request: Request,
  env: CloudflareEnv
): Promise<Response> => {
  const { url, headers } = request;
  const { origin, searchParams } = new URL(url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const cookieMatch = headers
    .get('Cookie')
    ?.match(/\bcsrf-token=([a-z-]+?)_([0-9a-f]{32})\b/);
  const provider = cookieMatch?.[1];
  const csrfToken = cookieMatch?.[2];

  const cookieProvider: Provider = supportedProviders.includes(provider ?? '')
    ? (provider as Provider)
    : 'unknown';

  if (!provider || !supportedProviders.includes(provider)) {
    return outputHTML(
      {
        error: 'Your Git backend is not supported by the authenticator.',
        errorCode: 'UNSUPPORTED_BACKEND',
      },
      env
    );
  }

  if (!code || !state) {
    return outputHTML(
      {
        provider: cookieProvider,
        error:
          'Failed to receive an authorization code. Please try again later.',
        errorCode: 'AUTH_CODE_REQUEST_FAILED',
      },
      env
    );
  }

  if (!csrfToken || state !== csrfToken) {
    return outputHTML(
      {
        provider: cookieProvider,
        error: 'Potential CSRF attack detected. Authentication flow aborted.',
        errorCode: 'CSRF_DETECTED',
      },
      env
    );
  }

  const {
    GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET,
    GITHUB_HOSTNAME = 'github.com',
    GITLAB_CLIENT_ID,
    GITLAB_CLIENT_SECRET,
    GITLAB_HOSTNAME = 'gitlab.com',
    //@ts-expect-error because it's a TODO feature
    _BITBUCKET_CLIENT_ID,
    //@ts-expect-error because it's a TODO feature
    _BITBUCKET_CLIENT_SECRET,
    //@ts-expect-error because it's a TODO feature
    _BITBUCKET_HOSTNAME = 'bitbucket.com',
  } = env;

  let tokenURL = '';
  let requestBody: Record<string, string> = {};

  // GitHub
  if (provider === 'github') {
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      return outputHTML(
        {
          provider: cookieProvider,
          error: 'OAuth app client ID or secret is not configured.',
          errorCode: 'MISCONFIGURED_CLIENT',
        },
        env
      );
    }

    tokenURL = `https://${GITHUB_HOSTNAME}/login/oauth/access_token`;
    requestBody = {
      code,
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
    };
  }

  if (provider === 'gitlab') {
    if (!GITLAB_CLIENT_ID || !GITLAB_CLIENT_SECRET) {
      return outputHTML(
        {
          provider: cookieProvider,
          error: 'OAuth app client ID or secret is not configured.',
          errorCode: 'MISCONFIGURED_CLIENT',
        },
        env
      );
    }

    tokenURL = `https://${GITLAB_HOSTNAME}/oauth/token`;
    requestBody = {
      code,
      client_id: GITLAB_CLIENT_ID,
      client_secret: GITLAB_CLIENT_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: `${origin}/callback`,
    };
  }

  if (provider === 'bitbucket') {
    return outputHTML(
      {
        provider: cookieProvider,
        error: 'Bitbucket OAuth is not yet supported.',
        errorCode: 'UNSUPPORTED_BACKEND',
      },
      env
    );
  }

  let response: Response | undefined;
  let token = '';
  let error = '';

  try {
    response = await fetch(tokenURL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch {
    //
  }

  if (!response) {
    return outputHTML(
      {
        provider: cookieProvider,
        error: 'Failed to request an access token. Please try again later.',
        errorCode: 'TOKEN_REQUEST_FAILED',
      },
      env
    );
  }

  try {
    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
    };
    token = data.access_token ?? '';
    error = data.error ?? '';
  } catch {
    return outputHTML(
      {
        provider: cookieProvider,
        error: 'Server responded with malformed data. Please try again later.',
        errorCode: 'MALFORMED_RESPONSE',
      },
      env
    );
  }

  return outputHTML({ provider: cookieProvider, token, error }, env);
};

export default {
  /**
   * The main request handler.
   * @param request - HTTP request.
   * @param env - Environment variables.
   * @returns HTTP response.
   * @see https://developers.cloudflare.com/workers/runtime-apis/fetch/
   * @see https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
   * @see https://docs.gitlab.com/ee/api/oauth2.html#authorization-code-flow
   */
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const { method, url } = request;
    const { pathname } = new URL(url);

    if (
      method === 'GET' &&
      ['/auth', '/oauth/authorize', '/oauth/auth'].includes(pathname)
    ) {
      return handleAuth(request, env);
    }

    if (
      method === 'GET' &&
      ['/callback', '/oauth/redirect'].includes(pathname)
    ) {
      return handleCallback(request, env);
    }

    return new Response('', { status: 404 });
  },
};
