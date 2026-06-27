import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { GoogleOAuthCallbackGuard, GoogleOAuthInitGuard } from './oauth-csrf.guard';

type GuardInstance = InstanceType<typeof GoogleOAuthCallbackGuard>;

function makeCallbackCtx(cookieState: string | undefined, queryState: string | undefined) {
  const cookies = cookieState !== undefined ? { oauth_state: cookieState } : {};
  const query = queryState !== undefined ? { state: queryState } : {};
  const mockRes = { clearCookie: jest.fn() };
  return {
    ctx: {
      switchToHttp: () => ({
        getRequest: () => ({ cookies, query }),
        getResponse: () => mockRes,
      }),
    } as unknown as ExecutionContext,
    mockRes,
  };
}

function makeCallbackGuard(): GuardInstance {
  const guard = new (GoogleOAuthCallbackGuard as any)() as GuardInstance;
  // Stub super.canActivate — it lives on MixinAuthGuard.prototype (two levels up)
  jest
    .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)) as GuardInstance, 'canActivate')
    .mockResolvedValue(true);
  return guard;
}

describe('OAuthCallbackGuard — CSRF state validation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('always clears the state cookie before validating', () => {
    const guard = makeCallbackGuard();
    const { ctx, mockRes } = makeCallbackCtx(undefined, undefined);
    try {
      guard.canActivate(ctx);
    } catch {
      /* expected */
    }
    expect(mockRes.clearCookie).toHaveBeenCalledWith('oauth_state', { path: '/' });
  });

  it('throws when oauth_state cookie is absent', () => {
    const guard = makeCallbackGuard();
    const { ctx } = makeCallbackCtx(undefined, 'somestate');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws when query state is absent', () => {
    const guard = makeCallbackGuard();
    const { ctx } = makeCallbackCtx('somestate', undefined);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws when cookie and query lengths differ', () => {
    const guard = makeCallbackGuard();
    const { ctx } = makeCallbackCtx('short', 'longer-value-here');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws when values are same length but do not match', () => {
    const guard = makeCallbackGuard();
    const { ctx } = makeCallbackCtx('aaa', 'bbb');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('calls super.canActivate when state matches', async () => {
    const guard = makeCallbackGuard();
    const state = crypto.randomBytes(32).toString('hex');
    const { ctx } = makeCallbackCtx(state, state);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

describe('OAuthInitGuard — state nonce cookie', () => {
  function makeInitGuard() {
    const guard = new (GoogleOAuthInitGuard as any)();
    (guard as any).config = { get: jest.fn().mockReturnValue('test') };
    return guard;
  }

  function makeInitCtx() {
    const mockRes = { cookie: jest.fn() };
    return {
      ctx: {
        switchToHttp: () => ({
          getRequest: () => ({}),
          getResponse: () => mockRes,
        }),
      } as unknown as ExecutionContext,
      mockRes,
    };
  }

  it('sets an HttpOnly SameSite=lax state cookie', () => {
    const guard = makeInitGuard();
    const { ctx, mockRes } = makeInitCtx();
    guard.getAuthenticateOptions(ctx);
    expect(mockRes.cookie).toHaveBeenCalledWith(
      'oauth_state',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('returns { state } equal to the cookie value', () => {
    const guard = makeInitGuard();
    const { ctx, mockRes } = makeInitCtx();
    const options = guard.getAuthenticateOptions(ctx) as { state: string };
    const cookieValue = (mockRes.cookie.mock.calls[0] as unknown[])[1] as string;
    expect(options.state).toBe(cookieValue);
  });

  it('generates a 64-char hex nonce (256-bit entropy)', () => {
    const guard = makeInitGuard();
    const { ctx } = makeInitCtx();
    const options = guard.getAuthenticateOptions(ctx) as { state: string };
    expect(options.state).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates a unique nonce on every call', () => {
    const guard = makeInitGuard();
    const { ctx: ctx1 } = makeInitCtx();
    const { ctx: ctx2 } = makeInitCtx();
    const a = (guard.getAuthenticateOptions(ctx1) as { state: string }).state;
    const b = (guard.getAuthenticateOptions(ctx2) as { state: string }).state;
    expect(a).not.toBe(b);
  });
});
