import crypto from 'crypto';

export function verifyLemonSqueezySignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const received = Buffer.from(signatureHeader, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  if (received.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(received, expectedBuf);
}
