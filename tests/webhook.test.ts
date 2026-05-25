import crypto from 'crypto';
import { verifyLemonSqueezySignature } from '../src/payments/verifySignature';
import { calculateSplit } from '../src/payments/splitPayout';

describe('Webhook Signature Verification', () => {
  const secret = 'test-webhook-secret';

  function sign(body: string): string {
    return crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
  }

  it('accepts a valid signature', () => {
    const body = '{"test": true}';
    const sig = sign(body);
    expect(verifyLemonSqueezySignature(Buffer.from(body), sig, secret)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const body = '{"test": true}';
    const sig = sign(body);
    const tampered = '{"test": false}';
    expect(verifyLemonSqueezySignature(Buffer.from(tampered), sig, secret)).toBe(false);
  });

  it('rejects an invalid signature', () => {
    const body = '{"test": true}';
    expect(verifyLemonSqueezySignature(Buffer.from(body), 'bad-signature', secret)).toBe(false);
  });

  it('rejects a signature with wrong secret', () => {
    const body = '{"test": true}';
    const sig = sign(body);
    expect(verifyLemonSqueezySignature(Buffer.from(body), sig, 'wrong-secret')).toBe(false);
  });

  it('handles empty body', () => {
    const body = '';
    const sig = sign(body);
    expect(verifyLemonSqueezySignature(Buffer.from(body), sig, secret)).toBe(true);
  });
});

describe('Payout Split Calculation', () => {
  it('splits 30/70 without affiliate', () => {
    const split = calculateSplit(100, false);
    expect(split.platformShare).toBe(30);
    expect(split.creatorShare).toBe(70);
    expect(split.affiliateShare).toBe(0);
  });

  it('splits 30/35/35 with affiliate', () => {
    const split = calculateSplit(100, true);
    expect(split.platformShare).toBe(30);
    expect(split.creatorShare).toBe(35);
    expect(split.affiliateShare).toBe(35);
  });

  it('handles fractional amounts correctly', () => {
    const split = calculateSplit(9.99, false);
    expect(split.platformShare).toBe(3);
    expect(split.creatorShare).toBe(6.99);
    expect(split.affiliateShare).toBe(0);
  });

  it('handles zero revenue', () => {
    const split = calculateSplit(0, false);
    expect(split.platformShare).toBe(0);
    expect(split.creatorShare).toBe(0);
    expect(split.affiliateShare).toBe(0);
  });

  it('all shares sum to total revenue', () => {
    const revenue = 49.99;
    const split = calculateSplit(revenue, true);
    const total = split.platformShare + split.creatorShare + split.affiliateShare;
    expect(Math.abs(total - revenue)).toBeLessThan(0.02);
  });
});
