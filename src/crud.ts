import type { Builder } from "@orpc/server";
import { ORPCError, os } from "@orpc/server";
import type { Column, SQL, Table } from "drizzle-orm";
import { and, asc, count, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { z } from "zod";

type DrizzleTableWithId = SQLiteTable & {
  id: unknown;
  $inferSelect: Record<string, unknown> & { id: unknown };
  $inferInsert: Record<string, unknown>;
};

type ListResponse<T> = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  page: number;
  perPage: number;
  results: T[];
  totalItems: number;
  totalPages: number;
};

type SoftDeleteConfig<T> = {
  field: keyof T;
  deletedValue: () => unknown;
};

type CrudOptions<TTable extends DrizzleTableWithId> = {
  searchFields?: (keyof TTable["$inferSelect"])[];
  softDelete?: SoftDeleteConfig<TTable["$inferSelect"]>;
};

type CrudOptionsWithBase<
  TTable extends DrizzleTableWithId,
  TContext extends Record<string, unknown>,
> = CrudOptions<TTable> & {
  base?: Builder<TContext, TContext, never, never, never, never>;
};

const listParamsSchema = z.object({
  page: z.number().int().positive().optional(),
  perPage: z.number().int().positive().max(200).optional(),
  sort: z
    .object({
      field: z.string(),
      order: z.enum(["asc", "desc"]).optional(),
    })
    .optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  search: z.string().optional(),
});

const col = (field: unknown): Column => field as Column;

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 10;

