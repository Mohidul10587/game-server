-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateTable: pools
CREATE TABLE "pools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "poolAmountPerCycle" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable: user_pool_allocations
CREATE TABLE "user_pool_allocations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "powerPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pool_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: mining_rooms
CREATE TABLE "mining_rooms" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalSlots" INTEGER NOT NULL DEFAULT 9,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mining_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable: miner_slots
CREATE TABLE "miner_slots" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "userMinerId" TEXT,
    "placedAt" TIMESTAMP(3),

    CONSTRAINT "miner_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable: deposit_addresses
CREATE TABLE "deposit_addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable: deposits
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "depositAddressId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "txHash" TEXT,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique pool name and currency
CREATE UNIQUE INDEX "pools_name_key" ON "pools"("name");
CREATE UNIQUE INDEX "pools_currency_key" ON "pools"("currency");

-- CreateIndex: Unique user+pool allocation
CREATE UNIQUE INDEX "user_pool_allocations_userId_poolId_key" ON "user_pool_allocations"("userId", "poolId");

-- CreateIndex: Unique room per user
CREATE UNIQUE INDEX "mining_rooms_userId_key" ON "mining_rooms"("userId");

-- CreateIndex: Unique slot per room
CREATE UNIQUE INDEX "miner_slots_roomId_slotIndex_key" ON "miner_slots"("roomId", "slotIndex");
CREATE UNIQUE INDEX "miner_slots_userMinerId_key" ON "miner_slots"("userMinerId");

-- CreateIndex: Unique deposit address
CREATE UNIQUE INDEX "deposit_addresses_address_key" ON "deposit_addresses"("address");
CREATE UNIQUE INDEX "deposit_addresses_userId_currency_key" ON "deposit_addresses"("userId", "currency");

-- CreateIndex: Unique tx hash
CREATE UNIQUE INDEX "deposits_txHash_key" ON "deposits"("txHash");

-- AddForeignKey: user_pool_allocations → users
ALTER TABLE "user_pool_allocations" ADD CONSTRAINT "user_pool_allocations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: user_pool_allocations → pools
ALTER TABLE "user_pool_allocations" ADD CONSTRAINT "user_pool_allocations_poolId_fkey"
    FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: mining_rooms → users
ALTER TABLE "mining_rooms" ADD CONSTRAINT "mining_rooms_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: miner_slots → mining_rooms
ALTER TABLE "miner_slots" ADD CONSTRAINT "miner_slots_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "mining_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: miner_slots → user_miners
ALTER TABLE "miner_slots" ADD CONSTRAINT "miner_slots_userMinerId_fkey"
    FOREIGN KEY ("userMinerId") REFERENCES "user_miners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: deposit_addresses → users
ALTER TABLE "deposit_addresses" ADD CONSTRAINT "deposit_addresses_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: deposits → deposit_addresses
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_depositAddressId_fkey"
    FOREIGN KEY ("depositAddressId") REFERENCES "deposit_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: deposits → users
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
