import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs/promises';
import { initializeSchema, getSchemaVersion, setSchemaVersion } from './schema.js';

const CURRENT_SCHEMA_VERSION = 1;

export class NectarDatabase {
  private db: initSqlJs.Database;
  private projectPath: string;
  private dbPath: string;

  constructor(projectPath: string, db: initSqlJs.Database) {
    this.projectPath = projectPath;
    this.db = db;
    this.dbPath = path.join(projectPath, '.nectar', 'nectar.db');
    
    this.migrate();
  }

  static async create(projectPath: string): Promise<NectarDatabase> {
    const SQL = await initSqlJs();
    const dbPath = path.join(projectPath, '.nectar', 'nectar.db');
    
    let db: initSqlJs.Database;
    try {
      const buffer = await fs.readFile(dbPath);
      db = new SQL.Database(buffer);
    } catch {
      // File doesn't exist, create new database
      db = new SQL.Database();
    }
    
    return new NectarDatabase(projectPath, db);
  }

  private migrate(): void {
    // If the DB is already populated (e.g. created by the Rust backend, which
    // uses an FTS5 table sql.js can't create), skip schema init entirely —
    // re-running initializeSchema would throw on the FTS5 CREATE.
    if (this.tableExists('chunks')) return;

    const version = getSchemaVersion(this.db);

    if (version === 0) {
      initializeSchema(this.db);
      setSchemaVersion(this.db, CURRENT_SCHEMA_VERSION);
    }
    // Future migrations would go here
  }

  private tableExists(name: string): boolean {
    try {
      const stmt = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      );
      stmt.bind([name]);
      const found = stmt.step();
      stmt.free();
      return found;
    } catch {
      return false;
    }
  }

  getDatabase(): initSqlJs.Database {
    return this.db;
  }

  async close(): Promise<void> {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    await fs.writeFile(this.dbPath, buffer);
    this.db.close();
  }

  // Transaction helper
  transaction<T>(fn: (db: initSqlJs.Database) => T): T {
    this.db.run('BEGIN TRANSACTION');
    try {
      const result = fn(this.db);
      this.db.run('COMMIT');
      return result;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }
}
