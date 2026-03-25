import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Role } from '../../../common/enums/role.enum';

// HydratedDocument gives you the full Mongoose Document type with your data shape.
// Use this as the return type in your service methods.
export type UserDocument = HydratedDocument<User>;

// ── OAuth Provider Record ──────────────────────────────────────────────────
// We store an array because users can link multiple providers to one account.
// The `providerId` is the ID from the external provider (e.g., Google's "sub" claim).
// We deliberately do NOT store OAuth access tokens here — they're short-lived,
// we don't need them after the initial profile fetch, and storing them is a
// liability if the DB is compromised.
@Schema({ _id: false })
export class OAuthProvider {
  @Prop({ required: true, enum: ['google', 'github'] })
  provider!: string;

  @Prop({ required: true })
  providerId!: string; // The user's ID in the external system

  @Prop()
  providerEmail?: string; // May differ from the account's primary email
}

// ── Subdocument: Refresh Token Rotation ───────────────────────────────────────
// We store hashed refresh tokens to support token rotation and revocation.
// If a stolen token is used, the legitimate user's next request will fail,
// alerting you to a potential account compromise.
// @Schema({ _id: false }) // No separate _id for embedded sub-documents
// export class RefreshToken {
//   @Prop({ required: true })
//   tokenHash!: string; // bcrypt hash, never store raw tokens

//   @Prop({ required: true })
//   expiresAt!: Date;

//   @Prop({ default: false })
//   isRevoked!: boolean;
// }

// ── Extended Refresh Token (Per-Device) ───────────────────────────────────
// We extend the existing RefreshToken subdocument with device metadata.
// This is the ONLY change to the existing RefreshToken structure —
// all Phase 3 rotation logic remains valid because we're adding fields, not changing them.
@Schema({ _id: false })
export class RefreshToken {
  @Prop({ required: true })
  tokenHash!: string;
  @Prop({ required: true })
  expiresAt!: Date;
  @Prop({ default: false })
  isRevoked!: boolean;
  @Prop({ required: true })
  jti!: string;
  @Prop({ required: true })
  family!: string;

  // ── New: Device Identity ─────────────────────────────────────────────────
  // deviceId: a stable ID we generate on first login from a device and
  // store in a non-HttpOnly cookie so JS can read and send it back.
  // This is NOT a secret — it's purely for UX (naming devices in the UI).
  @Prop() deviceId?: string;
  @Prop() deviceName?: string; // e.g., "Chrome on macOS"
  @Prop() userAgent?: string; // Raw User-Agent header, for display
  @Prop() lastUsedAt?: Date; // When this device last successfully refreshed
  @Prop() createdAt?: Date; // When this device first authenticated
}

// ── Main User Schema ───────────────────────────────────────────────────────────
@Schema({
  timestamps: true, // Mongoose auto-manages createdAt + updatedAt
  versionKey: false, // Removes the __v field from documents
  toJSON: {
    // When serializing to JSON, run the transform below.
    // This is a safety net — the serialization interceptor (class-transformer)
    // is your PRIMARY line of defense; this is a secondary fallback.
    transform: (_, ret: Record<string, unknown>) => {
      delete ret.password;
      delete ret.refreshTokens;
      return ret;
    },
  },
})
export class User extends Document {
  // ── Core Identity ──────────────────────────────────────────────────────────
  @Prop({
    required: true,
    unique: true,
    lowercase: true, // Normalize email before saving
    trim: true,
    index: true, // Explicitly declare index — don't rely on autoIndex in prod
  })
  email!: string;

  @Prop({ required: true, minlength: 2, maxlength: 100, trim: true })
  displayName!: string;

  // ── Authentication ────────────────────────────────────────────────────────
  @Prop({ required: true, select: false }) // select: false = excluded from all queries by default
  password!: string;

  @Prop({ type: [RefreshToken], default: [] })
  refreshTokens!: RefreshToken[];

  @Prop({ default: false })
  isEmailVerified!: boolean;

  @Prop({ type: String, select: false }) // Only fetched when explicitly needed
  emailVerificationToken?: string;

  @Prop({ type: Date })
  emailVerificationExpires?: Date;

  @Prop({ type: String, select: false })
  passwordResetToken?: string;

  @Prop({ type: Date })
  passwordResetExpires?: Date;

  // ── Authorization ─────────────────────────────────────────────────────────
  @Prop({
    type: [String],
    enum: Object.values(Role), // Constrain to the Role enum — rejects unknown roles at DB level
    default: [Role.USER],
  })
  roles!: Role[];

  @Prop({ default: true })
  isActive!: boolean;

  // ── Audit ─────────────────────────────────────────────────────────────────
  @Prop({ type: Date })
  lastLoginAt?: Date;

  @Prop({ type: String })
  lastLoginIp?: string;

  // Two-Factor Auth
  @Prop({ type: String, select: false }) // Never leak the secret in queries
  twoFactorSecret?: string;

  @Prop({ default: false })
  isTwoFactorEnabled: boolean = false;

  // Backup codes for 2FA recovery — stored as hashes, same reason as passwords
  @Prop({ type: [String], select: false })
  twoFactorBackupCodes?: string[];

  // Magic Link
  @Prop({ type: String, select: false })
  magicLinkTokenHash?: string;

  @Prop({ type: Date })
  magicLinkExpiresAt?: Date;

  // OAuth

  @Prop({ type: [OAuthProvider], default: [] })
  oauthProviders: OAuthProvider[] = [];

  // Whether the user has a password set — OAuth-only users don't have one,
  // so we need to distinguish them when they try to use password-based flows.

  @Prop({ default: true })
  hasPassword: boolean = false;
}

// ── Schema Factory & Hooks ─────────────────────────────────────────────────────
export const UserSchema = SchemaFactory.createForClass(User);

// PRE-SAVE HOOK: Hash password before persisting.
// Using a hook here (instead of the service) keeps the invariant close to the data.
// isModified() ensures we don't re-hash an already-hashed password on other updates.
UserSchema.pre<UserDocument>('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12); // 12 rounds: good balance of security/speed
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// INSTANCE METHOD: Safer to attach this to the schema than the service,
// because it keeps the password comparison logic with the password field.
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// VIRTUAL: full name or any computed property that doesn't need to be stored.
UserSchema.virtual('isTokenExpired').get(function () {
  // Example virtual — adapt to your business logic
  return this.passwordResetExpires ? this.passwordResetExpires < new Date() : true;
});

// ── Indexes ────────────────────────────────────────────────────────────────────
// Compound and sparse indexes should be declared here, not via @Prop({ index: true })
// for anything non-trivial, because @Prop only creates single-field indexes.
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ 'refreshTokens.tokenHash': 1 }, { sparse: true });
