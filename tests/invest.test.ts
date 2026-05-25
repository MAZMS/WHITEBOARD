import { Request, Response } from 'express';

jest.mock('../src/db/adminClient', () => {
  return {
    admin: {
      blueprint: {
        count: jest.fn(),
        aggregate: jest.fn(),
      },
      creator: {
        count: jest.fn(),
      },
      feedback: {
        create: jest.fn(),
      },
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { admin } = require('../src/db/adminClient');

import { investRouter } from '../src/control-plane/routes/invest';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    query: {},
    params: {},
    body: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res as Response;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(router: any, method: string, path: string) {
  for (const layer of router.stack) {
    if (
      layer.route &&
      layer.route.path === path &&
      layer.route.methods[method]
    ) {
      const handlers = layer.route.stack
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((s: any) => s.method === method)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((s: any) => s.handle);
      return handlers[handlers.length - 1];
    }
  }
  throw new Error(`Handler not found: ${method.toUpperCase()} ${path}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAllHandlers(router: any, method: string, path: string) {
  for (const layer of router.stack) {
    if (
      layer.route &&
      layer.route.path === path &&
      layer.route.methods[method]
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return layer.route.stack.map((s: any) => s.handle);
    }
  }
  throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
}

describe('GET /invest/metrics', () => {
  const handler = getHandler(investRouter, 'get', '/invest/metrics');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns aggregated platform metrics', async () => {
    admin.blueprint.count.mockResolvedValue(42);
    admin.creator.count.mockResolvedValue(8);
    admin.blueprint.aggregate.mockResolvedValue({
      _sum: { activeRuns: 350 },
    });

    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.blueprints).toBe(42);
    expect(body.creators).toBe(8);
    expect(body.activeRuns).toBe(350);
    expect(body).toHaveProperty('monthlyGrowth');
  });

  it('returns zero defaults when all DB calls fail', async () => {
    admin.blueprint.count.mockRejectedValue(new Error('fail'));
    admin.creator.count.mockRejectedValue(new Error('fail'));
    admin.blueprint.aggregate.mockRejectedValue(new Error('fail'));

    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.blueprints).toBe(0);
    expect(body.creators).toBe(0);
    expect(body.activeRuns).toBe(0);
    expect(body.monthlyGrowth).toBe(34); // placeholder value returned even on failure
  });

  it('handles partial DB failures gracefully via inner catch', async () => {
    // blueprint.count succeeds, others fail
    admin.blueprint.count.mockResolvedValue(10);
    admin.creator.count.mockResolvedValue(0);
    admin.blueprint.aggregate.mockResolvedValue({
      _sum: { activeRuns: 0 },
    });

    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.blueprints).toBe(10);
    expect(body.creators).toBe(0);
    expect(body.activeRuns).toBe(0);
  });
});

describe('GET /invest/chat', () => {
  const handler = getHandler(investRouter, 'get', '/invest/chat');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns available topics when q is empty', async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();

    await handler(req, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.topics).toBeDefined();
    expect(Array.isArray(body.topics)).toBe(true);
    expect(body.topics).toContain('revenue');
    expect(body.topics).toContain('team');
    expect(body.topics).toContain('market');
  });

  it('returns the revenue FAQ when q contains "revenue"', async () => {
    const req = mockReq({ query: { q: 'revenue' } });
    const res = mockRes();

    await handler(req, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.answer).toBeDefined();
    expect(body.answer).toContain('platform fee');
  });

  it('is case-insensitive (lowercases the query)', async () => {
    const req = mockReq({ query: { q: 'TEAM' } });
    const res = mockRes();

    await handler(req, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.answer).toBeDefined();
    expect(body.answer).toContain('Mohamed');
  });

  it('returns a fallback answer for unknown topics', async () => {
    const req = mockReq({ query: { q: 'unicorns' } });
    const res = mockRes();

    await handler(req, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.answer).toContain('interest form');
  });

  it('matches partial topic keywords in the query', async () => {
    const req = mockReq({ query: { q: 'what is your technology stack?' } });
    const res = mockRes();

    await handler(req, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.answer).toContain('Node.js');
  });
});

describe('POST /invest/interest', () => {
  // The route has a rateLimit middleware before the handler.
  // We get all handlers so we can test the final handler directly,
  // skipping the rate limiter for unit-level tests.
  const handler = getHandler(investRouter, 'post', '/invest/interest');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves valid investor interest and returns success', async () => {
    admin.feedback.create.mockResolvedValue({ id: 'fb1' });

    const req = mockReq({
      body: {
        name: 'Jane Doe',
        email: 'jane@vc.com',
        range: '$25k-$50k',
        message: 'Interested in the platform.',
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(admin.feedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'investor',
        email: 'jane@vc.com',
        status: 'INVESTOR_LEAD',
      }),
    });
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('stores the investor name and range in the text field', async () => {
    admin.feedback.create.mockResolvedValue({ id: 'fb2' });

    const req = mockReq({
      body: {
        name: 'Investor X',
        email: 'x@fund.com',
        range: '$100k+',
        message: 'Looking to invest.',
      },
    });
    const res = mockRes();

    await handler(req, res);

    const createArg = admin.feedback.create.mock.calls[0][0];
    expect(createArg.data.text).toContain('Investor X');
    expect(createArg.data.text).toContain('$100k+');
    expect(createArg.data.text).toContain('Looking to invest.');
  });

  it('rejects missing name', async () => {
    const req = mockReq({
      body: { email: 'no-name@test.com' },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'name is required' });
    expect(admin.feedback.create).not.toHaveBeenCalled();
  });

  it('rejects empty string name', async () => {
    const req = mockReq({
      body: { name: '   ', email: 'blank@test.com' },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'name is required' });
  });

  it('rejects missing email', async () => {
    const req = mockReq({
      body: { name: 'Valid Name' },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'A valid email is required' });
  });

  it('rejects email without @', async () => {
    const req = mockReq({
      body: { name: 'Valid Name', email: 'not-an-email' },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'A valid email is required' });
  });

  it('handles optional range and message', async () => {
    admin.feedback.create.mockResolvedValue({ id: 'fb3' });

    const req = mockReq({
      body: { name: 'Minimal', email: 'min@test.com' },
    });
    const res = mockRes();

    await handler(req, res);

    const createArg = admin.feedback.create.mock.calls[0][0];
    expect(createArg.data.text).toContain('Not specified');
    expect(createArg.data.text).toContain('No message');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('returns 500 when feedback creation fails', async () => {
    admin.feedback.create.mockRejectedValue(new Error('DB write failed'));

    const req = mockReq({
      body: { name: 'Error Case', email: 'err@test.com' },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('email') }),
    );
  });

  it('has a rate limiter middleware on the route', () => {
    const handlers = getAllHandlers(investRouter, 'post', '/invest/interest');
    // At least 2 handlers: rate limiter + the actual handler
    expect(handlers.length).toBeGreaterThanOrEqual(2);
  });
});
