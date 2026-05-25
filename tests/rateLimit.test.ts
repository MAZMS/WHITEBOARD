import { Request, Response, NextFunction } from 'express';
import { rateLimit } from '../src/middleware/rateLimit';

function mockReq(ip: string = '127.0.0.1'): Request {
  return {
    ip,
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

function mockRes(): Response & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res: Partial<Response> & { _headers: Record<string, string> } = { _headers: headers };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockImplementation((key: string, val: string) => {
    headers[key] = val;
    return res;
  });
  return res as Response & { _headers: Record<string, string> };
}

describe('Rate Limiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows requests under the limit', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3, keyPrefix: 'test-allow' });
    const req = mockReq('10.0.0.1');
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;

    limiter(req, res, next);
    limiter(req, res, next);
    limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks the request once max is exceeded', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: 'test-block' });
    const req = mockReq('10.0.0.2');
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;

    limiter(req, res, next); // 1 — allowed
    limiter(req, res, next); // 2 — allowed
    limiter(req, res, next); // 3 — blocked

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Too many requests. Try again later.',
    });
  });

  it('sets the Retry-After header on 429', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: 'test-retry' });
    const req = mockReq('10.0.0.3');
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;

    limiter(req, res, next); // allowed
    limiter(req, res, next); // blocked

    expect(res.set).toHaveBeenCalledWith(
      'Retry-After',
      expect.stringMatching(/^\d+$/),
    );
  });

  it('isolates different IPs into separate buckets', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: 'test-iso' });
    const next = jest.fn() as unknown as NextFunction;

    const req1 = mockReq('10.0.0.10');
    const res1 = mockRes();
    limiter(req1, res1, next); // IP-A — allowed

    const req2 = mockReq('10.0.0.20');
    const res2 = mockRes();
    limiter(req2, res2, next); // IP-B — allowed

    expect(next).toHaveBeenCalledTimes(2);
    expect(res1.status).not.toHaveBeenCalled();
    expect(res2.status).not.toHaveBeenCalled();
  });

  it('isolates different key prefixes', () => {
    const limiterA = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: 'prefix-a' });
    const limiterB = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: 'prefix-b' });
    const next = jest.fn() as unknown as NextFunction;
    const ip = '10.0.0.50';

    limiterA(mockReq(ip), mockRes(), next); // prefix-a:ip — allowed
    limiterB(mockReq(ip), mockRes(), next); // prefix-b:ip — allowed (separate bucket)

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('falls back to socket.remoteAddress when req.ip is undefined', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: 'test-fallback' });
    const req = {
      ip: undefined,
      socket: { remoteAddress: '192.168.1.1' },
    } as unknown as Request;
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;

    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Second request from same remoteAddress should be blocked
    const res2 = mockRes();
    limiter(req, res2, next);
    expect(res2.status).toHaveBeenCalledWith(429);
  });

  it('resets the bucket after the window expires', () => {
    jest.useFakeTimers();
    try {
      const windowMs = 10_000;
      const limiter = rateLimit({ windowMs, max: 1, keyPrefix: 'test-expire' });
      const req = mockReq('10.0.0.99');
      const next = jest.fn() as unknown as NextFunction;

      limiter(req, mockRes(), next); // allowed
      limiter(req, mockRes(), next); // blocked

      expect(next).toHaveBeenCalledTimes(1);

      // Advance past the window
      jest.advanceTimersByTime(windowMs + 1);

      limiter(req, mockRes(), next); // allowed again (new window)
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
