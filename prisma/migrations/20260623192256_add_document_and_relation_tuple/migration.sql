-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationTuple" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationTuple_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_ownerId_idx" ON "Document"("ownerId");

-- CreateIndex
CREATE INDEX "RelationTuple_objectType_objectId_relation_idx" ON "RelationTuple"("objectType", "objectId", "relation");

-- CreateIndex
CREATE INDEX "RelationTuple_subjectType_subjectId_idx" ON "RelationTuple"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "RelationTuple_subjectType_subjectId_relation_objectType_obj_key" ON "RelationTuple"("subjectType", "subjectId", "relation", "objectType", "objectId");
