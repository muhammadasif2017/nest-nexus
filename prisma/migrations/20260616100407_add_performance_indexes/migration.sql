-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "RefreshToken_isRevoked_idx" ON "RefreshToken"("isRevoked");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "User_magicLinkTokenHash_idx" ON "User"("magicLinkTokenHash");

-- CreateIndex
CREATE INDEX "User_magicLinkExpiresAt_idx" ON "User"("magicLinkExpiresAt");
