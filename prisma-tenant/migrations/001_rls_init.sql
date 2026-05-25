-- Enable RLS on every tenant-scoped table
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Workspace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Container" ENABLE ROW LEVEL SECURITY;

-- Policy: row visible iff tenantId == current session tenant
CREATE POLICY tenant_isolation_user ON "User"
  USING ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_workspace ON "Workspace"
  USING ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_container ON "Container"
  USING ("tenantId" = current_setting('app.tenant_id', true));

-- Force RLS even for table owner (critical — without this, the app DB user bypasses)
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Workspace" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Container" FORCE ROW LEVEL SECURITY;
