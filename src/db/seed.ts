const CREATORS = [
  { username: 'greatlibrary', email: 'team@greatlibrary.ai' },
  { username: 'agentsmith', email: 'smith@example.com' },
  { username: 'devops-dana', email: 'dana@example.com' },
  { username: 'automator-ai', email: 'auto@example.com' },
  { username: 'fullstack-finn', email: 'finn@example.com' },
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
    tags: ['code-quality', 'pr-review', 'ci'],
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
    tags: ['bugs', 'github', 'triage'],
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
    tags: ['documentation', 'api-docs', 'readme'],
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
    tags: ['dependencies', 'upgrades', 'codemods'],
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
    tags: ['security', 'owasp', 'audit'],
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
    tags: ['testing', 'jest', 'coverage'],
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
    tags: ['ci-cd', 'deploy', 'docker'],
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
    tags: ['refactoring', 'code-quality', 'cleanup'],
    creatorIdx: 0,
  },
  {
    name: 'Database Optimizer',
    slug: 'database-optimizer',
    description: 'Analyzes slow queries, suggests indexes, detects N+1 patterns.',
    githubUrl: 'https://github.com/automator-ai/database-optimizer',
    activeRuns: 120,
    stability: 96.8,
    requiredPermissions: ['Read', 'Grep', 'Bash(psql)', 'Bash(explain analyze)'],
    estimatedMonthlyCost: 14,
    tags: ['database', 'performance', 'sql'],
    creatorIdx: 3,
  },
  {
    name: 'API Monitor',
    slug: 'api-monitor',
    description: 'Watches API endpoints for latency spikes, error rates, and schema drift.',
    githubUrl: 'https://github.com/fullstack-finn/api-monitor',
    activeRuns: 89,
    stability: 98.2,
    requiredPermissions: ['Read', 'Bash(curl)', 'Grep'],
    estimatedMonthlyCost: 7,
    tags: ['monitoring', 'api', 'alerts'],
    creatorIdx: 4,
  },
  {
    name: 'Dependency Auditor',
    slug: 'dependency-auditor',
    description: 'Scans package.json/requirements.txt for outdated, deprecated, or vulnerable packages.',
    githubUrl: 'https://github.com/automator-ai/dependency-auditor',
    activeRuns: 156,
    stability: 97.1,
    requiredPermissions: ['Read', 'Glob', 'Bash(npm audit)', 'Bash(pip audit)'],
    estimatedMonthlyCost: 6,
    tags: ['dependencies', 'security', 'audit'],
    creatorIdx: 3,
  },
  {
    name: 'Git Workflow Agent',
    slug: 'git-workflow-agent',
    description: 'Automates branch management, PR creation, conventional commits, and changelog generation.',
    githubUrl: 'https://github.com/agentsmith/git-workflow-agent',
    activeRuns: 72,
    stability: 95.5,
    requiredPermissions: ['Read', 'Write', 'Bash(git *)', 'Bash(gh pr create)'],
    estimatedMonthlyCost: 8,
    tags: ['git', 'workflow', 'automation'],
    creatorIdx: 1,
  },
  {
    name: 'Error Tracker',
    slug: 'error-tracker',
    description: 'Monitors production logs for unhandled exceptions, groups similar errors, and creates GitHub issues.',
    githubUrl: 'https://github.com/devops-dana/error-tracker',
    activeRuns: 198,
    stability: 93.7,
    requiredPermissions: ['Read', 'Grep', 'Bash(gh issue create)', 'Glob'],
    estimatedMonthlyCost: 11,
    tags: ['monitoring', 'errors', 'github'],
    creatorIdx: 2,
  },
  {
    name: 'Performance Profiler',
    slug: 'performance-profiler',
    description: 'Runs benchmarks, identifies memory leaks, and generates flame graphs for Node.js/Python apps.',
    githubUrl: 'https://github.com/fullstack-finn/performance-profiler',
    activeRuns: 45,
    stability: 91.2,
    requiredPermissions: ['Read', 'Bash(node --prof)', 'Bash(clinic doctor)', 'Grep'],
    estimatedMonthlyCost: 18,
    tags: ['performance', 'profiling', 'benchmarks'],
    creatorIdx: 4,
  },
  {
    name: 'i18n Assistant',
    slug: 'i18n-assistant',
    description: 'Extracts hardcoded strings, generates translation files, and validates locale coverage.',
    githubUrl: 'https://github.com/greatlibrary/i18n-assistant',
    activeRuns: 34,
    stability: 99.3,
    requiredPermissions: ['Read', 'Write', 'Grep', 'Glob'],
    estimatedMonthlyCost: 4,
    tags: ['i18n', 'localization', 'translations'],
    creatorIdx: 0,
  },
  {
    name: 'Schema Migrator',
    slug: 'schema-migrator',
    description: 'Generates Prisma/Sequelize/TypeORM migrations from schema diffs, with rollback scripts.',
    githubUrl: 'https://github.com/automator-ai/schema-migrator',
    activeRuns: 67,
    stability: 94.8,
    requiredPermissions: ['Read', 'Write', 'Bash(npx prisma migrate)', 'Bash(npm test)'],
    estimatedMonthlyCost: 9,
    tags: ['database', 'migrations', 'orm'],
    creatorIdx: 3,
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
