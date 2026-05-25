import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { tenantBase } from '../../db/tenantClient';

export const authRouter = Router();

function generateSlug(email: string): string {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${local}${suffix}`;
}

export const authConfig = {
  providers: [
    {
      id: 'google',
      name: 'Google',
      type: 'oauth' as const,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
    {
      id: 'microsoft',
      name: 'Microsoft',
      type: 'oauth' as const,
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    },
    {
      id: 'github',
      name: 'GitHub',
      type: 'oauth' as const,
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    },
  ],
  callbacks: {
    async signIn({ user, account }: { user: { email: string; name?: string }; account: { provider: string; providerAccountId: string } }) {
      const existing = await tenantBase.user.findUnique({ where: { email: user.email } });
      if (existing) return true;

      const tenant = await tenantBase.tenant.create({
        data: {
          name: user.name || user.email,
          slug: generateSlug(user.email),
        },
      });

      await tenantBase.user.create({
        data: {
          email: user.email,
          name: user.name || null,
          tenantId: tenant.id,
          role: 'OWNER',
          accounts: {
            create: {
              type: 'oauth',
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
          },
        },
      });

      return true;
    },
    async jwt({ token, user }: { token: Record<string, unknown>; user?: { email: string } }) {
      if (user?.email) {
        const dbUser = await tenantBase.user.findUnique({
          where: { email: user.email },
          select: { id: true, tenantId: true, role: true },
        });
        if (dbUser) {
          token.userId = dbUser.id;
          token.tenantId = dbUser.tenantId;
          token.role = dbUser.role;
        }
      }
      return token;
    },
    async session({ session, token }: { session: Record<string, unknown>; token: Record<string, unknown> }) {
      if (token) {
        (session as Record<string, unknown>).user = {
          ...(session.user as Record<string, unknown> || {}),
          id: token.userId,
          tenantId: token.tenantId,
          role: token.role,
        };
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' as const },
};

authRouter.get('/me', (req: Request, res: Response) => {
  const user = (req as Request & { user?: { id: string; email: string; tenantId: string; role: string } }).user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json({
    id: user.id,
    email: user.email,
    tenantId: user.tenantId,
    role: user.role,
  });
});
