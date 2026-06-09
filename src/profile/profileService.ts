import type { Database } from "sql.js";

export class ProfileService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getProfile(_scopeId: string): {
    static: unknown[];
    dynamic: unknown[];
  } {
    return { static: [], dynamic: [] };
  }
}
