-- AlterTable: 给 Organization 加营业时间 JSON 字段（可空，向后兼容）
ALTER TABLE "Organization" ADD COLUMN "business_hours" JSONB;
