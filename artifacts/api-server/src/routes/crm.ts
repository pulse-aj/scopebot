import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  featureRequestsTable,
  customerCompaniesTable,
  customerContactsTable,
  customerCallNotesTable,
  customerContractsTable,
  customerBillingTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../lib/auth";
import { contentDispositionHeader } from "../lib/http";

const router: IRouter = Router();

// 7 MB cap per contract. base64 of 7 MB ≈ 9.4 MB, which stays under the
// express.json 10 MB body limit configured in app.ts.
const MAX_CONTRACT_BYTES = 7 * 1024 * 1024;

const BILLING_KINDS = ["subscription", "usage", "contract"] as const;
const BILLING_FREQUENCIES = [
  "monthly",
  "quarterly",
  "annual",
  "one_time",
] as const;
const COMPANY_STATUSES = ["prospect", "active", "churned"] as const;

const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

type BillingKind = (typeof BILLING_KINDS)[number];
type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];
type CompanyStatus = (typeof COMPANY_STATUSES)[number];

function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return String(v);
}

function cleanStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

// Normalizes an optional, nullable text field for PATCH bodies. Returns
// `undefined` when the key is absent (leave unchanged), `null` when explicitly
// cleared (empty string / null), or the trimmed string otherwise.
function patchStr(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v == null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function parseAmount(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n.toString();
}

function parseDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function parseId(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function loadCompanyOr404(
  id: number,
  res: Response,
): Promise<typeof customerCompaniesTable.$inferSelect | null> {
  const [c] = await db
    .select()
    .from(customerCompaniesTable)
    .where(eq(customerCompaniesTable.id, id))
    .limit(1);
  if (!c) {
    res.status(404).json({ error: "Company not found" });
    return null;
  }
  return c;
}

// Resolve the set of app-user ids that belong to a company: anyone whose email
// domain matches the company domain, plus anyone whose email matches a recorded
// contact email. Drives the linked "tickets" (feature requests) view.
async function companyUserIds(
  company: typeof customerCompaniesTable.$inferSelect,
  contactEmails: string[],
): Promise<string[]> {
  const ors = [];
  const domain = company.domain?.trim().toLowerCase();
  if (domain) {
    ors.push(sql`lower(split_part(${usersTable.email}, '@', 2)) = ${domain}`);
  }
  const emails = Array.from(
    new Set(contactEmails.map((e) => e.toLowerCase()).filter(Boolean)),
  );
  if (emails.length > 0) {
    ors.push(sql`lower(${usersTable.email}) = ANY(${emails})`);
  }
  if (ors.length === 0) return [];
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(or(...ors));
  return rows.map((r) => r.id);
}

function serializeCompany(c: typeof customerCompaniesTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    domain: c.domain,
    website: c.website,
    status: c.status,
    notes: c.notes,
    createdAt: toIso(c.createdAt),
    updatedAt: toIso(c.updatedAt),
  };
}

// --- Companies -------------------------------------------------------------

router.get(
  "/admin/crm/companies",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    const companies = await db
      .select()
      .from(customerCompaniesTable)
      .orderBy(desc(customerCompaniesTable.createdAt));

    const [contactCounts, contractCounts, billingCounts, ticketByDomain] =
      await Promise.all([
        db
          .select({
            companyId: customerContactsTable.companyId,
            c: sql<number>`count(*)::int`,
          })
          .from(customerContactsTable)
          .groupBy(customerContactsTable.companyId),
        db
          .select({
            companyId: customerContractsTable.companyId,
            c: sql<number>`count(*)::int`,
          })
          .from(customerContractsTable)
          .groupBy(customerContractsTable.companyId),
        db
          .select({
            companyId: customerBillingTable.companyId,
            c: sql<number>`count(*)::int`,
          })
          .from(customerBillingTable)
          .where(eq(customerBillingTable.isActive, true))
          .groupBy(customerBillingTable.companyId),
        db
          .select({
            domain: sql<string>`lower(split_part(${usersTable.email}, '@', 2))`,
            total: sql<number>`count(${featureRequestsTable.id})::int`,
            open: sql<number>`count(*) filter (where ${featureRequestsTable.status} <> 'deployed')::int`,
          })
          .from(featureRequestsTable)
          .innerJoin(
            usersTable,
            eq(usersTable.id, featureRequestsTable.userId),
          )
          .groupBy(sql`lower(split_part(${usersTable.email}, '@', 2))`),
      ]);

    const contactMap = new Map(contactCounts.map((r) => [r.companyId, r.c]));
    const contractMap = new Map(contractCounts.map((r) => [r.companyId, r.c]));
    const billingMap = new Map(billingCounts.map((r) => [r.companyId, r.c]));
    const ticketMap = new Map(
      ticketByDomain.map((r) => [r.domain, { total: r.total, open: r.open }]),
    );

    const items = companies.map((c) => {
      const dom = c.domain?.trim().toLowerCase();
      const tickets = (dom && ticketMap.get(dom)) || { total: 0, open: 0 };
      return {
        ...serializeCompany(c),
        contactCount: contactMap.get(c.id) ?? 0,
        contractCount: contractMap.get(c.id) ?? 0,
        billingCount: billingMap.get(c.id) ?? 0,
        ticketCount: tickets.total,
        openTicketCount: tickets.open,
      };
    });

    res.json({
      companies: items,
      stats: {
        total: items.length,
        active: items.filter((c) => c.status === "active").length,
        prospects: items.filter((c) => c.status === "prospect").length,
        openTickets: items.reduce((acc, c) => acc + c.openTicketCount, 0),
      },
    });
  },
);

