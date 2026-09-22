import { useEffect, useRef, useState } from "react";
import {
  type ClientLookupCompany,
  type EnterpriseSearchResult,
  type SessionItem,
  type MessageItem,
  clientFetchTenantProfile,
  clientLookupPhone,
  clientSearchEnterprises,
} from "../receptionApi";

export interface CustomerProfile {
  contact_name: string;
  contact_phone: string;
  company_name: string;
  tax_no: string;
  tenant_name?: string;
  tenant_no?: string;
  purchased_products?: string[];
  is_historical: boolean;
}

interface CustomerInfoCollectionPageProps {
  onSuccess: (data: {
    profile: CustomerProfile;
    session?: SessionItem | null;
    messages?: MessageItem[];
  }) => void;
}

export function CustomerInfoCollectionPage({ onSuccess }: CustomerInfoCollectionPageProps) {
  // 表单状态
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [taxNo, setTaxNo] = useState("");

  // 历史企业查询状态
  const [lookupLoading, setLookupLoading] = useState(false);
  const [historyEnterprises, setHistoryEnterprises] = useState<ClientLookupCompany[]>([]);
  const [historyDropdownOpen, setHistoryDropdownOpen] = useState(false);
  const [selectedHistoryEnterprise, setSelectedHistoryEnterprise] = useState<ClientLookupCompany | null>(null);

  // 工商局接口新企业联想推荐
  const [searchLoading, setSearchLoading] = useState(false);
  const [enterpriseSuggestions, setEnterpriseSuggestions] = useState<EnterpriseSearchResult[]>([]);
  const [suggestionDropdownOpen, setSuggestionDropdownOpen] = useState(false);

  // 提交状态
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const searchDebounceRef = useRef<any>(null);

  // 手机号格式与非法号码校验
  const validatePhone = (value: string): boolean => {
    const p = value.trim();
    if (!p) {
      setPhoneError("请输入咨询人手机号");
      return false;
    }
    // 11位以1开头
    const is11Digits = /^1[3-9]\d{9}$/.test(p);
    // 拦截全相同虚假号码如 11111111111, 22222222222
    const isAllSameDigits = new Set(p.split("")).size <= 1;

    if (!is11Digits || isAllSameDigits) {
      setPhoneError("请输入有效的11位手机号码（不允许全相同重复伪号码）");
      return false;
    }

    setPhoneError("");
    return true;
  };

  // 当手机号输入满 11 位且合法时，触发历史企业检索
  useEffect(() => {
    const p = phone.trim();
    if (p.length === 11) {
      if (validatePhone(p)) {
        setLookupLoading(true);
        clientLookupPhone(p)
          .then((res) => {
            setHistoryEnterprises(res.items);
            // 无论 1 条还是多条，均不自动填入！由客户自主选择
            setSelectedHistoryEnterprise(null);
            setHistoryDropdownOpen(false);
          })
          .catch(() => {
            setHistoryEnterprises([]);
          })
          .finally(() => {
            setLookupLoading(false);
          });
      }
    } else {
      setHistoryEnterprises([]);
      setHistoryDropdownOpen(false);
      setSelectedHistoryEnterprise(null);
      if (p.length > 0 && p.length < 11) {
        setPhoneError("手机号码必须为11位数字");
      } else if (p.length === 0) {
        setPhoneError("");
      }
    }
  }, [phone]);

  // 当客户手动录入企业名称时，触发工商局接口联想推荐（仅在未选择历史企业或使用新企业时）
  const handleCompanyNameChange = (value: string) => {
    setCompanyName(value);
    setSelectedHistoryEnterprise(null); // 用户手动输入则视为可能的新企业

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    const kw = value.trim();
    if (kw.length >= 2) {
      setSearchLoading(true);
      searchDebounceRef.current = setTimeout(async () => {
        try {
          const results = await clientSearchEnterprises(kw);
          setEnterpriseSuggestions(results);
          setSuggestionDropdownOpen(results.length > 0);
        } finally {
          setSearchLoading(false);
        }
      }, 300);
    } else {
      setEnterpriseSuggestions([]);
      setSuggestionDropdownOpen(false);
    }
  };

  // 选择历史企业
  const handleSelectHistoryEnterprise = (item: ClientLookupCompany) => {
    setSelectedHistoryEnterprise(item);
    setCompanyName(item.company_name);
    setTaxNo(item.tax_no);
    setHistoryDropdownOpen(false);
    setSuggestionDropdownOpen(false);
    if (!contactName && item.contact_name) {
      setContactName(item.contact_name);
    }
  };

  // 选择工商局联想推荐企业
  const handleSelectSuggestion = (item: EnterpriseSearchResult) => {
    setCompanyName(item.company_name);
    setTaxNo(item.tax_no);
    setSelectedHistoryEnterprise(null);
    setSuggestionDropdownOpen(false);
  };

  // 提交并初始化会话
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError("");

    if (!validatePhone(phone)) return;
    if (!companyName.trim()) {
      setSubmitError("请输入或选择企业名称");
      return;
    }
    if (!taxNo.trim()) {
      setSubmitError("请输入企业纳税人识别号/税号");
      return;
    }

    setSubmitting(true);
    try {
      const isHistorical = !!selectedHistoryEnterprise;
      let tenantName = selectedHistoryEnterprise?.tenant_name;
      let tenantNo = selectedHistoryEnterprise?.tenant_no;
      let purchasedProducts = selectedHistoryEnterprise?.purchased_products;

      // 如果不是使用历史企业，调用运营接口补全归属租户和已购产品信息
      if (!isHistorical || !tenantName || !tenantNo) {
        const profileRes = await clientFetchTenantProfile(companyName.trim(), taxNo.trim());
        tenantName = tenantName || profileRes.tenant_name;
        tenantNo = tenantNo || profileRes.tenant_no;
        purchasedProducts = purchasedProducts || profileRes.purchased_products;
      }

      // 咨询人姓名：若为空，后端逻辑自动以手机号或默认规则补全
      const finalContactName = contactName.trim() || `客户_${phone.trim().slice(-4)}`;

      const customerProfile: CustomerProfile = {
        contact_name: finalContactName,
        contact_phone: phone.trim(),
        company_name: companyName.trim(),
        tax_no: taxNo.trim(),
        tenant_name: tenantName,
        tenant_no: tenantNo,
        purchased_products: purchasedProducts,
        is_historical: isHistorical,
      };

      onSuccess({
        profile: customerProfile,
      });
    } catch (err: any) {
      console.error("提交失败:", err);
      setSubmitError(err?.message || "进入在线咨询失败，请检查网络或稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-white flex flex-col items-center pt-[20px] px-4 overflow-x-auto">
      {/* 页面标题：发票云售后在线支持（放大到16号字体加粗，向上移动距离页面顶端 20px，水平居中） */}
      <div className="w-full text-center mb-6">
        <div className="inline-flex items-center justify-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[rgb(35,94,212)] flex-none" />
          <h1 className="text-[16px] font-bold text-slate-800 tracking-tight">
            发票云售后在线支持
          </h1>
        </div>
        <div className="text-[11px] text-[#666666] mt-1">
          <span>欢迎咨询 · 身份登记</span>
          <span className="ml-1">（带 * 为必填要素）</span>
        </div>
      </div>

      {/* 信息录入表单：左右结构，一行展示一个 key+value，每行间距调整为 10px，整体水平居中且与“发票云售后在线支持”垂直对齐 */}
      <form onSubmit={handleSubmit} className="space-y-[10px] text-[13px] w-full flex flex-col items-center">
        {/* 咨询人姓名（非必填，宽 500px 高 30px） */}
        <div className="flex items-center justify-center gap-3 w-full">
          <label className="w-[120px] text-right text-[13px] font-medium text-slate-700 flex-none">
            咨询人姓名
          </label>
          <div className="w-[500px] flex-none">
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="请输入您的称呼（如：王经理、李会计）"
              className="w-[500px] h-[30px] px-3 border border-slate-200 rounded-[4px] text-slate-800 text-[13px] placeholder:text-slate-400 focus:outline-none focus:border-[rgb(35,94,212)] focus:ring-1 focus:ring-[rgb(35,94,212)]/20 transition"
            />
          </div>
          <div className="w-[120px] flex-none" />
        </div>

        {/* 咨询人手机号（必填，宽 500px 高 30px） */}
        <div className="flex items-start justify-center gap-3 w-full">
          <label className="w-[120px] text-right text-[13px] font-medium text-slate-700 flex-none pt-1">
            咨询人手机号 <span className="text-rose-500">*</span>
          </label>
          <div className="w-[500px] flex-none space-y-1">
            <input
              type="tel"
              maxLength={11}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              onBlur={() => phone && validatePhone(phone)}
              placeholder="请输入11位中国大陆手机号码"
              className={`w-[500px] h-[30px] px-3 border rounded-[4px] text-slate-800 font-mono text-[13px] placeholder:text-slate-400 focus:outline-none transition ${
                phoneError
                  ? "border-rose-400 bg-rose-50/20 focus:border-rose-500 focus:ring-1 focus:ring-rose-200"
                  : "border-slate-200 focus:border-[rgb(35,94,212)] focus:ring-1 focus:ring-[rgb(35,94,212)]/20"
              }`}
            />
            {lookupLoading && (
              <p className="text-[11px] text-[rgb(35,94,212)] animate-pulse">正在检索历史关联企业...</p>
            )}
            {phoneError && <p className="text-xs text-rose-500 font-medium">{phoneError}</p>}
          </div>
          <div className="w-[120px] flex-none" />
        </div>

        {/* 历史企业提示面板（≥1 条记录时展示提示文字与下拉查看按钮，绝不自动填充） */}
        {historyEnterprises.length > 0 && (
          <div className="flex items-start justify-center gap-3 w-full">
            <div className="w-[120px] flex-none" />
            <div className="w-[500px] flex-none p-3.5 bg-blue-50/70 border border-blue-200/80 rounded-lg space-y-2.5">
              <div className="text-xs text-[#666666] leading-relaxed">
                <span className="text-[rgb(35,94,212)] font-semibold">💡 提示：</span>
                后端查询咨询手机号关联咨询企业有{" "}
                <strong className="text-[rgb(35,94,212)] font-bold text-sm">
                  {historyEnterprises.length}
                </strong>{" "}
                个，下拉按钮查看并选择历史企业发起咨询，如需要给新企业咨询，请手动录入企业名称和税号
              </div>

              {/* 下拉按钮查看并选择历史企业 */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setHistoryDropdownOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1 bg-white border border-[rgb(35,94,212)]/40 text-[rgb(35,94,212)] rounded text-xs font-medium hover:bg-blue-50 cursor-pointer transition shadow-2xs"
                >
                  <span>查看并选择历史企业（{historyEnterprises.length}）</span>
                  <span>{historyDropdownOpen ? "▲" : "▼"}</span>
                </button>

                {selectedHistoryEnterprise && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-medium">
                    ✓ 已选用历史企业
                  </span>
                )}
              </div>

              {/* 历史企业下拉卡片列表 */}
              {historyDropdownOpen && (
                <div className="mt-2 space-y-2 pt-2 border-t border-blue-100 max-h-56 overflow-y-auto">
                  {historyEnterprises.map((ent, idx) => {
                    const isSelected =
                      selectedHistoryEnterprise?.company_name === ent.company_name &&
                      selectedHistoryEnterprise?.tax_no === ent.tax_no;
                    return (
                      <div
                        key={`${ent.company_name}_${idx}`}
                        onClick={() => handleSelectHistoryEnterprise(ent)}
                        className={`p-2.5 rounded-lg border text-xs cursor-pointer transition flex items-center justify-between ${
                          isSelected
                            ? "bg-blue-100/70 border-[rgb(35,94,212)] text-[rgb(35,94,212)] font-medium"
                            : "bg-white border-slate-200 hover:border-blue-300 text-slate-800"
                        }`}
                      >
                        <div className="space-y-0.5 max-w-[80%]">
                          <div className="font-semibold truncate">{ent.company_name}</div>
                          <div className="text-[11px] text-[#666666] font-mono">税号: {ent.tax_no || "—"}</div>
                          {ent.tenant_name && (
                            <div className="text-[10.5px] text-[#666666]">租户: {ent.tenant_name}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          className={`px-2.5 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                            isSelected
                              ? "bg-[rgb(35,94,212)] text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-[rgb(35,94,212)] hover:text-white"
                          }`}
                        >
                          {isSelected ? "已选" : "选择"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="w-[120px] flex-none" />
          </div>
        )}

        {/* 企业名称（左右结构：Key 在左，Value 在右，宽 500px 高 30px） */}
        <div className="flex items-start justify-center gap-3 w-full">
          <label className="w-[120px] text-right text-[13px] font-medium text-slate-700 flex-none pt-1">
            企业名称 <span className="text-rose-500">*</span>
          </label>
          <div className="w-[500px] flex-none relative space-y-1">
            <input
              type="text"
              value={companyName}
              onChange={(e) => handleCompanyNameChange(e.target.value)}
              onFocus={() => {
                if (enterpriseSuggestions.length > 0 && !selectedHistoryEnterprise) {
                  setSuggestionDropdownOpen(true);
                }
              }}
              placeholder="请输入本次咨询的企业全称"
              className="w-[500px] h-[30px] px-3 border border-slate-200 rounded-[4px] text-slate-800 text-[13px] placeholder:text-slate-400 focus:outline-none focus:border-[rgb(35,94,212)] focus:ring-1 focus:ring-[rgb(35,94,212)]/20 transition"
            />
            <div className="flex items-center justify-between text-[11px]">
              {selectedHistoryEnterprise ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedHistoryEnterprise(null);
                    setCompanyName("");
                    setTaxNo("");
                  }}
                  className="text-xs text-[rgb(35,94,212)] hover:underline cursor-pointer"
                >
                  清空换新企业
                </button>
              ) : searchLoading ? (
                <span className="text-[11px] text-[rgb(35,94,212)] animate-pulse">正在查询企业信息...</span>
              ) : (
                <span className="text-[11px] text-[#666666]">支持输入关键字查询企业信息</span>
              )}
            </div>

            {/* 企业查询推荐下拉面板（明显展示框，标题修改为“根据录入信息查询企业信息”） */}
            {suggestionDropdownOpen && enterpriseSuggestions.length > 0 && (
              <div className="absolute left-0 w-[500px] top-[34px] bg-white border-2 border-[rgb(35,94,212)]/50 rounded-lg shadow-[0_12px_28px_rgba(0,0,0,0.15)] z-30 max-h-60 overflow-y-auto divide-y divide-slate-200">
                <div className="p-2.5 bg-blue-50/80 border-b border-blue-100 text-[12px] font-medium text-[#666666] flex items-center justify-between">
                  <span>根据录入信息查询企业信息</span>
                  <button
                    type="button"
                    onClick={() => setSuggestionDropdownOpen(false)}
                    className="text-[#666666] hover:text-slate-900 cursor-pointer text-xs"
                  >
                    ✕
                  </button>
                </div>
                {enterpriseSuggestions.map((item, idx) => (
                  <div
                    key={`${item.company_name}_${idx}`}
                    onClick={() => handleSelectSuggestion(item)}
                    className="p-3 hover:bg-blue-50/70 cursor-pointer transition flex flex-col gap-[3px] border-l-2 border-l-transparent hover:border-l-[rgb(35,94,212)]"
                  >
                    <div className="font-semibold text-slate-800 text-[14px] leading-tight">
                      {item.company_name}
                    </div>
                    <div className="text-[13px] text-[#666666] font-mono flex items-center justify-between">
                      <span>统一社会信用代码: {item.tax_no}</span>
                      <span className="text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded text-[11px] font-medium font-sans">
                        {item.status || "存续"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="w-[120px] flex-none" />
        </div>

        {/* 企业税号（左右结构：Key 在左，Value 在右，宽 500px 高 30px） */}
        <div className="flex items-center justify-center gap-3 w-full">
          <label className="w-[120px] text-right text-[13px] font-medium text-slate-700 flex-none">
            企业税号 <span className="text-rose-500">*</span>
          </label>
          <div className="w-[500px] flex-none">
            <input
              type="text"
              value={taxNo}
              onChange={(e) => setTaxNo(e.target.value.toUpperCase().replace(/\s+/g, ""))}
              placeholder="请输入统一社会信用代码（18位）或纳税人识别号"
              className="w-[500px] h-[30px] px-3 border border-slate-200 rounded-[4px] text-slate-800 font-mono text-[13px] placeholder:text-slate-400 focus:outline-none focus:border-[rgb(35,94,212)] focus:ring-1 focus:ring-[rgb(35,94,212)]/20 transition uppercase"
            />
          </div>
          <div className="w-[120px] flex-none" />
        </div>

        {/* 错误提示 */}
        {submitError && (
          <div className="flex items-center justify-center gap-3 w-full">
            <div className="w-[120px] flex-none" />
            <div className="w-[500px] p-2.5 rounded bg-rose-50 border border-rose-200 text-rose-600 text-xs font-medium">
              {submitError}
            </div>
            <div className="w-[120px] flex-none" />
          </div>
        )}

        {/* 提交按钮：宽度 500px，高度修改为 30px，文字修改为【提交】 */}
        <div className="flex items-center justify-center gap-3 w-full">
          <div className="w-[120px] flex-none" />
          <div className="w-[500px] flex-none">
            <button
              type="submit"
              disabled={submitting}
              className="w-[500px] h-[30px] bg-[rgb(35,94,212)] hover:opacity-90 text-white rounded-[5px] font-medium text-[13px] transition cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>提交中...</span>
                </>
              ) : (
                <span>提交</span>
              )}
            </button>
          </div>
          <div className="w-[120px] flex-none" />
        </div>

        {/* 底部只保留隐私安全保护：字体颜色 RGB:666666 */}
        <div className="flex items-center justify-center gap-3 w-full">
          <div className="w-[120px] flex-none" />
          <div className="w-[500px] flex items-center justify-center text-[11px] text-[#666666]">
            <span>🔒 隐私安全保护</span>
          </div>
          <div className="w-[120px] flex-none" />
        </div>
      </form>
    </div>
  );
}
