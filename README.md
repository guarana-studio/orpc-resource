# orpc-resource

CRUD operations with oRPC, SQLite, and Drizzle in minutes.

## Usage

### 1. Define the database schema

```ts
// src/schema.ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  role: text("role", { enum: ["user", "admin"] }).default("user"),
  image: text("image"),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const note = sqliteTable("note", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  content: text("content"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});
```

### 2. Define the resources

```ts
// src/router.ts
import { os } from "@orpc/server";
import { crud } from "./crud";
import { user, note } from "./schema";
import { authorized } from "./server/orpc";
import { db } from "./db";

const { resource } = crud(db);

export const router = {
  users: resource(user, {
    searchFields: ["name", "email"],
    allowedFilters: ["role"],
    softDelete: {
      field: "deletedAt",
      defaultValue: new Date(),
    },
  }),
  notes: resource(note, {
    base: authorized,
    searchFields: ["title", "content"],
  }),
};
```

### 3. Use the newly defined procedures

```ts
// src/main.js
import { client } from "./orpc";

// Index
const index = await client.users.list({
  page: 1,
  perPage: 20,
});

// Show
const user = await client.users.findOne({ email: "user@example.com" });

// Create
const newUser = await client.users.create({
  email: "newuser@example.com",
  name: "New User",
});

// Update
await client.users.update({ id: newUser.id, data: { name: "Updated Name" } });

// Soft Delete
await client.users.deleteOne(newUser.id);

// Restore
await client.users.restore(user.id);

// Delete permanently
await client.users.permanentDelete(newUser.id);

// Bulk Create
const newUsers = await client.users.bulkCreate([
  { email: "user1@example.com", name: "User 1" },
  { email: "user2@example.com", name: "User 2" },
]);

// Bulk Delete (soft delete)
await client.users.bulkDelete([user1.id, user2.id]);

// Bulk Restore
await client.users.bulkRestore([user1.id, user2.id]);
```
