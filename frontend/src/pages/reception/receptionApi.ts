/**
 * API client and state management for 在线接待管理 (Reception Management).
 * Supports live backend endpoints with resilient client-side fallback/mock storage
 * so that the UI is fully functional in development.
 */

import { rawRequest } from "@/api/client";

async function httpGet<T>(path: string, query?: Record<string, any>): Promise<T> {
  return rawRequest<T>(path, { method: "GET" }, query);
}

async function httpPost<T>(path: string, body?: unknown): Promise<T> {
  return rawRequest<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function httpPut<T>(path: string, body?: unknown): Promise<T> {
  return rawRequest<T>(path, {
    method: "PUT",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export interface AgentItem {
  id: number;
  user_id: number;
  user_name: string;
  nickname: string;
  max_concurrent: number;
  status: "online" | "busy" | "offline";
  created_at: string;
  updated_at: string;
}

export interface EligibleUser {
  id: number;
  name: string;
  email?: string | null;
  role: string;
}

export interface SessionItem {
  id: string;
  company_name: string;
  tax_no?: string | null;
  tenant_no?: string | null;
  tenant_name?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  status: "queue" | "in_progress" | "pending" | "converted" | "closed";
  is_human: boolean;
  agent_user_id?: number | null;
  agent_name: string;
  ticket_id?: number | null;
  ticket_short_code?: string | null;
  summary?: string | null;
  session_type: "online" | "hotline";
  hotline_status?: "answered" | "missed" | null;
  unread_count: number;
  last_message?: string | null;
  last_message_at?: string | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  purchased_products?: string[];
  is_in_service?: string;
}

export interface MessageItem {
  id: number;
  session_id: string;
  sender_type: "customer" | "agent" | "bot" | "system";
  sender_name: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export interface WorkbenchQueueData {
  counts: {
    online_queue: number;
    online_in_progress: number;
    online_pending: number;
    online_closed: number;
    hotline_answered: number;
    hotline_missed: number;
  };
  sessions: {
    online_in_progress: SessionItem[];
    online_queue: SessionItem[];
    online_pending: SessionItem[];
    online_closed: SessionItem[];
    hotline_answered: SessionItem[];
    hotline_missed: SessionItem[];
  };
}

export interface AssistantSearchItem {
  id: string;
  title: string;
  snippet: string;
  type: "knowledge" | "ticket" | "order" | "benefit";
}

export interface ScheduleSlot {
  start: string;
  end: string;
}

export interface ScheduleSettings {
  weekday_slots: ScheduleSlot[];
  weekend_slots: ScheduleSlot[];
}

export const DEFAULT_SCHEDULE_SETTINGS: ScheduleSettings = {
  weekday_slots: [
    { start: "09:00", end: "11:45" },
    { start: "13:30", end: "18:00" },
  ],
  weekend_slots: [
    { start: "09:00", end: "11:45" },
    { start: "13:30", end: "18:00" },
  ],
};

// ----------------------------------------------------------------------------
// Local persistent fallback mock state
// ----------------------------------------------------------------------------

const SEED_AGENTS: AgentItem[] = [
  {
    id: 1,
    user_id: 35,
    user_name: "杨慧莉",
    nickname: "慧莉客服",
    max_concurrent: 10,
    status: "online",
    created_at: "2026-09-18 09:00:00",
    updated_at: "2026-09-18 09:00:00",
  },
  {
    id: 2,
    user_id: 2,
    user_name: "张工",
    nickname: "技术专家-小张",
    max_concurrent: 5,
    status: "busy",
    created_at: "2026-09-18 09:15:00",
    updated_at: "2026-09-18 09:15:00",
  },
  {
    id: 3,
    user_id: 1,
    user_name: "管理员",
    nickname: "总服01",
    max_concurrent: 8,
    status: "offline",
    created_at: "2026-09-18 08:30:00",
    updated_at: "2026-09-18 08:30:00",
  },
];

const SEED_SESSIONS: SessionItem[] = [
  {
    id: "ZXHH202609180001",
    company_name: "腾讯科技（深圳）有限公司",
    tax_no: "91440300708461136T",
    tenant_no: "TENANT-TX-001",
    tenant_name: "腾讯集团财务云租户",
    contact_name: "李经理",
    contact_phone: "13800138000",
    status: "in_progress",
    is_human: true,
    agent_name: "杨慧莉",
    summary: "数电发票开具额度不足，咨询月度临时额度调整审批流程与乐企专线互通要求。",
    session_type: "online",
    unread_count: 2,
    last_message: "请问提交额度申请后通常多久可以在乐企平台看到生效？",
    last_message_at: "2026-09-18 14:32:00",
    created_at: "2026-09-18 14:15:00",
    updated_at: "2026-09-18 14:32:00",
    purchased_products: ["发票云乐企直连版", "数电发票进项底账包"],
    is_in_service: "是（服务期至 2027-12-31）",
  },
  {
    id: "ZXHH202609180002",
    company_name: "阿里巴巴（中国）网络技术有限公司",
    tax_no: "91330100716105852F",
    tenant_no: "TENANT-ALI-002",
    tenant_name: "阿里企业云租户",
    contact_name: "王总监",
    contact_phone: "13912345678",
    status: "queue",
    is_human: true,
    agent_name: "待接入",
    summary: "乐企直连接口签名验签偶发502错误，请求紧急转人工协助排查。",
    session_type: "online",
    unread_count: 1,
    last_message: "您好，我们今天下午生产环境乐企批量开票接口有几笔报错502，请人工支持定位一下。",
    last_message_at: "2026-09-18 14:40:00",
    created_at: "2026-09-18 14:40:00",
    updated_at: "2026-09-18 14:40:00",
    purchased_products: ["数电发票企业专享版", "乐企直连高可用通道"],
    is_in_service: "是（服务期内）",
  },
  {
    id: "ZXHH202609180003",
    company_name: "北京京东世纪贸易有限公司",
    tax_no: "911103027993427339",
    tenant_no: "TENANT-JD-003",
    tenant_name: "京东供应链财税中心",
    contact_name: "陈主管",
    contact_phone: "13700001111",
    status: "pending",
    is_human: true,
    agent_name: "杨慧莉",
    summary: "销方已发起红字发票确认单，购方系统核实因科目映射失败无法自动确认。",
    session_type: "online",
    unread_count: 0,
    last_message: "你的问题，技术人员正在分析处理中，需要点时间定位问题，收到结论后同步给你。",
    last_message_at: "2026-09-18 12:10:00",
    created_at: "2026-09-18 11:20:00",
    updated_at: "2026-09-18 12:10:00",
    purchased_products: ["发票云敏捷版"],
    is_in_service: "是（服务期内）",
  },
  {
    id: "ZXHH202609180004",
    company_name: "字节跳动科技有限公司",
    tax_no: "91110108710929272W",
    tenant_no: "TENANT-BD-004",
    tenant_name: "字节全球结算中心",
    contact_name: "张经理",
    contact_phone: "18611112222",
    status: "converted",
    is_human: true,
    agent_name: "杨慧莉",
    ticket_short_code: "TKT-006625",
    summary: "海外结算场景特定税率栏次校验异常导致保存失败，已转研发跟进修复。",
    session_type: "online",
    unread_count: 0,
    last_message: "您的问题需要转工单推送到产研修复，已经帮您创建工单，工单号 TKT-006625，后续工单进度会通过短信通知。",
    last_message_at: "2026-09-18 10:45:00",
    created_at: "2026-09-18 10:00:00",
    updated_at: "2026-09-18 10:45:00",
    purchased_products: ["发票云全球跨境版"],
    is_in_service: "是（服务期内）",
  },
  {
    id: "ZXHH202609180005",
    company_name: "美团点评网络技术有限公司",
    tax_no: "911101050513871587",
    tenant_no: "TENANT-MT-005",
    tenant_name: "美团商户财税平台",
    contact_name: "赵工",
    contact_phone: "13566667777",
    status: "closed",
    is_human: true,
    agent_name: "张工",
    summary: "咨询发票云批量导出月度报表时字段映射配置，指导完成后客户确认解决关闭。",
    session_type: "online",
    unread_count: 0,
    last_message: "您的问题已解决，本次会话已结束，后续如有其他使用问题，可发起新的会话咨询。",
    last_message_at: "2026-09-18 09:30:00",
    created_at: "2026-09-18 09:00:00",
    updated_at: "2026-09-18 09:30:00",
    closed_at: "2026-09-18 09:30:00",
    purchased_products: ["发票云标准版"],
    is_in_service: "是（服务期内）",
  },
  {
    id: "ZXHH202609180006",
    company_name: "小米通讯技术有限公司",
    tax_no: "911101085585514006",
    tenant_no: "TENANT-MI-006",
    tenant_name: "小米供应链租户",
    contact_name: "孙主管",
    contact_phone: "13988889999",
    status: "closed",
    is_human: false,
    agent_name: "Agent",
    summary: "智能助手自动解答数电发票板式文件下载格式说明（PDF与OFD兼容性）。",
    session_type: "online",
    unread_count: 0,
    last_message: "Agent 已为您解答完成，如有其他问题可随时发送。",
    last_message_at: "2026-09-18 08:20:00",
    created_at: "2026-09-18 08:15:00",
    updated_at: "2026-09-18 08:20:00",
    purchased_products: ["发票云敏捷版"],
    is_in_service: "是（服务期内）",
  },
  // 热线接待样本
  {
    id: "ZXHH202609180007",
    company_name: "网易（杭州）网络有限公司",
    tax_no: "91330100788258385W",
    tenant_no: "TENANT-NE-007",
    tenant_name: "网易严选财税中台",
    contact_name: "周主管",
    contact_phone: "13699990000",
    status: "closed",
    is_human: true,
    agent_name: "杨慧莉",
    summary: "400热线电话咨询大促期间批量红冲发票限流阈值调整，已电话沟通指导开具。",
    session_type: "hotline",
    hotline_status: "answered",
    unread_count: 0,
    last_message: "【电话语音接待记录】：通话时长 05分32秒，已向客户说明红字发票确认单审批生效时间。",
    last_message_at: "2026-09-18 11:00:00",
    created_at: "2026-09-18 10:55:00",
    updated_at: "2026-09-18 11:00:00",
    purchased_products: ["发票云乐企直连版"],
    is_in_service: "是（服务期内）",
  },
  {
    id: "ZXHH202609180008",
    company_name: "快手科技有限公司",
    tax_no: "91110108MA002X5D3E",
    tenant_no: "TENANT-KS-008",
    tenant_name: "快手电商结算平台",
    contact_name: "吴经理",
    contact_phone: "15812345678",
    status: "closed",
    is_human: true,
    agent_name: "杨慧莉",
    summary: "400热线未接听来电，系统已触发短信提醒客户可在工作时间回拨或发起在线咨询。",
    session_type: "hotline",
    hotline_status: "missed",
    unread_count: 0,
    last_message: "【热线未接听记录】：响铃 28 秒未接听，已自动下发短信回执通知。",
    last_message_at: "2026-09-18 12:40:00",
    created_at: "2026-09-18 12:40:00",
    updated_at: "2026-09-18 12:40:00",
    purchased_products: ["发票云标准版"],
    is_in_service: "是（服务期内）",
  },
];

const SEED_MESSAGES: Record<string, MessageItem[]> = {
  ZXHH202609180001: [
    {
      id: 1,
      session_id: "ZXHH202609180001",
      sender_type: "customer",
      sender_name: "李经理",
      content: "您好，我们腾讯财务今天开具数电发票提示「发票额度不足」，请问如何申请临时加额？",
      is_read: true,
      created_at: "2026-09-18 14:15:10",
    },
    {
      id: 2,
      session_id: "ZXHH202609180001",
      sender_type: "bot",
      sender_name: "Agent",
      content: "您好！数电发票额度由电子税务局「税务数字账户」统一授信。如需临时加额，可登录电子发票服务平台提交【调整额度申请】。正在为您转接专属坐席协助排查...",
      is_read: true,
      created_at: "2026-09-18 14:15:12",
    },
    {
      id: 3,
      session_id: "ZXHH202609180001",
      sender_type: "system",
      sender_name: "系统通知",
      content: "已为您分配在线坐席【杨慧莉】，正在接入会话...",
      is_read: true,
      created_at: "2026-09-18 14:16:00",
    },
    {
      id: 4,
      session_id: "ZXHH202609180001",
      sender_type: "agent",
      sender_name: "杨慧莉",
      content: "李经理您好，我是发票云专属客服杨慧莉。请问您这边是乐企直连开票报错还是在云平台页面直接开具时报错？",
      is_read: true,
      created_at: "2026-09-18 14:16:30",
    },
    {
      id: 5,
      session_id: "ZXHH202609180001",
      sender_type: "customer",
      sender_name: "李经理",
      content: "是乐企批量接口调用的，我们税务局端后台刚申请了额度，请问提交额度申请后通常多久可以在乐企平台看到生效？",
      is_read: false,
      created_at: "2026-09-18 14:32:00",
    },
  ],
  ZXHH202609180002: [
    {
      id: 10,
      session_id: "ZXHH202609180002",
      sender_type: "customer",
      sender_name: "王总监",
      content: "您好，我们今天下午生产环境乐企批量开票接口有几笔报错502，请人工支持定位一下。",
      is_read: false,
      created_at: "2026-09-18 14:40:00",
    },
  ],
};

function getLocalStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`reception_${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setLocalStore<T>(key: string, val: T): void {
  try {
    localStorage.setItem(`reception_${key}`, JSON.stringify(val));
  } catch {
    // ignore
  }
}

// ----------------------------------------------------------------------------
// API Methods
// ----------------------------------------------------------------------------

export async function fetchEligibleUsers(): Promise<EligibleUser[]> {
  try {
    const res = await httpGet<EligibleUser[]>("/api/reception/eligible-users");
    if (Array.isArray(res)) return res;
  } catch {
    // fallback to /api/admin/users
    try {
      const uRes = await httpGet<any>("/api/admin/users");
      const list = Array.isArray(uRes) ? uRes : uRes?.items || uRes?.users || [];
      if (list.length) {
        return list.map((u: any) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
        }));
      }
    } catch {
      // ignore
    }
  }
  return [
    { id: 35, name: "杨慧莉", role: "admin" },
    { id: 2, name: "张工", role: "assignee" },
    { id: 1, name: "管理员", role: "admin" },
    { id: 10, name: "王工", role: "assignee" },
    { id: 12, name: "刘运营", role: "knowledge_op" },
  ];
}

export async function fetchAgents(params?: {
  name?: string;
  nickname?: string;
  statuses?: string[];
}): Promise<{ items: AgentItem[]; total: number }> {
  try {
    const query: Record<string, string> = {};
    if (params?.name) query.name = params.name;
    if (params?.nickname) query.nickname = params.nickname;
    if (params?.statuses && params.statuses.length) {
      query.statuses = params.statuses.join(",");
    }
    const res = await httpGet<{ items: AgentItem[]; total: number }>(
      "/api/reception/agents",
      query
    );
    if (res && Array.isArray(res.items)) return res;
  } catch {
    // use local fallback
  }

  let list = getLocalStore<AgentItem[]>("agents", SEED_AGENTS);
  if (params?.name?.trim()) {
    const q = params.name.trim().toLowerCase();
    list = list.filter((a) => a.user_name.toLowerCase().includes(q));
  }
  if (params?.nickname?.trim()) {
    const q = params.nickname.trim().toLowerCase();
    list = list.filter((a) => a.nickname.toLowerCase().includes(q));
  }
  if (params?.statuses && params.statuses.length && !params.statuses.includes("不限")) {
    const statusMap: Record<string, string> = { 在线: "online", 忙碌: "busy", 离线: "offline" };
    const mapped = params.statuses.map((s) => statusMap[s] || s);
    list = list.filter((a) => mapped.includes(a.status));
  }
  return { items: list, total: list.length };
}

export async function createAgent(body: {
  user_id: number;
  nickname: string;
  max_concurrent: number;
}): Promise<AgentItem> {
  try {
    const res = await httpPost<AgentItem>("/api/reception/agents", body);
    if (res && res.id) return res;
  } catch {
    // fallback
  }

  const users = await fetchEligibleUsers();
  const u = users.find((x) => x.id === body.user_id) || { name: `用户#${body.user_id}` };
  const agents = getLocalStore<AgentItem[]>("agents", SEED_AGENTS);
  const newAgent: AgentItem = {
    id: Date.now(),
    user_id: body.user_id,
    user_name: u.name,
    nickname: body.nickname.trim(),
    max_concurrent: body.max_concurrent,
    status: "offline",
    created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    updated_at: new Date().toISOString().replace("T", " ").slice(0, 19),
  };
  agents.unshift(newAgent);
  setLocalStore("agents", agents);
  return newAgent;
}

export async function updateAgent(
  agentId: number,
  body: { nickname?: string; max_concurrent?: number; status?: string }
): Promise<AgentItem> {
  try {
    const res = await httpPut<AgentItem>(`/api/reception/agents/${agentId}`, body);
    if (res && res.id) return res;
  } catch {
    // fallback
  }

  const agents = getLocalStore<AgentItem[]>("agents", SEED_AGENTS);
  const idx = agents.findIndex((a) => a.id === agentId);
  if (idx !== -1) {
    if (body.nickname) agents[idx].nickname = body.nickname.trim();
    if (body.max_concurrent) agents[idx].max_concurrent = body.max_concurrent;
    if (body.status) agents[idx].status = body.status as any;
    agents[idx].updated_at = new Date().toISOString().replace("T", " ").slice(0, 19);
    setLocalStore("agents", agents);
    return agents[idx];
  }
  throw new Error("Agent not found");
}

export async function batchRemoveAgents(agentIds: number[]): Promise<number> {
  try {
    const res = await httpPost<{ removed_count: number }>("/api/reception/agents/batch-remove", {
      agent_ids: agentIds,
    });
    if (res && typeof res.removed_count === "number") return res.removed_count;
  } catch {
    // fallback
  }

  let agents = getLocalStore<AgentItem[]>("agents", SEED_AGENTS);
  const initialLen = agents.length;
  agents = agents.filter((a) => !agentIds.includes(a.id));
  setLocalStore("agents", agents);
  return initialLen - agents.length;
}

export async function fetchSessions(params?: {
  company_name?: string;
  contact_phone?: string;
  statuses?: string[];
  start_time?: string;
  end_time?: string;
  is_human?: string;
  agent_name?: string;
  page?: number;
  page_size?: number;
}): Promise<{ items: SessionItem[]; total: number; page: number; page_size: number }> {
  try {
    const query: Record<string, string> = {};
    if (params?.company_name) query.company_name = params.company_name;
    if (params?.contact_phone) query.contact_phone = params.contact_phone;
    if (params?.statuses && params.statuses.length) {
      query.statuses = params.statuses.join(",");
    }
    if (params?.start_time) query.start_time = params.start_time;
    if (params?.end_time) query.end_time = params.end_time;
    if (params?.is_human) query.is_human = params.is_human;
    if (params?.agent_name) query.agent_name = params.agent_name;
    query.page = String(params?.page || 1);
    query.page_size = String(params?.page_size || 20);

    const res = await httpGet<{
      items: SessionItem[];
      total: number;
      page: number;
      page_size: number;
    }>("/api/reception/sessions", query);
    if (res && Array.isArray(res.items)) return res;
  } catch {
    // fallback
  }

  let list = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
  if (params?.company_name?.trim()) {
    const q = params.company_name.trim().toLowerCase();
    list = list.filter((s) => s.company_name.toLowerCase().includes(q));
  }
  if (params?.contact_phone?.trim()) {
    const q = params.contact_phone.trim();
    list = list.filter((s) => (s.contact_phone || "").includes(q));
  }
  if (params?.statuses && params.statuses.length && !params.statuses.includes("不限")) {
    const codeMap: Record<string, string> = {
      进行中: "in_progress",
      挂起: "pending",
      转工单: "converted",
      已关闭: "closed",
    };
    const mapped = params.statuses.map((x) => codeMap[x] || x);
    list = list.filter((s) => mapped.includes(s.status));
  }
  if (params?.is_human && params.is_human !== "不限") {
    const boolVal = params.is_human === "是";
    list = list.filter((s) => s.is_human === boolVal);
  }
  if (params?.agent_name?.trim()) {
    const q = params.agent_name.trim().toLowerCase();
    list = list.filter((s) => s.agent_name.toLowerCase().includes(q));
  }

  const p = params?.page || 1;
  const pSize = params?.page_size || 20;
  return {
    items: list.slice((p - 1) * pSize, p * pSize),
    total: list.length,
    page: p,
    page_size: pSize,
  };
}

export async function fetchSessionDetail(
  sessionId: string
): Promise<{ session: SessionItem; messages: MessageItem[] }> {
  try {
    const res = await httpGet<{ session: SessionItem; messages: MessageItem[] }>(
      `/api/reception/sessions/${sessionId}`
    );
    if (res && res.session) return res;
  } catch {
    // fallback
  }

  const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
  const session = sessions.find((s) => s.id === sessionId) || {
    id: sessionId,
    company_name: "未知企业",
    tax_no: "—",
    tenant_no: "—",
    tenant_name: "—",
    contact_name: "—",
    contact_phone: "—",
    status: "in_progress" as const,
    is_human: true,
    agent_name: "杨慧莉",
    session_type: "online" as const,
    unread_count: 0,
    created_at: "2026-09-18 14:00:00",
    updated_at: "2026-09-18 14:00:00",
  };

  const allMsgs = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
  const messages = allMsgs[sessionId] || [
    {
      id: 99,
      session_id: sessionId,
      sender_type: "customer",
      sender_name: session.contact_name || "客户",
      content: session.summary || "您好，我们企业咨询相关功能。",
      is_read: true,
      created_at: session.created_at,
    },
  ];

  return { session, messages };
}

export async function fetchWorkbenchSessions(): Promise<WorkbenchQueueData> {
  try {
    const res = await httpGet<WorkbenchQueueData>("/api/reception/workbench/sessions");
    if (res && res.counts && res.sessions) return res;
  } catch {
    // fallback
  }

  const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
  const counts = {
    online_queue: 0,
    online_in_progress: 0,
    online_pending: 0,
    online_closed: 0,
    hotline_answered: 0,
    hotline_missed: 0,
  };
  const grouped: WorkbenchQueueData["sessions"] = {
    online_in_progress: [],
    online_queue: [],
    online_pending: [],
    online_closed: [],
    hotline_answered: [],
    hotline_missed: [],
  };

  for (const s of sessions) {
    if (s.session_type === "online") {
      if (s.status === "in_progress") {
        counts.online_in_progress++;
        grouped.online_in_progress.push(s);
      } else if (s.status === "queue") {
        counts.online_queue++;
        grouped.online_queue.push(s);
      } else if (s.status === "pending") {
        counts.online_pending++;
        grouped.online_pending.push(s);
      } else if (s.status === "closed" || s.status === "converted") {
        counts.online_closed++;
        grouped.online_closed.push(s);
      }
    } else if (s.session_type === "hotline") {
      if (s.hotline_status === "answered") {
        counts.hotline_answered++;
        grouped.hotline_answered.push(s);
      } else {
        counts.hotline_missed++;
        grouped.hotline_missed.push(s);
      }
    }
  }

  return { counts, sessions: grouped };
}

export async function inviteSession(sessionId: string): Promise<void> {
  try {
    await httpPost(`/api/reception/workbench/sessions/${sessionId}/invite`, {});
  } catch {
    // local mutate
  }
  const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
  const s = sessions.find((x) => x.id === sessionId);
  if (s) {
    s.status = "in_progress";
    s.is_human = true;
    s.agent_name = "杨慧莉";
    setLocalStore("sessions", sessions);

    const allMsgs = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
    const msgs = allMsgs[sessionId] || [];
    msgs.push({
      id: Date.now(),
      session_id: sessionId,
      sender_type: "system",
      sender_name: "系统通知",
      content: "坐席【杨慧莉】已接入本次会话，正在为您提供服务。",
      is_read: true,
      created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    });
    allMsgs[sessionId] = msgs;
    setLocalStore("messages", allMsgs);
  }
}

export async function suspendSession(sessionId: string): Promise<void> {
  try {
    await httpPost(`/api/reception/workbench/sessions/${sessionId}/suspend`, {});
  } catch {
    // local mutate
  }
  const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
  const s = sessions.find((x) => x.id === sessionId);
  if (s) {
    s.status = "pending";
    setLocalStore("sessions", sessions);

    const allMsgs = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
    const msgs = allMsgs[sessionId] || [];
    msgs.push({
      id: Date.now(),
      session_id: sessionId,
      sender_type: "agent",
      sender_name: "杨慧莉",
      content: "你的问题，技术人员正在分析处理中，需要点时间定位问题，收到结论后同步给你。",
      is_read: true,
      created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    });
    allMsgs[sessionId] = msgs;
    setLocalStore("messages", allMsgs);
  }
}

export async function activateSession(sessionId: string): Promise<void> {
  try {
    await httpPost(`/api/reception/workbench/sessions/${sessionId}/activate`, {});
  } catch {
    // local mutate
  }
  const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
  const s = sessions.find((x) => x.id === sessionId);
  if (s) {
    s.status = "in_progress";
    setLocalStore("sessions", sessions);

    const allMsgs = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
    const msgs = allMsgs[sessionId] || [];
    msgs.push({
      id: Date.now(),
      session_id: sessionId,
      sender_type: "system",
      sender_name: "系统通知",
      content: "会话已被坐席重新激活，继续沟通中。",
      is_read: true,
      created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    });
    allMsgs[sessionId] = msgs;
    setLocalStore("messages", allMsgs);
  }
}

export async function closeSession(sessionId: string): Promise<void> {
  try {
    await httpPost(`/api/reception/workbench/sessions/${sessionId}/close`, {});
  } catch {
    // local mutate
  }
  const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
  const s = sessions.find((x) => x.id === sessionId);
  if (s) {
    s.status = "closed";
    s.closed_at = new Date().toISOString().replace("T", " ").slice(0, 19);
    setLocalStore("sessions", sessions);

    const allMsgs = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
    const msgs = allMsgs[sessionId] || [];
    msgs.push({
      id: Date.now(),
      session_id: sessionId,
      sender_type: "system",
      sender_name: "系统通知",
      content: "您的问题已解决，本次会话已结束，后续如有其他使用问题，可发起新的会话咨询。",
      is_read: true,
      created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    });
    allMsgs[sessionId] = msgs;
    setLocalStore("messages", allMsgs);
  }
}

export async function transferTicket(
  sessionId: string,
  payload?: { title?: string }
): Promise<string> {
  let ticketCode = `TKT-${Math.floor(Math.random() * 5000 + 5000)}`;
  try {
    const res = await httpPost<{ ok: boolean; ticket_short_code: string }>(
      `/api/reception/workbench/sessions/${sessionId}/transfer-ticket`,
      payload || {}
    );
    if (res && res.ticket_short_code) {
      ticketCode = res.ticket_short_code;
    }
  } catch {
    // local mutate
  }

  const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
  const s = sessions.find((x) => x.id === sessionId);
  if (s) {
    s.status = "converted";
    s.ticket_short_code = ticketCode;
    setLocalStore("sessions", sessions);

    const allMsgs = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
    const msgs = allMsgs[sessionId] || [];
    msgs.push({
      id: Date.now(),
      session_id: sessionId,
      sender_type: "agent",
      sender_name: "杨慧莉",
      content: `您的问题需要转工单推送到产研修复，已经帮您创建工单，工单号 ${ticketCode}，后续工单进度会通过短信通知。`,
      is_read: true,
      created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    });
    allMsgs[sessionId] = msgs;
    setLocalStore("messages", allMsgs);
  }
  return ticketCode;
}

export async function sendAgentMessage(sessionId: string, content: string): Promise<MessageItem> {
  const newMsg: MessageItem = {
    id: Date.now(),
    session_id: sessionId,
    sender_type: "agent",
    sender_name: "杨慧莉",
    content: content.trim(),
    is_read: true,
    created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
  };

  try {
    const res = await httpPost<MessageItem>(
      `/api/reception/workbench/sessions/${sessionId}/send-message`,
      { content: content.trim() }
    );
    if (res && res.id) return res;
  } catch {
    // fallback
  }

  const allMsgs = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
  const msgs = allMsgs[sessionId] || [];
  msgs.push(newMsg);
  allMsgs[sessionId] = msgs;
  setLocalStore("messages", allMsgs);

  const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
  const s = sessions.find((x) => x.id === sessionId);
  if (s) {
    s.last_message = content.trim();
    s.last_message_at = newMsg.created_at;
    setLocalStore("sessions", sessions);
  }

  return newMsg;
}

export async function searchAssistant(
  type: "knowledge" | "ticket" | "order" | "benefit",
  query: string
): Promise<AssistantSearchItem[]> {
  try {
    const res = await httpGet<AssistantSearchItem[]>("/api/reception/workbench/assistant-search", {
      type,
      query,
    });
    if (Array.isArray(res)) return res;
  } catch {
    // fallback
  }

  const q = query.trim().toLowerCase();
  if (type === "knowledge") {
    const items: AssistantSearchItem[] = [
      {
        id: "FPYFAQ-202609-01",
        title: "数电发票开具时提示「发票额度不足」如何处理？",
        snippet: "请登录电子税务局「税务数字账户」核验本月总授信额度。如需临时调整，可通过电子发票服务平台提交额度调整申请。",
        type: "knowledge",
      },
      {
        id: "FPYFAQ-202609-02",
        title: "乐企对接直连服务签名证书过期更换步骤",
        snippet: "更换乐企证书需在发票云控制台「安全认证」上传国密新证书，并在税务端同步完成公钥备案后刷新网关连接。",
        type: "knowledge",
      },
      {
        id: "FPYFAQ-202609-03",
        title: "红字发票确认单开具后对方未确认如何撤销？",
        snippet: "销方发起红字确认单后，在购方未确认前，销方可直接在「红字发票处理」模块点击【撤销确认单】并重新提交。",
        type: "knowledge",
      },
      {
        id: "FPYFAQ-202609-04",
        title: "数电发票板式文件PDF/OFD批量下载超时优化指引",
        snippet: "若单次下载超过200份建议采用「异步报表导出」任务，系统生成打包链接后在「下载中心」统一收取。",
        type: "knowledge",
      },
    ];
    return items.filter((i) => !q || i.title.toLowerCase().includes(q) || i.snippet.toLowerCase().includes(q));
  } else if (type === "ticket") {
    const items: AssistantSearchItem[] = [
      {
        id: "TKT-006619",
        title: "【数电发票】特定税率栏次校验异常导致保存失败",
        snippet: "处理状态：研发处理中。已由架构组定位到规则引擎映射，预计明日版本发版修复。",
        type: "ticket",
      },
      {
        id: "TKT-005820",
        title: "乐企专线链路波动导致开票接口出现504超时",
        snippet: "处理状态：已发版解决。已完成专线网关主备切换并提升探活频次。",
        type: "ticket",
      },
    ];
    return items.filter((i) => !q || i.title.toLowerCase().includes(q) || i.snippet.toLowerCase().includes(q));
  } else if (type === "order") {
    const items: AssistantSearchItem[] = [
      {
        id: "ORD-202608-883",
        title: "发票云乐企直连年费订阅订单（2026-2027）",
        snippet: "订单金额：¥48,000.00，支付状态：已支付，服务生效中至 2027-08-31。",
        type: "order",
      },
      {
        id: "ORD-202605-120",
        title: "发票云数电混合开票接口增值并发包",
        snippet: "订单金额：¥12,000.00，当前已配额 100 QPS，运行状态正常。",
        type: "order",
      },
    ];
    return items.filter((i) => !q || i.title.toLowerCase().includes(q) || i.snippet.toLowerCase().includes(q));
  } else {
    const items: AssistantSearchItem[] = [
      {
        id: "BEN-VIP-01",
        title: "企业专属权益：7×24小时专属产研架构师直连通道",
        snippet: "权益状态：生效中。月度支持时长剩余 18 小时，支持一键转派高级架构师。",
        type: "benefit",
      },
      {
        id: "BEN-SLA-02",
        title: "企业专属权益：P0级故障30分钟响应与临时版本打包服务",
        snippet: "权益状态：生效中。已签署白金级技术服务协议。",
        type: "benefit",
      },
    ];
    return items.filter((i) => !q || i.title.toLowerCase().includes(q) || i.snippet.toLowerCase().includes(q));
  }
}

// ----------------------------------------------------------------------------
// Schedule Settings & Auto Dispatch & Handover
// ----------------------------------------------------------------------------

export function isWithinReceptionTime(
  settings: ScheduleSettings,
  now: Date = new Date()
): boolean {
  const day = now.getDay(); // 0 is Sunday, 6 is Saturday
  const isWeekend = day === 0 || day === 6;
  const slots = isWeekend ? settings.weekend_slots : settings.weekday_slots;
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const timeStr = `${hours}:${minutes}`;

  for (const slot of slots) {
    if (slot.start <= timeStr && timeStr <= slot.end) {
      return true;
    }
  }
  return false;
}

export async function fetchScheduleSettings(): Promise<ScheduleSettings> {
  try {
    const res = await httpGet<ScheduleSettings>("/api/reception/settings/schedule");
    if (res && Array.isArray(res.weekday_slots) && Array.isArray(res.weekend_slots)) {
      setLocalStore("schedule_settings", res);
      return res;
    }
  } catch {
    // ignore
  }
  return getLocalStore<ScheduleSettings>("schedule_settings", DEFAULT_SCHEDULE_SETTINGS);
}

export async function updateScheduleSettings(
  settings: ScheduleSettings
): Promise<ScheduleSettings> {
  setLocalStore("schedule_settings", settings);
  try {
    const res = await httpPut<ScheduleSettings>("/api/reception/settings/schedule", settings);
    if (res) return res;
  } catch {
    // ignore
  }
  return settings;
}

export async function handoverAndOffline(
  fromAgentId: number,
  toAgentId: number
): Promise<{ ok: boolean; transferred_count: number }> {
  try {
    const res = await httpPost<{ ok: boolean; transferred_count: number }>(
      "/api/reception/workbench/handover-offline",
      { from_agent_id: fromAgentId, to_agent_id: toAgentId }
    );
    if (res && res.ok) {
      // synced on backend
    }
  } catch {
    // fallback
  }

  // Local fallback mutation
  const agents = getLocalStore<AgentItem[]>("agents", SEED_AGENTS);
  const fromAgent = agents.find((a) => a.id === fromAgentId);
  const toAgent = agents.find((a) => a.id === toAgentId);

  if (fromAgent) {
    fromAgent.status = "offline";
    fromAgent.updated_at = new Date().toISOString().replace("T", " ").slice(0, 19);
  }

  let transferredCount = 0;
  if (fromAgent && toAgent) {
    const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
    const messages = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);

    sessions.forEach((s) => {
      if (
        s.status === "in_progress" &&
        (s.agent_user_id === fromAgent.user_id || s.agent_name === fromAgent.user_name)
      ) {
        s.agent_user_id = toAgent.user_id;
        s.agent_name = toAgent.user_name;
        s.updated_at = nowStr;
        transferredCount++;

        const msgs = messages[s.id] || [];
        msgs.push({
          id: Date.now() + transferredCount,
          session_id: s.id,
          sender_type: "system",
          sender_name: "系统通知",
          content: `会话已由坐席【${fromAgent.user_name}】转交给【${toAgent.user_name}】继续为您服务。`,
          is_read: true,
          created_at: nowStr,
        });
        messages[s.id] = msgs;
      }
    });

    setLocalStore("sessions", sessions);
    setLocalStore("messages", messages);
  }
  setLocalStore("agents", agents);

  return { ok: true, transferred_count: transferredCount };
}

export async function autoDispatchQueueSessions(): Promise<{ dispatched: number }> {
  try {
    const res = await httpPost<{ dispatched: number }>("/api/reception/workbench/auto-dispatch");
    if (res && typeof res.dispatched === "number") {
      return res;
    }
  } catch {
    // fallback
  }

  // Local fallback allocation algorithm
  const agents = getLocalStore<AgentItem[]>("agents", SEED_AGENTS);
  const onlineAgents = agents.filter((a) => a.status === "online");
  if (onlineAgents.length === 0) return { dispatched: 0 };

  const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
  const messages = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);

  // Compute remaining capacity for each online agent
  const agentCapacities = onlineAgents.map((ag) => {
    const activeCount = sessions.filter(
      (s) =>
        s.status === "in_progress" &&
        s.session_type === "online" &&
        (s.agent_user_id === ag.user_id || s.agent_name === ag.user_name)
    ).length;
    return {
      agent: ag,
      remaining: Math.max(0, ag.max_concurrent - activeCount),
    };
  });

  const totalCap = agentCapacities.reduce((acc, c) => acc + c.remaining, 0);
  if (totalCap <= 0) return { dispatched: 0 };

  // Queue sessions
  const queueSessions = sessions.filter(
    (s) => s.status === "queue" && s.session_type === "online"
  );
  if (queueSessions.length === 0) return { dispatched: 0 };

  let dispatched = 0;
  let agentIdx = 0;
  const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);

  for (const s of queueSessions) {
    let assigned = false;
    for (let i = 0; i < agentCapacities.length; i++) {
      const curr = agentCapacities[agentIdx % agentCapacities.length];
      agentIdx++;
      if (curr.remaining > 0) {
        curr.remaining--;
        s.status = "in_progress";
        s.is_human = true;
        s.agent_user_id = curr.agent.user_id;
        s.agent_name = curr.agent.user_name;
        s.updated_at = nowStr;

        const msgs = messages[s.id] || [];
        msgs.push({
          id: Date.now() + dispatched,
          session_id: s.id,
          sender_type: "system",
          sender_name: "系统通知",
          content: `已为您分配在线坐席【${curr.agent.user_name}】，正在接入会话...`,
          is_read: true,
          created_at: nowStr,
        });
        messages[s.id] = msgs;

        dispatched++;
        assigned = true;
        break;
      }
    }
    if (!assigned) break; // all capacity filled
  }

  if (dispatched > 0) {
    setLocalStore("sessions", sessions);
    setLocalStore("messages", messages);
  }

  return { dispatched };
}
