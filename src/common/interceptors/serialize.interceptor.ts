import {
  UseInterceptors, NestInterceptor, ExecutionContext,
  CallHandler, Injectable,
} from '@nestjs/common';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { Observable, map } from 'rxjs';

// A factory interceptor: @Serialize(UserOutput) wraps any controller method
// or resolver and transforms the return value through class-transformer.
// This is the explicit alternative to the global ClassSerializerInterceptor.
// Use this when specific routes need a different output shape than the default.
@Injectable()
export class SerializeInterceptor<T> implements NestInterceptor {
  constructor(private readonly dto: ClassConstructor<T>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        // plainToInstance converts a plain object (or Mongoose document) into
        // a DTO class instance, which class-transformer's @Expose/@Exclude then
        // operates on. Without this step, decorators on the DTO are ignored.
        return plainToInstance(this.dto, data, {
          // excludeExtraneousValues: true enforces the @Expose() whitelist —
          // ONLY fields decorated with @Expose() will appear in the output.
          // This is the secure default.
          excludeExtraneousValues: true,
        });
      }),
    );
  }
}

// Convenience decorator — use as @Serialize(UserOutput) on any handler.
export function Serialize<T>(dto: ClassConstructor<T>) {
  return UseInterceptors(new SerializeInterceptor(dto));
}