router.post(
  "/admin/crm/companies",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = cleanStr(body.name);
    if (!name) {
      res.status(400).json({ error: "Company name is required" });
      return;
    }
    const status = cleanStr(body.status);
    if (status && !COMPANY_STATUSES.includes(status as CompanyStatus)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    const domain = cleanStr(body.domain)?.toLowerCase().replace(/^@/, "");
    const [created] = await db
      .insert(customerCompaniesTable)
      .values({
        name,
        domain: domain ?? null,
        website: cleanStr(body.website) ?? null,
        status: (status as CompanyStatus) ?? "active",
        notes: cleanStr(body.notes) ?? null,
        createdByUserId: req.user?.id ?? null,
      })
      .returning();
    res.status(201).json(serializeCompany(created));
  },
);

router.get(
  "/admin/crm/companies/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid company id" });
      return;
    }
    const company = await loadCompanyOr404(id, res);
    if (!company) return;

    const [contacts, callNotes, contracts, billing] = await Promise.all([
      db
        .select()
        .from(customerContactsTable)
        .where(eq(customerContactsTable.companyId, id))
        .orderBy(
          desc(customerContactsTable.isPrimary),
          customerContactsTable.name,
        ),
      db
        .select()
        .from(customerCallNotesTable)
        .where(eq(customerCallNotesTable.companyId, id))
        .orderBy(desc(customerCallNotesTable.occurredAt)),
      db
        .select({
          id: customerContractsTable.id,
          title: customerContractsTable.title,
          filename: customerContractsTable.filename,
          mimeType: customerContractsTable.mimeType,
          sizeBytes: customerContractsTable.sizeBytes,
          createdAt: customerContractsTable.createdAt,
        })
        .from(customerContractsTable)
        .where(eq(customerContractsTable.companyId, id))
        .orderBy(desc(customerContractsTable.createdAt)),
      db
        .select()
        .from(customerBillingTable)
        .where(eq(customerBillingTable.companyId, id))
        .orderBy(
          desc(customerBillingTable.isActive),
          customerBillingTable.kind,
        ),
    ]);

    const contactEmails = contacts
      .map((c) => c.email)
      .filter((e): e is string => !!e);
    const userIds = await companyUserIds(company, contactEmails);

    let tickets: Array<{
      id: number;
      title: string;
      status: string;
      priority: string;
      summary: string;
      userEmail: string;
      userName: string | null;
      createdAt: string | null;
    }> = [];
    if (userIds.length > 0) {
      const rows = await db
        .select({
          id: featureRequestsTable.id,
          title: featureRequestsTable.title,
          status: featureRequestsTable.status,
          priority: featureRequestsTable.priority,
          summary: featureRequestsTable.summary,
          userEmail: usersTable.email,
          userName: usersTable.name,
          createdAt: featureRequestsTable.createdAt,
        })
        .from(featureRequestsTable)
        .innerJoin(usersTable, eq(usersTable.id, featureRequestsTable.userId))
        .where(inArray(featureRequestsTable.userId, userIds))
        .orderBy(desc(featureRequestsTable.createdAt));
      tickets = rows.map((r) => ({ ...r, createdAt: toIso(r.createdAt) }));
    }

    res.json({
      company: serializeCompany(company),
      contacts: contacts.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        title: c.title,
        isPrimary: c.isPrimary,
        notes: c.notes,
        createdAt: toIso(c.createdAt),
      })),
      callNotes: callNotes.map((n) => ({
        id: n.id,
        contactId: n.contactId,
        subject: n.subject,
        body: n.body,
        occurredAt: toIso(n.occurredAt),
        createdAt: toIso(n.createdAt),
      })),
      contracts: contracts.map((c) => ({
        id: c.id,
        title: c.title,
        filename: c.filename,
        mimeType: c.mimeType,
        sizeBytes: c.sizeBytes,
        createdAt: toIso(c.createdAt),
      })),
      billing: billing.map((b) => ({
        id: b.id,
        kind: b.kind,
        label: b.label,
        currency: b.currency,
        amount: b.amount,
        frequency: b.frequency,
        unitLabel: b.unitLabel,
        startDate: toIso(b.startDate),
        endDate: toIso(b.endDate),
        notes: b.notes,
        isActive: b.isActive,
      })),
      tickets,
    });
  },
);

