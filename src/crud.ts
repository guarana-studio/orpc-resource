import type {
  DrizzleDatabase,
  DrizzleTableWithId,
  ListParams,
  CrudOptions,
} from "@bwg-labs/drizzle-crud";
import { drizzleCrud } from "@bwg-labs/drizzle-crud";
import { zod } from "@bwg-labs/drizzle-crud/zod";
import { ORPCError, os, type Builder } from "@orpc/server";
import { type } from "@orpc/server";

type CrudOptionsWithBase<
  TDatabase extends DrizzleDatabase,
  TTable extends DrizzleTableWithId,
  TContext extends Record<string, unknown>,
> = CrudOptions<TDatabase, TTable> & { base?: Builder<TContext, TContext, any, any, any, any> };

export function crud(db: DrizzleDatabase) {
  const crud = drizzleCrud(db, { validation: zod() });

  function resource<T extends Record<string, unknown>>(
    table: DrizzleTableWithId,
    crudOptions: CrudOptionsWithBase<typeof db, DrizzleTableWithId, T>,
  ) {
    type LocalTable = typeof table;
    const localResource = crud(table, crudOptions);
    const base = crudOptions.base ?? os;
    return {
      list: base.input(type<ListParams<LocalTable>>()).handler(async ({ input }) => {
        return localResource.list(input);
      }),
      findOne: base
        .input(type<Partial<LocalTable["$inferSelect"]>>())
        .handler(async ({ input }) => {
          const result = await localResource.findOne(input);
          if (!result) throw new ORPCError("NOT_FOUND");
          return result;
        }),
      create: base.input(type<LocalTable["$inferInsert"]>()).handler(async ({ input }) => {
        return localResource.create(input);
      }),
      update: base
        .input(
          type<{
            id: LocalTable["$inferSelect"]["id"];
            data: Partial<LocalTable["$inferInsert"]>;
          }>(),
        )
        .handler(async ({ input }) => {
          return localResource.update(input.id, input.data);
        }),
      deleteOne: base.input(type<LocalTable["$inferSelect"]["id"]>()).handler(async ({ input }) => {
        return localResource.deleteOne(input);
      }),
      restore: base.input(type<LocalTable["$inferSelect"]["id"]>()).handler(async ({ input }) => {
        return localResource.restore(input);
      }),
      permanentDelete: base
        .input(type<LocalTable["$inferSelect"]["id"]>())
        .handler(async ({ input }) => {
          return localResource.permanentDelete(input);
        }),
    };
  }

  return {
    resource,
  };
}
