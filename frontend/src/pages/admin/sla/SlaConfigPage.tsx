import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminTabs } from "../AdminTabs";
import { adminSlaApi, type SlaLevelItem, type SlaLevelFormData } from "@/api/adminSla";
import { SlaModal } from "./SlaModal";

function formatDateTime(val?: string | null): string {
  if (!val) return "-";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${Y}-${M}-${D} ${h}:${m}`;
}

export function SlaConfigPage() {
  const qc = useQueryClient();

  // 筛选条件状态
  const [filterName, setFilterName] = useState("");
  const [filterLevels, setFilterLevels] = useState<string[]>(["不限"]);
  const [filterTypes, setFilterTypes] = useState<string[]>(["不限"]);

  // 筛选下拉展开状态
  const [levelDropdownOpen, setLevelDropdownOpen] = useState(false);
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);

  // 选中的记录 id 列表
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // 弹窗状态：editingItem 为 null 时新增；isCopy 为 true 时复制新增
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SlaLevelItem | null>(null);
  const [isCopy, setIsCopy] = useState(false);

  // Toast 提示
  const [toastMessage, setToastMessage] = useState<{ text: string; type?: "success" | "warning" } | null>(null);

  const showToast = (text: string, type: "success" | "warning" = "warning") => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  // 数据查询
  const slaQuery = useQuery({
    queryKey: ["admin", "sla-levels"],
    queryFn: () => adminSlaApi.list(),
  });

  const rawList: SlaLevelItem[] = slaQuery.data ?? [];

  // 前端多维过滤
  const list = rawList.filter((item) => {
    // 1. 服务等级筛选
    if (filterName.trim() && !item.name.toLowerCase().includes(filterName.trim().toLowerCase())) {
      return false;
    }
    // 2. 问题级别筛选（默认“不限”）
    if (!filterLevels.includes("不限") && filterLevels.length > 0) {
      const itemLevels = (item.issue_levels || "").split("、").map((s) => s.trim());
      const hasMatch = filterLevels.some((lvl) => itemLevels.includes(lvl));
      if (!hasMatch) return false;
    }
    // 3. 问题类型筛选（默认“不限”）
    if (!filterTypes.includes("不限") && filterTypes.length > 0) {
      const itemTypes = (item.issue_types || "").split("、").map((s) => s.trim());
      const hasMatch = filterTypes.some((t) => itemTypes.includes(t));
      if (!hasMatch) return false;
    }
    return true;
  });

  // 新增/修改保存 Mutation
  const saveMutation = useMutation({
    mutationFn: async (formData: SlaLevelFormData) => {
      if (editingItem && !isCopy) {
        await adminSlaApi.update(editingItem.id, formData);
      } else {
        await adminSlaApi.create(formData);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "sla-levels"] });
      setSelectedIds([]);
      showToast(editingItem && !isCopy ? "修改成功" : "新增成功", "success");
    },
  });

  // 全选/反选
  const allSelected = list.length > 0 && selectedIds.length === list.length;
  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(list.map((item) => item.id));
    }
  };

  const handleToggleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  // 点击【新增】
  const handleAdd = () => {
    setEditingItem(null);
    setIsCopy(false);
    setModalOpen(true);
  };

  // 点击【复制新增】
  const handleCopyAdd = () => {
    if (selectedIds.length === 0) {
      showToast("请先勾选需要复制的记录", "warning");
      return;
    }
    if (selectedIds.length > 1) {
      showToast("仅支持单选记录进行复制新增", "warning");
      return;
    }
    const target = rawList.find((item) => item.id === selectedIds[0]);
    if (!target) {
      showToast("未找到选中的记录", "warning");
      return;
    }
    setEditingItem(target);
    setIsCopy(true);
    setModalOpen(true);
  };

  // 点击【修改】
  const handleEdit = () => {
    if (selectedIds.length === 0) {
      showToast("请先勾选需要修改的记录", "warning");
      return;
    }
    if (selectedIds.length > 1) {
      showToast("仅支持单选记录进行修改", "warning");
      return;
    }
    const target = rawList.find((item) => item.id === selectedIds[0]);
    if (!target) {
      showToast("未找到选中的记录", "warning");
      return;
    }
    setEditingItem(target);
    setIsCopy(false);
    setModalOpen(true);
  };

  // 问题级别多选逻辑
  const toggleFilterLevel = (lvl: string) => {
    setFilterLevels((prev) => {
      if (lvl === "不限") return ["不限"];
      const withoutUnlimited = prev.filter((item) => item !== "不限");
      const next = withoutUnlimited.includes(lvl)
        ? withoutUnlimited.filter((item) => item !== lvl)
        : [...withoutUnlimited, lvl];
      return next.length === 0 ? ["不限"] : next;
    });
  };

  // 问题类型多选逻辑
  const toggleFilterType = (t: string) => {
    setFilterTypes((prev) => {
      if (t === "不限") return ["不限"];
      const withoutUnlimited = prev.filter((item) => item !== "不限");
      const next = withoutUnlimited.includes(t)
        ? withoutUnlimited.filter((item) => item !== t)
        : [...withoutUnlimited, t];
      return next.length === 0 ? ["不限"] : next;
    });
  };

  return (
    <div className="font-hub text-hub-text text-[13px] -m-6 min-h-screen bg-hub-page px-7 pt-5 pb-10">
      {/* 顶部标题与全局 Tab */}
      <h1 className="m-0 text-[17px] font-bold">管理</h1>
      <AdminTabs />

      {/* 顶部 Toast 提示条 */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-3 duration-200 pointer-events-none">
          <div
            className={`px-4 py-2.5 rounded-[8px] shadow-lg border flex items-center gap-2 text-[12.5px] font-semibold pointer-events-auto ${
              toastMessage.type === "warning"
                ? "bg-amber-50 text-amber-900 border-amber-300"
                : "bg-emerald-50 text-emerald-900 border-emerald-300"
            }`}
          >
            <span>{toastMessage.type === "warning" ? "⚠️" : "✓"}</span>
            <span>{toastMessage.text}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-slate-400 hover:text-slate-700 ml-3 text-[14px] cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 1. 筛选条件栏 */}
      <div className="bg-white p-3.5 rounded-[10px] border border-hub-border mb-3.5 flex items-center gap-4 flex-wrap text-[12.5px]">
        {/* 服务等级 */}
        <div className="flex items-center gap-2">
          <span className="text-hub-textSecondary font-medium">服务等级:</span>
          <input
            type="text"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="手动录入筛选"
            className="w-[160px] h-[30px] px-2.5 border border-hub-border rounded-[6px] outline-none focus:border-[#6085e7] transition-colors"
          />
        </div>

        {/* 问题级别 */}
        <div className="flex items-center gap-2 relative">
          <span className="text-hub-textSecondary font-medium">问题级别:</span>
          <div className="relative w-[160px]">
            <div
              onClick={() => {
                setLevelDropdownOpen(!levelDropdownOpen);
                setTypeDropdownOpen(false);
              }}
              className="w-full h-[30px] px-2.5 flex items-center justify-between border border-hub-border rounded-[6px] bg-white cursor-pointer hover:border-[#6085e7] transition-colors select-none"
            >
              <span className="truncate">{filterLevels.join("、")}</span>
              <span className="text-hub-textMuted text-[10px]">▼</span>
            </div>
            {levelDropdownOpen && (
              <div className="absolute top-9 left-0 w-full bg-white border border-hub-border rounded-[8px] shadow-lg z-30 py-1.5 flex flex-col gap-0.5">
                {["不限", "P0", "P1", "P2", "P3"].map((lvl) => (
                  <label
                    key={lvl}
                    className="flex items-center gap-2 px-3 py-1 hover:bg-slate-50 cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={filterLevels.includes(lvl)}
                      onChange={() => toggleFilterLevel(lvl)}
                      className="w-3.5 h-3.5 rounded border-hub-border text-[#6085e7] focus:ring-0 cursor-pointer"
                    />
                    <span>{lvl}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 问题类型 */}
        <div className="flex items-center gap-2 relative">
          <span className="text-hub-textSecondary font-medium">问题类型:</span>
          <div className="relative w-[160px]">
            <div
              onClick={() => {
                setTypeDropdownOpen(!typeDropdownOpen);
                setLevelDropdownOpen(false);
              }}
              className="w-full h-[30px] px-2.5 flex items-center justify-between border border-hub-border rounded-[6px] bg-white cursor-pointer hover:border-[#6085e7] transition-colors select-none"
            >
              <span className="truncate">{filterTypes.join("、")}</span>
              <span className="text-hub-textMuted text-[10px]">▼</span>
            </div>
            {typeDropdownOpen && (
              <div className="absolute top-9 left-0 w-full bg-white border border-hub-border rounded-[8px] shadow-lg z-30 py-1.5 flex flex-col gap-0.5">
                {["不限", "应用类", "需求", "bug修复"].map((t) => (
                  <label
                    key={t}
                    className="flex items-center gap-2 px-3 py-1 hover:bg-slate-50 cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={filterTypes.includes(t)}
                      onChange={() => toggleFilterType(t)}
                      className="w-3.5 h-3.5 rounded border-hub-border text-[#6085e7] focus:ring-0 cursor-pointer"
                    />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 重置按钮 */}
        {(filterName || !filterLevels.includes("不限") || !filterTypes.includes("不限")) && (
          <button
            type="button"
            onClick={() => {
              setFilterName("");
              setFilterLevels(["不限"]);
              setFilterTypes(["不限"]);
            }}
            className="text-[#6085e7] hover:underline cursor-pointer text-[12px]"
          >
            重置筛选
          </button>
        )}
      </div>

      {/* 2. 操作按钮区域（增加【复制新增】按钮在【新增】后面） */}
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleAdd}
            className="px-4 py-1.5 rounded-[6px] bg-[#6085e7] text-white text-[13px] font-medium hover:bg-[#4f75dd] transition-colors cursor-pointer shadow-sm"
          >
            新增
          </button>
          <button
            type="button"
            onClick={handleCopyAdd}
            className="px-4 py-1.5 rounded-[6px] bg-white border border-[#6085e7] text-[#6085e7] text-[13px] font-medium hover:bg-[#f0f4fd] transition-colors cursor-pointer shadow-sm"
          >
            复制新增
          </button>
          <button
            type="button"
            onClick={handleEdit}
            className="px-4 py-1.5 rounded-[6px] bg-white border border-hub-border text-hub-text text-[13px] font-medium hover:border-[#6085e7] hover:text-[#6085e7] transition-colors cursor-pointer shadow-sm"
          >
            修改
          </button>
        </div>
        <div className="text-[12px] text-hub-textMuted">
          共 <span className="font-bold text-hub-text">{list.length}</span> 条服务等级与SLA配置
        </div>
      </div>

      {/* 表格容器 */}
      <div className="bg-white rounded-[10px] border border-hub-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse font-hub text-[12.5px]">
            <thead>
              <tr className="bg-slate-50 text-hub-textSecondary border-b border-hub-border select-none">
                {/* 1. 勾选框 */}
                <th className="w-10 px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={handleToggleSelectAll}
                    aria-label="全选"
                    className="w-4 h-4 rounded border-hub-border text-[#6085e7] focus:ring-0 cursor-pointer align-middle"
                  />
                </th>

                {/* 2. 序号 */}
                <th className="w-14 px-3 py-3 text-center whitespace-nowrap">序号</th>

                {/* 3. 服务等级 */}
                <th className="px-3 py-3 whitespace-nowrap">服务等级</th>

                {/* 4. 问题级别 */}
                <th className="px-3 py-3 whitespace-nowrap">问题级别</th>

                {/* 5. 问题类型 */}
                <th className="px-3 py-3 whitespace-nowrap">问题类型</th>

                {/* 6. 标准处理时长SLA（h) */}
                <th className="px-3 py-3 text-center whitespace-nowrap">标准处理时长SLA（h)</th>

                {/* 7. 对应系统 */}
                <th className="px-3 py-3 whitespace-nowrap">对应系统</th>

                {/* 8. 来源系统字段 */}
                <th className="px-3 py-3 whitespace-nowrap">来源系统字段</th>

                {/* 9. 来源系统code */}
                <th className="px-3 py-3 whitespace-nowrap">来源系统code</th>

                {/* 10. 最后操作人 */}
                <th className="px-3 py-3 whitespace-nowrap">最后操作人</th>

                {/* 11. 最后操作时间 */}
                <th className="px-3 py-3 whitespace-nowrap">最后操作时间</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-hub-borderLight">
              {slaQuery.isLoading && (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-hub-textMuted">
                    加载中…
                  </td>
                </tr>
              )}

              {!slaQuery.isLoading && list.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-hub-textMuted">
                    暂无服务等级与SLA配置数据
                  </td>
                </tr>
              )}

              {!slaQuery.isLoading &&
                list.map((item, index) => {
                  const isChecked = selectedIds.includes(item.id);
                  return (
                    <tr
                      key={item.id}
                      onClick={() => handleToggleSelectRow(item.id)}
                      className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                        isChecked ? "bg-blue-50/40" : ""
                      }`}
                    >
                      {/* 1. 勾选框 */}
                      <td
                        className="px-3 py-2.5 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelectRow(item.id)}
                          aria-label={`选择第 ${index + 1} 项`}
                          className="w-4 h-4 rounded border-hub-border text-[#6085e7] focus:ring-0 cursor-pointer align-middle"
                        />
                      </td>

                      {/* 2. 序号 */}
                      <td className="px-3 py-2.5 text-center text-hub-textMuted tabular-nums">
                        {index + 1}
                      </td>

                      {/* 3. 服务等级 */}
                      <td className="px-3 py-2.5 font-medium text-hub-text whitespace-nowrap">
                        {item.name}
                      </td>

                      {/* 4. 问题级别 */}
                      <td className="px-3 py-2.5 text-hub-textSecondary whitespace-nowrap">
                        {item.issue_levels || "-"}
                      </td>

                      {/* 5. 问题类型 */}
                      <td className="px-3 py-2.5 text-hub-textSecondary whitespace-nowrap">
                        {item.issue_types || "-"}
                      </td>

                      {/* 6. 标准处理时长SLA（h) */}
                      <td className="px-3 py-2.5 text-center font-semibold text-hub-text tabular-nums whitespace-nowrap">
                        {item.sla_hours}
                      </td>

                      {/* 7. 对应系统 */}
                      <td className="px-3 py-2.5 text-hub-textSecondary whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11.5px]">
                          {item.source_system}
                        </span>
                      </td>

                      {/* 8. 来源系统字段 */}
                      <td className="px-3 py-2.5 text-hub-textSecondary whitespace-nowrap">
                        {item.source_system_field}
                      </td>

                      {/* 9. 来源系统code */}
                      <td className="px-3 py-2.5 text-hub-textSecondary whitespace-nowrap font-mono text-[12px]">
                        {item.source_system_code || item.code}
                      </td>

                      {/* 10. 最后操作人 */}
                      <td className="px-3 py-2.5 text-hub-textSecondary whitespace-nowrap">
                        {item.updated_by || "-"}
                      </td>

                      {/* 11. 最后操作时间 */}
                      <td className="px-3 py-2.5 text-hub-textMuted tabular-nums whitespace-nowrap">
                        {formatDateTime(item.updated_at)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增 / 修改 弹窗 */}
      {modalOpen && (
        <SlaModal
          initialData={editingItem}
          onClose={() => setModalOpen(false)}
          onSubmit={async (formData) => {
            await saveMutation.mutateAsync(formData);
          }}
        />
      )}
    </div>
  );
}
