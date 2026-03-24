import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Role } from '../../../common/enums/role.enum';

// HydratedDocument gives you the full Mongoose Document type with your data shape.
// Use this as the return type in your service methods.
export type UserDocument = HydratedDocument<User>;

// ── Subdocument: Refresh Token Rotation ───────────────────────────────────────
// We store hashed refresh tokens to support token rotation and revocation.
// If a stolen token is used, the legitimate user's next request will fail,
// alerting you to a potential account compromise.
@Schema({ _id: false }) // No separate _id for embedded sub-documents
export class RefreshToken {
  @Prop({ required: true })
  tokenHash!: string; // bcrypt hash, never store raw tokens

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ default: false })
  isRevoked!: boolean;
}

// ── Main User Schema ───────────────────────────────────────────────────────────
@Schema({
  timestamps: true,        // Mongoose auto-manages createdAt + updatedAt
  versionKey: false,       // Removes the __v field from documents
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
    lowercase: true,    // Normalize email before saving
    trim: true,
    index: true,        // Explicitly declare index — don't rely on autoIndex in prod
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
UserSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// VIRTUAL: full name or any computed property that doesn't need to be stored.
UserSchema.virtual('isTokenExpired').get(function () {
  // Example virtual — adapt to your business logic
  return this.passwordResetExpires
    ? this.passwordResetExpires < new Date()
    : true;
});

// ── Indexes ────────────────────────────────────────────────────────────────────
// Compound and sparse indexes should be declared here, not via @Prop({ index: true })
// for anything non-trivial, because @Prop only creates single-field indexes.
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ 'refreshTokens.tokenHash': 1 }, { sparse: true });