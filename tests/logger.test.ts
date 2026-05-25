import { log, logInfo, logWarn, logError, requestLogger } from '../src/middleware/logger';
import { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';

describe('Logger — structured log functions', () => {
  let spyLog: jest.SpyInstance;
  let spyWarn: jest.SpyInstance;
  let spyError: jest.SpyInstance;

  beforeEach(() => {
    spyLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    spyError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    spyLog.mockRestore();
    spyWarn.mockRestore();
    spyError.mockRestore();
  });

  it('log("info", ...) writes valid JSON to console.log', () => {
    log('info', 'test message');

    expect(spyLog).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spyLog.mock.calls[0][0]);
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('test message');
    expect(entry.ts).toBeDefined();
  });

  it('log("warn", ...) writes to console.warn', () => {
    log('warn', 'warning msg');

    expect(spyWarn).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spyWarn.mock.calls[0][0]);
    expect(entry.level).toBe('warn');
    expect(entry.msg).toBe('warning msg');
  });

  it('log("error", ...) writes to console.error', () => {
    log('error', 'error msg');

    expect(spyError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spyError.mock.calls[0][0]);
    expect(entry.level).toBe('error');
    expect(entry.msg).toBe('error msg');
  });

  it('includes data when provided', () => {
    log('info', 'with data', { userId: 'u1', count: 42 });

    const entry = JSON.parse(spyLog.mock.calls[0][0]);
    expect(entry.data).toEqual({ userId: 'u1', count: 42 });
  });

  it('omits data field when not provided', () => {
    log('info', 'no data');

    const entry = JSON.parse(spyLog.mock.calls[0][0]);
    expect(entry).not.toHaveProperty('data');
  });

  it('ts field is a valid ISO 8601 string', () => {
    log('info', 'timestamp check');

    const entry = JSON.parse(spyLog.mock.calls[0][0]);
    const parsed = new Date(entry.ts);
    expect(parsed.toISOString()).toBe(entry.ts);
  });
});

describe('Logger — convenience wrappers', () => {
  let spyLog: jest.SpyInstance;
  let spyWarn: jest.SpyInstance;
  let spyError: jest.SpyInstance;

  beforeEach(() => {
    spyLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    spyError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    spyLog.mockRestore();
    spyWarn.mockRestore();
    spyError.mockRestore();
  });

  it('logInfo delegates to console.log with level=info', () => {
    logInfo('info shortcut', { key: 'val' });

    expect(spyLog).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spyLog.mock.calls[0][0]);
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('info shortcut');
    expect(entry.data).toEqual({ key: 'val' });
  });

  it('logWarn delegates to console.warn with level=warn', () => {
    logWarn('warn shortcut');

    expect(spyWarn).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spyWarn.mock.calls[0][0]);
    expect(entry.level).toBe('warn');
  });

  it('logError delegates to console.error with level=error', () => {
    logError('error shortcut');

    expect(spyError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spyError.mock.calls[0][0]);
    expect(entry.level).toBe('error');
  });
});

describe('Logger — requestLogger middleware', () => {
  let spyLog: jest.SpyInstance;
  let spyWarn: jest.SpyInstance;
  let spyError: jest.SpyInstance;

  beforeEach(() => {
    spyLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    spyError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    spyLog.mockRestore();
    spyWarn.mockRestore();
    spyError.mockRestore();
  });

  function createReqRes(path: string, method: string = 'GET') {
    const req = {
      path,
      method,
    } as unknown as Request;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = new EventEmitter() as any as Response & EventEmitter;
    (res as unknown as Record<string, unknown>).statusCode = 200;

    const next = jest.fn() as unknown as NextFunction;

    return { req, res, next };
  }

  it('calls next() for normal API routes', () => {
    const { req, res, next } = createReqRes('/api/invest/metrics');
    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('skips static CSS files and still calls next()', () => {
    const { req, res, next } = createReqRes('/css/main.css');
    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();

    // Simulate finish — should NOT have logged anything
    (res as unknown as EventEmitter).emit('finish');
    expect(spyLog).not.toHaveBeenCalled();
  });

  it('skips static JS files', () => {
    const { req, res, next } = createReqRes('/js/app.js');
    requestLogger(req, res, next);
    (res as unknown as EventEmitter).emit('finish');
    expect(spyLog).not.toHaveBeenCalled();
  });

  it('skips image paths', () => {
    const { req, res, next } = createReqRes('/img/logo.png');
    requestLogger(req, res, next);
    (res as unknown as EventEmitter).emit('finish');
    expect(spyLog).not.toHaveBeenCalled();
  });

  it('skips .ico files', () => {
    const { req, res, next } = createReqRes('/favicon.ico');
    requestLogger(req, res, next);
    (res as unknown as EventEmitter).emit('finish');
    expect(spyLog).not.toHaveBeenCalled();
  });

  it('skips .map files', () => {
    const { req, res, next } = createReqRes('/js/app.js.map');
    requestLogger(req, res, next);
    (res as unknown as EventEmitter).emit('finish');
    expect(spyLog).not.toHaveBeenCalled();
  });

  it('logs info-level for 2xx responses on finish', () => {
    const { req, res, next } = createReqRes('/api/data', 'GET');
    (res as unknown as Record<string, unknown>).statusCode = 200;

    requestLogger(req, res, next);
    (res as unknown as EventEmitter).emit('finish');

    expect(spyLog).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spyLog.mock.calls[0][0]);
    expect(entry.level).toBe('info');
    expect(entry.data.method).toBe('GET');
    expect(entry.data.path).toBe('/api/data');
    expect(entry.data.status).toBe(200);
    expect(entry.data).toHaveProperty('ms');
  });

  it('logs warn-level for 4xx responses', () => {
    const { req, res, next } = createReqRes('/api/missing', 'GET');
    (res as unknown as Record<string, unknown>).statusCode = 404;

    requestLogger(req, res, next);
    (res as unknown as EventEmitter).emit('finish');

    expect(spyWarn).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spyWarn.mock.calls[0][0]);
    expect(entry.level).toBe('warn');
    expect(entry.data.status).toBe(404);
  });

  it('logs error-level for 5xx responses', () => {
    const { req, res, next } = createReqRes('/api/crash', 'POST');
    (res as unknown as Record<string, unknown>).statusCode = 500;

    requestLogger(req, res, next);
    (res as unknown as EventEmitter).emit('finish');

    expect(spyError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spyError.mock.calls[0][0]);
    expect(entry.level).toBe('error');
    expect(entry.data.status).toBe(500);
    expect(entry.data.method).toBe('POST');
  });
});
