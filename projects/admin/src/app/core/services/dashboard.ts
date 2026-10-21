import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { AuditLogService, AuditLogItem } from './audit-log';

export interface DashboardNewLead {
  id: string;
  name: string;
  destinationInterestText: string | null;
  createdAt: string;
}

export interface DashboardStalledDraft {
  id: string;
  title: string;
  updatedAt: string;
}

export interface DashboardMonthlySummary {
  totalLeads: number;
  responseRate: number;
  topDestinations: Array<{ label: string; count: number }>;
}

export interface DashboardCounts {
  newLeads: number;
  publishedDestinations: number;
  draftDestinations: number;
}

export interface DashboardData {
  newLeads: DashboardNewLead[];
  stalledDrafts: DashboardStalledDraft[];
  monthly: DashboardMonthlySummary;
  counts: DashboardCounts;
  recentActivity: AuditLogItem[];
}

export interface AdvisorProposalRow {
  id: string;
  clientName: string;
  title: string | null;
  status: string;
  updatedAt: string;
  feedbackSentAt: string | null;
  commentCount: number;
}

/** Dashboard de la asesora: solo lo suyo (las policies RLS ya filtran por
 *  asesora asignada, aqui no se vuelve a filtrar por id). */
export interface AdvisorDashboardData {
  newLeads: DashboardNewLead[];
  counts: {
    newLeads: number;
    monthLeads: number;
    drafts: number;
    awaitingClient: number;
    feedback: number;
    accepted: number;
  };
  feedbackProposals: AdvisorProposalRow[];
  recentProposals: AdvisorProposalRow[];
}

const LIST_LIMIT = 10;
const TOP_DESTINATIONS_LIMIT = 5;

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private readonly supabase = inject(SupabaseService);
  private readonly auditLog = inject(AuditLogService);

  async load(): Promise<DashboardData> {
    const [newLeads, stalledDrafts, monthly, counts, recentActivity] = await Promise.all([
      this.fetchNewLeads(),
      this.fetchStalledDrafts(),
      this.fetchMonthlySummary(),
      this.fetchCounts(),
      this.auditLog.listRecent()
    ]);

    return { newLeads, stalledDrafts, monthly, counts, recentActivity };
  }

  async loadAdvisor(): Promise<AdvisorDashboardData> {
    const [newLeads, monthly, proposalsResult] = await Promise.all([
      this.fetchNewLeads(),
      this.fetchMonthlySummary(),
      this.supabase.client
        .from('proposals')
        .select('id, client_name, title, status, updated_at, feedback_sent_at, service_comments')
        // El panel habla de «Propuestas»: los itinerarios no se mezclan en sus conteos ni listas.
        .eq('kind', 'proposal')
        .order('updated_at', { ascending: false })
        .limit(200)
    ]);

    if (proposalsResult.error) {
      throw proposalsResult.error;
    }

    const proposals: AdvisorProposalRow[] = (proposalsResult.data ?? []).map((row) => ({
      id: row.id,
      clientName: row.client_name,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      feedbackSentAt: row.feedback_sent_at ?? null,
      commentCount: Object.values(row.service_comments ?? {}).filter((text) => typeof text === 'string' && text.trim()).length
    }));

    const feedbackProposals = proposals.filter((p) => p.feedbackSentAt && p.status !== 'accepted');

    return {
      newLeads,
      counts: {
        newLeads: newLeads.length,
        monthLeads: monthly.totalLeads,
        drafts: proposals.filter((p) => p.status === 'draft').length,
        awaitingClient: proposals.filter((p) => p.status === 'published' || p.status === 'viewed').length,
        feedback: feedbackProposals.length,
        accepted: proposals.filter((p) => p.status === 'accepted').length
      },
      feedbackProposals: feedbackProposals.slice(0, LIST_LIMIT),
      recentProposals: proposals.slice(0, LIST_LIMIT)
    };
  }

  private async fetchCounts(): Promise<DashboardCounts> {
    const [newLeadsCount, publishedCount, draftCount] = await Promise.all([
      this.supabase.client.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'nueva'),
      this.supabase.client
        .from('destinations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'published'),
      this.supabase.client.from('destinations').select('id', { count: 'exact', head: true }).eq('status', 'draft')
    ]);

    if (newLeadsCount.error) {
      throw newLeadsCount.error;
    }
    if (publishedCount.error) {
      throw publishedCount.error;
    }
    if (draftCount.error) {
      throw draftCount.error;
    }

    return {
      newLeads: newLeadsCount.count ?? 0,
      publishedDestinations: publishedCount.count ?? 0,
      draftDestinations: draftCount.count ?? 0
    };
  }

  private async fetchNewLeads(): Promise<DashboardNewLead[]> {
    const { data, error } = await this.supabase.client
      .from('leads')
      .select('id, name, destination_interest_text, created_at')
      .eq('status', 'nueva')
      .order('created_at', { ascending: true })
      .limit(LIST_LIMIT);

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      destinationInterestText: row.destination_interest_text,
      createdAt: row.created_at
    }));
  }

  private async fetchStalledDrafts(): Promise<DashboardStalledDraft[]> {
    const { data, error } = await this.supabase.client
      .from('destinations')
      .select('id, title, updated_at')
      .eq('status', 'draft')
      .order('updated_at', { ascending: true })
      .limit(LIST_LIMIT);

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at }));
  }

  private async fetchMonthlySummary(): Promise<DashboardMonthlySummary> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data, error } = await this.supabase.client
      .from('leads')
      .select('status, destination_interest_text')
      .gte('created_at', startOfMonth.toISOString());

    if (error) {
      throw error;
    }

    const rows = data ?? [];
    const total = rows.length;
    const responded = rows.filter((row) => row.status !== 'nueva').length;

    const counts = new Map<string, number>();
    for (const row of rows) {
      const label = row.destination_interest_text?.trim();
      if (!label) {
        continue;
      }
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    const topDestinations = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_DESTINATIONS_LIMIT)
      .map(([label, count]) => ({ label, count }));

    return {
      totalLeads: total,
      responseRate: total > 0 ? Math.round((responded / total) * 100) : 0,
      topDestinations
    };
  }
}
