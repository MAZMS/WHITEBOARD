import { provisionContainer } from '../src/orchestrator/provision';

jest.mock('../src/orchestrator/docker', () => {
  const mockContainer = {
    id: 'mock-container-id-123',
    start: jest.fn().mockResolvedValue(undefined),
  };

  return {
    docker: {
      createContainer: jest.fn().mockResolvedValue(mockContainer),
      getContainer: jest.fn().mockReturnValue({
        stop: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      }),
    },
  };
});

describe('Container Orchestrator', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const { docker } = require('../src/orchestrator/docker');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('provisions a container with correct resource limits', async () => {
    const containerId = await provisionContainer({
      tenantId: 'tenant123',
      workspaceId: 'workspace456',
      image: 'blueprint-image:latest',
      envVars: { API_KEY: 'test' },
    });

    expect(containerId).toBe('mock-container-id-123');
    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'blueprint-image:latest',
        HostConfig: expect.objectContaining({
          Memory: 128 * 1024 * 1024,
          CpuPeriod: 100000,
          CpuQuota: 50000,
        }),
      }),
    );
  });

  it('enforces security options', async () => {
    await provisionContainer({
      tenantId: 'tenant123',
      workspaceId: 'workspace456',
      image: 'blueprint-image:latest',
      envVars: {},
    });

    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          ReadonlyRootfs: true,
          SecurityOpt: ['no-new-privileges'],
          NetworkMode: 'bridge',
          RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 },
        }),
      }),
    );
  });

  it('sets correct labels for tenant isolation', async () => {
    await provisionContainer({
      tenantId: 'tenant123',
      workspaceId: 'workspace456',
      image: 'blueprint-image:latest',
      envVars: {},
    });

    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Labels: {
          'greatlibrary.tenantId': 'tenant123',
          'greatlibrary.workspaceId': 'workspace456',
        },
      }),
    );
  });

  it('passes environment variables to container', async () => {
    await provisionContainer({
      tenantId: 'tenant123',
      workspaceId: 'workspace456',
      image: 'blueprint-image:latest',
      envVars: { DB_URL: 'postgres://...', API_KEY: 'secret' },
    });

    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: ['DB_URL=postgres://...', 'API_KEY=secret'],
      }),
    );
  });

  it('starts the container after creation', async () => {
    await provisionContainer({
      tenantId: 'tenant123',
      workspaceId: 'workspace456',
      image: 'blueprint-image:latest',
      envVars: {},
    });

    const mockContainer = await docker.createContainer.mock.results[0].value;
    expect(mockContainer.start).toHaveBeenCalled();
  });

  it('does not mount docker socket into containers', async () => {
    await provisionContainer({
      tenantId: 'tenant123',
      workspaceId: 'workspace456',
      image: 'blueprint-image:latest',
      envVars: {},
    });

    const callArgs = docker.createContainer.mock.calls[0][0];
    expect(callArgs.HostConfig.Binds).toBeUndefined();
    expect(callArgs.HostConfig.Privileged).toBeUndefined();
  });
});
