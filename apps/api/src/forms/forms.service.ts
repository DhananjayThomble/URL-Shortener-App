import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq, forms, formResponses, sql, workspaces, type Database } from "@snapurl/database";
import type {
  CreateFormInput,
  Form,
  FormResponseList,
  PublicForm,
  SubmitFormInput,
  SubmitFormResult,
  UpdateFormInput,
} from "@snapurl/contract";
import { exportColumns, generateSlug, isSlugAvailableShape, validateSubmission, withFieldKeys } from "@snapurl/domain";
import { DB } from "../database/database.module.js";
import { isUniqueViolation } from "../common/postgres-error.filter.js";
import { recordActivity, type Actor } from "../common/activity.js";
import { csvCell } from "../links/links.service.js";

type FormRow = typeof forms.$inferSelect;

@Injectable()
export class FormsService {
  constructor(@Inject(DB) private readonly db: Database) {}
  private readonly logger = new Logger(FormsService.name);

  async list(workspaceId: string): Promise<Form[]> {
    const rows = await this.db
      .select()
      .from(forms)
      .where(eq(forms.workspaceId, workspaceId))
      .orderBy(desc(forms.createdAt));
    return rows.map(toDto);
  }

  async get(workspaceId: string, id: string): Promise<Form> {
    const [row] = await this.db
      .select()
      .from(forms)
      .where(and(eq(forms.id, id), eq(forms.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw new NotFoundException("That form doesn't exist, or isn't in this workspace.");
    return toDto(row);
  }

  async create(workspaceId: string, actor: Actor, input: CreateFormInput): Promise<Form> {
    if (input.slug) {
      const shape = isSlugAvailableShape(input.slug);
      if (!shape.ok) throw new BadRequestException(shape.reason ?? "That address isn't usable.");
    }

    /* Keys are assigned here, once, and never again. Editing a label later
       rewrites what the form says without touching what its answers mean. */
    const fields = withFieldKeys(input.fields);

    try {
      const [row] = await this.db
        .insert(forms)
        .values({
          workspaceId,
          slug: input.slug || generateSlug(),
          title: input.title.trim(),
          description: input.description ?? "",
          status: input.status,
          fields,
        })
        .returning();

      const dto = toDto(row!);
      await recordActivity(this.db, this.logger, {
        workspaceId,
        actor,
        auditAction: "form.created",
        targetType: "form",
        targetId: dto.id,
        metadata: { slug: dto.slug, title: dto.title },
      });
      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`/f/${input.slug} is already taken. Try another address.`);
      }
      throw err;
    }
  }

  async update(workspaceId: string, id: string, actor: Actor, input: UpdateFormInput): Promise<Form> {
    await this.get(workspaceId, id);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined) patch.status = input.status;
    // Fields arriving with a key keep it; only genuinely new ones get one.
    if (input.fields !== undefined) patch.fields = withFieldKeys(input.fields);

    await this.db.update(forms).set(patch).where(and(eq(forms.id, id), eq(forms.workspaceId, workspaceId)));

    const dto = await this.get(workspaceId, id);
    await recordActivity(this.db, this.logger, {
      workspaceId,
      actor,
      auditAction: "form.updated",
      targetType: "form",
      targetId: id,
      metadata: { slug: dto.slug },
    });
    return dto;
  }

  async remove(workspaceId: string, id: string, actor: Actor): Promise<void> {
    const form = await this.get(workspaceId, id);
    // Responses cascade. That is the point: deleting a form is how a workspace
    // disposes of what people typed into it.
    await this.db.delete(forms).where(and(eq(forms.id, id), eq(forms.workspaceId, workspaceId)));
    await recordActivity(this.db, this.logger, {
      workspaceId,
      actor,
      auditAction: "form.deleted",
      targetType: "form",
      targetId: id,
      metadata: { slug: form.slug, responses: form.responseCount },
    });
  }

  async responses(workspaceId: string, id: string, limit = 100): Promise<FormResponseList> {
    const form = await this.get(workspaceId, id);
    const rows = await this.db
      .select()
      .from(formResponses)
      .where(eq(formResponses.formId, id))
      .orderBy(desc(formResponses.submittedAt))
      .limit(limit);

    return {
      items: rows.map((r) => ({
        id: r.id,
        answers: r.answers,
        submittedAt: r.submittedAt.toISOString(),
      })),
      total: form.responseCount,
      columns: exportColumns(form.fields, rows),
    };
  }

  /**
   * Export every response.
   *
   * Columns are the union of the form's current fields and every key any
   * response carries, so a field deleted last week still exports the answers
   * people gave it. See docs/DECISIONS.md.
   */
  async *exportCsv(workspaceId: string, id: string): AsyncGenerator<string> {
    const form = await this.get(workspaceId, id);
    const rows = await this.db
      .select()
      .from(formResponses)
      .where(eq(formResponses.formId, id))
      .orderBy(desc(formResponses.submittedAt));

    const keys = exportColumns(form.fields, rows);
    const labels = new Map(form.fields.map((f) => [f.key, f.label]));
    // Header uses labels where the field still exists, and the raw key where
    // it does not — an honest "this came from something since removed".
    yield `${["submitted_at", ...keys.map((k) => labels.get(k) ?? k)].map(csvCell).join(",")}\n`;

    for (const row of rows) {
      yield `${[row.submittedAt.toISOString(), ...keys.map((k) => row.answers[k] ?? "")].map(csvCell).join(",")}\n`;
    }
  }

  /* ---------------- public ---------------- */

  async publicForm(slug: string): Promise<PublicForm> {
    const [row] = await this.db
      .select({ form: forms, workspace: workspaces.name })
      .from(forms)
      .innerJoin(workspaces, eq(forms.workspaceId, workspaces.id))
      .where(sql`lower(${forms.slug}) = ${slug.toLowerCase()}`)
      .limit(1);

    // A draft or closed form is not found rather than forbidden: whether a
    // workspace has a form at this address is not a stranger's business.
    if (!row || row.form.status !== "live") throw new NotFoundException("There's no form at that address.");

    return {
      slug: row.form.slug,
      title: row.form.title,
      description: row.form.description,
      fields: row.form.fields,
      workspace: row.workspace,
    };
  }

  async submit(slug: string, input: SubmitFormInput): Promise<SubmitFormResult> {
    const [row] = await this.db
      .select()
      .from(forms)
      .where(sql`lower(${forms.slug}) = ${slug.toLowerCase()}`)
      .limit(1);
    if (!row || row.status !== "live") throw new NotFoundException("There's no form at that address.");

    const result = validateSubmission(row.fields, input.answers);
    if (!result.ok) return { ok: false, errors: result.errors };

    await this.db.transaction(async (tx) => {
      await tx.insert(formResponses).values({
        formId: row.id,
        workspaceId: row.workspaceId,
        answers: result.answers,
      });
      // Incremented rather than recounted: a form's response count is only
      // ever read for display, and a count query per submission is a cost the
      // public endpoint should not carry.
      await tx
        .update(forms)
        .set({ responseCount: sql`${forms.responseCount} + 1` })
        .where(eq(forms.id, row.id));
    });

    return { ok: true, errors: {} };
  }
}

function toDto(row: FormRow): Form {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status as Form["status"],
    fields: row.fields,
    responseCount: row.responseCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
