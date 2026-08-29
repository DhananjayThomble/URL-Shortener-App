"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  Form,
  FormResponseList,
  PublicForm,
  SubmitFormResult,
  type CreateFormInput,
  type UpdateFormInput,
} from "@snapurl/contract";
import { request, API_URL, tokens } from "../client";
import { qk } from "./keys";

export function useForms() {
  return useQuery({ queryKey: qk.forms(), queryFn: () => request("/forms", z.array(Form)) });
}

export function useForm(id: string) {
  return useQuery({
    queryKey: qk.form(id),
    queryFn: () => request(`/forms/${id}`, Form),
    enabled: Boolean(id),
  });
}

export function useFormResponses(id: string) {
  return useQuery({
    queryKey: qk.formResponses(id),
    queryFn: () => request(`/forms/${id}/responses`, FormResponseList),
    enabled: Boolean(id),
  });
}

export function useCreateForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFormInput) => request("/forms", Form, { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forms"] }),
  });
}

export function useUpdateForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateFormInput & { id: string }) =>
      request(`/forms/${id}`, Form, { method: "PATCH", body: input }),
    onSuccess: (form) => {
      qc.setQueryData(qk.form(form.id), form);
      qc.invalidateQueries({ queryKey: ["forms"] });
    },
  });
}

export function useDeleteForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/forms/${id}`, z.undefined(), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forms"] }),
  });
}

/* ---------------- public ---------------- */

/** What a visitor at /f/<slug> sees. No auth, and no workspace internals. */
export function usePublicForm(slug: string) {
  return useQuery({
    queryKey: qk.publicForm(slug),
    queryFn: () => request(`/public/forms/${encodeURIComponent(slug)}`, PublicForm),
    enabled: Boolean(slug),
    retry: false,
  });
}

export function useSubmitForm(slug: string) {
  return useMutation({
    mutationFn: (answers: Record<string, string>) =>
      request(`/public/forms/${encodeURIComponent(slug)}`, SubmitFormResult, {
        method: "POST",
        body: { answers },
      }),
  });
}

/**
 * Download a form's responses as CSV.
 *
 * Same shape as the links export and for the same reason: the endpoint needs
 * an Authorization header and an anchor cannot send one.
 */
export function useExportResponses() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (formId: string, name: string) => {
    setExporting(true);
    setError(null);
    let url: string | null = null;
    try {
      const res = await fetch(`${API_URL}/forms/${formId}/responses.csv`, {
        headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name || "responses"}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      if (url) URL.revokeObjectURL(url);
      setExporting(false);
    }
  };

  return { run, exporting, error };
}