router.patch(
  "/admin/crm/companies/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid company id" });
      return;
    }
    const company = await loadCompanyOr404(id, res);
    if (!company) return;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if ("name" in body) {
      const name = cleanStr(body.name);
      if (!name) {
        res.status(400).json({ error: "Company name cannot be empty" });
        return;
      }
      update.name = name;
    }
    if ("status" in body) {
      const status = cleanStr(body.status);
      if (!status || !COMPANY_STATUSES.includes(status as CompanyStatus)) {
        res.status(400).json({ error: "Invalid status" });
        return;
      }
      update.status = status;
    }
    const domain = patchStr(body, "domain");
    if (domain !== undefined)
      update.domain = domain ? domain.toLowerCase().replace(/^@/, "") : null;
    const website = patchStr(body, "website");
    if (website !== undefined) update.website = website;
    const notes = patchStr(body, "notes");
    if (notes !== undefined) update.notes = notes;

    const [updated] = await db
      .update(customerCompaniesTable)
      .set(update)
      .where(eq(customerCompaniesTable.id, id))
      .returning();
    res.json(serializeCompany(updated));
  },
);

router.delete(
  "/admin/crm/companies/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid company id" });
      return;
    }
    const company = await loadCompanyOr404(id, res);
    if (!company) return;
    await db
      .delete(customerCompaniesTable)
      .where(eq(customerCompaniesTable.id, id));
    res.json({ ok: true });
  },
);

// --- Contacts --------------------------------------------------------------

