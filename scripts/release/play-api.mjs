/**
 * Minimal Google Play Developer API (androidpublisher v3) client for the
 * release scripts. Authenticates with an OAuth access token that has the
 * androidpublisher scope (google-github-actions/auth with token_format).
 */
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

export const playRequest = async (method, url, token, body) => {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${method} ${url}: ${response.status} ${await response.text()}`);
  }

  return response.status === 204 ? {} : response.json().catch(() => ({}));
};

/**
 * Runs `work(edit)` inside a temporary Play edit. The edit is committed when
 * `work` returns `{ commit: true }`, and deleted otherwise (also on errors),
 * so a failed or read-only run never leaves a pending edit behind.
 */
export const withEdit = async (packageName, token, work) => {
  const appUrl = `${API}/${encodeURIComponent(packageName)}`;
  const { id } = await playRequest('POST', `${appUrl}/edits`, token);
  const url = `${appUrl}/edits/${id}`;
  const edit = {
    get: (path) => playRequest('GET', `${url}/${path}`, token),
    put: (path, body) => playRequest('PUT', `${url}/${path}`, token, body),
  };

  let committed = false;
  try {
    const result = await work(edit);
    if (result?.commit) {
      await playRequest('POST', `${url}:commit`, token);
      committed = true;
    }
    return result;
  } finally {
    if (!committed) {
      await playRequest('DELETE', url, token);
    }
  }
};
