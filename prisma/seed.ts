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
      description: 'A simple entry-level miner. Perfect for beginners.',
      rarity: 'COMMON' as const,
      basePower: 500,
      price: 500,
      imageUrl: '/images/miners/basic.png',
      isActive: true,
    },
    {
      name: 'Silver Miner',
      description: 'An upgraded miner with better hash rate.',
      rarity: 'RARE' as const,
      basePower: 2000,
      price: 2000,
      imageUrl: '/images/miners/silver.png',
      isActive: true,
    },
    {
      name: 'Gold Miner',
      description: 'A high-performance miner with exceptional hash rate.',
      rarity: 'EPIC' as const,
      basePower: 10000,
      price: 8000,
      imageUrl: '/images/miners/gold.png',
      isActive: true,
    },
    {
      name: 'Diamond Miner',
      description: 'The ultimate mining machine. Legendary performance.',
      rarity: 'LEGENDARY' as const,
      basePower: 50000,
      price: 30000,
      imageUrl: '/images/miners/diamond.png',
      isActive: true,
    },
  ];

  for (const miner of miners) {
    await prisma.miner.upsert({
      where: { id: await getMinerIdByName(miner.name) },
      update: miner,
      create: miner,
    });
  }
  console.log(`✅ Seeded ${miners.length} miners`);

  // ─────────────────────────────────────────
  // QUESTS
  // ─────────────────────────────────────────
  const quests = [
    // Daily quests
    {
      title: 'Daily Login',
      description: 'Log in to BanglaMiners today',
      type: 'DAILY' as const,
      requiredAction: 'LOGIN',
      targetValue: 1,
      rewardType: 'COIN' as const,
      rewardAmount: 100,
      isActive: true,
    },
    {
      title: 'Play 3 Games',
      description: 'Play any 3 mining games today',
      type: 'DAILY' as const,
      requiredAction: 'PLAY_GAME',
      targetValue: 3,
      rewardType: 'COIN' as const,
      rewardAmount: 300,
      isActive: true,
    },
    {
      title: 'Buy a Miner',
      description: 'Purchase a miner from the shop today',
      type: 'DAILY' as const,
      requiredAction: 'BUY_MINER',
      targetValue: 1,
      rewardType: 'COIN' as const,
      rewardAmount: 200,
      isActive: true,
    },
    // Weekly quests
    {
      title: 'Weekly Grinder',
      description: 'Play 20 mining games this week',
      type: 'WEEKLY' as const,
      requiredAction: 'PLAY_GAME',
      targetValue: 20,
      rewardType: 'COIN' as const,
      rewardAmount: 2000,
      isActive: true,
    },
    {
      title: 'Referral Champion',
      description: 'Refer 3 new players this week',
      type: 'WEEKLY' as const,
      requiredAction: 'REFER_USER',
      targetValue: 3,
      rewardType: 'COIN' as const,
      rewardAmount: 1500,
      isActive: true,
    },
  ];

  for (const quest of quests) {
    const existing = await prisma.quest.findFirst({
      where: { title: quest.title, type: quest.type },
    });

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
    await prisma.rewardConfig.create({
      data: {
        poolAmountPerCycle: 50000, // 50,000 satoshi per 10-minute cycle
        cycleMinutes: 10,
      },
    });
    console.log('✅ Seeded reward config: 50000 satoshi / 10 min');
  } else {
    console.log('ℹ️  Reward config already exists, skipping');
  }

  // ─────────────────────────────────────────
  // ADMIN USER
  // ─────────────────────────────────────────
  const adminEmail = 'admin@banglaminers.com';
  const adminUsername = 'admin';
  const adminPassword = 'Admin@1234'; // Change this after first login!

  const existingAdmin = await prisma.user.findFirst({
    where: { OR: [{ email: adminEmail }, { username: adminUsername }] },
  });

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const referralCode = uuidv4().replace(/-/g, '').substring(0, 10).toUpperCase();

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

    await prisma.cryptoBalance.create({
      data: { userId: admin.id, currency: 'BTC', amount: 0 },
    });

    console.log('✅ Admin user created');
    console.log('   📧 Email   :', adminEmail);
    console.log('   🔑 Password:', adminPassword);
    console.log('   ⚠️  Change the password after first login!');
  } else {
    // Ensure existing admin has ADMIN role (in case role was downgraded)
    if (existingAdmin.role !== 'ADMIN') {
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { role: 'ADMIN' },
      });
      console.log('✅ Promoted existing user to ADMIN:', existingAdmin.email);
    } else {
      console.log('ℹ️  Admin user already exists:', existingAdmin.email);
    }
  }

  console.log('🎉 Seed complete!');
}

async function getMinerIdByName(name: string): Promise<string> {
  const miner = await prisma.miner.findFirst({ where: { name } });
  // If miner doesn't exist yet, return a non-matching ID so upsert creates it
  return miner?.id ?? 'new-miner-placeholder';
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
