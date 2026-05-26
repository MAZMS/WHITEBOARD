import { Router } from 'express';
import { admin } from '../../db/adminClient';

export const blueprintRouter = Router();

blueprintRouter.get('/blueprints', async (_req, res) => {
  try {
    const blueprints = await admin.blueprint.findMany({
      include: { creator: { select: { username: true } } },
      orderBy: { activeRuns: 'desc' },
    });
    res.json(blueprints);
  } catch {
    res.json([]);
  }
});

blueprintRouter.get('/blueprints/search', async (req, res) => {
  try {
    const q = (req.query.q as string || '').trim();
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { description: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const blueprints = await admin.blueprint.findMany({
      where,
      include: { creator: { select: { username: true } } },
      orderBy: { activeRuns: 'desc' },
    });
    res.json(blueprints);
  } catch {
    res.json([]);
  }
});

blueprintRouter.get('/creators/:username', async (req, res) => {
  try {
    const creator = await admin.creator.findUnique({
      where: { username: req.params.username },
    });
    if (!creator) {
      res.status(404).json({ error: 'Creator not found' });
      return;
    }
    const blueprints = await admin.blueprint.findMany({
      where: { creatorId: creator.id },
      include: { creator: { select: { username: true } } },
      orderBy: { activeRuns: 'desc' },
    });
    const totalRuns = blueprints.reduce((sum: number, b: { activeRuns: number }) => sum + b.activeRuns, 0);
    const avgStability = blueprints.length > 0
      ? Math.round(blueprints.reduce((sum: number, b: { stability: number }) => sum + b.stability, 0) / blueprints.length * 10) / 10
      : 0;
    res.json({
      creator: {
        id: creator.id,
        username: creator.username,
        email: creator.email,
        createdAt: creator.createdAt,
      },
      blueprints,
      stats: {
        totalRuns,
        avgStability,
        blueprintCount: blueprints.length,
      },
    });
  } catch {
    res.status(500).json({ error: 'Service unavailable' });
  }
});

blueprintRouter.get('/blueprints/:slug', async (req, res) => {
  try {
    const blueprint = await admin.blueprint.findUnique({
      where: { slug: req.params.slug },
      include: { creator: { select: { username: true, email: true } } },
    });
    if (!blueprint) {
      res.status(404).json({ error: 'Blueprint not found' });
      return;
    }
    res.json(blueprint);
  } catch {
    res.status(500).json({ error: 'Service unavailable' });
  }
});

// ── Activity feed ──
blueprintRouter.get('/activity', async (_req, res) => {
  try {
    const blueprints = await admin.blueprint.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { creator: { select: { username: true } } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feed = blueprints.map((bp: any) => ({
      type: 'blueprint_created' as const,
      blueprint: bp,
      createdAt: bp.createdAt,
    }));
    res.json(feed);
  } catch {
    res.json([]);
  }
});

// ── Badge SVG endpoint ──
blueprintRouter.get('/badge/:slug', async (req, res) => {
  try {
    const blueprint = await admin.blueprint.findUnique({
      where: { slug: req.params.slug },
      select: { name: true, stability: true },
    });
    if (!blueprint) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }

    const { name, stability } = blueprint;
    const stabilityText = stability + '%';

    // Color based on stability thresholds
    let color: string;
    if (stability >= 97) {
      color = '#3fb950'; // green
    } else if (stability >= 93) {
      color = '#d29922'; // amber
    } else {
      color = '#f85149'; // red
    }

    // Approximate text widths (7px per char at 11px font is close to shields.io)
    const charWidth = 6.5;
    const padding = 10;
    const leftText = name;
    const rightText = stabilityText + ' | on GreatLibrary';
    const leftWidth = Math.round(leftText.length * charWidth + padding * 2);
    const rightWidth = Math.round(rightText.length * charWidth + padding * 2);
    const totalWidth = leftWidth + rightWidth;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${name}: ${stabilityText}">
  <title>${name}: ${stabilityText}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="20" fill="#555"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${leftWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${escapeXml(leftText)}</text>
    <text x="${leftWidth / 2}" y="13">${escapeXml(leftText)}</text>
    <text x="${leftWidth + rightWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${escapeXml(rightText)}</text>
    <text x="${leftWidth + rightWidth / 2}" y="13">${escapeXml(rightText)}</text>
  </g>
</svg>`;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(svg);
  } catch {
    res.status(500).type('text/plain').send('Badge generation failed');
  }
});

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
