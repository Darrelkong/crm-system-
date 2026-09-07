import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertMigrationSqlIsAdditive,
  stripSqlComments,
} from "./mail-large-attachment-production-precheck.mjs";

describe("Production migration SQL precheck", () => {
  it("ignores single-line comments containing update and delete", () => {
    assert.doesNotThrow(() =>
      assertMigrationSqlIsAdditive(`
        -- no update of existing rows
        -- this migration does not delete business data
        CREATE TABLE example (id TEXT PRIMARY KEY);
      `),
    );
  });

  it("ignores block comments containing mutation words", () => {
    assert.doesNotThrow(() =>
      assertMigrationSqlIsAdditive(`
        /* no update is performed */
        CREATE TABLE example (id TEXT PRIMARY KEY);
        /* no delete or alter is performed */
        CREATE INDEX example_id ON example (id);
      `),
    );
  });

  it("accepts CREATE TABLE and CREATE INDEX statements", () => {
    assert.doesNotThrow(() =>
      assertMigrationSqlIsAdditive("CREATE TABLE example (id TEXT PRIMARY KEY);"),
    );
    assert.doesNotThrow(() =>
      assertMigrationSqlIsAdditive("CREATE INDEX example_id ON example (id);"),
    );
  });

  for (const statement of [
    "UPDATE users SET name = 'changed';",
    "DELETE FROM users;",
    "DROP TABLE users;",
    "ALTER TABLE users ADD COLUMN name TEXT;",
  ]) {
    it(`rejects real SQL mutation: ${statement.split(" ", 1)[0]}`, () => {
      assert.throws(
        () =>
          assertMigrationSqlIsAdditive(
            `CREATE TABLE example (id TEXT PRIMARY KEY);\n${statement}`,
          ),
        /forbidden SQL mutation statement/,
      );
    });
  }

  it("removes comments without hiding surrounding SQL statements", () => {
    const sql = stripSqlComments(
      "CREATE TABLE example (id TEXT PRIMARY KEY); /* note */ UPDATE users SET name = 'changed';",
    );
    assert.match(sql, /CREATE TABLE/);
    assert.match(sql, /UPDATE users SET/);
  });
});
