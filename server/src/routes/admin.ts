import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import {
  setAuditContext,
  getAuditLogs,
  getAuditStatistics,
  exportAuditLogsToCSV,
  verifyAuditTrailIntegrity,
} from "../middleware/audit";
import { requireAdmin } from "../middleware/authz";
import { uploadVaultMetadata } from "../services/ipfs/vaultMetadataService";
import { freezeService } from "../services/freezeService";
import { parsePaginationLimit, type PaginatedResponse } from "../types/pagination";
import { PROTOCOLS } from "../config/protocols";
import { strategyStateTransitionAuditService } from "../services/strategyStateTransitionAuditService";

const adminRouter = Router();

// #935 — sensitive admin mutations (fund/vault/access impacting) get a tight,
// per-window burst limit with a clear 429 error response.
const adminMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many admin requests. Please try again later." },
});

// Read-only admin endpoints (audit log browsing/exports) get a looser limit.
const adminReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many admin requests. Please try again later." },
});

/**
 * Update vault parameters
 * POST /api/admin/vaults/:vaultId/parameters
 */
adminRouter.post(
  "/vaults/:vaultId/parameters",
  adminMutationLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { vaultId } = req.params;
      const changes = req.body;

      // Set audit context before processing
      setAuditContext(req, {
        action: "UPDATE_VAULT_PARAMETERS",
        resource: "VAULT",
        resourceId: vaultId,
        changes,
      });

      // TODO: Implement actual vault parameter update logic
      // Example: await updateVaultParameters(vaultId, changes);

      res.json({
        success: true,
        message: `Vault ${vaultId} parameters updated`,
        vaultId,
        changes,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to update vault parameters",
      });
    }
  },
);

/**
 * Upload vault metadata to IPFS and return metadata URI for contract updates
 * POST /api/admin/vaults/:vaultId/metadata
 */
adminRouter.post(
  "/vaults/:vaultId/metadata",
  adminMutationLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { vaultId } = req.params;
      const { vaultName, description, iconSvg } = req.body as {
        vaultName?: string;
        description?: string;
        iconSvg?: string;
      };

      if (!vaultName || !description || !iconSvg) {
        res.status(400).json({
          error: "vaultName, description, and iconSvg are required",
        });
        return;
      }

      const uploadResult = await uploadVaultMetadata({
        vaultName,
        description,
        iconSvg,
      });

      setAuditContext(req, {
        action: "UPDATE_VAULT_METADATA_URI",
        resource: "VAULT",
        resourceId: vaultId,
        changes: {
          metadataUri: uploadResult.metadataUri,
          cid: uploadResult.cid,
          uploadMode: uploadResult.uploadMode,
        },
      });

      res.json({
        success: true,
        vaultId,
        cid: uploadResult.cid,
        metadataUri: uploadResult.metadataUri,
        iconUri: uploadResult.iconUri,
        uploadMode: uploadResult.uploadMode,
        metadata: uploadResult.metadata,
        transactionPayload: {
          method: "set_metadata_uri",
          args: {
            vaultId,
            metadataUri: uploadResult.metadataUri,
          },
        },
      });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload vault metadata",
      });
    }
  },
);

/**
 * Pause vault
 * POST /api/admin/vaults/:vaultId/pause
 */
adminRouter.post(
  "/vaults/:vaultId/pause",
  adminMutationLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { vaultId } = req.params;
      const { reason } = req.body;

      setAuditContext(req, {
        action: "PAUSE_VAULT",
        resource: "VAULT",
        resourceId: vaultId,
        changes: { reason },
      });

      // TODO: Implement actual vault pause logic
      // Example: await pauseVault(vaultId, reason);

      res.json({
        success: true,
        message: `Vault ${vaultId} paused`,
        vaultId,
        reason,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to pause vault",
      });
    }
  },
);

/**
 * Resume vault
 * POST /api/admin/vaults/:vaultId/resume
 */