router.post(
  "/admin/crm/companies/:id/contacts",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid company id" });
      return;
    }
    const company = await loadCompanyOr404(id, res);
    if (!company) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = cleanStr(body.name);
    if (!name) {
      res.status(400).json({ error: "Contact name is required" });
      return;
    }
    const [created] = await db
      .insert(customerContactsTable)
      .values({
        companyId: id,
        name,
        email: cleanStr(body.email)?.toLowerCase() ?? null,
        phone: cleanStr(body.phone) ?? null,
        title: cleanStr(body.title) ?? null,
        isPrimary: body.isPrimary === true,
        notes: cleanStr(body.notes) ?? null,
      })
      .returning();
    res.status(201).json({
      id: created.id,
      name: created.name,
      email: created.email,
      phone: created.phone,
      title: created.title,
      isPrimary: created.isPrimary,
      notes: created.notes,
      createdAt: toIso(created.createdAt),
    });
  },
);

router.patch(
  "/admin/crm/contacts/:contactId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const contactId = parseId(req.params.contactId);
    if (!contactId) {
      res.status(400).json({ error: "Invalid contact id" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if ("name" in body) {
      const name = cleanStr(body.name);
      if (!name) {
        res.status(400).json({ error: "Contact name cannot be empty" });
        return;
      }
      update.name = name;
    }
    const email = patchStr(body, "email");
    if (email !== undefined) update.email = email ? email.toLowerCase() : null;
    const phone = patchStr(body, "phone");
    if (phone !== undefined) update.phone = phone;
    const title = patchStr(body, "title");
    if (title !== undefined) update.title = title;
    const notes = patchStr(body, "notes");
    if (notes !== undefined) update.notes = notes;
    if ("isPrimary" in body) update.isPrimary = body.isPrimary === true;

    const [updated] = await db
      .update(customerContactsTable)
      .set(update)
      .where(eq(customerContactsTable.id, contactId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    res.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      title: updated.title,
      isPrimary: updated.isPrimary,
      notes: updated.notes,
      createdAt: toIso(updated.createdAt),
    });
  },
);

router.delete(
  "/admin/crm/contacts/:contactId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const contactId = parseId(req.params.contactId);
    if (!contactId) {
      res.status(400).json({ error: "Invalid contact id" });
      return;
    }
    const deleted = await db
      .delete(customerContactsTable)
      .where(eq(customerContactsTable.id, contactId))
      .returning({ id: customerContactsTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    res.json({ ok: true });
  },
);

// --- Call notes ------------------------------------------------------------

router.post(
  "/admin/crm/companies/:id/call-notes",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid company id" });
      return;
    }
    const company = await loadCompanyOr404(id, res);
    if (!company) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const noteBody = cleanStr(body.body);
    if (!noteBody) {
      res.status(400).json({ error: "Note body is required" });
      return;
    }
    const occurredAt = parseDate(body.occurredAt);
    if (occurredAt === undefined && body.occurredAt != null) {
      res.status(400).json({ error: "Invalid occurredAt date" });
      return;
    }
    let contactId: number | null = null;
    if (body.contactId != null && body.contactId !== "") {
      contactId = parseId(body.contactId);
      if (!contactId) {
        res.status(400).json({ error: "Invalid contactId" });
        return;
      }
      const [contact] = await db
        .select({ companyId: customerContactsTable.companyId })
        .from(customerContactsTable)
        .where(eq(customerContactsTable.id, contactId))
        .limit(1);
      if (!contact || contact.companyId !== id) {
        res
          .status(400)
          .json({ error: "Contact does not belong to this company" });
        return;
      }
    }
    const [created] = await db
      .insert(customerCallNotesTable)
      .values({
        companyId: id,
        contactId: contactId ?? null,
        authorUserId: req.user?.id ?? null,
        subject: cleanStr(body.subject) ?? null,
        body: noteBody,
        occurredAt: occurredAt ?? new Date(),
      })
      .returning();
    res.status(201).json({
      id: created.id,
      contactId: created.contactId,
      subject: created.subject,
      body: created.body,
      occurredAt: toIso(created.occurredAt),
      createdAt: toIso(created.createdAt),
    });
  },
);

router.delete(
  "/admin/crm/call-notes/:noteId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const noteId = parseId(req.params.noteId);
    if (!noteId) {
      res.status(400).json({ error: "Invalid note id" });
      return;
    }
    const deleted = await db
      .delete(customerCallNotesTable)
      .where(eq(customerCallNotesTable.id, noteId))
      .returning({ id: customerCallNotesTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json({ ok: true });
  },
);

// --- Contracts (file upload) ----------------------------------------------

router.post(
  "/admin/crm/companies/:id/contracts",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid company id" });
      return;
    }
    const company = await loadCompanyOr404(id, res);
    if (!company) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const filename = cleanStr(body.filename);
    const mimeType = cleanStr(body.mimeType);
    const dataBase64 = typeof body.dataBase64 === "string" ? body.dataBase64 : "";
    if (!filename || !mimeType || !dataBase64) {
      res
        .status(400)
        .json({ error: "filename, mimeType, and dataBase64 are required" });
      return;
    }
    const buf = Buffer.from(dataBase64, "base64");
    if (buf.length === 0) {
      res.status(400).json({ error: "File is empty or not valid base64" });
      return;
    }
    if (buf.length > MAX_CONTRACT_BYTES) {
      res.status(413).json({ error: "File exceeds the 7 MB limit" });
      return;
    }
    const [created] = await db
      .insert(customerContractsTable)
      .values({
        companyId: id,
        title: cleanStr(body.title) ?? filename,
        filename,
        mimeType,
        sizeBytes: buf.length,
        dataBase64,
        uploadedByUserId: req.user?.id ?? null,
      })
      .returning({
        id: customerContractsTable.id,
        title: customerContractsTable.title,
        filename: customerContractsTable.filename,
        mimeType: customerContractsTable.mimeType,
        sizeBytes: customerContractsTable.sizeBytes,
        createdAt: customerContractsTable.createdAt,
      });
    res.status(201).json({ ...created, createdAt: toIso(created.createdAt) });
  },
);

