import { Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { RelationService } from './rebac/relation.service';

// Exports the authorization decision layer so feature modules (e.g. DocumentModule)
// can import it and wire the authz guards, which resolve these services from
// the consuming module's DI context.
@Module({
  providers: [AuthorizationService, RelationService],
  exports: [AuthorizationService, RelationService],
})
export class AuthorizationModule {}
