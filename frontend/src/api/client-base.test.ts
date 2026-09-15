import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

it.each(["/", "/hub-issue/", "/ticket-hub-uat/"])("keeps API calls under %s", async (base) => {
  vi.resetModules();
  vi.stubEnv("BASE_URL", base);
  vi.stubEnv("VITE_API_BASE", undefined);
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({items: []}), {status: 200}));
  vi.stubGlobal("fetch", fetchMock);
  const { api } = await import("./client");
  await api.get("/api/tickets");
  expect(fetchMock.mock.calls[0][0]).toBe(`${base.replace(/\/$/, "")}/api/tickets`);
});

it("honors an explicit API prefix", async () => {
  vi.resetModules();
  vi.stubEnv("BASE_URL", "/ticket-hub-uat/");
  vi.stubEnv("VITE_API_BASE", "/other/");
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", {status: 200}));
  vi.stubGlobal("fetch", fetchMock);
  const { api } = await import("./client");
  await api.get("/api/tickets");
  expect(fetchMock.mock.calls[0][0]).toBe("/other/api/tickets");
});