adminRouter.post(
  "/vaults/:vaultId/resume",
  adminMutationLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { vaultId } = req.params;

      setAuditContext(req, {
        action: "RESUME_VAULT",
        resource: "VAULT",
        resourceId: vaultId,
      });

      // TODO: Implement actual vault resume logic
      // Example: await resumeVault(vaultId);

      res.json({
        success: true,
        message: `Vault ${vaultId} resumed`,
        vaultId,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to resume vault",
      });
    }
  },
);

/**
 * Update fee configuration
 * POST /api/admin/fees/config
 */
adminRouter.post(
  "/fees/config",
  adminMutationLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const changes = req.body;

      setAuditContext(req, {
        action: "UPDATE_FEE_CONFIG",
        resource: "FEE_CONFIG",
        changes,
      });

      // TODO: Implement actual fee config update logic
      // Example: await updateFeeConfig(changes);

      res.json({
        success: true,
        message: "Fee configuration updated",
        changes,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to update fee configuration",
      });
    }
  },
);

/**
 * Update risk parameters
 * POST /api/admin/risk/parameters
 */
adminRouter.post(
  "/risk/parameters",
  adminMutationLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const changes = req.body;

      setAuditContext(req, {
        action: "UPDATE_RISK_PARAMETERS",
        resource: "RISK_CONFIG",
        changes,
      });

      // TODO: Implement actual risk parameter update logic
      // Example: await updateRiskParameters(changes);

      res.json({
        success: true,
        message: "Risk parameters updated",
        changes,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to update risk parameters",
      });
    }
  },
);

/**
 * Get audit logs
 * GET /api/admin/audit-logs
 */
adminRouter.get(
  "/audit-logs",
  adminReadLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId, action, resource, startDate, endDate, limit, cursor } = req.query;

      const effectiveLimit = parsePaginationLimit(limit);

      const logs = await getAuditLogs({
        userId: userId as string,
        action: action as string,
        resource: resource as string,
        startDate: startDate as string,
        endDate: endDate as string,
        limit: effectiveLimit + 1,
        cursor: cursor as string | undefined,
      });

      const hasMore = logs.length > effectiveLimit;
      const page = hasMore ? logs.slice(0, effectiveLimit) : logs;
      const nextCursor = hasMore ? page[page.length - 1].id : null;

      const response: PaginatedResponse<(typeof page)[0]> = {
        data: page,
        pagination: { nextCursor, hasMore, limit: effectiveLimit },
      };

      res.json(response);
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to retrieve audit logs",
      });
    }
  },
);

/**
 * Get audit statistics
 * GET /api/admin/audit-stats
 */
adminRouter.get(
  "/audit-stats",
  adminReadLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const stats = await getAuditStatistics();

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to retrieve audit statistics",
      });
    }
  },
);

/**
 * Export audit logs as CSV
 * GET /api/admin/audit-logs/export
 */
adminRouter.get(
  "/audit-logs/export",
  adminReadLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId, action, resource, startDate, endDate } = req.query;

      const csv = await exportAuditLogsToCSV({
        userId: userId as string,
        action: action as string,
        resource: resource as string,
        startDate: startDate as string,
        endDate: endDate as string,
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="audit-logs.csv"',
      );
      res.send(csv);
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to export audit logs",
      });
    }
  },
);

/**
 * Verify audit trail integrity
 * GET /api/admin/audit-verify
 */
adminRouter.get(
  "/audit-verify",
  adminReadLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const logs = await getAuditLogs({ limit: 10000 });
      const verification = verifyAuditTrailIntegrity(logs);

      res.json({
        success: true,
        isValid: verification.isValid,
        totalEntries: logs.length,
        invalidEntries: verification.invalidEntries,
        message: verification.isValid
          ? "Audit trail integrity verified"
          : `Found ${verification.invalidEntries.length} invalid entries`,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to verify audit trail",
      });
    }
  },
);

/**
 * Revoke user access
 * POST /api/admin/users/:userId/revoke-access
 */
