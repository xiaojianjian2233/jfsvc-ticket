import { rawRequest } from "./client";

export interface SlaLevelItem {
  id: string; // SEVERLEVEL#### 流水号主键，前端不展示
  code: string;
  name: string;
  sort_order: number;
  issue_levels: string;
  issue_types: string;
  sla_hours: number;
  source_system: string;
  source_system_field: string;
  source_system_code: string;
  updated_by?: string | null;
  updated_at?: string | null;
}

export interface SlaLevelFormData {
  name: string;
  issue_levels: string;
  issue_types: string;
  sla_hours: number;
  source_system: string;
  source_system_field: string;
  source_system_code: string;
  sort_order?: number;
}

const DEFAULT_MOCK_SLA_LEVELS: SlaLevelItem[] = [
  {
    id: "SEVERLEVEL0001",
    code: "22",
    name: "标准成功服务（2023版）",
    sort_order: 1,
    issue_levels: "P0、P1、P2、P3",
    issue_types: "不限",
    sla_hours: 40,
    source_system: "KSM",
    source_system_field: "serviceLevel",
    source_system_code: "22",
    updated_by: "杨慧莉",
    updated_at: "2026-09-10T14:20:00+08:00",
  },
  {
    id: "SEVERLEVEL0002",
    code: "54",
    name: "高级成功服务（含定制开发维）",
    sort_order: 2,
    issue_levels: "P0、P1、P2、P3",
    issue_types: "不限",
    sla_hours: 24,
    source_system: "KSM",
    source_system_field: "serviceLevel",
    source_system_code: "54",
    updated_by: "杨慧莉",
    updated_at: "2026-09-10T14:20:00+08:00",
  },
  {
    id: "SEVERLEVEL0003",
    code: "52",
    name: "高级成功服务（仅工单）",
    sort_order: 3,
    issue_levels: "P0、P1、P2、P3",
    issue_types: "不限",
    sla_hours: 32,
    source_system: "KSM",
    source_system_field: "serviceLevel",
    source_system_code: "52",
    updated_by: "杨慧莉",
    updated_at: "2026-09-10T14:20:00+08:00",
  },
  {
    id: "SEVERLEVEL0004",
    code: "55",
    name: "高级成功服务（2023版）",
    sort_order: 4,
    issue_levels: "P0、P1、P2、P3",
    issue_types: "不限",
    sla_hours: 24,
    source_system: "KSM",
    source_system_field: "serviceLevel",
    source_system_code: "55",
    updated_by: "杨慧莉",
    updated_at: "2026-09-10T14:20:00+08:00",
  },
  {
    id: "SEVERLEVEL0005",
    code: "50",
    name: "战略客户绿色通道",
    sort_order: 5,
    issue_levels: "P0、P1",
    issue_types: "应用类、Bug修复",
    sla_hours: 8,
    source_system: "KSM",
    source_system_field: "serviceLevel",
    source_system_code: "50",
    updated_by: "杨慧莉",
    updated_at: "2026-09-10T14:20:00+08:00",
  },
  {
    id: "SEVERLEVEL0006",
    code: "10",
    name: "服务期外",
    sort_order: 6,
    issue_levels: "P3",
    issue_types: "不限",
    sla_hours: 72,
    source_system: "KSM",
    source_system_field: "serviceLevel",
    source_system_code: "10",
    updated_by: "杨慧莉",
    updated_at: "2026-09-10T14:20:00+08:00",
  },
  {
    id: "SEVERLEVEL0007",
    code: "19",
    name: "标准成功服务",
    sort_order: 7,
    issue_levels: "P0、P1、P2、P3",
    issue_types: "不限",
    sla_hours: 48,
    source_system: "KSM",
    source_system_field: "serviceLevel",
    source_system_code: "19",
    updated_by: "杨慧莉",
    updated_at: "2026-09-10T14:20:00+08:00",
  },
];

function getStoredLocalSla(): SlaLevelItem[] {
  try {
    const raw = localStorage.getItem("local_sla_levels");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore parse error
  }
  localStorage.setItem("local_sla_levels", JSON.stringify(DEFAULT_MOCK_SLA_LEVELS));
  return DEFAULT_MOCK_SLA_LEVELS;
}

function saveStoredLocalSla(items: SlaLevelItem[]) {
  localStorage.setItem("local_sla_levels", JSON.stringify(items));
}

export const adminSlaApi = {
  list: async () => {
    try {
      return await rawRequest<SlaLevelItem[]>("/api/admin/sla-levels", { method: "GET" });
    } catch {
      return getStoredLocalSla();
    }
  },
  create: async (data: SlaLevelFormData) => {
    try {
      return await rawRequest<SlaLevelItem>("/api/admin/sla-levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch {
      const current = getStoredLocalSla();
      const maxNum = current.reduce((acc, cur) => {
        const num = parseInt(cur.id.replace("SEVERLEVEL", ""), 10);
        return isNaN(num) ? acc : Math.max(acc, num);
      }, 0);
      const nextId = `SEVERLEVEL${String(maxNum + 1).padStart(4, "0")}`;
      const now = new Date().toISOString();
      const newItem: SlaLevelItem = {
        id: nextId,
        code: data.source_system_code,
        name: data.name,
        sort_order: data.sort_order ?? current.length + 1,
        issue_levels: data.issue_levels,
        issue_types: data.issue_types,
        sla_hours: data.sla_hours,
        source_system: data.source_system,
        source_system_field: data.source_system_field,
        source_system_code: data.source_system_code,
        updated_by: "当前用户",
        updated_at: now,
      };
      const updated = [...current, newItem];
      saveStoredLocalSla(updated);
      return newItem;
    }
  },
  update: async (id: string, data: SlaLevelFormData) => {
    try {
      return await rawRequest<SlaLevelItem>(`/api/admin/sla-levels/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch {
      const current = getStoredLocalSla();
      const now = new Date().toISOString();
      const updated = current.map((item) => {
        if (item.id === id) {
          return {
            ...item,
            name: data.name,
            issue_levels: data.issue_levels,
            issue_types: data.issue_types,
            sla_hours: data.sla_hours,
            source_system: data.source_system,
            source_system_field: data.source_system_field,
            source_system_code: data.source_system_code,
            code: data.source_system_code,
            updated_by: "当前用户",
            updated_at: now,
          };
        }
        return item;
      });
      saveStoredLocalSla(updated);
      const matched = updated.find((i) => i.id === id);
      return matched!;
    }
  },
};
