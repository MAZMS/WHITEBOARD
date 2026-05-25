import { PrismaClient } from '../../node_modules/.prisma/admin-client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const admin: any = new PrismaClient();
