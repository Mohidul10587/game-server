import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // ─────────────────────────────────────────
  // MINERS
  // ─────────────────────────────────────────
  const miners = [
    {
      name: 'Basic Miner',
      description: 'An entry-level miner with solid hash rate. Perfect for beginners.',
      rarity: 'COMMON' as const,
      basePower: 500,
      miningPower: 500,
      price: 500,
      imageUrl: '/assets/miners/miner-basic.svg',
      minerType: 'basic',
      isActive: true,
    },
    {
      name: 'Advanced Miner',
      description: 'A high-performance miner with improved cooling and hash rate.',
      rarity: 'RARE' as const,
      basePower: 2000,
      miningPower: 2000,
      price: 2000,
      imageUrl: '/assets/miners/miner-advanced.svg',
      minerType: 'advanced',
      isActive: true,
    },
    {
      name: 'Premium Miner',
      description: 'The ultimate mining machine with premium hardware and LED design.',
      rarity: 'EPIC' as const,
      basePower: 10000,
      miningPower: 10000,
      price: 8000,
      imageUrl: '/assets/miners/miner-premium.svg',
      minerType: 'premium',
      isActive: true,
    },
    {
      name: 'Legendary Miner',
      description: 'Legendary performance. Exclusive hardware for elite miners.',
      rarity: 'LEGENDARY' as const,
      basePower: 50000,
      miningPower: 50000,
      price: 30000,
      imageUrl: '/assets/miners/miner-premium.svg',
      minerType: 'premium',
      isActive: true,
    },
  ];

  for (const miner of miners) {
    const existing = await prisma.miner.findFirst({ where: { name: miner.name } });
    if (existing) {
      await prisma.miner.update({ where: { id: existing.id }, data: miner });
    } else {
      await prisma.miner.create({ data: miner });
    }
  }
  console.log(`✅ Seeded ${miners.length} miners`);

  // ─────────────────────────────────────────
  // RACK PRODUCTS
  // ─────────────────────────────────────────
  const racks = [
    {
      name: 'Basic Rack',
      description: 'A standard 4-slot mining rack. Great for getting started.',
      imageUrl: '/assets/racks/rack-basic.svg',
      price: 1000,
      minerCapacity: 4,
      rackType: 'basic',
      isActive: true,
    },
    {
      name: 'Standard Rack',
      description: 'An upgraded 6-slot rack with better ventilation.',
      imageUrl: '/assets/racks/rack-basic.svg',
      price: 2500,
      minerCapacity: 6,
      rackType: 'standard',
      isActive: true,
    },
    {
      name: 'Pro Rack',
      description: 'Professional 8-slot rack for serious miners.',
      imageUrl: '/assets/racks/rack-basic.svg',
      price: 6000,
      minerCapacity: 8,
      rackType: 'pro',
      isActive: true,
    },
  ];

  for (const rack of racks) {
    const existing = await prisma.rackProduct.findFirst({ where: { name: rack.name } });
    if (existing) {
      await prisma.rackProduct.update({ where: { id: existing.id }, data: rack });
    } else {
      await prisma.rackProduct.create({ data: rack });
    }
  }
  console.log(`✅ Seeded ${racks.length} rack products`);

  // ─────────────────────────────────────────
  // ROOM CONFIG
  // ─────────────────────────────────────────
  const roomConfigs = [
    { roomNumber: 1, unlockCost: 0,     name: 'Room 01', isActive: true },
    { roomNumber: 2, unlockCost: 5000,  name: 'Room 02', isActive: true },
    { roomNumber: 3, unlockCost: 15000, name: 'Room 03', isActive: true },
    { roomNumber: 4, unlockCost: 30000, name: 'Room 04', isActive: true },
  ];

  for (const cfg of roomConfigs) {
    await prisma.roomConfig.upsert({
      where: { roomNumber: cfg.roomNumber },
      update: { unlockCost: cfg.unlockCost, name: cfg.name },
      create: cfg,
    });
  }
  console.log(`✅ Seeded room configs (4 rooms)`);

  // ─────────────────────────────────────────
  // QUESTS
  // ─────────────────────────────────────────
  const quests = [
    { title: 'Daily Login',       description: 'Log in to BanglaMiners today',         type: 'DAILY'  as const, requiredAction: 'LOGIN',      targetValue: 1,  rewardType: 'COIN' as const, rewardAmount: 100,  isActive: true },
    { title: 'Play 3 Games',      description: 'Play any 3 mining games today',         type: 'DAILY'  as const, requiredAction: 'PLAY_GAME',  targetValue: 3,  rewardType: 'COIN' as const, rewardAmount: 300,  isActive: true },
    { title: 'Buy a Miner',       description: 'Purchase a miner from the shop today',  type: 'DAILY'  as const, requiredAction: 'BUY_MINER',  targetValue: 1,  rewardType: 'COIN' as const, rewardAmount: 200,  isActive: true },
    { title: 'Weekly Grinder',    description: 'Play 20 mining games this week',        type: 'WEEKLY' as const, requiredAction: 'PLAY_GAME',  targetValue: 20, rewardType: 'COIN' as const, rewardAmount: 2000, isActive: true },
    { title: 'Referral Champion', description: 'Refer 3 new players this week',         type: 'WEEKLY' as const, requiredAction: 'REFER_USER', targetValue: 3,  rewardType: 'COIN' as const, rewardAmount: 1500, isActive: true },
  ];

  for (const quest of quests) {
    const existing = await prisma.quest.findFirst({ where: { title: quest.title, type: quest.type } });
    if (!existing) {
      await prisma.quest.create({ data: quest });
    } else {
      await prisma.quest.update({ where: { id: existing.id }, data: quest });
    }
  }
  console.log(`✅ Seeded ${quests.length} quests`);

  // ─────────────────────────────────────────
  // REWARD CONFIG
  // ─────────────────────────────────────────
  const existingConfig = await prisma.rewardConfig.findFirst();
  if (!existingConfig) {
    await prisma.rewardConfig.create({ data: { poolAmountPerCycle: 50000, cycleMinutes: 10 } });
    console.log('✅ Seeded reward config: 50000 satoshi / 10 min');
  } else {
    console.log('ℹ️  Reward config already exists, skipping');
  }

  // ─────────────────────────────────────────
  // MINING POOLS
  // ─────────────────────────────────────────
  const pools = [
    { name: 'BTC Pool', currency: 'BTC', poolAmountPerCycle: 0.0005, isActive: true },
    { name: 'ETH Pool', currency: 'ETH', poolAmountPerCycle: 0.005,  isActive: true },
    { name: 'SOL Pool', currency: 'SOL', poolAmountPerCycle: 0.1,    isActive: true },
  ];

  for (const pool of pools) {
    await prisma.pool.upsert({
      where: { currency: pool.currency },
      update: { poolAmountPerCycle: pool.poolAmountPerCycle, isActive: pool.isActive },
      create: pool,
    });
  }
  console.log(`✅ Seeded ${pools.length} mining pools (BTC, ETH, SOL)`);

  // ─────────────────────────────────────────
  // ADMIN USER
  // ─────────────────────────────────────────
  const adminEmail    = 'admin@banglaminers.com';
  const adminUsername = 'admin';
  const adminPassword = 'Admin@1234';

  const existingAdmin = await prisma.user.findFirst({
    where: { OR: [{ email: adminEmail }, { username: adminUsername }] },
  });

  if (!existingAdmin) {
    const passwordHash  = await bcrypt.hash(adminPassword, 12);
    const referralCode  = uuidv4().replace(/-/g, '').substring(0, 10).toUpperCase();

    const admin = await prisma.user.create({
      data: {
        username: adminUsername,
        email: adminEmail,
        passwordHash,
        role: 'ADMIN',
        referralCode,
        miningPower: { create: { temporaryPower: 0, permanentPower: 0 } },
        coinBalance: { create: { amount: 0 } },
      },
    });

    await prisma.cryptoBalance.create({ data: { userId: admin.id, currency: 'BTC', amount: 0 } });

    console.log('✅ Admin user created');
    console.log('   📧 Email   :', adminEmail);
    console.log('   🔑 Password:', adminPassword);
    console.log('   ⚠️  Change the password after first login!');
  } else {
    if (existingAdmin.role !== 'ADMIN') {
      await prisma.user.update({ where: { id: existingAdmin.id }, data: { role: 'ADMIN' } });
      console.log('✅ Promoted existing user to ADMIN:', existingAdmin.email);
    } else {
      console.log('ℹ️  Admin user already exists:', existingAdmin.email);
    }
  }

  console.log('🎉 Seed complete!');
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
