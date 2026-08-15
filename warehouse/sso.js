import crypto from 'crypto';

// Легкий міст для переходу між застосунками Fresh Black Workspace (ERP ⇄
// HR CRM) без повторного вводу логіна/паролю — НЕ повноцінний SSO (той
// вимагав би спільного домену/кукі, яких тут немає — кожен застосунок на
// своєму *.up.railway.app), а короткоживучий (60 сек) HMAC-підписаний
// токен: "ця людина щойно була залогінена в системі А під іменем X" →
// система Б довіряє й заводить сесію під тим самим username, ЯКЩО в неї
// самої є акаунт з такою назвою (див. registerSsoAcceptRoute нижче).
// SSO_SHARED_SECRET має бути ОДНАКОВИЙ в обох Railway-сервісах.

function getSecret() {
  const secret = process.env.SSO_SHARED_SECRET;
  if (!secret) throw new Error('SSO_SHARED_SECRET is not set');
  return secret;
}

export function signSsoToken(username) {
  const expires = Date.now() + 60_000;
  const payload = `${username}.${expires}`;
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`, 'utf8').toString('base64url');
}

export function verifySsoToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split('.');
    if (parts.length !== 3) return null;
    const [username, expiresStr, sig] = parts;
    const payload = `${username}.${expiresStr}`;
    const expectedSig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    if (Date.now() > Number(expiresStr)) return null;
    return username;
  } catch {
    return null;
  }
}
