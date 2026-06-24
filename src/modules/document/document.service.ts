import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  AuthorizationService,
  AuthSubject,
  DocumentResource,
} from '../authorization/authorization.service';
import { RelationService, Relation } from '../authorization/rebac/relation.service';
import { Permission } from '../../common/enums/permission.enum';
import { CreateDocumentInput } from './dto/create-document.input';
import { UpdateDocumentInput } from './dto/update-document.input';
import { DocumentOutput } from './dto/document.output';
import { ShareDocumentDto } from './dto/share-document.dto';
import { PaginationQuery } from './dto/pagination.query';

const DOCUMENT = 'document';

@Injectable()
export class DocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly relation: RelationService,
  ) {}

  // Create → caller is the owner. Persist ownerId and seed the owner ReBAC tuple
  // so relation-based checks (and implication to editor/viewer) work immediately.
  async create(user: AuthSubject, dto: CreateDocumentInput): Promise<DocumentOutput> {
    const doc = await this.prisma.document.create({
      data: {
        title: dto.title,
        body: dto.body,
        visibility: dto.visibility ?? 'private',
        ownerId: user.sub,
      },
    });
    await this.relation.grant(user.sub, Relation.OWNER, DOCUMENT, doc.id);
    return this.toOutput(doc);
  }

  // List is object-level filtered: return only documents the user can read.
  // Paginated (bounded page) + bulk-filtered (O(1) queries, no per-row N+1). The
  // route scope guard already enforced the document:read permission.
  async findAll(user: AuthSubject, query: PaginationQuery): Promise<DocumentOutput[]> {
    const docs = await this.prisma.document.findMany({
      skip: query.skip,
      take: query.take,
      orderBy: { createdAt: 'desc' },
    });
    const readable = await this.authz.filterReadableDocuments(user, docs);
    return readable.map((d) => this.toOutput(d));
  }

  // Single read: composed decision (read:any scope | ABAC visibility | viewer
  // relation) lives in can(), which a stacked-AND route guard cannot express.
  // No-enumeration: a forbidden read returns 404 (identical to missing) so a
  // caller cannot probe which ids exist. See ADR-028.
  async findOne(user: AuthSubject, id: string): Promise<DocumentOutput> {
    const doc = await this.getOrThrow(id);
    if (!(await this.authz.can(user, Permission.DOCUMENT_READ, this.asResource(doc)))) {
      throw new NotFoundException(`Document with id ${id} not found.`);
    }
    return this.toOutput(doc);
  }

  // Update is gated at the route by scope + ReBAC editor relation. Editors may
  // change content, but only the owner (or super_admin) may change visibility —
  // visibility is an ownership-level attribute that governs who can read at all.
  async update(user: AuthSubject, id: string, dto: UpdateDocumentInput): Promise<DocumentOutput> {
    if (dto.visibility !== undefined && !this.authz.isSuperAdmin(user)) {
      const doc = await this.getOrThrow(id);
      if (doc.ownerId !== user.sub) {
        throw new ForbiddenException('Only the owner can change a document’s visibility.');
      }
    }
    const updated = await this.prisma.document
      .update({ where: { id }, data: dto })
      .catch((e) => this.rethrowNotFound(e, id));
    return this.toOutput(updated);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.document.delete({ where: { id } }).catch((e) => this.rethrowNotFound(e, id));
    // Drop dangling relation tuples for the deleted document.
    await this.prisma.relationTuple.deleteMany({
      where: { objectType: DOCUMENT, objectId: id },
    });
  }

  // Sharing grants a relation to another user. Ownership is NOT transferable via
  // share (would create co-owners / allow lockout) — only editor/viewer. The
  // grantee must be a real user.
  async share(id: string, dto: ShareDocumentDto): Promise<void> {
    this.assertShareableRelation(dto.relation);
    await this.getOrThrow(id);
    const target = await this.prisma.user.findUnique({
      where: { id: dto.subjectId },
      select: { id: true },
    });
    if (!target) throw new BadRequestException('Target user does not exist.');
    await this.relation.grant(dto.subjectId, dto.relation, DOCUMENT, id);
  }

  async unshare(id: string, dto: ShareDocumentDto): Promise<void> {
    this.assertShareableRelation(dto.relation);
    await this.relation.revoke(dto.subjectId, dto.relation, DOCUMENT, id);
  }

  private assertShareableRelation(relation: Relation): void {
    if (relation === Relation.OWNER) {
      throw new BadRequestException('Ownership cannot be granted or revoked via share.');
    }
  }

  private async getOrThrow(id: string) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`Document with id ${id} not found.`);
    return doc;
  }

  private asResource(doc: { id: string; ownerId: string; visibility: string }): DocumentResource {
    return { id: doc.id, ownerId: doc.ownerId, visibility: doc.visibility };
  }

  private toOutput(doc: object): DocumentOutput {
    return plainToInstance(DocumentOutput, doc, { excludeExtraneousValues: true });
  }

  private rethrowNotFound(e: unknown, id: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new NotFoundException(`Document with id ${id} not found.`);
    }
    throw e;
  }
}
