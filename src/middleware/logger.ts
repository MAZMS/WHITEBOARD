import { Request, Response, NextFunction } from 'express';

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  data?: Record<string, unknown>;
}

export function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (data !== undefined) {
    entry.data = data;
  }
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logInfo = (msg: string, data?: Record<string, unknown>): void => log('info', msg, data);
export const logWarn = (msg: string, data?: Record<string, unknown>): void => log('warn', msg, data);
export const logError = (msg: string, data?: Record<string, unknown>): void => log('error', msg, data);

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Skip static file requests — only log API / dynamic routes
  if (
    req.path.startsWith('/css/') ||
    req.path.startsWith('/js/') ||
    req.path.startsWith('/img/') ||
    req.path.startsWith('/fonts/') ||
    req.path.startsWith('/assets/') ||
    req.path.endsWith('.ico') ||
    req.path.endsWith('.png') ||
    req.path.endsWith('.jpg') ||
    req.path.endsWith('.svg') ||
    req.path.endsWith('.css') ||
    req.path.endsWith('.js') ||
    req.path.endsWith('.map')
  ) {
    next();
    return;
  }

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const meta: Record<string, unknown> = {
      method: req.method,
      path: req.path,
      status,
      ms: duration,
    };

    if (status >= 500) {
      log('error', `${req.method} ${req.path} ${status}`, meta);
    } else if (status >= 400) {
      log('warn', `${req.method} ${req.path} ${status}`, meta);
    } else {
      log('info', `${req.method} ${req.path} ${status}`, meta);
    }
  });

  next();
}
