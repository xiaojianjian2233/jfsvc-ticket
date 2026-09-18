import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { appPath } from "@/api/base";

const DEV_DEFAULT_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzNSIsIm5hbWUiOiJcdTY3NjhcdTYxNjdcdTgzODkiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3ODk3MDM0OTQsImV4cCI6MTc5MDMwODI5NH0.q9W9u7I-NE43Zn67kBNgzBFkzkGn8UmXPSuU6X_2n4E";
const DEV_DEFAULT_USER = {
  id: 35,
  name: "杨慧莉",
  role: "admin",
  feishu_uid: "ou_bc3d1376d982e452056b469b4e73cad4",
};

export function LoginPage() {
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ssoError, setSsoError] = useState<string | null>(null);

  useEffect(() => {
    // 本地开发环境自动写入有效授权并直接进入系统，防止飞书授权重定向到 SIT 线上环境
    if (import.meta.env.DEV) {
      localStorage.setItem("auth_token", DEV_DEFAULT_TOKEN);
      localStorage.setItem("auth_user", JSON.stringify(DEV_DEFAULT_USER));
      window.location.href = appPath("/tickets");
      return;
    }

    // If main.tsx flagged an SSO failure (callback returned with sso_error),
    // surface it here.
    const stored = localStorage.getItem("auth_sso_error");
    if (stored) {
      setSsoError(stored);
      localStorage.removeItem("auth_sso_error");
    }
    api
      .get("/api/auth/feishu/login")
      .then((r) => setAuthorizeUrl(r.authorize_url))
      .catch((e) => setError(String(e)));
  }, []);

  const handleDevLogin = () => {
    localStorage.setItem("auth_token", DEV_DEFAULT_TOKEN);
    localStorage.setItem("auth_user", JSON.stringify(DEV_DEFAULT_USER));
    window.location.href = appPath("/tickets");
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-sm w-full space-y-4 p-8 rounded-lg shadow bg-white dark:bg-gray-900">
        <h1 className="text-xl font-semibold">登录 ticket-hub</h1>
        <p className="text-sm text-gray-500">飞书扫码登录是唯一入口（决策 D19）。</p>
        {ssoError && (
          <p className="text-sm text-red-600">
            上次扫码失败：{ssoError}
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {import.meta.env.DEV && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded space-y-2">
            <div className="text-xs text-blue-700 font-medium">本地开发环境快捷通道</div>
            <button
              type="button"
              onClick={handleDevLogin}
              className="block w-full text-center bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded font-medium text-sm transition-colors"
            >
              一键进入系统（杨慧莉）
            </button>
          </div>
        )}

        {authorizeUrl ? (
          <a
            href={authorizeUrl}
            className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white py-2 rounded"
          >
            飞书扫码登录
          </a>
        ) : (
          <button disabled className="w-full bg-gray-300 text-gray-600 py-2 rounded">
            正在加载…
          </button>
        )}
      </div>
    </div>
  );
}