router.get(
  "/admin/crm/contracts/:contractId/download",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const contractId = parseId(req.params.contractId);
    if (!contractId) {
      res.status(400).json({ error: "Invalid contract id" });
      return;
    }
    const [c] = await db
      .select()
      .from(customerContractsTable)
      .where(eq(customerContractsTable.id, contractId))
      .limit(1);
    if (!c) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const buf = Buffer.from(c.dataBase64, "base64");
    const inline = INLINE_TYPES.has(c.mimeType.toLowerCase());
    res.setHeader(
      "Content-Type",
      inline ? c.mimeType : "application/octet-stream",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      contentDispositionHeader(inline ? "inline" : "attachment", c.filename),
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(buf);
  },
);

router.delete(
  "/admin/crm/contracts/:contractId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const contractId = parseId(req.params.contractId);
    if (!contractId) {
      res.status(400).json({ error: "Invalid contract id" });
      return;
    }
    const deleted = await db
      .delete(customerContractsTable)
      .where(eq(customerContractsTable.id, contractId))
      .returning({ id: customerContractsTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    res.json({ ok: true });
  },
);

// --- Billing model ---------------------------------------------------------

function serializeBilling(b: typeof customerBillingTable.$inferSelect) {
  return {
    id: b.id,
    kind: b.kind,
    label: b.label,
    currency: b.currency,
    amount: b.amount,
    frequency: b.frequency,
    unitLabel: b.unitLabel,
    startDate: toIso(b.startDate),
    endDate: toIso(b.endDate),
    notes: b.notes,
    isActive: b.isActive,
  };
}

router.post(
  "/admin/crm/companies/:id/billing",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid company id" });
      return;
    }
    const company = await loadCompanyOr404(id, res);
    if (!company) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = cleanStr(body.kind);
    if (!kind || !BILLING_KINDS.includes(kind as BillingKind)) {
      res.status(400).json({ error: "Invalid billing kind" });
      return;
    }
    const label = cleanStr(body.label);
    if (!label) {
      res.status(400).json({ error: "Billing label is required" });
      return;
    }
    const amount = parseAmount(body.amount);
    if (amount === undefined && body.amount != null && body.amount !== "") {
      res.status(400).json({ error: "Invalid amount" });
      return;
    }
    const frequency = cleanStr(body.frequency);
    if (frequency && !BILLING_FREQUENCIES.includes(frequency as BillingFrequency)) {
      res.status(400).json({ error: "Invalid frequency" });
      return;
    }
    const startDate = parseDate(body.startDate);
    if (startDate === undefined && body.startDate != null && body.startDate !== "") {
      res.status(400).json({ error: "Invalid startDate" });
      return;
    }
    const endDate = parseDate(body.endDate);
    if (endDate === undefined && body.endDate != null && body.endDate !== "") {
      res.status(400).json({ error: "Invalid endDate" });
      return;
    }
    const [created] = await db
      .insert(customerBillingTable)
      .values({
        companyId: id,
        kind: kind as BillingKind,
        label,
        currency: cleanStr(body.currency)?.toUpperCase() ?? "USD",
        amount: amount ?? null,
        frequency: (frequency as BillingFrequency) ?? null,
        unitLabel: cleanStr(body.unitLabel) ?? null,
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        notes: cleanStr(body.notes) ?? null,
        isActive: body.isActive === undefined ? true : body.isActive === true,
      })
      .returning();
    res.status(201).json(serializeBilling(created));
  },
);

