import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClamAvService } from './clamav.service';

const mockConfig = (overrides: Record<string, unknown> = {}) => ({
  get: jest.fn((key: string) => {
    const map: Record<string, unknown> = {
      'storage.clamavEnabled': true,
      'storage.clamavHost': 'localhost',
      'storage.clamavPort': 3310,
      ...overrides,
    };
    return map[key];
  }),
});

describe('ClamAvService', () => {
  let service: ClamAvService;

  async function buildService(configOverrides: Record<string, unknown> = {}): Promise<ClamAvService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClamAvService,
        { provide: ConfigService, useValue: mockConfig(configOverrides) },
      ],
    }).compile();
    return module.get(ClamAvService);
  }

  describe('when disabled', () => {
    beforeEach(async () => {
      service = await buildService({ 'storage.clamavEnabled': false });
    });

    it('scan() returns isClean=true without calling the scanner', async () => {
      const result = await service.scan(Buffer.from('anything'));
      expect(result).toEqual({ isClean: true });
    });

    it('scanOrThrow() does not throw', async () => {
      await expect(service.scanOrThrow(Buffer.from('anything'))).resolves.toBeUndefined();
    });
  });

  describe('when enabled but scanner not initialized', () => {
    beforeEach(async () => {
      service = await buildService();
      // Skip onModuleInit so scanner stays null
    });

    it('scan() throws BadRequestException (scanner unavailable)', async () => {
      await expect(service.scan(Buffer.from('test'))).rejects.toThrow(BadRequestException);
    });
  });

  describe('when scanner is initialized', () => {
    const buf = Buffer.from('clean-file');

    beforeEach(async () => {
      service = await buildService();
      // Inject a mock scanner directly
      (service as any).scanner = {
        scanBuffer: jest.fn().mockResolvedValue({ isInfected: false, viruses: [] }),
      };
    });

    it('scan() returns isClean=true for clean file', async () => {
      await expect(service.scan(buf)).resolves.toEqual({ isClean: true });
    });

    it('scan() returns isClean=false and virusName for infected file', async () => {
      (service as any).scanner.scanBuffer.mockResolvedValue({
        isInfected: true,
        viruses: ['Eicar-Test-Signature'],
      });
      const result = await service.scan(buf);
      expect(result).toEqual({ isClean: false, virusName: 'Eicar-Test-Signature' });
    });

    it('scan() uses "Unknown" when virus name list is empty', async () => {
      (service as any).scanner.scanBuffer.mockResolvedValue({ isInfected: true, viruses: [] });
      const result = await service.scan(buf);
      expect(result.virusName).toBe('Unknown');
    });

    it('scan() throws BadRequestException when scanBuffer rejects', async () => {
      (service as any).scanner.scanBuffer.mockRejectedValue(new Error('clamd connection reset'));
      await expect(service.scan(buf)).rejects.toThrow(BadRequestException);
    });

    it('scanOrThrow() throws BadRequestException on infected file', async () => {
      (service as any).scanner.scanBuffer.mockResolvedValue({
        isInfected: true,
        viruses: ['Eicar-Test-Signature'],
      });
      await expect(service.scanOrThrow(buf)).rejects.toThrow(BadRequestException);
    });

    it('scanOrThrow() resolves for clean file', async () => {
      await expect(service.scanOrThrow(buf)).resolves.toBeUndefined();
    });
  });
});
