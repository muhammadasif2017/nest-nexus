import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DocumentService } from './document.service';
import { DocumentOutput } from './dto/document.output';
import { CreateDocumentInput } from './dto/create-document.input';
import { UpdateDocumentInput } from './dto/update-document.input';
import { ShareDocumentDto } from './dto/share-document.dto';
import { PaginationQuery } from './dto/pagination.query';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PolicyGuard } from '../../common/guards/policy.guard';
import { RelationGuard } from '../../common/guards/relation.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Policy } from '../../common/decorators/policy.decorator';
import { RequireRelation } from '../../common/decorators/require-relation.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permission.enum';
import { Relation } from '../authorization/rebac/relation.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

// Demo resource exercising all four authz techniques. JwtAuthGuard is global, so
// every route is authenticated. The three authz guards are applied class-wide;
// each is a no-op unless its decorator is present on the route — so per-route
// decorators select which technique(s) gate that route (stacked = logical AND).
@ApiTags('documents')
@ApiBearerAuth('access-token')
@Controller('documents')
@UseGuards(PermissionsGuard, RelationGuard, PolicyGuard)
export class DocumentController {
  constructor(private readonly documents: DocumentService) {}

  // Scopes: needs document:write to create. Caller becomes owner.
  @Post()
  @RequirePermission(Permission.DOCUMENT_WRITE)
  @ApiOperation({ summary: 'Create a document (scope: document:write)' })
  @ApiResponse({ status: 201, type: DocumentOutput })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() input: CreateDocumentInput,
  ): Promise<DocumentOutput> {
    return this.documents.create(user, input);
  }

  // Scopes + object-level filter: returns only documents can() permits reading.
  @Get()
  @RequirePermission(Permission.DOCUMENT_READ)
  @ApiOperation({ summary: 'List readable documents (scope + per-row authz filter)' })
  @ApiResponse({ status: 200, type: [DocumentOutput] })
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: PaginationQuery,
  ): Promise<DocumentOutput[]> {
    return this.documents.findAll(user, query);
  }

  // Composed read decision (read:any | ABAC visibility | ReBAC viewer) in can().
  @Get(':id')
  @RequirePermission(Permission.DOCUMENT_READ)
  @ApiOperation({ summary: 'Read one document (composed authz decision)' })
  @ApiResponse({ status: 200, type: DocumentOutput })
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<DocumentOutput> {
    return this.documents.findOne(user, id);
  }

  // ABAC demo: gated purely by the document.read visibility policy (no ReBAC).
  @Get(':id/preview')
  @RequirePermission(Permission.DOCUMENT_READ)
  @Policy('document.read')
  @ApiOperation({ summary: 'Preview a document (ABAC visibility policy)' })
  @ApiResponse({ status: 200, type: DocumentOutput })
  preview(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<DocumentOutput> {
    return this.documents.findOne(user, id);
  }

  // ReBAC demo: requires editor (or owner via implication) + write scope.
  @Patch(':id')
  @RequirePermission(Permission.DOCUMENT_WRITE)
  @RequireRelation(Relation.EDITOR, 'document')
  @ApiOperation({ summary: 'Update a document (scope + ReBAC editor relation)' })
  @ApiResponse({ status: 200, type: DocumentOutput })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() input: UpdateDocumentInput,
  ): Promise<DocumentOutput> {
    return this.documents.update(user, id, input);
  }

  // ReBAC demo: requires owner relation + delete scope.
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(Permission.DOCUMENT_DELETE)
  @RequireRelation(Relation.OWNER, 'document')
  @ApiOperation({ summary: 'Delete a document (scope + ReBAC owner relation)' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  remove(@Param('id') id: string): Promise<void> {
    return this.documents.remove(id);
  }

  // ReBAC management: only the owner can share (grant a relation to another user).
  @Post(':id/share')
  @HttpCode(204)
  @RequireRelation(Relation.OWNER, 'document')
  @ApiOperation({ summary: 'Share a document — grant a relation (owner only)' })
  @ApiResponse({ status: 204, description: 'Relation granted.' })
  share(@Param('id') id: string, @Body() dto: ShareDocumentDto): Promise<void> {
    return this.documents.share(id, dto);
  }

  @Delete(':id/share')
  @HttpCode(204)
  @RequireRelation(Relation.OWNER, 'document')
  @ApiOperation({ summary: 'Unshare a document — revoke a relation (owner only)' })
  @ApiResponse({ status: 204, description: 'Relation revoked.' })
  unshare(@Param('id') id: string, @Body() dto: ShareDocumentDto): Promise<void> {
    return this.documents.unshare(id, dto);
  }
}
