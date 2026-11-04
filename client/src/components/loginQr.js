const loginQrPrefix = 'sims-login=';

export function loginQrPayload({ username, temporary_password }, baseUrl) {
  const loginUrl = new URL(baseUrl);
  loginUrl.search = '';
  loginUrl.hash = `${loginQrPrefix}${encodeURIComponent(JSON.stringify({
    type: 'school-mis-login',
    version: 1,
    username,
    password: temporary_password
  }))}`;
  return loginUrl.toString();
}

export function consumeLoginQrHash(hash) {
  if (!hash.startsWith(`#${loginQrPrefix}`)) return { found: false, credentials: null, error: '' };

  let payload;
  try {
    payload = JSON.parse(decodeURIComponent(hash.slice(loginQrPrefix.length + 1)));
  } catch {
    return { found: true, credentials: null, error: 'The credential QR code is invalid or damaged.' };
  }

  if (
    !payload ||
    payload.type !== 'school-mis-login' ||
    payload.version !== 1 ||
    typeof payload.username !== 'string' ||
    !payload.username ||
    typeof payload.password !== 'string' ||
    !payload.password
  ) {
    return { found: true, credentials: null, error: 'The credential QR code is invalid or damaged.' };
  }

  return {
    found: true,
    credentials: { username: payload.username, password: payload.password },
    error: ''
  };
}
