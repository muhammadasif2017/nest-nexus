import { HealthCheckError } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';
import { PrismaService } from '../prisma/prisma.service';

const makePrismaMock = () => ({
  $queryRaw: jest.fn(),
});

const makeIndicator = () => {
  const prisma = makePrismaMock();
  const indicator = new PrismaHealthIndicator(prisma as unknown as PrismaService);
  return { indicator, prisma };
};

describe('PrismaHealthIndicator', () => {
  describe('isHealthy()', () => {
    it('returns an up status when the query succeeds', async () => {
      const { indicator, prisma } = makeIndicator();
      prisma.$queryRaw.mockResolvedValue([{ '1': 1 }]);
      const result = await indicator.isHealthy('postgres');
      expect(result).toEqual({ postgres: { status: 'up' } });
    });

    it('throws HealthCheckError with a down status when the query fails', async () => {
      const { indicator, prisma } = makeIndicator();
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
      await expect(indicator.isHealthy('postgres')).rejects.toThrow(HealthCheckError);
    });

    it('includes the underlying error message in the down status', async () => {
      const { indicator, prisma } = makeIndicator();
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
      await expect(indicator.isHealthy('postgres')).rejects.toMatchObject({
        causes: { postgres: { status: 'down', message: 'connection refused' } },
      });
    });
  });
});
