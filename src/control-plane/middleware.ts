import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthenticatedUser {
  id: string;
  email: string;
  tenantId: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  tenantId?: string;
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || 'dev-secret') as {
      userId: string;
      email: string;
      tenantId: string;
      role: string;
    };

    req.user = {
      id: decoded.userId,
      email: decoded.email,
      tenantId: decoded.tenantId,
      role: decoded.role,
    };
    req.tenantId = decoded.tenantId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
