-- Read-path indexes for current filters and sort orders.
CREATE INDEX "users_createdAt_idx"
  ON "users"("createdAt" DESC);

CREATE INDEX "mining_power_leaderboard_idx"
  ON "mining_power"("permanentPower" DESC, "temporaryPower" DESC);

CREATE INDEX "game_sessions_userId_status_idx"
  ON "game_sessions"("userId", "status");
CREATE INDEX "game_sessions_userId_createdAt_idx"
  ON "game_sessions"("userId", "createdAt" DESC);

CREATE INDEX "user_miners_userId_isActive_idx"
  ON "user_miners"("userId", "isActive");
CREATE INDEX "user_miners_userId_acquiredAt_idx"
  ON "user_miners"("userId", "acquiredAt" DESC);

CREATE INDEX "marketplace_listings_status_createdAt_idx"
  ON "marketplace_listings"("status", "createdAt" DESC);
CREATE INDEX "marketplace_listings_userMinerId_status_idx"
  ON "marketplace_listings"("userMinerId", "status");

CREATE INDEX "reward_history_userId_distributedAt_idx"
  ON "reward_history"("userId", "distributedAt" DESC);

CREATE INDEX "withdrawals_status_createdAt_idx"
  ON "withdrawals"("status", "createdAt");
CREATE INDEX "withdrawals_userId_status_idx"
  ON "withdrawals"("userId", "status");

CREATE INDEX "referrals_referrerId_createdAt_idx"
  ON "referrals"("referrerId", "createdAt" DESC);

CREATE INDEX "user_rack_inventory_userId_acquiredAt_idx"
  ON "user_rack_inventory"("userId", "acquiredAt" DESC);

CREATE INDEX "deposits_userId_createdAt_idx"
  ON "deposits"("userId", "createdAt" DESC);
