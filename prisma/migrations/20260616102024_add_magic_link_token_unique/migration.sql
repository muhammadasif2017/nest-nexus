/*
  Warnings:

  - A unique constraint covering the columns `[magicLinkTokenHash]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "User_magicLinkTokenHash_idx";

-- CreateIndex
CREATE UNIQUE INDEX "User_magicLinkTokenHash_key" ON "User"("magicLinkTokenHash");
