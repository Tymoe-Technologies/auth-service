// 一次性迁移脚本：把 order-service.merchant_online_order_configs 中的品牌字段
// (subdomain / custom_domain / theme_settings) 复制到 auth-service.Organization
//
// 只迁主店（parent_merchant_id IS NULL）的字段；分店不需要（auth 通过 parentOrgId 继承）
// 幂等：如果目标 Organization 已经有非空且与源不同的值，会跳过并警告（避免覆盖手工修改）
//
// 用法：
//   ORDER_DATABASE_URL='postgresql://user:pass@host:5432/order-service?sslmode=require' \
//     npx tsx scripts/migrate-branding-fields.ts [--dry-run]
//
// 提示：order-service .env 里 sslmode=verify-ca + sslrootcert 相对路径无法跨项目使用，
// 建议跑脚本时改用 sslmode=require（仅加密，不验证 CA），或填 cert 绝对路径

import { PrismaClient } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const orderUrl = process.env.ORDER_DATABASE_URL;
  if (!orderUrl) {
    console.error('Missing env: ORDER_DATABASE_URL');
    console.error('Hint: ORDER_DATABASE_URL=\'postgresql://user:pass@host:5432/order-service?sslmode=require\'');
    process.exit(1);
  }

  const authDb = new PrismaClient();
  const orderDb = new PrismaClient({ datasourceUrl: orderUrl });

  try {
    // 1. 读取所有主店的品牌字段
    const rows = await orderDb.$queryRawUnsafe<Array<{
      merchant_id: string;
      subdomain: string | null;
      custom_domain: string | null;
      theme_settings: any;
    }>>(`
      SELECT merchant_id, subdomain, custom_domain, theme_settings
      FROM merchant_online_order_configs
      WHERE parent_merchant_id IS NULL
    `);

    console.log(`Found ${rows.length} main-store config(s) in order-service`);
    if (rows.length === 0) {
      console.log('Nothing to migrate.');
      return;
    }

    // 2. 找出 auth-service 已存在的 Organization
    const orgIds = rows.map(r => r.merchant_id);
    const orgs = await authDb.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, orgName: true, orgType: true, subdomain: true, customDomain: true, themeSettings: true },
    });
    const orgMap = new Map(orgs.map(o => [o.id, o]));

    const missing = orgIds.filter(id => !orgMap.has(id));
    if (missing.length > 0) {
      console.warn(`⚠️  ${missing.length} merchant_id(s) in order-service have no matching Organization in auth-service:`);
      missing.forEach(id => console.warn(`  - ${id}`));
    }

    let willUpdate = 0;
    let skipped = 0;

    for (const row of rows) {
      const org = orgMap.get(row.merchant_id);
      if (!org) continue;

      if (org.orgType !== 'MAIN') {
        console.warn(`⚠️  Organization ${row.merchant_id} (${org.orgName}) is ${org.orgType}, not MAIN. Skipping.`);
        skipped++;
        continue;
      }

      // 幂等：目标字段已有非空值且与源不同 → 跳过避免覆盖手工修改
      const themeChanged = JSON.stringify(org.themeSettings ?? null) !== JSON.stringify(row.theme_settings ?? null);
      const wouldOverwrite =
        (org.subdomain && org.subdomain !== row.subdomain) ||
        (org.customDomain && org.customDomain !== row.custom_domain) ||
        (org.themeSettings && themeChanged);

      if (wouldOverwrite) {
        console.warn(`⚠️  Organization ${row.merchant_id} (${org.orgName}) already has different brand fields. Skipping.`);
        console.warn(`     existing: subdomain=${org.subdomain}, customDomain=${org.customDomain}, themeSettings=${org.themeSettings ? '(set)' : 'null'}`);
        console.warn(`     incoming: subdomain=${row.subdomain}, customDomain=${row.custom_domain}, themeSettings=${row.theme_settings ? '(set)' : 'null'}`);
        skipped++;
        continue;
      }

      const samePayload =
        org.subdomain === row.subdomain &&
        org.customDomain === row.custom_domain &&
        !themeChanged;
      if (samePayload) {
        // 已经迁过了（值一致），无需再 update
        continue;
      }

      console.log(`${DRY_RUN ? '[dry-run] ' : ''}Update ${org.orgName} (${row.merchant_id}): subdomain=${row.subdomain}, customDomain=${row.custom_domain}, themeSettings=${row.theme_settings ? '(set)' : 'null'}`);

      if (!DRY_RUN) {
        await authDb.organization.update({
          where: { id: row.merchant_id },
          data: {
            subdomain: row.subdomain,
            customDomain: row.custom_domain,
            themeSettings: row.theme_settings,
          },
        });
      }
      willUpdate++;
    }

    console.log('---');
    console.log(`${DRY_RUN ? 'Would update' : 'Updated'}: ${willUpdate}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Missing in auth-service: ${missing.length}`);
  } finally {
    await Promise.all([authDb.$disconnect(), orderDb.$disconnect()]);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
