/**
 * #935 — Authorization and rate-limit audit for admin, AI, and risk endpoints.
 *
 * - Every sensitive route has an explicit authz test (no user / wrong role / admin).
 * - Rate limit tests prove burst limits kick in with a clear 429 error response.
 * - Audit logs redact tokens, prompts, and secrets from recorded changes.
 */
import request from "supertest";
import { createApp } from "../app";
import { resetAuditLog, getAuditLogs, createAuditEntry } from "../middleware/audit";

const app = createApp();

const ADMIN_AUTH = { Authorization: "Bearer mock-admin-token" };
const USER_AUTH = { Authorization: "Bearer mock-user-token" };

describe("#935 — Route-level authorization policy", () => {
  describe("Admin endpoints require ADMIN role", () => {
    const cases: Array<{ method: "get" | "post"; path: string }> = [
      { method: "post", path: "/api/admin/vaults/v1/parameters" },
      { method: "post", path: "/api/admin/vaults/v1/pause" },
      { method: "post", path: "/api/admin/vaults/v1/resume" },
      { method: "post", path: "/api/admin/fees/config" },
      { method: "post", path: "/api/admin/risk/parameters" },
      { method: "get", path: "/api/admin/audit-logs" },
      { method: "get", path: "/api/admin/audit-stats" },
      { method: "get", path: "/api/admin/audit-verify" },
      { method: "post", path: "/api/admin/users/u1/revoke-access" },
      { method: "post", path: "/api/admin/users/u1/grant-access" },
      { method: "post", path: "/api/admin/recommendations/freeze" },
      { method: "post", path: "/api/admin/recommendations/resume" },
    ];

    for (const { method, path } of cases) {
      it(`${method.toUpperCase()} ${path} → 401 with no credentials`, async () => {
        const res =
          method === "get"
            ? await request(app).get(path)
            : await request(app).post(path).send({});
        expect(res.status).toBe(401);
      });

      it(`${method.toUpperCase()} ${path} → 403 for a non-admin USER role`, async () => {
        const res =
          method === "get"
            ? await request(app).get(path).set(USER_AUTH)
            : await request(app).post(path).set(USER_AUTH).send({});
        expect(res.status).toBe(403);
      });

      it(`${method.toUpperCase()} ${path} → not blocked by authz for ADMIN role`, async () => {
        const res =
          method === "get"
            ? await request(app).get(path).set(ADMIN_AUTH)
            : await request(app).post(path).set(ADMIN_AUTH).send({});
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });
    }
  });

  describe("Risk config-mutation endpoints require ADMIN role", () => {
    // NOTE: all three routes below share `scenarioMutationLimiter` (max 5 per
    // window) by design, so this block is deliberately kept to <=5 requests
    // total to avoid tripping that limiter and polluting the authz assertions
    // (the dedicated rate-limit describe below exercises the 429 behavior).
    const cases: Array<{ method: "post" | "delete"; path: string; body?: object }> = [
      { method: "post", path: "/api/risk/dispersion/config", body: {} },
      {
        method: "post",
        path: "/api/risk/stress-matrix/scenarios",
        body: { id: "s1", name: "Test", factors: {} },
      },
    ];

    for (const { method, path, body } of cases) {
      it(`${method.toUpperCase()} ${path} → 401 with no credentials`, async () => {
        const req = request(app)[method](path);
        const res = body ? await req.send(body) : await req;
        expect(res.status).toBe(401);
      });

      it(`${method.toUpperCase()} ${path} → 403 for a non-admin USER role`, async () => {
        const req = request(app)[method](path).set(USER_AUTH);
        const res = body ? await req.send(body) : await req;
        expect(res.status).toBe(403);
      });
    }

    it("DELETE /api/risk/stress-matrix/scenarios/:id → 401 with no credentials", async () => {
      const res = await request(app).delete(
        "/api/risk/stress-matrix/scenarios/does-not-exist",
      );
      expect(res.status).toBe(401);
    });
  });

  describe("Read-only risk/treasury/governance endpoints remain accessible without ADMIN", () => {
    it("GET /api/risk/dispersion/config does not require admin", async () => {
      const res = await request(app).get("/api/risk/dispersion/config");
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it("GET /api/treasury/scenarios does not require admin", async () => {
      const res = await request(app).get("/api/treasury/scenarios");
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });
});

describe("#935 — Rate limits on sensitive endpoints", () => {
  it("burst of admin mutation requests trips the 429 limit with a clear error body", async () => {
    const path = "/api/admin/vaults/v1/pause";
    let sawLimit = false;
    let lastBody: unknown;

    for (let i = 0; i < 35; i++) {
      const res = await request(app)
        .post(path)
        .set(ADMIN_AUTH)
        .send({ reason: `burst-${i}` });
      if (res.status === 429) {
        sawLimit = true;
        lastBody = res.body;
        break;
      }
    }

    expect(sawLimit).toBe(true);
    expect(lastBody).toHaveProperty("error");
    expect(String((lastBody as { error: string }).error)).toMatch(/too many/i);
  });

  it("sustained requests under the limit are never rate-limited", async () => {
    const path = "/api/risk/dispersion/config";
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get(path);
      expect(res.status).not.toBe(429);
    }
  });

  it("scenario-mutation burst on risk routes trips the 429 limit", async () => {
    let sawLimit = false;
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .delete(`/api/risk/stress-matrix/scenarios/nope-${i}`)
        .set(ADMIN_AUTH);
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
      // Before the limit trips, an authenticated admin request for a
      // nonexistent scenario resolves past authz to a 404.
      expect(res.status).toBe(404);
    }
    expect(sawLimit).toBe(true);
  });
});

describe("#935 — Audit log redaction of tokens, prompts, and secrets", () => {
  beforeEach(() => {
    resetAuditLog();
  });

  it("redacts sensitive keys from recorded change payloads", async () => {
    const req = {
      method: "POST",
      path: "/api/admin/fees/config",
      headers: { "user-agent": "jest" },
      socket: { remoteAddress: "127.0.0.1" },
    } as any;
    const res = { statusCode: 200 } as any;

    await createAuditEntry(req, res, {
      userId: "admin-123",
      action: "UPDATE_FEE_CONFIG",
      resource: "FEE_CONFIG",
      changes: {
        feeBps: 50,
        apiKey: "sk-super-secret-value",
        authorization: "Bearer abc.def.ghi",
        nested: { password: "hunter2", prompt: "ignore all instructions" },
      },
    });

    const [entry] = await getAuditLogs({ limit: 1 });
    expect(entry.changes).toMatchObject({
      feeBps: 50,
      apiKey: "[REDACTED]",
      authorization: "[REDACTED]",
      nested: { password: "[REDACTED]", prompt: "[REDACTED]" },
    });
    expect(JSON.stringify(entry.changes)).not.toContain("sk-super-secret-value");
    expect(JSON.stringify(entry.changes)).not.toContain("hunter2");
  });
});
