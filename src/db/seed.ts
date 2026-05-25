const CREATORS = [
  { username: 'greatlibrary', email: 'team@greatlibrary.ai' },
  { username: 'agentsmith', email: 'smith@example.com' },
  { username: 'devops-dana', email: 'dana@example.com' },
];

const BLUEPRINTS = [
  {
    name: 'Code Reviewer',
    slug: 'code-reviewer',
    description: 'Automated PR review agent that checks style, security, and correctness. Runs on every push and leaves inline comments.',
    githubUrl: 'https://github.com/greatlibrary/code-reviewer',
    activeRuns: 142,
    stability: 98.5,
    requiredPermissions: ['Read', 'Bash(npm test)', 'Grep'],
    estimatedMonthlyCost: 12,
    creatorIdx: 0,
  },
  {
    name: 'Bug Triager',
    slug: 'bug-triager',
    description: 'Reads new GitHub issues, reproduces bugs in a sandbox, and labels them by severity. Escalates critical issues to Slack.',
    githubUrl: 'https://github.com/greatlibrary/bug-triager',
    activeRuns: 87,
    stability: 95.2,
    requiredPermissions: ['Read', 'Bash(git log*)', 'Grep', 'Glob'],
    estimatedMonthlyCost: 8,
    creatorIdx: 0,
  },
  {
    name: 'Docs Generator',
    slug: 'docs-generator',
    description: 'Scans your codebase and generates API documentation, README sections, and architecture diagrams automatically.',
    githubUrl: 'https://github.com/agentsmith/docs-generator',
    activeRuns: 203,
    stability: 99.1,
    requiredPermissions: ['Read', 'Write', 'Glob', 'Grep'],
    estimatedMonthlyCost: 5,
    creatorIdx: 1,
  },
  {
    name: 'Migration Assistant',
    slug: 'migration-assistant',
    description: 'Upgrades dependencies, runs codemods, and fixes breaking changes. Supports React, Next.js, Express, and Prisma migrations.',
    githubUrl: 'https://github.com/agentsmith/migration-assistant',
    activeRuns: 64,
    stability: 92.8,
    requiredPermissions: ['Read', 'Edit', 'Bash(npm install)', 'Bash(npm test)'],
    estimatedMonthlyCost: 15,
    creatorIdx: 1,
  },
  {
    name: 'Security Scanner',
    slug: 'security-scanner',
    description: 'Continuous security audit agent. Checks for OWASP Top 10, dependency vulnerabilities, leaked secrets, and insecure configurations.',
    githubUrl: 'https://github.com/devops-dana/security-scanner',
    activeRuns: 311,
    stability: 97.6,
    requiredPermissions: ['Read', 'Grep', 'Glob', 'Bash(npm audit)'],
    estimatedMonthlyCost: 10,
    creatorIdx: 2,
  },
  {
    name: 'Test Writer',
    slug: 'test-writer',
    description: 'Analyzes untested code paths and generates Jest/Vitest/Pytest tests with meaningful assertions. Targets 80%+ coverage.',
    githubUrl: 'https://github.com/devops-dana/test-writer',
    activeRuns: 178,
    stability: 94.3,
    requiredPermissions: ['Read', 'Write', 'Bash(npm test)', 'Grep'],
    estimatedMonthlyCost: 9,
    creatorIdx: 2,
  },
  {
    name: 'Deployment Pipeline',
    slug: 'deployment-pipeline',
    description: 'End-to-end CI/CD agent that builds, tests, and deploys your app. Supports Railway, Vercel, AWS, and Docker targets.',
    githubUrl: 'https://github.com/devops-dana/deployment-pipeline',
    activeRuns: 56,
    stability: 99.7,
    requiredPermissions: ['Read', 'Bash(npm run build)', 'Bash(npm test)'],
    estimatedMonthlyCost: 20,
    creatorIdx: 2,
  },
  {
    name: 'Refactor Agent',
    slug: 'refactor-agent',
    description: 'Identifies code smells, duplicate logic, and dead code. Proposes safe refactors with full test coverage verification.',
    githubUrl: 'https://github.com/greatlibrary/refactor-agent',
    activeRuns: 95,
    stability: 96.1,
    requiredPermissions: ['Read', 'Edit', 'Grep', 'Bash(npm test)'],
    estimatedMonthlyCost: 11,
    creatorIdx: 0,
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedDatabase(admin: any): Promise<void> {
  const creators = [];
  for (const c of CREATORS) {
    const existing = await admin.creator.findUnique({ where: { email: c.email } });
    if (existing) {
      creators.push(existing);
    } else {
      const created = await admin.creator.create({ data: c });
      creators.push(created);
      console.log(`  Created creator: ${c.username}`);
    }
  }

  for (const bp of BLUEPRINTS) {
    const { creatorIdx, ...data } = bp;
    const existing = await admin.blueprint.findUnique({ where: { slug: data.slug } });
    if (existing) continue;
    await admin.blueprint.create({
      data: { ...data, creatorId: creators[creatorIdx].id },
    });
    console.log(`  Created blueprint: ${data.name}`);
  }
}
