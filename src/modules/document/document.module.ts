import { Module } from '@nestjs/common';
import { DocumentService } from './document.service';
import { DocumentController } from './document.controller';
import { AuthorizationModule } from '../authorization/authorization.module';

// Imports AuthorizationModule so the class-level authz guards (PermissionsGuard,
// PolicyGuard, RelationGuard) can resolve AuthorizationService / RelationService
// from this module's DI context.
@Module({
  imports: [AuthorizationModule],
  controllers: [DocumentController],
  providers: [DocumentService],
})
export class DocumentModule {}
