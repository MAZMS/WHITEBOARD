import { docker } from './docker';

export async function provisionContainer(opts: {
  tenantId: string;
  workspaceId: string;
  image: string;
  envVars: Record<string, string>;
}): Promise<string> {
  const container = await docker.createContainer({
    Image: opts.image,
    Env: Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`),
    HostConfig: {
      Memory: 128 * 1024 * 1024,
      CpuPeriod: 100000,
      CpuQuota: 50000,
      NetworkMode: 'bridge',
      RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 },
      ReadonlyRootfs: true,
      SecurityOpt: ['no-new-privileges'],
    },
    Labels: {
      'greatlibrary.tenantId': opts.tenantId,
      'greatlibrary.workspaceId': opts.workspaceId,
    },
  });
  await container.start();
  return container.id;
}

export async function stopContainer(dockerId: string): Promise<void> {
  const container = docker.getContainer(dockerId);
  await container.stop();
}

export async function removeContainer(dockerId: string): Promise<void> {
  const container = docker.getContainer(dockerId);
  await container.remove({ force: true });
}
