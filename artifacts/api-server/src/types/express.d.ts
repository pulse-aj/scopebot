import type { User as DbUser } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      user?: DbUser;
    }
  }
}

export {};
