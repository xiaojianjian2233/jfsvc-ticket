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
      content: "已为您分配在线坐席【慧莉客服】，正在接入会话...",
      is_read: true,
      created_at: "2026-09-18 14:16:00",
    },
    {
      id: 4,
      session_id: "ZXHH202609180001",
      sender_type: "agent",
      sender_name: "慧莉客服",
      content: "李经理您好，我是发票云专属客服慧莉客服。请问您这边是乐企直连开票报错还是在云平台页面直接开具时报错？",
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
    return raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(fallback));
  } catch {
    return JSON.parse(JSON.stringify(fallback));
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
    if (res && Array.isArray(res.items)) {
      // 检查 localStore 中的 sessions，若有本地创建但服务端尚未包含的会话，智能置顶合并
      const localSessions = getLocalStore<SessionItem[]>("sessions", []);
      let allItems = [...res.items];
      if (localSessions.length > 0) {
        const serverIds = new Set(res.items.map((x) => x.id));
        const extraLocal = localSessions.filter((x) => !serverIds.has(x.id));
        if (extraLocal.length > 0) {
          let filteredExtra = extraLocal;
          if (params?.company_name?.trim()) {
            const q = params.company_name.trim().toLowerCase();
            filteredExtra = filteredExtra.filter((s) => s.company_name.toLowerCase().includes(q));
          }
          if (params?.contact_phone?.trim()) {
            const q = params.contact_phone.trim();
            filteredExtra = filteredExtra.filter((s) => (s.contact_phone || "").includes(q));
          }
          if (filteredExtra.length > 0) {
            allItems = [...filteredExtra, ...allItems];
          }
        }
      }
      // 严格按照创建时间倒序排
      allItems.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      const pSize = Number(query.page_size) || 20;
      return {
        items: allItems.slice(0, pSize),
        total: Math.max(res.total, allItems.length),
        page: res.page,
        page_size: res.page_size,
      };
    }
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
      排队中: "queue",
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

  // 严格按照创建时间倒序排
  list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

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
    s.agent_name = "慧莉客服";
    s.updated_at = new Date().toISOString().replace("T", " ").slice(0, 19);
    setLocalStore("sessions", sessions);

    const allMsgs = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
    const msgs = allMsgs[sessionId] || [];
    msgs.push({
      id: Date.now(),
      session_id: sessionId,
      sender_type: "system",
      sender_name: "系统通知",
      content: "已为您分配在线坐席【慧莉客服】，正在接入会话...",
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
      sender_name: "慧莉客服",
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
      sender_name: "慧莉客服",
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
    id: Date.now() + Math.floor(Math.random() * 10000),
    session_id: sessionId,
    sender_type: "agent",
    sender_name: "慧莉客服",
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
        (s.agent_user_id === fromAgent.user_id ||
          s.agent_name === fromAgent.user_name ||
          s.agent_name === fromAgent.nickname)
      ) {
        const fromDisplayName = fromAgent.nickname || fromAgent.user_name;
        const toDisplayName = toAgent.nickname || toAgent.user_name;
        s.agent_user_id = toAgent.user_id;
        s.agent_name = toDisplayName;
        s.updated_at = nowStr;
        transferredCount++;

        const msgs = messages[s.id] || [];
        msgs.push({
          id: Date.now() + transferredCount,
          session_id: s.id,
          sender_type: "system",
          sender_name: "系统通知",
          content: `会话已由坐席【${fromDisplayName}】转交给【${toDisplayName}】继续为您服务。`,
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
        (s.agent_user_id === ag.user_id ||
          s.agent_name === ag.user_name ||
          s.agent_name === ag.nickname)
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
        const agentDisplayName = curr.agent.nickname || curr.agent.user_name;
        s.status = "in_progress";
        s.is_human = true;
        s.agent_user_id = curr.agent.user_id;
        s.agent_name = agentDisplayName;
        s.updated_at = nowStr;

        const msgs = messages[s.id] || [];
        msgs.push({
          id: Date.now() + dispatched,
          session_id: s.id,
          sender_type: "system",
          sender_name: "系统通知",
          content: `已为您分配在线坐席【${agentDisplayName}】，正在接入会话...`,
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

// ============================================================================
// 8. 客户端 (Customer Client H5) API 与本地回退
// ============================================================================

export interface ClientLookupCompany {
  company_name: string;
  tax_no: string;
  tenant_name?: string | null;
  tenant_no?: string | null;
  purchased_products?: string[];
  contact_name?: string | null;
}

export interface ClientLookupPhoneResponse {
  phone: string;
  exists: boolean;
  count: number;
  items: ClientLookupCompany[];
}

export interface EnterpriseSearchResult {
  company_name: string;
  tax_no: string;
  status?: string;
  legal_person?: string;
}

export interface TenantProfileResponse {
  tenant_no: string;
  tenant_name: string;
  purchased_products: string[];
}

export interface ClientInitSessionPayload {
  contact_name?: string;
  contact_phone: string;
  company_name: string;
  tax_no: string;
  tenant_name?: string | null;
  tenant_no?: string | null;
  purchased_products?: string[];
  is_historical?: boolean;
}

export interface ClientSessionsGrouped {
  recent_open: SessionItem[];
  closed: SessionItem[];
}

export interface ClientEvaluationPayload {
  score: number;
  tags: string[];
  comment?: string;
}

const MOCK_INDUSTRY_ENTERPRISES: EnterpriseSearchResult[] = [
  { company_name: "腾讯科技（深圳）有限公司", tax_no: "91440300708461136T", status: "存续", legal_person: "马化腾" },
  { company_name: "阿里巴巴（中国）网络技术有限公司", tax_no: "91330100716105852F", status: "存续", legal_person: "蒋芳" },
  { company_name: "北京百度网讯科技有限公司", tax_no: "91110000802100433B", status: "存续", legal_person: "梁志祥" },
  { company_name: "华为技术有限公司", tax_no: "914403001922038216", status: "存续", legal_person: "赵明路" },
  { company_name: "比亚迪股份有限公司", tax_no: "91440300192317458F", status: "存续", legal_person: "王传福" },
  { company_name: "美团科技有限公司", tax_no: "91110108MA01712M9L", status: "存续", legal_person: "王兴" },
  { company_name: "上海寻梦信息技术有限公司", tax_no: "91310000324443210P", status: "存续", legal_person: "朱健冲" },
  { company_name: "浙江吉利控股集团有限公司", tax_no: "91330000749021884X", status: "存续", legal_person: "李书福" },
  { company_name: "深圳市大疆创新科技有限公司", tax_no: "91440300795432587N", status: "存续", legal_person: "汪滔" },
  { company_name: "中国移动通信集团有限公司", tax_no: "911100007109250324", status: "存续", legal_person: "杨杰" },
];

/**
 * 客户端：根据手机号查询历史去重企业
 */
export async function clientLookupPhone(phone: string): Promise<ClientLookupPhoneResponse> {
  const cleanPhone = phone.trim();
  try {
    return await httpGet<ClientLookupPhoneResponse>("/api/reception/client/lookup-phone", { phone: cleanPhone });
  } catch {
    const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
    const matched = sessions.filter((s) => s.contact_phone === cleanPhone && s.company_name);
    const seen = new Set<string>();
    const items: ClientLookupCompany[] = [];

    for (const s of matched) {
      const key = `${s.company_name.trim()}__${(s.tax_no || "").trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push({
          company_name: s.company_name.trim(),
          tax_no: s.tax_no || "",
          tenant_name: s.tenant_name,
          tenant_no: s.tenant_no,
          purchased_products: s.purchased_products || [],
          contact_name: s.contact_name,
        });
      }
    }

    return {
      phone: cleanPhone,
      exists: items.length > 0,
      count: items.length,
      items,
    };
  }
}

/**
 * 客户端：工商局接口模糊搜索企业与税号推荐
 */
export async function clientSearchEnterprises(keyword: string): Promise<EnterpriseSearchResult[]> {
  const kw = keyword.trim();
  if (!kw) return [];
  try {
    return await httpGet<EnterpriseSearchResult[]>("/api/reception/client/search-enterprises", { keyword: kw });
  } catch {
    const results: EnterpriseSearchResult[] = [];
    const seen = new Set<string>();

    const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
    for (const s of sessions) {
      if (s.company_name && s.company_name.includes(kw) && !seen.has(s.company_name)) {
        seen.add(s.company_name);
        results.push({
          company_name: s.company_name,
          tax_no: s.tax_no || `91440300${Math.floor(10000000 + Math.random() * 90000000)}A`,
          status: "存续",
        });
      }
    }

    for (const item of MOCK_INDUSTRY_ENTERPRISES) {
      if (item.company_name.includes(kw) && !seen.has(item.company_name)) {
        seen.add(item.company_name);
        results.push(item);
      }
    }

    if (!results.some((r) => r.company_name === kw) && kw.length >= 2) {
      const codeSuffix = Array.from(kw.slice(0, 6))
        .map((c) => (c.charCodeAt(0) % 10).toString())
        .join("")
        .padEnd(10, "8");
      results.unshift({
        company_name: kw,
        tax_no: `91310115${codeSuffix}X`,
        status: "存续",
      });
    }

    return results.slice(0, 8);
  }
}

/**
 * 客户端：运营接口获取归属租户和已购产品
 */
export async function clientFetchTenantProfile(
  companyName: string,
  taxNo: string
): Promise<TenantProfileResponse> {
  try {
    return await httpPost<TenantProfileResponse>("/api/reception/client/fetch-tenant-profile", {
      company_name: companyName,
      tax_no: taxNo,
    });
  } catch {
    const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
    const existing = sessions.find((s) => s.company_name === companyName || (taxNo && s.tax_no === taxNo));
    if (existing && existing.tenant_name && existing.tenant_no) {
      return {
        tenant_no: existing.tenant_no,
        tenant_name: existing.tenant_name,
        purchased_products: existing.purchased_products || ["发票云标准版", "数电发票采集模块"],
      };
    }

    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return {
      tenant_no: `TNT_${todayStr}_${Math.floor(1000 + Math.random() * 9000)}`,
      tenant_name: `${companyName.slice(0, 4)}企业租户`,
      purchased_products: ["发票云敏捷版", "数电乐企开票组件", "进项发票查验服务"],
    };
  }
}

/**
 * 广播新会话创建事件（用于跨标签页、跨组件实时刷新坐席端会话列表与工作台）
 */
export function notifySessionCreated(session: SessionItem) {
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("reception:session_created", { detail: session }));
      try {
        localStorage.setItem("ticket_hub_reception_session_ping", String(Date.now()));
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

/**
 * 客户端：初始化/提交会话
 */
export async function clientInitSession(
  payload: ClientInitSessionPayload
): Promise<{ session: SessionItem; messages: MessageItem[] }> {
  try {
    const res = await httpPost<{ session: SessionItem; messages: MessageItem[] }>(
      "/api/reception/client/init-session",
      payload
    );
    if (res?.session) {
      const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
      if (!sessions.some((s) => s.id === res.session.id)) {
        sessions.unshift(res.session);
        setLocalStore("sessions", sessions);
      }
      if (res.messages && res.messages.length > 0) {
        const allMessages = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
        allMessages[res.session.id] = res.messages;
        setLocalStore("messages", allMessages);
      }
      notifySessionCreated(res.session);
    }
    return res;
  } catch {
    const phone = payload.contact_phone.trim();
    let contactName = (payload.contact_name || "").trim();
    const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);

    if (!contactName) {
      const historySession = sessions.find((s) => s.contact_phone === phone && s.contact_name);
      contactName = historySession?.contact_name || `客户_${phone.slice(-4)}`;
    }

    let tenantName = payload.tenant_name;
    let tenantNo = payload.tenant_no;
    let purchasedProducts = payload.purchased_products;

    if (!tenantName || !tenantNo) {
      const profile = await clientFetchTenantProfile(payload.company_name, payload.tax_no);
      tenantName = tenantName || profile.tenant_name;
      tenantNo = tenantNo || profile.tenant_no;
      purchasedProducts = purchasedProducts || profile.purchased_products;
    }

    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = `ZXHH${todayStr}`;
    const seq = sessions.filter((s) => s.id.startsWith(prefix)).length + 1;
    const sessionId = `${prefix}${seq.toString().padStart(4, "0")}`;
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);

    const newSession: SessionItem = {
      id: sessionId,
      session_type: "online",
      status: "queue",
      is_human: true,
      agent_name: "在线待分配",
      company_name: payload.company_name.trim(),
      tax_no: payload.tax_no.trim(),
      tenant_name: tenantName,
      tenant_no: tenantNo,
      contact_name: contactName,
      contact_phone: phone,
      purchased_products: purchasedProducts || ["发票云标准版"],
      is_in_service: "服务期内",
      unread_count: 0,
      last_message: "客户发起了新的在线咨询",
      last_message_at: nowStr,
      created_at: nowStr,
      updated_at: nowStr,
    };

    const welcomeMsg: MessageItem = {
      id: Date.now(),
      session_id: sessionId,
      sender_type: "system",
      sender_name: "发票云小助手",
      content: `您好！欢迎使用发票云售后在线支持。系统已为您建立会话【${sessionId}】，正在为您接入在线专业客服，请稍候...`,
      is_read: true,
      created_at: nowStr,
    };

    sessions.unshift(newSession);
    setLocalStore("sessions", sessions);

    const allMessages = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
    allMessages[sessionId] = [welcomeMsg];
    setLocalStore("messages", allMessages);

    // 触发自动分发
    autoDispatchQueueSessions().catch(() => {});
    notifySessionCreated(newSession);

    return { session: newSession, messages: [welcomeMsg] };
  }
}

/**
 * 客户端：查询该手机号会话（分24小时内未关闭与已结束）
 */
export async function clientFetchSessions(phone: string): Promise<ClientSessionsGrouped> {
  const cleanPhone = phone.trim();
  try {
    return await httpGet<ClientSessionsGrouped>("/api/reception/client/sessions", { phone: cleanPhone });
  } catch {
    const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
    const matched = sessions.filter((s) => s.contact_phone === cleanPhone);
    const nowMs = Date.now();

    const recent_open: SessionItem[] = [];
    const closed: SessionItem[] = [];

    for (const s of matched) {
      if (s.status === "closed" || s.status === "converted") {
        closed.push(s);
      } else {
        const createdMs = new Date(s.created_at.replace(" ", "T")).getTime();
        if (nowMs - createdMs <= 24 * 3600 * 1000) {
          recent_open.push(s);
        } else {
          closed.push(s);
        }
      }
    }

    return { recent_open, closed };
  }
}

/**
 * 客户端：获取指定会话历史消息
 */
export async function clientFetchMessages(sessionId: string): Promise<MessageItem[]> {
  try {
    return await httpGet<MessageItem[]>(`/api/reception/client/sessions/${sessionId}/messages`);
  } catch {
    const allMessages = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
    return allMessages[sessionId] || [];
  }
}

/**
 * 客户端：发送消息（支持文字与附件解析）
 */
export async function clientSendMessage(
  sessionId: string,
  content: string,
  senderName = "客户"
): Promise<MessageItem> {
  try {
    return await httpPost<MessageItem>(`/api/reception/client/sessions/${sessionId}/send-message`, {
      content,
      sender_name: senderName,
    });
  } catch (err: any) {
    if (err?.status === 404 || err?.message?.includes("404") || err?.message?.includes("不存在")) {
      throw err;
    }
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
    const allMessages = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
    const list = allMessages[sessionId] || [];

    const newMsg: MessageItem = {
      id: Date.now() + Math.floor(Math.random() * 100),
      session_id: sessionId,
      sender_type: "customer",
      sender_name: senderName,
      content,
      is_read: false,
      created_at: nowStr,
    };
    list.push(newMsg);
    allMessages[sessionId] = list;
    setLocalStore("messages", allMessages);

    // 更新会话最新消息
    const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
    const s = sessions.find((item) => item.id === sessionId);
    if (s) {
      s.last_message = content.slice(0, 120);
      s.last_message_at = nowStr;
      s.unread_count = (s.unread_count || 0) + 1;
      s.updated_at = nowStr;
      setLocalStore("sessions", sessions);
    }

    return newMsg;
  }
}

/**
 * 客户端：结束会话
 */
export async function clientCloseSession(sessionId: string): Promise<{ status: string; closed_at: string }> {
  try {
    return await httpPost<{ status: string; closed_at: string }>(`/api/reception/client/sessions/${sessionId}/close`);
  } catch {
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
    const sessions = getLocalStore<SessionItem[]>("sessions", SEED_SESSIONS);
    const s = sessions.find((item) => item.id === sessionId);
    if (s) {
      s.status = "closed";
      s.closed_at = nowStr;
      s.updated_at = nowStr;
      setLocalStore("sessions", sessions);
    }

    const allMessages = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
    const list = allMessages[sessionId] || [];
    list.push({
      id: Date.now(),
      session_id: sessionId,
      sender_type: "system",
      sender_name: "系统通知",
      content: "客户已自主结束会话。感谢您的咨询，请对本次服务进行评价！",
      is_read: true,
      created_at: nowStr,
    });
    allMessages[sessionId] = list;
    setLocalStore("messages", allMessages);

    return { status: "ok", closed_at: nowStr };
  }
}

/**
 * 客户端：服务评价
 */
export async function clientEvaluateSession(
  sessionId: string,
  evaluation: ClientEvaluationPayload
): Promise<{ status: string }> {
  try {
    return await httpPost<{ status: string }>(`/api/reception/client/sessions/${sessionId}/evaluate`, evaluation);
  } catch {
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
    const evalText = `【客户服务评价】评分：${evaluation.score}星 | 标签：${
      evaluation.tags.length > 0 ? evaluation.tags.join("、") : "无"
    } | 意见反馈：${evaluation.comment || "无"}`;

    const allMessages = getLocalStore<Record<string, MessageItem[]>>("messages", SEED_MESSAGES);
    const list = allMessages[sessionId] || [];
    list.push({
      id: Date.now(),
      session_id: sessionId,
      sender_type: "system",
      sender_name: "服务评价",
      content: evalText,
      is_read: true,
      created_at: nowStr,
    });
    allMessages[sessionId] = list;
    setLocalStore("messages", allMessages);

    return { status: "ok" };
  }
}

/**
 * 客户端：重要通知数据类型
 */
export interface ClientNoticeItem {
  id: string;
  title: string;
  content: string;
  is_important: boolean;
  publish_time: string;
  publisher?: string;
  category?: string;
  popup_prompt?: boolean;
}

export interface ReceptionNoticeItem {
  id: number;
  notice_no: string;
  title: string;
  content: string;
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string;
  popup_prompt: boolean;
  status: "published" | "unpublished";
  effective_status: "published" | "unpublished";
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

export interface NoticeFilterParams {
  statuses?: string[];
  start_time?: string;
  end_time?: string;
}

export interface CreateNoticePayload {
  title: string;
  start_date: string;
  end_date: string;
  popup_prompt: boolean;
  content: string;
}

export interface UpdateNoticePayload {
  title?: string;
  start_date?: string;
  end_date?: string;
  popup_prompt?: boolean;
  content?: string;
}

export const SEED_CLIENT_NOTICES: ClientNoticeItem[] = [
  {
    id: "INF202609210001",
    title: "关于数电发票乐企直连通道升级维护的通知",
    content:
      "尊敬的纳税人用户：为了提供更稳定优质的数电发票乐企对接服务，国家税务总局定于本周五晚 22:00 至周六早 06:00 进行乐企平台与电子底账系统底层升级。升级期间开票、受票及勾选认证服务可能出现短时响应延迟或连接波动。建议各企业财务提前做好发票开具与勾选安排，紧急开票可使用离线开票备用模式。升级完成后服务将自动恢复，如有疑问请随时联系本在线技术支持团队。",
    is_important: true,
    publish_time: "2026-09-21 10:00",
    publisher: "国家税务总局运维中心",
    category: "系统维护",
    popup_prompt: false,
  },
  {
    id: "INF202609180002",
    title: "金蝶发票云 2026 年第 3 季度征期服务保障方案",
    content:
      "为全力保障 9 月大征期期间企业税控与数电发票系统平稳运行，金蝶发票云售后技术团队已启动 7×24 小时征期应急响应机制。专家坐席全量在线，针对批量开票卡顿、税控盘升级校验、红字信息表开具异常等常见问题提供 1 对 1 快速排障支持，确保企业纳税申报与发票交付万无一失。",
    is_important: true,
    publish_time: "2026-09-18 09:30",
    publisher: "金蝶发票云服务团队",
    category: "征期保障",
    popup_prompt: false,
  },
  {
    id: "INF202609150003",
    title: "关于近期增值税发票合规开具与风险防范温馨提示",
    content:
      "近期各省税务局加大对异常大额发票及开票品目与企业经营范围不符的动态监控力度。金蝶发票云已全新上线「AI 智能风控开票插件」，支持开票前自动校验黑名单客户、异常开票额度预警。建议企业开票人员在系统设置中开启合规自检功能，确保业务发票合规开具与入账。",
    is_important: false,
    publish_time: "2026-09-15 14:20",
    publisher: "税务合规运营中心",
    category: "业务指引",
    popup_prompt: false,
  },
];

const LOCAL_NOTICES_KEY = "ticket_hub_reception_notices_local";

function getLocalNotices(): ReceptionNoticeItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_NOTICES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  const defaults: ReceptionNoticeItem[] = [
    {
      id: 1,
      notice_no: "INF202609210001",
      title: "关于数电发票乐企直连通道升级维护的通知",
      content:
        "尊敬的纳税人用户：为了提供更稳定优质的数电发票乐企对接服务，国家税务总局定于本周五晚 22:00 至周六早 06:00 进行乐企平台与电子底账系统底层升级。升级期间开票、受票及勾选认证服务可能出现短时响应延迟或连接波动。建议各企业财务提前做好发票开具与勾选安排，紧急开票可使用离线开票备用模式。升级完成后服务将自动恢复，如有疑问请随时联系本在线技术支持团队。",
      start_time: "2026-09-20 00:00:00",
      end_time: "2026-09-30 23:59:59",
      start_date: "2026-09-20",
      end_date: "2026-09-30",
      popup_prompt: true,
      status: "published",
      effective_status: "published",
      created_by: "杨慧丽",
      created_at: "2026-09-20 09:30:00",
      updated_by: "杨慧丽",
      updated_at: "2026-09-20 09:30:00",
    },
    {
      id: 2,
      notice_no: "INF202609180002",
      title: "金蝶发票云 2026 年第 3 季度征期服务保障方案",
      content:
        "为全力保障 9 月大征期期间企业税控与数电发票系统平稳运行，金蝶发票云售后技术团队已启动 7×24 小时征期应急响应机制。专家坐席全量在线，针对批量开票卡顿、税控盘升级校验、红字信息表开具异常等常见问题提供 1 对 1 快速排障支持，确保企业纳税申报与发票交付万无一失。",
      start_time: "2026-09-18 00:00:00",
      end_time: "2026-09-28 23:59:59",
      start_date: "2026-09-18",
      end_date: "2026-09-28",
      popup_prompt: false,
      status: "published",
      effective_status: "published",
      created_by: "杨慧丽",
      created_at: "2026-09-18 08:30:00",
      updated_by: "杨慧丽",
      updated_at: "2026-09-18 08:30:00",
    },
    {
      id: 3,
      notice_no: "INF202609100003",
      title: "发票云在线技术支持客户端全面升级公告",
      content:
        "发票云在线技术支持客户端已全面完成升级，支持历史会话无缝续接、多企业身份快速切换、工单进度实时追踪及图文附件拖拽发送。同时新增重要通知实时播报面板，欢迎广大企业客户体验更高效、敏捷的专家支持服务！",
      start_time: "2026-09-01 00:00:00",
      end_time: "2026-09-15 23:59:59",
      start_date: "2026-09-01",
      end_date: "2026-09-15",
      popup_prompt: false,
      status: "unpublished",
      effective_status: "unpublished",
      created_by: "管理员",
      created_at: "2026-09-01 10:00:00",
      updated_by: "管理员",
      updated_at: "2026-09-15 23:59:59",
    },
  ];
  try {
    localStorage.setItem(LOCAL_NOTICES_KEY, JSON.stringify(defaults));
  } catch {
    // ignore
  }
  return defaults;
}

function saveLocalNotices(items: ReceptionNoticeItem[]) {
  try {
    localStorage.setItem(LOCAL_NOTICES_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

/**
 * 获取消息通知列表，支持状态多选及创建时间区间筛选
 */
export async function fetchNotices(
  filters?: NoticeFilterParams
): Promise<ReceptionNoticeItem[]> {
  let list = getLocalNotices();
  try {
    const query: Record<string, any> = {};
    if (filters?.statuses && filters.statuses.length > 0) {
      query.statuses = filters.statuses;
    }
    if (filters?.start_time) {
      query.start_time = filters.start_time;
    }
    if (filters?.end_time) {
      query.end_time = filters.end_time;
    }
    const res = await httpGet<ReceptionNoticeItem[]>("/api/reception/notices", query);
    if (Array.isArray(res) && res.length > 0) {
      const map = new Map<string | number, ReceptionNoticeItem>();
      for (const item of list) {
        map.set(item.notice_no || item.id, item);
      }
      for (const item of res) {
        map.set(item.notice_no || item.id, item);
      }
      list = Array.from(map.values());
      saveLocalNotices(list);
    }
  } catch {
    // 降级使用本地存储
  }

  if (filters?.statuses && filters.statuses.length > 0) {
    const stSet = new Set(filters.statuses);
    if (!stSet.has("all") && !stSet.has("不限")) {
      list = list.filter((n) => stSet.has(n.effective_status) || stSet.has(n.status));
    }
  }
  if (filters?.start_time) {
    list = list.filter((n) => (n.created_at || "") >= filters.start_time!);
  }
  if (filters?.end_time) {
    list = list.filter((n) => (n.created_at || "") <= filters.end_time!);
  }
  return list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

/**
 * 获取消息通知详情
 */
export async function fetchNoticeDetail(id: number): Promise<ReceptionNoticeItem> {
  try {
    const res = await httpGet<ReceptionNoticeItem>(`/api/reception/notices/${id}`);
    if (res && res.id) return res;
  } catch {
    // 降级本地
  }
  const list = getLocalNotices();
  const found = list.find((n) => n.id === id);
  if (found) return found;
  throw new Error("通知记录不存在");
}

/**
 * 新建消息通知
 */
export async function createNotice(
  payload: CreateNoticePayload
): Promise<ReceptionNoticeItem> {
  const list = getLocalNotices();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  const todayStr = `${y}${m}${d}`;
  const nextSeq = list.length + 1;
  const noticeNo = `INF${todayStr}${String(nextSeq).padStart(4, "0")}`;
  const nowStr = `${y}-${m}-${d} ${hh}:${mm}:${ss}`;

  const newItem: ReceptionNoticeItem = {
    id: Date.now(),
    notice_no: noticeNo,
    title: payload.title,
    content: payload.content,
    start_time: `${payload.start_date} 00:00:00`,
    end_time: `${payload.end_date} 23:59:59`,
    start_date: payload.start_date,
    end_date: payload.end_date,
    popup_prompt: !!payload.popup_prompt,
    status: "published",
    effective_status: "published",
    created_by: "当前坐席",
    created_at: nowStr,
    updated_by: "当前坐席",
    updated_at: nowStr,
  };

  // 优先写入本地缓存，确保 0ms 立即生效展示
  saveLocalNotices([newItem, ...list]);

  try {
    const res = await httpPost<ReceptionNoticeItem>("/api/reception/notices", payload);
    if (res && res.id) {
      const current = getLocalNotices();
      const updated = current.map((n) => (n.id === newItem.id ? res : n));
      if (!updated.some((n) => n.id === res.id)) {
        updated.unshift(res);
      }
      saveLocalNotices(updated);
      return res;
    }
  } catch {
    // 降级使用本地新建
  }

  return newItem;
}

/**
 * 更新/修改消息通知
 */
export async function updateNotice(
  id: number,
  payload: UpdateNoticePayload
): Promise<ReceptionNoticeItem> {
  try {
    const res = await httpPut<ReceptionNoticeItem>(`/api/reception/notices/${id}`, payload);
    if (res && res.id) {
      const list = getLocalNotices().map((n) => (n.id === id ? res : n));
      saveLocalNotices(list);
      return res;
    }
  } catch {
    // 降级本地
  }

  const list = getLocalNotices();
  const idx = list.findIndex((n) => n.id === id);
  if (idx < 0) throw new Error("通知不存在");

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const nowStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const current = list[idx];
  const updated: ReceptionNoticeItem = {
    ...current,
    title: payload.title ?? current.title,
    content: payload.content ?? current.content,
    start_date: payload.start_date ?? current.start_date,
    end_date: payload.end_date ?? current.end_date,
    start_time: payload.start_date ? `${payload.start_date} 00:00:00` : current.start_time,
    end_time: payload.end_date ? `${payload.end_date} 23:59:59` : current.end_time,
    popup_prompt: payload.popup_prompt ?? current.popup_prompt,
    updated_by: "当前用户",
    updated_at: nowStr,
  };
  list[idx] = updated;
  saveLocalNotices(list);
  return updated;
}

/**
 * 批量上架消息通知
 */
export async function batchPublishNotices(ids: number[]): Promise<void> {
  try {
    await httpPost("/api/reception/notices/batch-publish", { ids });
  } catch {
    // 降级
  }
  const list = getLocalNotices().map((n) => {
    if (ids.includes(n.id)) {
      return {
        ...n,
        status: "published" as const,
        effective_status: "published" as const,
        updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      };
    }
    return n;
  });
  saveLocalNotices(list);
}

/**
 * 批量下架消息通知
 */
export async function batchUnpublishNotices(ids: number[]): Promise<void> {
  try {
    await httpPost("/api/reception/notices/batch-unpublish", { ids });
  } catch {
    // 降级
  }
  const list = getLocalNotices().map((n) => {
    if (ids.includes(n.id)) {
      return {
        ...n,
        status: "unpublished" as const,
        effective_status: "unpublished" as const,
        updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      };
    }
    return n;
  });
  saveLocalNotices(list);
}

/**
 * 批量删除消息通知（仅限下架状态）
 */
export async function batchDeleteNotices(ids: number[]): Promise<void> {
  try {
    await httpPost("/api/reception/notices/batch-delete", { ids });
  } catch (err: any) {
    if (err?.message?.includes("处于上架状态") || err?.response?.data?.detail?.includes("处于上架状态")) {
      throw err;
    }
  }
  const list = getLocalNotices().filter((n) => !ids.includes(n.id));
  saveLocalNotices(list);
}

/**
 * 客户端：获取重要通知列表
 */
export async function clientFetchNotices(): Promise<ClientNoticeItem[]> {
  let serverNotices: ClientNoticeItem[] = [];
  try {
    const res = await httpGet<ClientNoticeItem[]>("/api/reception/client/notices");
    if (Array.isArray(res) && res.length > 0) {
      serverNotices = res;
    }
  } catch {
    // ignore
  }

  // 从本地持久缓存提取所有上架且有效的通知
  const localList = getLocalNotices();
  const nowStr = new Date().toISOString().slice(0, 10);
  const localPublished: ClientNoticeItem[] = localList
    .filter((n) => {
      if (n.effective_status !== "published" && n.status !== "published") return false;
      const s = n.start_date || (n.start_time ? n.start_time.slice(0, 10) : "");
      const e = n.end_date || (n.end_time ? n.end_time.slice(0, 10) : "");
      if (s && s > nowStr) return false;
      if (e && e < nowStr) return false;
      return true;
    })
    .map((n) => ({
      id: n.notice_no || String(n.id),
      title: n.title,
      content: n.content,
      is_important: true,
      publish_time:
        n.start_date || (n.start_time ? n.start_time.slice(0, 16) : "") || (n.created_at || "").slice(0, 16),
      publisher: n.created_by || "发票云服务团队",
      category: "系统公告",
      popup_prompt: !!n.popup_prompt,
    }));

  // 合并本地与服务端数据：以本地最新发布的通知为先，去重
  const seenNos = new Set<string>();
  const combined: ClientNoticeItem[] = [];

  for (const item of localPublished) {
    const key = String(item.id);
    if (!seenNos.has(key)) {
      seenNos.add(key);
      combined.push(item);
    }
  }

  for (const item of serverNotices) {
    const key = String(item.id);
    if (!seenNos.has(key)) {
      seenNos.add(key);
      combined.push(item);
    }
  }

  if (combined.length === 0) {
    return SEED_CLIENT_NOTICES;
  }
  return combined;
}


