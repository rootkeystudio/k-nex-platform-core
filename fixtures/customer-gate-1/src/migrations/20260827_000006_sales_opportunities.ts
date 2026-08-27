import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_sales_opportunities_stage" AS ENUM('lead', 'qualified', 'won', 'lost');
    CREATE TABLE "sales_opportunities" (
      "id" serial PRIMARY KEY NOT NULL,
      "name" varchar NOT NULL,
      "stage" "enum_sales_opportunities_stage" DEFAULT 'lead' NOT NULL,
      "value" varchar,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "sales_opportunities_id" integer;
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sales_opportunities_fk"
      FOREIGN KEY ("sales_opportunities_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX "sales_opportunities_updated_at_idx" ON "sales_opportunities" USING btree ("updated_at");
    CREATE INDEX "sales_opportunities_created_at_idx" ON "sales_opportunities" USING btree ("created_at");
    CREATE INDEX "sales_opportunities_stage_idx" ON "sales_opportunities" USING btree ("stage");
    CREATE INDEX "payload_locked_documents_rels_sales_opportunities_id_idx" ON "payload_locked_documents_rels" USING btree ("sales_opportunities_id");
    UPDATE "k_nex_migration_revision" SET "predecessor_revision" = 5, "revision" = 6 WHERE "id" = 1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_sales_opportunities_fk";
    DROP INDEX "payload_locked_documents_rels_sales_opportunities_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "sales_opportunities_id";
    DROP TABLE "sales_opportunities" CASCADE;
    DROP TYPE "public"."enum_sales_opportunities_stage";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision" = 4, "revision" = 5 WHERE "id" = 1;
  `);
}
