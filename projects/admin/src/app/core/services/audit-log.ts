import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { ProfilesService } from './profiles';
import { AuditLogEntry, toAuditLogEntry } from '../models/audit-log.model';

export interface AuditLogItem extends AuditLogEntry {
  actorName: string;
}

const DEFAULT_LIMIT = 10;

@Injectable({
  providedIn: 'root'
})
export class AuditLogService {
  private readonly supabase = inject(SupabaseService);
  private readonly profiles = inject(ProfilesService);

  async listRecent(limit = DEFAULT_LIMIT): Promise<AuditLogItem[]> {
    const [{ data, error }, names] = await Promise.all([
      this.supabase.client.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit),
      this.profiles.nameMap()
    ]);

    if (error) {
      throw error;
    }
    return this.withActorNames(data, names);
  }

  async listByActor(actorId: string, limit = DEFAULT_LIMIT): Promise<AuditLogItem[]> {
    const [{ data, error }, names] = await Promise.all([
      this.supabase.client
        .from('audit_log')
        .select('*')
        .eq('actor_id', actorId)
        .order('created_at', { ascending: false })
        .limit(limit),
      this.profiles.nameMap()
    ]);

    if (error) {
      throw error;
    }
    return this.withActorNames(data, names);
  }

  private withActorNames(
    rows: Parameters<typeof toAuditLogEntry>[0][] | null,
    names: Map<string, string>
  ): AuditLogItem[] {
    return (rows ?? []).map(toAuditLogEntry).map((entry) => ({
      ...entry,
      actorName: (entry.actorId && names.get(entry.actorId)) || 'Alguien del equipo'
    }));
  }
}
