"""List Linear issue labels (UUID + name + team).

Usage:
    .venv/bin/python scripts/list_linear_labels.py
"""

from __future__ import annotations

import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

import httpx

from app.config import get_settings


def main() -> None:
    settings = get_settings()
    key = settings.linear_api_key.strip()
    if not key:
        print("未在当前环境配置中检测到 LINEAR_API_KEY")
        sys.exit(1)

    headers = {
        "Authorization": key,
        "Content-Type": "application/json",
    }
    query = """
    query {
      issueLabels(first: 100) {
        nodes {
          id
          name
          color
          description
          team {
            key
            name
          }
        }
      }
    }
    """
    try:
        resp = httpx.post(
            "https://api.linear.app/graphql",
            headers=headers,
            json={"query": query},
            timeout=15,
        )
        data = resp.json()
        if "errors" in data:
            print("Linear GraphQL 错误:", data["errors"])
            sys.exit(1)

        nodes = data.get("data", {}).get("issueLabels", {}).get("nodes", [])
        print(f"共查询到 {len(nodes)} 个 Linear 标签：\n")
        print(f"{'归属团队':<12} {'标签名称':<25} {'UUID':<40} {'说明'}")
        print("-" * 85)
        for n in nodes:
            team_info = f"[{n['team']['key']}]" if n.get("team") else "[全局]"
            desc = n.get("description") or ""
            print(f"{team_info:<12} {n['name']:<25} {n['id']:<40} {desc}")
    except Exception as e:
        print("请求失败:", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
