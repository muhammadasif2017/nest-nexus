import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_2FA_KEY = 'allowPending2fa';

// Routes decorated with @AllowPending2FA() accept tokens with scope='two_factor_pending'.
// JwtAuthGuard reads this metadata before rejecting incomplete 2FA sessions.
// Without this decorator, a pending-2FA token is treated as unauthorized.
export const AllowPending2FA = () => SetMetadata(ALLOW_PENDING_2FA_KEY, true);
