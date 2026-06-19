import { Injectable, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ScanResult {
  isClean: boolean;
  virusName?: string;
}

// ClamAvService connects to clamd via TCP (host:port).
// Set CLAMAV_ENABLED=false to skip scanning in dev without Docker.
// In production always keep enabled — silent skip defeats the point.
@Injectable()
export class ClamAvService implements OnModuleInit {
  private readonly logger = new Logger(ClamAvService.name);
  private readonly enabled: boolean;
  private readonly host: string;
  private readonly port: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private scanner: any = null;

  constructor(private readonly config: ConfigService) {
    this.enabled = config.get<boolean>('storage.clamavEnabled') ?? true;
    this.host = config.get<string>('storage.clamavHost') ?? 'localhost';
    this.port = config.get<number>('storage.clamavPort') ?? 3310;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(
        'ClamAV scanning is DISABLED (CLAMAV_ENABLED=false). Do not use in production.',
      );
      return;
    }

    try {
      // Dynamic import — clamscan has no ESM export; require at runtime
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NodeClam = require('clamscan');
      this.scanner = await new NodeClam().init({
        clamdscan: {
          host: this.host,
          port: this.port,
          socket: false,
          active: true,
          timeout: 10000,
        },
        preference: 'clamdscan',
      });
      this.logger.log(`ClamAV connected at ${this.host}:${this.port}`);
    } catch (err) {
      this.logger.error(
        `ClamAV init failed: ${(err as Error).message}. Uploads will be rejected until ClamAV is reachable.`,
      );
    }
  }

  async scan(buffer: Buffer): Promise<ScanResult> {
    if (!this.enabled) return { isClean: true };

    if (!this.scanner) {
      throw new BadRequestException('Virus scanner is unavailable. Please try again later.');
    }

    let isInfected: boolean;
    let viruses: string[];
    try {
      ({ isInfected, viruses } = await this.scanner.scanBuffer(buffer));
    } catch (err) {
      this.logger.error({ err }, 'ClamAV scanBuffer failed');
      throw new BadRequestException('Virus scanner error. Please try again.');
    }

    if (isInfected) {
      const virusName = viruses[0] ?? 'Unknown';
      this.logger.warn(`Virus detected: ${virusName}`);
      return { isClean: false, virusName };
    }

    return { isClean: true };
  }

  async scanOrThrow(buffer: Buffer): Promise<void> {
    const result = await this.scan(buffer);
    if (!result.isClean) {
      throw new BadRequestException(`Virus detected in uploaded file: ${result.virusName}`);
    }
  }
}
