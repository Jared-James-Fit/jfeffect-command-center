/**
 * Local persistence for an in-progress planner session.
 * Keyed by (clientId, templateId). Survives refresh + accidental navigation.
 */
import type { PlannerSelection, AssignmentMethod, Weekday, ConflictDecision, PublishStatus } from "./types";

export interface PlannerDraft {
  step: number;
  selection: PlannerSelection;
  method: AssignmentMethod;
  trainingDays: Weekday[];
  startDate: string | null;
  manualDateMap: Record<string, string>;
  conflictDecisions: Record<string, ConflictDecision>;
  publishStatus: PublishStatus;
  publishAt: string | null;
  idempotencyKey: string;
  updatedAt: number;
}

function keyFor(clientId: string, templateId: string) {
  return `assignment-draft:${clientId}:${templateId}`;
}

export function loadDraft(clientId: string, templateId: string): PlannerDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(clientId, templateId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as PlannerDraft;
  } catch {
    return null;
  }
}

export function saveDraft(clientId: string, templateId: string, draft: PlannerDraft): void {
  try {
    localStorage.setItem(keyFor(clientId, templateId), JSON.stringify({ ...draft, updatedAt: Date.now() }));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function clearDraft(clientId: string, templateId: string): void {
  try { localStorage.removeItem(keyFor(clientId, templateId)); } catch { /* noop */ }
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}