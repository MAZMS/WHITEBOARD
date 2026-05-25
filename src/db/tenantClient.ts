import { PrismaClient } from '../../node_modules/.prisma/tenant-client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const base: any = new PrismaClient();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTenantPrisma(tenantId: string): any {
  if (!tenantId || !/^[a-z0-9]+$/i.test(tenantId)) {
    throw new Error('Invalid tenantId');
  }
  return base.$extends({
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ args, query }: { args: any; query: any }) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return base.$transaction(async (tx: any) => {
            await tx.$executeRawUnsafe(
              `SET LOCAL app.tenant_id = '${tenantId}'`,
            );
            return query(args);
          });
        },
      },
    },
  });
}

export { base as tenantBase };
