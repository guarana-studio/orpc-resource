import type {
  DrizzleDatabase,
  DrizzleTableWithId,
  ListParams,
  CrudOptions,
} from "@bwg-labs/drizzle-crud";
import { drizzleCrud } from "@bwg-labs/drizzle-crud";
import { zod } from "@bwg-labs/drizzle-crud/zod";
import type { Builder } from "@orpc/server";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";

type CrudOptionsWithBase<
  TDatabase extends DrizzleDatabase,
  TTable extends DrizzleTableWithId,
  TContext extends Record<string, unknown>,
> = CrudOptions<TDatabase, TTable> & { base?: Builder<TContext, TContext, any, any, any, any> };

export function crud(db: DrizzleDatabase) {
  const crud = drizzleCrud(db, { validation: zod() });

  function resource<TTable extends DrizzleTableWithId, TContext extends Record<string, unknown>>(
    table: TTable,
    crudOptions: CrudOptionsWithBase<typeof db, TTable, TContext>,
  ) {
    type LocalTable = TTable;
    type SelectType = LocalTable["$inferSelect"];
    type InsertType = LocalTable["$inferInsert"];

    const localResource = crud(table, crudOptions);
    const base = crudOptions.base ?? os;

    const selectSchema = z.custom<SelectType>();
    const insertSchema = z.custom<InsertType>();
    const partialSelectSchema = z.custom<Partial<SelectType>>();
    const partialInsertSchema = z.custom<Partial<InsertType>>();
    const idSchema = z.custom<SelectType["id"]>();

    return {
      list: base.input(z.custom<ListParams<LocalTable>>()).handler(async ({ input }) => {
        return localResource.list(input);
      }),
      findOne: base.input(partialSelectSchema).handler(async ({ input }) => {
        const result = await localResource.findOne(input);
        if (!result) throw new ORPCError("NOT_FOUND");
        return result;
      }),
      create: base.input(insertSchema).handler(async ({ input }) => {
        return localResource.create(input);
      }),
      update: base
        .input(
          z.object({
            id: idSchema,
            data: partialInsertSchema,
          }),
        )
        .handler(async ({ input }) => {
          return localResource.update(input.id, input.data);
        }),
      deleteOne: base.input(idSchema).handler(async ({ input }) => {
        return localResource.deleteOne(input);
      }),
      restore: base.input(idSchema).handler(async ({ input }) => {
        return localResource.restore(input);
      }),
      permanentDelete: base.input(idSchema).handler(async ({ input }) => {
        return localResource.permanentDelete(input);
      }),
      bulkCreate: base.input(z.array(insertSchema)).handler(async ({ input }) => {
        return localResource.bulkCreate(input);
      }),
      bulkDelete: base.input(z.array(idSchema)).handler(async ({ input }) => {
        return localResource.bulkDelete(input);
      }),
      bulkRestore: base.input(z.array(idSchema)).handler(async ({ input }) => {
        return localResource.bulkRestore(input);
      }),
    };
  }

  return {
    resource,
  };
}
