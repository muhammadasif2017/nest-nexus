import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Expose, Exclude } from 'class-transformer';
import { of, firstValueFrom } from 'rxjs';
import { SerializeInterceptor } from './serialize.interceptor';

// ── Test DTOs ────────────────────────────────────────────────────────────────

@Exclude()
class UserOutput {
  @Expose() id!: string;
  @Expose() email!: string;
  // password intentionally has no @Expose() — must be stripped
  password!: string;
  // refreshTokens intentionally has no @Expose() — must be stripped
  refreshTokens!: string[];
}

@Exclude()
class ProfileOutput {
  @Expose() username!: string;
  @Expose() bio!: string;
  internalNotes!: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockCallHandler = (data: unknown): CallHandler => ({
  handle: () => of(data),
});

const mockContext = {} as ExecutionContext;

const intercept = async <T>(dto: new () => T, data: unknown): Promise<T> => {
  const interceptor = new SerializeInterceptor(dto);
  const result$ = interceptor.intercept(mockContext, mockCallHandler(data));
  return firstValueFrom(result$);
};

// ─────────────────────────────────────────────────────────────────────────────

describe('SerializeInterceptor', () => {
  describe('field exposure', () => {
    it('includes fields decorated with @Expose()', async () => {
      const data = { id: '1', email: 'a@test.com', password: 'secret' };
      const result = await intercept(UserOutput, data);

      expect(result).toMatchObject({ id: '1', email: 'a@test.com' });
    });

    it('strips fields without @Expose()', async () => {
      const data = { id: '1', email: 'a@test.com', password: 'secret' };
      const result = (await intercept(UserOutput, data)) as any;

      expect(result.password).toBeUndefined();
    });

    it('strips refreshTokens (sensitive field without @Expose())', async () => {
      const data = {
        id: '1',
        email: 'a@test.com',
        password: 'hash',
        refreshTokens: ['token1', 'token2'],
      };
      const result = (await intercept(UserOutput, data)) as any;

      expect(result.refreshTokens).toBeUndefined();
    });

    it('strips extra fields not present in DTO at all', async () => {
      const data = { id: '1', email: 'a@test.com', unknownField: 'value' };
      const result = (await intercept(UserOutput, data)) as any;

      expect(result.unknownField).toBeUndefined();
    });
  });

  describe('output shape', () => {
    it('returns only the @Expose() fields — no extras', async () => {
      const data = {
        id: '42',
        email: 'b@test.com',
        password: 'hash',
        refreshTokens: [],
        __v: 0,
        _id: 'mongo-id',
      };
      const result = await intercept(UserOutput, data);

      expect(Object.keys(result as object).sort()).toEqual(['email', 'id'].sort());
    });

    it('works with a different DTO shape', async () => {
      const data = {
        username: 'alice',
        bio: 'developer',
        internalNotes: 'flagged user',
      };
      const result = (await intercept(ProfileOutput, data)) as any;

      expect(result.username).toBe('alice');
      expect(result.bio).toBe('developer');
      expect(result.internalNotes).toBeUndefined();
    });
  });

  describe('data types', () => {
    it('handles plain object input', async () => {
      const data = { id: '1', email: 'c@test.com' };
      const result = await intercept(UserOutput, data);

      expect((result as any).id).toBe('1');
    });

    it('handles class instance input (strips non-exposed fields)', async () => {
      const instance = new UserOutput();
      instance.id = '99';
      instance.email = 'd@test.com';
      instance.password = 'should-be-stripped';

      const result = (await intercept(UserOutput, instance)) as any;

      expect(result.id).toBe('99');
      expect(result.password).toBeUndefined();
    });

    it('handles array of objects — strips each element', async () => {
      const data = [
        { id: '1', email: 'x@test.com', password: 'p1' },
        { id: '2', email: 'y@test.com', password: 'p2' },
      ];
      const result = (await intercept(UserOutput, data)) as unknown as any[];

      expect(result).toHaveLength(2);
      expect(result[0].password).toBeUndefined();
      expect(result[1].password).toBeUndefined();
      expect(result[0].email).toBe('x@test.com');
    });

    it('handles null data without throwing', async () => {
      const result = await intercept(UserOutput, null);
      expect(result).toBeNull();
    });

    it('handles undefined data without throwing', async () => {
      const result = await intercept(UserOutput, undefined);
      expect(result).toBeUndefined();
    });
  });

  describe('observable pipeline', () => {
    it('returns an Observable', () => {
      const interceptor = new SerializeInterceptor(UserOutput);
      const result$ = interceptor.intercept(
        mockContext,
        mockCallHandler({ id: '1', email: 'e@test.com' }),
      );

      expect(result$).toBeDefined();
      expect(typeof result$.pipe).toBe('function');
    });

    it('calls next.handle() exactly once', async () => {
      const interceptor = new SerializeInterceptor(UserOutput);
      const handler = mockCallHandler({ id: '1', email: 'f@test.com' });
      const handleSpy = jest.spyOn(handler, 'handle');

      await firstValueFrom(interceptor.intercept(mockContext, handler));

      expect(handleSpy).toHaveBeenCalledTimes(1);
    });
  });
});
