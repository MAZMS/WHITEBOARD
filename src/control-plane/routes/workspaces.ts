import { Router } from 'express';
import { getTenantPrisma } from '../../db/tenantClient';
import { AuthenticatedRequest } from '../middleware';

export const workspaceRouter = Router();

workspaceRouter.get('/workspaces', async (req, res) => {
  const { tenantId } = req as AuthenticatedRequest;
  if (!tenantId) {
    res.status(401).json({ error: 'No tenant context' });
    return;
  }

  const prisma = getTenantPrisma(tenantId);
  const workspaces = await prisma.workspace.findMany({
    include: { containers: true },
  });
  res.json(workspaces);
});

workspaceRouter.post('/workspaces', async (req, res) => {
  const { tenantId } = req as AuthenticatedRequest;
  if (!tenantId) {
    res.status(401).json({ error: 'No tenant context' });
    return;
  }

  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const prisma = getTenantPrisma(tenantId);
  const workspace = await prisma.workspace.create({
    data: { name, tenantId },
  });
  res.status(201).json(workspace);
});

workspaceRouter.delete('/workspaces/:id', async (req, res) => {
  const { tenantId } = req as AuthenticatedRequest;
  if (!tenantId) {
    res.status(401).json({ error: 'No tenant context' });
    return;
  }

  const prisma = getTenantPrisma(tenantId);
  try {
    await prisma.workspace.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: 'Workspace not found' });
  }
});
