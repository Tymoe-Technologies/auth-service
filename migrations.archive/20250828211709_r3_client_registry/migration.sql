/*
  Warnings:

  - You are about to drop the column `pkceRequired` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `scopes` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Client` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `Client` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `redirectUris` on the `Client` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Client" DROP COLUMN "pkceRequired",
DROP COLUMN "scopes",
DROP COLUMN "type",
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
DROP COLUMN "redirectUris",
ADD COLUMN     "redirectUris" JSONB NOT NULL;
