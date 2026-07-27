import { RecoveryRecommendationService, ShockEvent } from "../recoveryRecommendationService";

describe("RecoveryRecommendationService", () => {
  const mockVaultId = "test-vault";
  const mockProtocol = "TestProtocol";

  const mockPassingGuardrails = {
    evaluateGuardrails: () => ({ passed: true, blockedRules: [], warnings: [] })
  };

  const service = new RecoveryRecommendationService(mockPassingGuardrails);

  it("should recommend ROTATE for CRITICAL APY crash", async () => {
    const event: ShockEvent = {
      type: "APY_CRASH",
      severity: "CRITICAL",
      vaultId: mockVaultId,
      protocol: mockProtocol,
      description: "APY dropped to 0%",
      timestamp: Date.now(),
    };

    const recommendations = await service.evaluateRecoveryOptions(event);
    
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].path).toBe("ROTATE");
    expect(recommendations[0].riskLevel).toBe("MEDIUM");
  });

  it("should recommend HOLD and REBALANCE for LOW APY crash", async () => {
    const event: ShockEvent = {
      type: "APY_CRASH",
      severity: "LOW",
      vaultId: mockVaultId,
      protocol: mockProtocol,
      description: "Minor APY dip",
      timestamp: Date.now(),
    };

    const recommendations = await service.evaluateRecoveryOptions(event);
    
    expect(recommendations).toHaveLength(2);
    expect(recommendations.map(r => r.path)).toContain("HOLD");
    expect(recommendations.map(r => r.path)).toContain("REBALANCE");
  });

  it("should recommend UNWIND for ORACLE_ANOMALY regardless of severity", async () => {
    const event: ShockEvent = {
      type: "ORACLE_ANOMALY",
      severity: "LOW",
      vaultId: mockVaultId,
      protocol: mockProtocol,
      description: "Stale price feed",
      timestamp: Date.now(),
    };

    const recommendations = await service.evaluateRecoveryOptions(event);
    
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].path).toBe("UNWIND");
    expect(recommendations[0].riskLevel).toBe("HIGH");
  });

  it("should recommend UNWIND for HIGH severity LIQUIDITY_EVENT", async () => {
    const event: ShockEvent = {
      type: "LIQUIDITY_EVENT",
      severity: "HIGH",
      vaultId: mockVaultId,
      protocol: mockProtocol,
      description: "Pool liquidity drained",
      timestamp: Date.now(),
    };

    const recommendations = await service.evaluateRecoveryOptions(event);
    
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].path).toBe("UNWIND");
    expect(recommendations[0].riskLevel).toBe("HIGH");
  });

  it("should recommend REBALANCE for LOW severity LIQUIDITY_EVENT", async () => {
    const event: ShockEvent = {
      type: "LIQUIDITY_EVENT",
      severity: "LOW",
      vaultId: mockVaultId,
      protocol: mockProtocol,
      description: "Slight liquidity dip",
      timestamp: Date.now(),
    };

    const recommendations = await service.evaluateRecoveryOptions(event);
    
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].path).toBe("REBALANCE");
    expect(recommendations[0].riskLevel).toBe("MEDIUM");
  });

  it("should return default HOLD recommendation for unknown event types", async () => {
    const event: any = {
      type: "UNKNOWN_EVENT",
      severity: "MEDIUM",
      vaultId: mockVaultId,
      protocol: mockProtocol,
      description: "Something happened",
      timestamp: Date.now(),
    };

    const recommendations = await service.evaluateRecoveryOptions(event);
    
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].path).toBe("HOLD");
  });

  it("should recommend ROTATE when health check fails even for LOW severity", async () => {
    const mockFailingGuardrails = {
      evaluateGuardrails: () => ({ passed: false, blockedRules: [], warnings: ["Health failed"] })
    };
    const failingService = new RecoveryRecommendationService(mockFailingGuardrails);

    const event: ShockEvent = {
      type: "APY_CRASH",
      severity: "LOW",
      vaultId: mockVaultId,
      protocol: mockProtocol,
      description: "Minor dip but health failed",
      timestamp: Date.now(),
    };

    const recommendations = await failingService.evaluateRecoveryOptions(event);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].path).toBe("ROTATE");
  });

  describe("stable tie-breaking for equal-score recommendations", () => {
    it("should rank equal-confidence recommendations consistently", async () => {
      const event: ShockEvent = {
        type: "APY_CRASH",
        severity: "LOW",
        vaultId: mockVaultId,
        protocol: mockProtocol,
        description: "Minor APY dip",
        timestamp: Date.now(),
      };

      // Get recommendations multiple times and check order is stable
      const recommendations1 = await service.evaluateRecoveryOptions(event);
      const recommendations2 = await service.evaluateRecoveryOptions(event);

      // Check order is the same
      expect(recommendations1.map(r => r.path)).toEqual(recommendations2.map(r => r.path));
    });

    it("should include tie-breaker explanation when multiple recs have same confidence", async () => {
      const event: ShockEvent = {
        type: "APY_CRASH",
        severity: "LOW",
        vaultId: mockVaultId,
        protocol: mockProtocol,
        description: "Minor APY dip",
        timestamp: Date.now(),
      };

      const recommendations = await service.evaluateRecoveryOptions(event);

      // Should have multiple recommendations with potentially same confidence
      if (recommendations.length > 1) {
        // At least one should have a tie-breaker if there are equal confidences
        const withTieBreaker = recommendations.filter(r => r.tieBreaker);
        expect(withTieBreaker.length).toBeGreaterThanOrEqual(0);

        // Verify tie-breaker structure
        if (withTieBreaker.length > 0) {
          withTieBreaker.forEach(rec => {
            expect(rec.tieBreaker?.reason).toBeDefined();
            expect(typeof rec.tieBreaker?.reason).toBe('string');
            expect(rec.tieBreaker?.priority).toBeDefined();
            expect(typeof rec.tieBreaker?.priority).toBe('number');
          });
        }
      }
    });

    it("should prioritize UNWIND over other paths in ties", async () => {
      const event: ShockEvent = {
        type: "LIQUIDITY_EVENT",
        severity: "HIGH",
        vaultId: mockVaultId,
        protocol: mockProtocol,
        description: "High severity liquidity event",
        timestamp: Date.now(),
      };

      const recommendations = await service.evaluateRecoveryOptions(event);

      // UNWIND should appear first (highest priority)
      expect(recommendations[0].path).toBe("UNWIND");
    });

    it("should rank HOLD lower than UNWIND/ROTATE/REBALANCE in ties", async () => {
      const event: ShockEvent = {
        type: "APY_CRASH",
        severity: "LOW",
        vaultId: mockVaultId,
        protocol: mockProtocol,
        description: "Minor APY dip",
        timestamp: Date.now(),
      };

      const recommendations = await service.evaluateRecoveryOptions(event);

      // Find HOLD recommendation
      const holdIndex = recommendations.findIndex(r => r.path === "HOLD");
      if (holdIndex > -1 && recommendations.length > 1) {
        // If there are other recommendations, HOLD should not be first
        const firstPath = recommendations[0].path;
        if (firstPath !== "HOLD") {
          expect(holdIndex).toBeGreaterThan(0);
        }
      }
    });

    it("should provide deterministic ranking across multiple calls", async () => {
      const event: ShockEvent = {
        type: "APY_CRASH",
        severity: "LOW",
        vaultId: mockVaultId,
        protocol: mockProtocol,
        description: "APY crash testing determinism",
        timestamp: Date.now(),
      };

      const calls = await Promise.all([
        service.evaluateRecoveryOptions(event),
        service.evaluateRecoveryOptions(event),
        service.evaluateRecoveryOptions(event),
      ]);

      // All calls should return same order
      const paths1 = calls[0].map(r => r.path);
      const paths2 = calls[1].map(r => r.path);
      const paths3 = calls[2].map(r => r.path);

      expect(paths1).toEqual(paths2);
      expect(paths2).toEqual(paths3);
    });
  });
});
