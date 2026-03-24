import { SetMetadata } from '@nestjs/common';

// When JwtAuthGuard is applied globally, every route requires authentication.
// @Public() is the "opt-out" escape hatch — it marks routes that anyone can call.
// The JwtAuthGuard checks for this metadata before doing anything else.
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);