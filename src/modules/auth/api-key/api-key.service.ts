import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import crypto from 'crypto';
import { sha256Hex } from '../../../common/crypto/hash.util';
import { PrismaService } from '../../../core/prisma/prisma.service';

export interface ValidatedApiKey {
  id: string;
  userId: string;
  scopes: string[];
}

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(userId: string, scopes: string[]): Promise<{ rawKey: string }> {
    const rawKey = crypto.randomBytes(32).toString('hex');
    const keyHash = sha256Hex(rawKey);

    await this.prisma.apiKey.create({
      data: { userId, keyHash, scopes },
    });

    this.eventEmitter.emit('apiKey.created', { userId });

    return { rawKey };
  }

  async validate(rawKey: string): Promise<ValidatedApiKey> {
    const keyHash = sha256Hex(rawKey);

    const apiKey = await this.prisma.apiKey.findUnique({ where: { keyHash } });

    if (!apiKey || apiKey.revokedAt) {
      throw new UnauthorizedException('Invalid or revoked API key.');
    }

    await this.prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return { id: apiKey.id, userId: apiKey.userId, scopes: apiKey.scopes };
  }

  async revoke(id: string, userId: string): Promise<void> {
    const apiKey = await this.prisma.apiKey.findFirst({ where: { id, userId } });

    if (!apiKey) {
      throw new NotFoundException('API key not found.');
    }

    await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    this.eventEmitter.emit('apiKey.revoked', { userId, keyId: id });
  }
}
