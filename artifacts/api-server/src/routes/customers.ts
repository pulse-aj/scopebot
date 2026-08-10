import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  featureRequestsTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../lib/auth";

const router: IRouter = Router();

// Personal-email domains are kept as individual customers (not grouped by
// domain) because the domain doesn't represent an organization.
const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.in",
  "yahoo.ca",
  "yahoo.fr",
  "yahoo.de",
  "ymail.com",
]);

// Employees on internal domains are excluded from the customer view
// entirely. Configured via INTERNAL_DOMAINS (comma-separated list of
// email domains, e.g. "example.com,example.org").
const INTERNAL_DOMAINS = new Set(
  (process.env.INTERNAL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
);

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return String(v);
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).toLowerCase();
}

interface CustomerUser {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  requestCount: number;
  lastRequestAt: string | null;
}

router.get(
  "/admin/customers",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    // Pull every user + their feature-request stats in a single query.
    const rows = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        createdAt: usersTable.createdAt,
        isAdmin: usersTable.isAdmin,
        requestCount: sql<number>`COALESCE(COUNT(${featureRequestsTable.id}), 0)::int`,
        lastRequestAt: sql<string | null>`MAX(${featureRequestsTable.createdAt})`,
      })
      .from(usersTable)
      .leftJoin(
        featureRequestsTable,
        eq(featureRequestsTable.userId, usersTable.id),
      )
      .groupBy(usersTable.id);

    const corporate = new Map<
      string,
      {
        domain: string;
        users: CustomerUser[];
        userCount: number;
        requestCount: number;
        lastRequestAt: string | null;
      }
    >();
    const individuals: CustomerUser[] = [];

    for (const r of rows) {
      const domain = domainOf(r.email);
      if (!domain || INTERNAL_DOMAINS.has(domain)) continue;
      const user: CustomerUser = {
        id: r.id,
        email: r.email,
        name: r.name,
        createdAt: toIso(r.createdAt),
        requestCount: r.requestCount,
        lastRequestAt: r.lastRequestAt ? toIso(r.lastRequestAt) : null,
      };

      if (PERSONAL_DOMAINS.has(domain)) {
        individuals.push(user);
        continue;
      }

      const existing = corporate.get(domain);
      if (existing) {
        existing.users.push(user);
        existing.userCount += 1;
        existing.requestCount += user.requestCount;
        if (
          user.lastRequestAt &&
          (!existing.lastRequestAt ||
            user.lastRequestAt > existing.lastRequestAt)
        ) {
          existing.lastRequestAt = user.lastRequestAt;
        }
      } else {
        corporate.set(domain, {
          domain,
          users: [user],
          userCount: 1,
          requestCount: user.requestCount,
          lastRequestAt: user.lastRequestAt,
        });
      }
    }

    const groups = Array.from(corporate.values())
      .map((g) => ({
        ...g,
        users: g.users.sort(
          (a, b) => b.requestCount - a.requestCount || a.email.localeCompare(b.email),
        ),
      }))
      .sort(
        (a, b) =>
          b.requestCount - a.requestCount ||
          b.userCount - a.userCount ||
          a.domain.localeCompare(b.domain),
      );

    individuals.sort(
      (a, b) =>
        b.requestCount - a.requestCount || a.email.localeCompare(b.email),
    );

    res.json({
      groups,
      individuals,
      stats: {
        totalCustomers: groups.reduce((acc, g) => acc + g.userCount, 0) +
          individuals.length,
        totalOrganizations: groups.length,
        totalIndividuals: individuals.length,
      },
    });
  },
);

router.get(
  "/admin/customers/:userId/requests",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const userId = String(req.params.userId ?? "");
    if (!userId) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    const requests = await db
      .select({
        id: featureRequestsTable.id,
        title: featureRequestsTable.title,
        status: featureRequestsTable.status,
        priority: featureRequestsTable.priority,
        summary: featureRequestsTable.summary,
        createdAt: featureRequestsTable.createdAt,
        updatedAt: featureRequestsTable.updatedAt,
      })
      .from(featureRequestsTable)
      .where(eq(featureRequestsTable.userId, userId))
      .orderBy(desc(featureRequestsTable.createdAt));

    res.json({ user, requests });
  },
);

export default router;
