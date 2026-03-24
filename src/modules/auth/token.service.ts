import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { User, UserDocument } from '../users/schemas/user.schema';
import { JwtPayload } from './strategies/jwt.strategy';

// The shape of data we embed in a refresh token (kept minimal intentionally).
export interface RefreshTokenPayload {
  sub: string;   // userId
  jti: string;   // JWT ID — a unique ID for THIS specific token (used for reuse detection)
  family: string; // Token family ID — all tokens in a rotation chain share this
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  // ── Access Token ────────────────────────────────────────────────────────────
  // Short-lived (15m). Contains enough info for guards to authorize requests
  // without a DB lookup on every request (the JwtStrategy does one DB check,
  // but only for user status — everything else comes from this payload).
  generateAccessToken(user: { _id: any; email: string; roles: string[] }): string {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user._id.toString(),
      email: user.email,
      roles: user.roles,
    };

    return this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwt.secret'),
      expiresIn: this.config.get<string>('jwt.expiresIn'), // '15m'
    });
  }

  // ── Refresh Token ────────────────────────────────────────────────────────────
  // Long-lived (7d). We store only a HASH of this token in the DB, never the
  // raw value. This way, even if the database is compromised, the attacker
  // can't use stolen refresh tokens without also breaking bcrypt.
  async generateRefreshToken(userId: string, existingFamily?: string): Promise<string> {
    // jti (JWT ID) is a unique random identifier for this specific token.
    // This is what lets us detect reuse: if a jti is presented that we've
    // already marked as consumed, we know rotation was bypassed.
    const jti = crypto.randomUUID();

    // A token "family" groups all tokens in a single rotation chain.
    // When we detect reuse of any token in a family, we revoke the entire family.
    // This limits the damage of a stolen token to a single rotation cycle.
    const family = existingFamily ?? crypto.randomUUID();

    const payload: RefreshTokenPayload = { sub: userId, jti, family };

    const rawToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwt.refreshSecret'),
      expiresIn: this.config.get<string>('jwt.refreshExpiresIn'), // '7d'
    });

    // Hash before storing. We use a lower bcrypt cost (8 rounds) here compared
    // to the password hash (12 rounds) because refresh tokens are already
    // cryptographically random — they don't need the same brute-force protection
    // that user-chosen passwords do. This makes token rotation faster.
    const tokenHash = await bcrypt.hash(rawToken, 8);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Store the hash alongside its jti so we can find and verify it efficiently.
    await this.userModel.findByIdAndUpdate(userId, {
      $push: {
        refreshTokens: { tokenHash, expiresAt, jti, family, isRevoked: false },
      },
    });

    // Housekeeping: clean up expired tokens to prevent the array from growing
    // unboundedly. We do this asynchronously — it's not on the critical path.
    this.pruneExpiredTokens(userId).catch(() => {});

    return rawToken;
  }

  // ── Refresh Token Rotation ────────────────────────────────────────────────
  // This is the most security-critical method in the entire codebase.
  // It must atomically: verify the token, detect reuse, issue new tokens,
  // and revoke the old one — all or nothing.
  async rotateRefreshToken(rawToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    userId: string;
  }> {
    // Step 1: Verify the JWT signature and expiry.
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(rawToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      // Expired or tampered tokens get the same generic error — don't leak
      // whether a token was valid but expired vs. completely fabricated.
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    // Step 2: Find the user and load their refresh token array.
    // We select refreshTokens explicitly because it's normally hidden (select: false).
    const user = await this.userModel
      .findById(payload.sub)
      .select('+refreshTokens email roles isActive')
      .exec();

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive.');
    }

    // Step 3: Find the matching token by comparing hashes.
    // We find candidates by family first (a smaller set), then verify the hash.
    const familyTokens = user.refreshTokens.filter(
      (t) => t.family === payload.family,
    );

    // Look for a token in this family that matches our raw token.
    let matchedToken: (typeof user.refreshTokens)[0] | null = null;
    for (const candidate of familyTokens) {
      const matches = await bcrypt.compare(rawToken, candidate.tokenHash);
      if (matches) {
        matchedToken = candidate;
        break;
      }
    }

    // Step 4: REUSE DETECTION — the heart of the security model.
    // If we found the family but no matching token, it means a token in this
    // family was already used (rotated out) and someone is replaying it.
    // This is a definitive sign of token theft. Our response: revoke the
    // ENTIRE family, forcing the legitimate user to re-authenticate.
    if (!matchedToken) {
      if (familyTokens.length > 0) {
        // Suspected theft — invalidate all tokens in this compromised family
        await this.revokeTokenFamily(user._id.toString(), payload.family);
      }
      throw new UnauthorizedException(
        'Refresh token has already been used. Please log in again.',
      );
    }

    // Step 5: Check if this specific token has been explicitly revoked.
    if (matchedToken.isRevoked) {
      throw new UnauthorizedException('Refresh token has been revoked.');
    }

    // Step 6: Mark the old token as revoked (consumed) BEFORE issuing the new one.
    // Doing this before the new issue means that if the new token generation fails,
    // the old token is already invalid — the user just has to log in again.
    // This is safer than the reverse, which could leave two valid tokens in circulation.
    await this.userModel.findByIdAndUpdate(user._id, {
      $set: { 'refreshTokens.$[elem].isRevoked': true },
    }, {
      arrayFilters: [{ 'elem.tokenHash': matchedToken.tokenHash }],
    });

    // Step 7: Issue a new token pair, preserving the same family ID.
    const newRefreshToken = await this.generateRefreshToken(
      user._id.toString(),
      payload.family, // Same family — the chain continues
    );

    const newAccessToken = this.generateAccessToken(user);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      userId: user._id.toString(),
    };
  }

  // ── Revoke All Tokens (Logout) ────────────────────────────────────────────
  async revokeAllTokens(userId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $set: { refreshTokens: [] },
    });
  }

  // ── Revoke a Specific Family ──────────────────────────────────────────────
  private async revokeTokenFamily(userId: string, family: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $pull: { refreshTokens: { family } },
    });
  }

  // ── Prune Expired Tokens ──────────────────────────────────────────────────
  // Runs asynchronously after token issuance — keeps the refreshTokens array
  // from growing forever for long-lived accounts.
  private async pruneExpiredTokens(userId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $pull: {
        refreshTokens: {
          $or: [{ expiresAt: { $lt: new Date() } }, { isRevoked: true }],
        },
      },
    });
  }

  // ── Cookie Helper ─────────────────────────────────────────────────────────
  // Centralizes cookie configuration so it's consistent across login,
  // refresh, and any future auth methods (OAuth, magic links, etc.)
  getRefreshTokenCookieOptions() {
    const isProd = this.config.get('app.nodeEnv') === 'production';
    return {
      httpOnly: true,       // JS cannot read this cookie — kills XSS token theft
      secure: isProd,       // HTTPS only in production
      sameSite: 'strict' as const,  // Prevents CSRF from using this cookie
      path: '/api/v1/auth', // Cookie only sent to auth endpoints — minimal exposure
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    };
  }
}