adminRouter.post(
  "/users/:userId/revoke-access",
  adminMutationLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      const { reason } = req.body;

      setAuditContext(req, {
        action: "REVOKE_USER_ACCESS",
        resource: "USER",
        resourceId: userId,
        changes: { reason },
      });

      // TODO: Implement actual user access revocation logic
      // Example: await revokeUserAccess(userId, reason);

      res.json({
        success: true,
        message: `Access revoked for user ${userId}`,
        userId,
        reason,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to revoke user access",
      });
    }
  },
);

/**
 * Grant user access
 * POST /api/admin/users/:userId/grant-access
 */
adminRouter.post(
  "/users/:userId/grant-access",
  adminMutationLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      const { role, permissions } = req.body;

      setAuditContext(req, {
        action: "GRANT_USER_ACCESS",
        resource: "USER",
        resourceId: userId,
        changes: { role, permissions },
      });

      // TODO: Implement actual user access grant logic
      // Example: await grantUserAccess(userId, role, permissions);

      res.json({
        success: true,
        message: `Access granted for user ${userId}`,
        userId,
        role,
        permissions,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to grant user access",
      });
    }
  },
);

/**
 * Global or protocol-specific recommendation freeze
 * POST /api/admin/recommendations/freeze
 */
adminRouter.post(
  "/recommendations/freeze",
  adminMutationLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { protocol, reason } = req.body;
      const actor = (req as unknown as { user?: { id: string } }).user?.id || "admin";

      let state;
      if (protocol) {
        state = await freezeService.freezeProtocol(protocol, reason, actor);

        // #371 operator intervention: record lifecycle transition to frozen.
        try {
          strategyStateTransitionAuditService.recordOperatorIntervention(
            String(protocol).toLowerCase(),
            "frozen",
            `freeze_reason=${reason}`,
            actor,
          );
        } catch (err) {
          console.warn("Failed to record frozen transition:", err);
        }
      } else {
        state = await freezeService.freezeGlobal(reason, actor);

        // #371 operator intervention: record frozen transition for all known strategies.
        for (const p of PROTOCOLS) {
          try {
            strategyStateTransitionAuditService.recordOperatorIntervention(
              p.protocolName.toLowerCase(),
              "frozen",
              `freeze_reason=${reason}`,
              actor,
            );
          } catch {
            // Best-effort only; never break the admin endpoint.
          }
        }
      }

      setAuditContext(req, {
        action: "FREEZE_RECOMMENDATIONS",
        resource: protocol ? "PROTOCOL" : "GLOBAL",
        resourceId: protocol || "GLOBAL",
        changes: { reason },
      });

      res.json({ success: true, state });
    } catch {
      res.status(500).json({ error: "Failed to freeze recommendations" });
    }
  },
);

/**
 * Global or protocol-specific recommendation resume
 * POST /api/admin/recommendations/resume
 */
adminRouter.post(
  "/recommendations/resume",
  adminMutationLimiter,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { protocol } = req.body;
      const actor = (req as unknown as { user?: { id: string } }).user?.id || "admin";

      let state;
      if (protocol) {
        state = await freezeService.resumeProtocol(protocol, actor);

        // #371 operator intervention: record lifecycle transition to recovered.
        try {
          strategyStateTransitionAuditService.recordOperatorIntervention(
            String(protocol).toLowerCase(),
            "recovered",
            "resume_reason=operator",
            actor,
          );
        } catch (err) {
          console.warn("Failed to record recovered transition:", err);
        }
      } else {
        state = await freezeService.resumeGlobal(actor);

        for (const p of PROTOCOLS) {
          try {
            strategyStateTransitionAuditService.recordOperatorIntervention(
              p.protocolName.toLowerCase(),
              "recovered",
              "resume_reason=operator",
              actor,
            );
          } catch {
            // Best-effort only; never break the admin endpoint.
          }
        }
      }

      setAuditContext(req, {
        action: "RESUME_RECOMMENDATIONS",
        resource: protocol ? "PROTOCOL" : "GLOBAL",
        resourceId: protocol || "GLOBAL",
      });

      res.json({ success: true, state });
    } catch {
      res.status(500).json({ error: "Failed to resume recommendations" });
    }
  },
);

export default adminRouter;
