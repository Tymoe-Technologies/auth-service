-- AlterTable: 给 Organization 加门店 IANA 时区字段（可空，向后兼容）
ALTER TABLE "Organization" ADD COLUMN "timezone" VARCHAR(64);