export function crud<TSchema extends Record<string, unknown>>(db: LibSQLDatabase<TSchema>) {
  function resource<TTable extends DrizzleTableWithId, TContext extends Record<string, unknown>>(
    table: TTable,
    crudOptions: CrudOptionsWithBase<TTable, TContext>,
  ) {
    type SelectType = TTable["$inferSelect"];
    type InsertType = TTable["$inferInsert"];

    const base = crudOptions.base ?? os;
    const searchFields = crudOptions.searchFields ?? [];
    const softDelete = crudOptions.softDelete;
    const tableId = col(table.id);

    const idSchema = z.custom<SelectType["id"]>();
    const insertSchema = z.custom<InsertType>();
    const selectSchema = z.custom<SelectType>();
    const partialSelectSchema = z.custom<Partial<SelectType>>();
    const partialInsertSchema = z.custom<Partial<InsertType>>();

    const listResponseSchema = z.object({
      hasNextPage: z.boolean(),
      hasPreviousPage: z.boolean(),
      page: z.number(),
      perPage: z.number(),
      results: z.array(selectSchema),
      totalItems: z.number(),
      totalPages: z.number(),
    });

    const successSchema = z.object({ success: z.literal(true) }); // narrowed from boolean
    const bulkSuccessSchema = z.object({
      success: z.literal(true),
      count: z.number().int().nonnegative(),
    });
    const bulkCreateResponseSchema = bulkSuccessSchema.extend({
      items: z.array(selectSchema),
    });

    function buildWhereConditions(
      filters?: Partial<SelectType>,
      search?: string,
      includeDeleted = false,
    ): SQL<unknown> | undefined {
      const conditions: SQL<unknown>[] = [];

      if (softDelete && !includeDeleted) {
        conditions.push(isNull(col(table[softDelete.field as keyof typeof table])));
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value != null) {
            conditions.push(eq(col(table[key as keyof typeof table]), value));
          }
        }
      }

      if (search && searchFields.length > 0) {
        const searchConditions = searchFields.map((field) =>
          like(col(table[field as keyof typeof table]), `%${search}%`),
        );
        conditions.push(or(...searchConditions) as SQL<unknown>);
      }

      return conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]!
          : (and(...conditions) as SQL<unknown>);
    }

    function requireSoftDelete() {
      if (!softDelete) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Soft delete is not enabled for this resource",
        });
      }
      return softDelete;
    }

    async function runSelect(where?: SQL<unknown>): Promise<SelectType[]> {
      const q = db.select().from(table as Table);
      return (await (where ? q.where(where) : q)) as SelectType[];
    }

    async function runCount(where?: SQL<unknown>): Promise<number> {
      const q = db.select({ count: count() }).from(table as Table);
      const result = (await (where ? q.where(where) : q)) as [{ count: number }];
      return result[0]?.count ?? 0;
    }

    async function applySoftDeleteOrHardDelete(where: SQL<unknown>): Promise<void> {
      if (softDelete) {
        await db
          .update(table as Table)
          .set({ [softDelete.field]: softDelete.deletedValue() })
          .where(where);
      } else {
        await db.delete(table as Table).where(where);
      }
    }

    async function applyRestore(where: SQL<unknown>): Promise<void> {
      const sd = requireSoftDelete();
      await db
        .update(table as Table)
        .set({ [sd.field]: null })
        .where(where);
    }

    const list = base
      .input(listParamsSchema)
      .output(listResponseSchema)
      .handler(async ({ input }): Promise<ListResponse<SelectType>> => {
        const page = input.page ?? DEFAULT_PAGE;
        const perPage = input.perPage ?? DEFAULT_PER_PAGE;
        const offset = (page - 1) * perPage;
        const where = buildWhereConditions(input.filters as Partial<SelectType>, input.search);

        const [totalItems, rawResults] = await Promise.all([
          runCount(where),
          (() => {
            const qb = db.select().from(table as Table);
            const qw = where ? qb.where(where) : qb;
            const sortField = input.sort?.field
              ? col(table[input.sort.field as keyof typeof table])
              : undefined;
            const qo = sortField
              ? qw.orderBy((input.sort!.order === "desc" ? desc : asc)(sortField))
              : qw;
            return qo.limit(perPage).offset(offset);
          })(),
        ]);

        const totalPages = Math.ceil(totalItems / perPage);
        const results = rawResults as SelectType[];

        return {
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
          page,
          perPage,
          results,
          totalItems,
          totalPages,
        };
      });

    const findOne = base
      .input(partialSelectSchema)
      .output(selectSchema)
      .handler(async ({ input }): Promise<SelectType> => {
        const where = buildWhereConditions(input as Partial<SelectType>);
        const results = await runSelect(where);
        if (results.length === 0) throw new ORPCError("NOT_FOUND");
        return results[0]!;
      });

    const create = base
      .input(insertSchema)
      .output(selectSchema)
      .handler(async ({ input }): Promise<SelectType> => {
        const [item] = (await db
          .insert(table as Table)
          .values(input)
          .returning()) as SelectType[];
        if (!item) throw new ORPCError("INTERNAL_SERVER_ERROR");
        return item;
      });

    const update = base
      .input(z.object({ id: idSchema, data: partialInsertSchema }))
      .output(selectSchema)
      .handler(async ({ input }): Promise<SelectType> => {
        const [item] = (await db
          .update(table as Table)
          .set(input.data as Record<string, unknown>)
          .where(eq(tableId, input.id))
          .returning()) as SelectType[];
        if (!item) throw new ORPCError("NOT_FOUND");
        return item;
      });

    const deleteOne = base
      .input(idSchema)
      .output(successSchema)
      .handler(async ({ input }) => {
        await applySoftDeleteOrHardDelete(eq(tableId, input));
        return { success: true as const };
      });

    const restore = base
      .input(idSchema)
      .output(successSchema)
      .handler(async ({ input }) => {
        await applyRestore(eq(tableId, input));
        return { success: true as const };
      });

    const permanentDelete = base
      .input(idSchema)
      .output(successSchema)
      .handler(async ({ input }) => {
        await db.delete(table as Table).where(eq(tableId, input));
        return { success: true as const };
      });

    const bulkCreate = base
      .input(z.array(insertSchema))
      .output(bulkCreateResponseSchema)
      .handler(
        async ({ input }): Promise<{ success: true; count: number; items: SelectType[] }> => {
          const items = (await db
            .insert(table as Table)
            .values(input)
            .returning()) as SelectType[];
          return { success: true, count: items.length, items };
        },
      );

    const bulkDelete = base
      .input(z.array(idSchema))
      .output(bulkSuccessSchema)
      .handler(async ({ input }) => {
        await applySoftDeleteOrHardDelete(inArray(tableId, input));
        return { success: true as const, count: input.length };
      });

    const bulkRestore = base
      .input(z.array(idSchema))
      .output(bulkSuccessSchema)
      .handler(async ({ input }) => {
        await applyRestore(inArray(tableId, input));
        return { success: true as const, count: input.length };
      });

    return {
      list,
      findOne,
      create,
      update,
      deleteOne,
      restore,
      permanentDelete,
      bulkCreate,
      bulkDelete,
      bulkRestore,
    };
  }

  return { resource };
}
