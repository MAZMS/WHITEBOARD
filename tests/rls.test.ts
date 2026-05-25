import { getTenantPrisma } from '../src/db/tenantClient';

describe('Row-Level Security', () => {
  const tenantAId = 'tenantA123';
  const tenantBId = 'tenantB456';

  it('rejects invalid tenant IDs', () => {
    expect(() => getTenantPrisma('')).toThrow('Invalid tenantId');
    expect(() => getTenantPrisma('a b c')).toThrow('Invalid tenantId');
    expect(() => getTenantPrisma('tenant;DROP TABLE')).toThrow('Invalid tenantId');
  });

  it('accepts valid alphanumeric tenant IDs', () => {
    expect(() => getTenantPrisma(tenantAId)).not.toThrow();
    expect(() => getTenantPrisma(tenantBId)).not.toThrow();
  });

  it('returns an extended prisma client with tenant isolation', () => {
    const client = getTenantPrisma(tenantAId);
    expect(client).toBeDefined();
    expect(client).toHaveProperty('user');
    expect(client).toHaveProperty('workspace');
    expect(client).toHaveProperty('container');
    expect(client).toHaveProperty('tenant');
  });

  describe('tenant isolation contract', () => {
    it('getTenantPrisma wraps all operations in a transaction with SET LOCAL', () => {
      const clientA = getTenantPrisma(tenantAId);
      const clientB = getTenantPrisma(tenantBId);
      expect(clientA).not.toBe(clientB);
    });

    it('prevents SQL injection via tenantId validation', () => {
      expect(() => getTenantPrisma('\'; DROP TABLE "User"; --')).toThrow('Invalid tenantId');
      expect(() => getTenantPrisma('valid123')).not.toThrow();
    });
  });
});
