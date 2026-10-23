// Reports, account standing, and moderation. Moderator functions refuse
// anyone who isn't in the moderators table.

import { supabase } from '@/lib/supabase';

export type ReportTarget = 'post' | 'comment' | 'profile';

export const REPORT_REASONS: { reason: string; label: string }[] = [
  { reason: 'hate', label: 'Hate based on who someone is' },
  { reason: 'threat', label: 'A threat of violence or harm' },
  { reason: 'self_harm_encouragement', label: 'Encouraging someone to hurt themselves' },
  { reason: 'harassment', label: 'Harassment or degrading insults' },
  { reason: 'sexual', label: 'Sexual content aimed at someone' },
  { reason: 'doxxing', label: 'Sharing private information' },
  { reason: 'other', label: 'Something else' },
];

export type MyStatus = {
  crisis_support_until: string | null;
  comment_paused: boolean;
  suspended_until: string | null;
  banned: boolean;
  is_moderator: boolean;
};

export type Decision = {
  report_id: string;
  target_type: ReportTarget;
  reason: string;
  decision: string;
  decided_at: string;
  appeal_status: string | null;
};

export type QueueItem = {
  report_id: string;
  target_type: ReportTarget;
  target_id: string;
  reason: string;
  details: string;
  content: string | null;
  author_username: string | null;
  author_prior_actions: number;
  report_count: number;
  created_at: string;
};

export type PauseItem = {
  username: string;
  attempts: { category: string; excerpt: string; at: string }[];
  paused_at: string;
};

export type AppealItem = {
  appeal_id: string;
  reason: string;
  decision: string;
  message: string;
  author_username: string;
  created_at: string;
};

export const DECISION_LABELS: Record<string, string> = {
  warn: 'Content removed and a warning',
  suspend_7: 'Content removed and a 7-day suspension',
  suspend_30: 'Content removed and a 30-day suspension',
  ban: 'Content removed and a permanent ban',
};

function check<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function myStatus(): Promise<MyStatus | null> {
  const rows: MyStatus[] = check(await supabase.rpc('my_status')) ?? [];
  return rows[0] ?? null;
}

export function inCrisisSupport(status: MyStatus | null | undefined) {
  return Boolean(status?.crisis_support_until && new Date(status.crisis_support_until) > new Date());
}

export async function report(targetType: ReportTarget, targetId: string, reason: string, details: string) {
  check(
    await supabase.rpc('report_content', {
      target_type: targetType,
      target_id: targetId,
      reason,
      details,
    }),
  );
}

export async function myDecisions(): Promise<Decision[]> {
  return check(await supabase.rpc('my_decisions')) ?? [];
}

export async function appeal(reportId: string, message: string) {
  check(await supabase.rpc('appeal', { report_id: reportId, message }));
}

export async function reviewQueue(): Promise<QueueItem[]> {
  return check(await supabase.rpc('review_queue')) ?? [];
}

export async function decideReport(reportId: string, decision: string, badFaith = false) {
  check(await supabase.rpc('decide_report', { report_id: reportId, decision, bad_faith: badFaith }));
}

export async function pauseQueue(): Promise<PauseItem[]> {
  return check(await supabase.rpc('pause_queue')) ?? [];
}

export async function decidePause(username: string, decision: string) {
  check(await supabase.rpc('decide_pause', { username, decision }));
}

export async function appealQueue(): Promise<AppealItem[]> {
  return check(await supabase.rpc('appeal_queue')) ?? [];
}

export async function decideAppeal(appealId: string, overturn: boolean) {
  check(await supabase.rpc('decide_appeal', { appeal_id: appealId, overturn }));
}
