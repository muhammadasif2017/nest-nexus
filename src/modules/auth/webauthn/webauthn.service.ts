import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { PrismaService } from '../../../core/prisma/prisma.service';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class WebauthnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  private get rpID(): string {
    return this.config.get<string>('app.webauthnRpId')!;
  }

  private get rpName(): string {
    return this.config.get<string>('app.webauthnRpName')!;
  }

  private get origin(): string {
    return this.config.get<string>('app.clientOrigin')!;
  }

  async registerOptions(
    userId: string,
    email: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const existing = await this.prisma.webauthnCredential.findUnique({ where: { userId } });

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: email,
      userID: new Uint8Array(Buffer.from(userId)),
      excludeCredentials: existing
        ? [
            {
              id: existing.credentialId,
              transports: existing.transports as AuthenticatorTransportFuture[],
            },
          ]
        : [],
    });

    await this.cache.set(`webauthn:register:${userId}`, options.challenge, CHALLENGE_TTL_MS);
    return options;
  }

  async registerVerify(userId: string, response: RegistrationResponseJSON): Promise<void> {
    const expectedChallenge = await this.cache.get<string>(`webauthn:register:${userId}`);
    if (!expectedChallenge) {
      throw new UnauthorizedException('Registration challenge expired or not found.');
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new UnauthorizedException('WebAuthn registration verification failed.');
    }

    const { credential } = verification.registrationInfo;

    await this.prisma.webauthnCredential.upsert({
      where: { userId },
      create: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
      },
      update: {
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
      },
    });

    await this.cache.del(`webauthn:register:${userId}`);
  }

  async loginOptions(email: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const normalizedEmail = email.toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, webauthnCredential: true },
    });

    // Empty allowCredentials when no user/credential is found — the client simply won't
    // find a matching local credential, and we don't reveal whether the email exists.
    const allowCredentials = user?.webauthnCredential
      ? [
          {
            id: user.webauthnCredential.credentialId,
            transports: user.webauthnCredential.transports as AuthenticatorTransportFuture[],
          },
        ]
      : [];

    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials,
    });

    await this.cache.set(`webauthn:login:${normalizedEmail}`, options.challenge, CHALLENGE_TTL_MS);
    return options;
  }

  async loginVerify(email: string, response: AuthenticationResponseJSON): Promise<string> {
    const normalizedEmail = email.toLowerCase();

    const expectedChallenge = await this.cache.get<string>(`webauthn:login:${normalizedEmail}`);
    if (!expectedChallenge) {
      throw new UnauthorizedException('Login challenge expired or not found.');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, webauthnCredential: true },
    });

    if (!user?.webauthnCredential) {
      throw new UnauthorizedException('No passkey registered for this account.');
    }

    const cred = user.webauthnCredential;

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(cred.publicKey),
        counter: cred.counter,
        transports: cred.transports as AuthenticatorTransportFuture[],
      },
    });

    if (!verification.verified) {
      throw new UnauthorizedException('WebAuthn login verification failed.');
    }

    await this.prisma.webauthnCredential.update({
      where: { id: cred.id },
      data: { counter: verification.authenticationInfo.newCounter },
    });

    await this.cache.del(`webauthn:login:${normalizedEmail}`);

    return user.id;
  }

  async deleteCredential(userId: string): Promise<void> {
    const credential = await this.prisma.webauthnCredential.findUnique({ where: { userId } });

    if (!credential) {
      throw new NotFoundException('No passkey registered for this account.');
    }

    await this.prisma.webauthnCredential.delete({ where: { userId } });
  }
}
