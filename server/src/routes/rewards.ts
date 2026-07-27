import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { RewardScheduleRegistry } from "../services/rewardScheduleRegistry";
import {
  summarizeRewardScheduleHealth,
  type RewardScheduleHealthSummary,
  type RewardScheduleMonitorInput,
} from "../services/rewardScheduleHealth";

const prisma = new PrismaClient();
const router = Router();

// Inlined computeIdempotencyKey to avoid adding the rewards library as a runtime dependency.
function computeIdempotencyKey(epoch: number, claimant: string, amount: string): string {
  const { createHash } = require("crypto");
  const input = `${epoch}:${claimant}:${amount}`;
  return createHash("sha256").update(input).digest("hex");
}

router.get("/schedule-summary", async (_req: Request, res: Response) => {
  try {
    const schedules = await RewardScheduleRegistry.getMaintainerScheduleSummary();
    res.json({
      generatedAt: new Date().toISOString(),
      schedules,
    });
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to summarize reward schedules",
    });
  }
});

/**
 * Dry-run preview of reward schedule health and payout timing.
 *
 * GET /api/rewards/dry-run
 *
 * Returns maintainer-facing health summaries and payout timing risk without mutating state.
 * Query params:
 *  - now (ISO date, optional): override the reference date for the preview
 */
router.get("/dry-run", async (req: Request, res: Response) => {
  try {
    const referenceDate = req.query.now
      ? new Date(req.query.now as string)
      : new Date();

    if (Number.isNaN(referenceDate.getTime())) {
      res.status(400).json({
        error: "Invalid 'now' query parameter. Provide an ISO date string.",
        code: "invalid_query",
      });
      return;
    }

    const schedules = await RewardScheduleRegistry.getMaintainerScheduleSummary(
      referenceDate,
    );

    const health = schedules.map((entry) => {
      const scheduleInput: RewardScheduleMonitorInput = {
        protocolName: entry.protocolName,
        tokenSymbol: entry.tokenSymbol,
        dailyEmission: entry.dailyEmission,
        startDate: new Date(entry.startDate),
        endDate: new Date(entry.endDate),
        cliffDate: entry.cliffDate ? new Date(entry.cliffDate) : undefined,
        taperStartDate: entry.taperStartDate
          ? new Date(entry.taperStartDate)
          : undefined,
        taperEndDate: entry.taperEndDate
          ? new Date(entry.taperEndDate)
          : undefined,
        isActive: entry.isActive,
      };

      const summary = summarizeRewardScheduleHealth(scheduleInput, {
        now: referenceDate,
      });

      return {
        ...summary,
        payoutTimingRisk: summary.daysUntilEnd <= 0 ? "expired" : summary.daysUntilEnd <= 7 ? "imminent" : "normal",
      } satisfies RewardScheduleHealthSummary & { payoutTimingRisk: string };
    });

    res.json({
      generatedAt: new Date().toISOString(),
      referenceDate: referenceDate.toISOString(),
      health,
    });
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to generate reward schedule dry-run",
    });
  }
});

/**
 * POST /api/rewards/claim
 *
 * Submit a reward claim with idempotency protection. The idempotency key
 * uniquely identifies (epoch, claimant, amount). Repeated submissions with
 * the same key return the existing state. Submissions with the same key but
 * different (merkleRoot, index) are rejected as conflicts.
 */
router.post("/claim", async (req: Request, res: Response) => {
  try {
    const { idempotencyKey, epoch, claimant, amount, merkleRoot, index, proof } = req.body as {
      idempotencyKey?: string;
      epoch?: number;
      claimant?: string;
      amount?: string;
      merkleRoot?: string;
      index?: number;
      proof?: string[];
    };

    // ── Validation ──────────────────────────────────────────────────────────
    if (!epoch || !claimant || !amount || !merkleRoot || index === undefined || !proof) {
      res.status(400).json({ error: "Missing required fields: epoch, claimant, amount, merkleRoot, index, proof" });
      return;
    }

    const computedKey = computeIdempotencyKey(epoch, claimant, amount);

    if (!idempotencyKey || idempotencyKey !== computedKey) {
      res.status(400).json({
        error: "Invalid idempotencyKey",
        expected: computedKey,
      });
      return;
    }

    // ── Check for existing claim ────────────────────────────────────────────
    const existing = await prisma.rewardClaim.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      if (existing.merkleRoot !== merkleRoot || existing.index !== index) {
        res.status(409).json({
          error: "Idempotency key already used with different claim parameters",
          existing: {
            status: existing.status,
            merkleRoot: existing.merkleRoot,
            index: existing.index,
          },
        });
        return;
      }

      res.status(200).json({
        id: existing.id,
        idempotencyKey: existing.idempotencyKey,
        status: existing.status,
        txHash: existing.txHash,
        errorMessage: existing.errorMessage,
        createdAt: existing.createdAt.toISOString(),
      });
      return;
    }

    // ── Create new claim record ─────────────────────────────────────────────
    const claim = await prisma.rewardClaim.create({
      data: {
        idempotencyKey,
        epoch,
        claimant,
        amount,
        merkleRoot,
        index,
        status: "pending",
      },
    });

    // TODO: Submit the claim transaction to the Soroban MerkleDistributor
    // contract. For now, the claim is recorded as "pending" — an indexer
    // worker or webhook should update the status once the on-chain
    // transaction confirms.

    res.status(201).json({
      id: claim.id,
      idempotencyKey: claim.idempotencyKey,
      status: claim.status,
      createdAt: claim.createdAt.toISOString(),
      message: "Claim recorded. Transaction submission is pending.",
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to process claim",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/rewards/claim/:idempotencyKey
 *
 * Retrieve the current state of a claim by its idempotency key.
 */
router.get("/claim/:idempotencyKey", async (req: Request, res: Response) => {
  try {
    const { idempotencyKey } = req.params;

    const claim = await prisma.rewardClaim.findUnique({
      where: { idempotencyKey },
    });

    if (!claim) {
      res.status(404).json({ error: "Claim not found" });
      return;
    }

    res.json({
      id: claim.id,
      idempotencyKey: claim.idempotencyKey,
      epoch: claim.epoch,
      claimant: claim.claimant,
      amount: claim.amount,
      merkleRoot: claim.merkleRoot,
      index: claim.index,
      status: claim.status,
      txHash: claim.txHash,
      errorMessage: claim.errorMessage,
      createdAt: claim.createdAt.toISOString(),
      updatedAt: claim.updatedAt.toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch claim",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
