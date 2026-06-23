import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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

  // List is object-level filtered: return only documents the user can read. The
  // route scope guard already enforced the document:read permission.
  async findAll(user: AuthSubject): Promise<DocumentOutput[]> {
    const docs = await this.prisma.document.findMany();
    const readable: typeof docs = [];
    for (const doc of docs) {
      if (await this.authz.can(user, Permission.DOCUMENT_READ, this.asResource(doc))) {
        readable.push(doc);
      }
    }
    return readable.map((d) => this.toOutput(d));
  }

  // Single read: composed decision (read:any scope | ABAC visibility | viewer
  // relation) lives in can(), which a stacked-AND route guard cannot express.
  async findOne(user: AuthSubject, id: string): Promise<DocumentOutput> {
    const doc = await this.getOrThrow(id);
    if (!(await this.authz.can(user, Permission.DOCUMENT_READ, this.asResource(doc)))) {
      throw new ForbiddenException('Not allowed to read this document.');
    }
    return this.toOutput(doc);
  }

  // Update/delete are gated at the route by scope + ReBAC relation guards, so the
  // service only performs the mutation (NotFound mapped from P2025).
  async update(id: string, dto: UpdateDocumentInput): Promise<DocumentOutput> {
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

  async share(id: string, dto: ShareDocumentDto): Promise<void> {
    await this.getOrThrow(id);
    await this.relation.grant(dto.subjectId, dto.relation, DOCUMENT, id);
  }

  async unshare(id: string, dto: ShareDocumentDto): Promise<void> {
    await this.relation.revoke(dto.subjectId, dto.relation, DOCUMENT, id);
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
