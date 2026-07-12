import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { requireAdmin } from "../../src/admin/auth.js";

describe("requireAdmin middleware", () => {
  const VALID_TOKEN = "my-secret-admin-token";

  it("returns 401 when no Authorization header is present", async () => {
    const app = new Hono();
    app.use("/admin/*", requireAdmin(VALID_TOKEN));
    app.get("/admin/status", (c) => c.json({ ok: true }));

    const res = await app.request("/admin/status");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is not Bearer", async () => {
    const app = new Hono();
    app.use("/admin/*", requireAdmin(VALID_TOKEN));
    app.get("/admin/status", (c) => c.json({ ok: true }));

    const res = await app.request("/admin/status", {
      headers: { authorization: "Basic abc123" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when Bearer token is wrong", async () => {
    const app = new Hono();
    app.use("/admin/*", requireAdmin(VALID_TOKEN));
    app.get("/admin/status", (c) => c.json({ ok: true }));

    const res = await app.request("/admin/status", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 when Bearer token is correct", async () => {
    const app = new Hono();
    app.use("/admin/*", requireAdmin(VALID_TOKEN));
    app.get("/admin/status", (c) => c.json({ ok: true }));

    const res = await app.request("/admin/status", {
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 401 when configured token is empty (fail closed)", async () => {
    const app = new Hono();
    app.use("/admin/*", requireAdmin(""));
    app.get("/admin/status", (c) => c.json({ ok: true }));

    const res = await app.request("/admin/status", {
      headers: { authorization: "Bearer any-token" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when configured token is empty and no header sent", async () => {
    const app = new Hono();
    app.use("/admin/*", requireAdmin(""));
    app.get("/admin/status", (c) => c.json({ ok: true }));

    const res = await app.request("/admin/status");
    expect(res.status).toBe(401);
  });
});
