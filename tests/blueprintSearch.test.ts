import { Request, Response } from 'express';

// Mock the admin client before importing the router
jest.mock('../src/db/adminClient', () => {
  return {
    admin: {
      blueprint: {
        findMany: jest.fn(),
      },
      creator: {
        findUnique: jest.fn(),
      },
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { admin } = require('../src/db/adminClient');

import { blueprintRouter } from '../src/control-plane/routes/blueprints';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    query: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

// Extract handler functions from the router so we can call them directly
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(router: any, method: string, path: string) {
  for (const layer of router.stack) {
    if (
      layer.route &&
      layer.route.path === path &&
      layer.route.methods[method]
    ) {
      // Return the last handler (skip middleware like rateLimit)
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

describe('Blueprint Search — GET /blueprints/search', () => {
  const handler = getHandler(blueprintRouter, 'get', '/blueprints/search');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns all blueprints when q is empty', async () => {
    const all = [{ id: '1', name: 'Alpha', description: 'First' }];
    admin.blueprint.findMany.mockResolvedValue(all);

    const req = mockReq({ query: { q: '' } });
    const res = mockRes();

    await handler(req, res);

    expect(admin.blueprint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    expect(res.json).toHaveBeenCalledWith(all);
  });

  it('returns all blueprints when q is absent', async () => {
    admin.blueprint.findMany.mockResolvedValue([]);

    const req = mockReq({ query: {} });
    const res = mockRes();

    await handler(req, res);

    expect(admin.blueprint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('builds a case-insensitive OR filter on name and description', async () => {
    admin.blueprint.findMany.mockResolvedValue([]);

    const req = mockReq({ query: { q: 'chat' } });
    const res = mockRes();

    await handler(req, res);

    expect(admin.blueprint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: 'chat', mode: 'insensitive' } },
            { description: { contains: 'chat', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('trims whitespace from the query', async () => {
    admin.blueprint.findMany.mockResolvedValue([]);

    const req = mockReq({ query: { q: '  bot  ' } });
    const res = mockRes();

    await handler(req, res);

    expect(admin.blueprint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: 'bot', mode: 'insensitive' } },
            { description: { contains: 'bot', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('includes creator username and orders by activeRuns desc', async () => {
    admin.blueprint.findMany.mockResolvedValue([]);

    const req = mockReq({ query: { q: 'x' } });
    const res = mockRes();

    await handler(req, res);

    expect(admin.blueprint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { creator: { select: { username: true } } },
        orderBy: { activeRuns: 'desc' },
      }),
    );
  });

  it('returns empty array on database error', async () => {
    admin.blueprint.findMany.mockRejectedValue(new Error('DB down'));

    const req = mockReq({ query: { q: 'fail' } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith([]);
  });
});

describe('Creator Profile — GET /creators/:username', () => {
  const handler = getHandler(blueprintRouter, 'get', '/creators/:username');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 404 when creator does not exist', async () => {
    admin.creator.findUnique.mockResolvedValue(null);

    const req = mockReq({ params: { username: 'ghost' } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Creator not found' });
  });

  it('returns creator info, blueprints, and aggregated stats', async () => {
    const creator = {
      id: 'c1',
      username: 'alice',
      email: 'alice@test.com',
      createdAt: '2025-01-01',
    };
    const blueprints = [
      { id: 'b1', activeRuns: 10, stability: 95, creator: { username: 'alice' } },
      { id: 'b2', activeRuns: 20, stability: 85, creator: { username: 'alice' } },
    ];

    admin.creator.findUnique.mockResolvedValue(creator);
    admin.blueprint.findMany.mockResolvedValue(blueprints);

    const req = mockReq({ params: { username: 'alice' } });
    const res = mockRes();

    await handler(req, res);

    expect(admin.creator.findUnique).toHaveBeenCalledWith({
      where: { username: 'alice' },
    });
    expect(admin.blueprint.findMany).toHaveBeenCalledWith({
      where: { creatorId: 'c1' },
      include: { creator: { select: { username: true } } },
      orderBy: { activeRuns: 'desc' },
    });

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.creator.username).toBe('alice');
    expect(body.creator.email).toBe('alice@test.com');
    expect(body.stats.totalRuns).toBe(30);
    expect(body.stats.avgStability).toBe(90);
    expect(body.stats.blueprintCount).toBe(2);
    expect(body.blueprints).toHaveLength(2);
  });

  it('returns zero stats when creator has no blueprints', async () => {
    const creator = {
      id: 'c2',
      username: 'bob',
      email: 'bob@test.com',
      createdAt: '2025-06-01',
    };

    admin.creator.findUnique.mockResolvedValue(creator);
    admin.blueprint.findMany.mockResolvedValue([]);

    const req = mockReq({ params: { username: 'bob' } });
    const res = mockRes();

    await handler(req, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.stats.totalRuns).toBe(0);
    expect(body.stats.avgStability).toBe(0);
    expect(body.stats.blueprintCount).toBe(0);
  });

  it('does not leak internal creator fields', async () => {
    const creator = {
      id: 'c3',
      username: 'carol',
      email: 'carol@test.com',
      createdAt: '2025-03-01',
      passwordHash: 'should-not-appear',
    };

    admin.creator.findUnique.mockResolvedValue(creator);
    admin.blueprint.findMany.mockResolvedValue([]);

    const req = mockReq({ params: { username: 'carol' } });
    const res = mockRes();

    await handler(req, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.creator).not.toHaveProperty('passwordHash');
    expect(Object.keys(body.creator)).toEqual(
      expect.arrayContaining(['id', 'username', 'email', 'createdAt']),
    );
  });

  it('returns 500 on database error', async () => {
    admin.creator.findUnique.mockRejectedValue(new Error('DB down'));

    const req = mockReq({ params: { username: 'crash' } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Service unavailable' });
  });
});