router.patch(
  "/admin/crm/billing/:billingId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const billingId = parseId(req.params.billingId);
    if (!billingId) {
      res.status(400).json({ error: "Invalid billing id" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if ("kind" in body) {
      const kind = cleanStr(body.kind);
      if (!kind || !BILLING_KINDS.includes(kind as BillingKind)) {
        res.status(400).json({ error: "Invalid billing kind" });
        return;
      }
      update.kind = kind;
    }
    if ("label" in body) {
      const label = cleanStr(body.label);
      if (!label) {
        res.status(400).json({ error: "Billing label cannot be empty" });
        return;
      }
      update.label = label;
    }
    if ("currency" in body) {
      update.currency = cleanStr(body.currency)?.toUpperCase() ?? "USD";
    }
    if ("amount" in body) {
      const amount = parseAmount(body.amount);
      if (amount === undefined) {
        res.status(400).json({ error: "Invalid amount" });
        return;
      }
      update.amount = amount;
    }
    if ("frequency" in body) {
      const frequency = cleanStr(body.frequency);
      if (frequency && !BILLING_FREQUENCIES.includes(frequency as BillingFrequency)) {
        res.status(400).json({ error: "Invalid frequency" });
        return;
      }
      update.frequency = frequency ?? null;
    }
    const unitLabel = patchStr(body, "unitLabel");
    if (unitLabel !== undefined) update.unitLabel = unitLabel;
    if ("startDate" in body) {
      const d = parseDate(body.startDate);
      if (d === undefined) {
        res.status(400).json({ error: "Invalid startDate" });
        return;
      }
      update.startDate = d;
    }
    if ("endDate" in body) {
      const d = parseDate(body.endDate);
      if (d === undefined) {
        res.status(400).json({ error: "Invalid endDate" });
        return;
      }
      update.endDate = d;
    }
    const notes = patchStr(body, "notes");
    if (notes !== undefined) update.notes = notes;
    if ("isActive" in body) update.isActive = body.isActive === true;

    const [updated] = await db
      .update(customerBillingTable)
      .set(update)
      .where(eq(customerBillingTable.id, billingId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Billing item not found" });
      return;
    }
    res.json(serializeBilling(updated));
  },
);

router.delete(
  "/admin/crm/billing/:billingId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const billingId = parseId(req.params.billingId);
    if (!billingId) {
      res.status(400).json({ error: "Invalid billing id" });
      return;
    }
    const deleted = await db
      .delete(customerBillingTable)
      .where(eq(customerBillingTable.id, billingId))
      .returning({ id: customerBillingTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Billing item not found" });
      return;
    }
    res.json({ ok: true });
  },
);

export default router;
