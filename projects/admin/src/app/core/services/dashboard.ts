import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';

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

export interface DashboardData {
  newLeads: DashboardNewLead[];
  stalledDrafts: DashboardStalledDraft[];
  monthly: DashboardMonthlySummary;
}

const LIST_LIMIT = 10;
const TOP_DESTINATIONS_LIMIT = 5;

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private readonly supabase = inject(SupabaseService);

  async load(): Promise<DashboardData> {
    const [newLeads, stalledDrafts, monthly] = await Promise.all([
      this.fetchNewLeads(),
      this.fetchStalledDrafts(),
      this.fetchMonthlySummary()
    ]);

    return { newLeads, stalledDrafts, monthly };
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
