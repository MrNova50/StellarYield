import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provenanceService, AllocationProvenance, calculateSourceHash } from '../../src/services/provenance.service';
import { PrismaClient } from '@prisma/client';

// Mock PrismaClient
vi.mock('@prisma/client', () => {
  const mPrisma = {
    allocationProvenance: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
  return { PrismaClient: vi.fn(() => mPrisma) };
});

const prisma = new PrismaClient() as any;

describe('ProvenanceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockProvenance: AllocationProvenance = {
    decisionId: 'test-uuid-1',
    vaultId: 'vault-xlm-1',
    strategyVersion: '2.1.0',
    timestamp: 1715000000000,
    triggerContext: {
      condition: 'MARKET_VOLATILITY_THRESHOLD',
      rawInputs: { volatility: 0.15 },
    },
    allocationChange: {
      previous: { 'blend': 50, 'soroswap': 50 },
      updated: { 'blend': 70, 'soroswap': 30 },
    },
    signer: 'GB...XYZ',
  };

  describe('saveDecision', () => {
    it('should successfully save a new decision', async () => {
      prisma.allocationProvenance.findUnique.mockResolvedValue(null);
      prisma.allocationProvenance.create.mockImplementation(({ data }: any) => ({
        ...data,
        timestamp: new Date(data.timestamp),
      }));

      const result = await provenanceService.saveDecision(mockProvenance);

      expect(result.decisionId).toBe(mockProvenance.decisionId);
      expect(prisma.allocationProvenance.create).toHaveBeenCalled();
    });

    it('should throw an error if the decisionId already exists (Immutability check)', async () => {
      prisma.allocationProvenance.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(provenanceService.saveDecision(mockProvenance))
        .rejects.toThrow(/already exists/);
      
      expect(prisma.allocationProvenance.create).not.toHaveBeenCalled();
    });
  });

  describe('getHistory', () => {
    it('should fetch history with time window filters', async () => {
      const startTime = 1714000000000;
      const endTime = 1716000000000;

      prisma.allocationProvenance.findMany.mockResolvedValue([]);

      await provenanceService.getHistory({
        vaultId: 'vault-xlm-1',
        startTime,
        endTime,
      });

      expect(prisma.allocationProvenance.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          vaultId: 'vault-xlm-1',
          timestamp: { gte: new Date(startTime), lte: new Date(endTime) },
        },
      }));
    });
  });

  describe('source provenance hashing', () => {
    it('should generate stable hash for source data', () => {
      const sourceData = { apy: 0.12, tvl: 1000000, volatility: 0.15 };
      const hash = calculateSourceHash(sourceData);

      // Generate same hash from same data
      const hash2 = calculateSourceHash(sourceData);
      expect(hash).toBe(hash2);

      // Should be a valid hex string
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate same hash regardless of input order', () => {
      const sourceData1 = { apy: 0.12, tvl: 1000000, volatility: 0.15 };
      const sourceData2 = { volatility: 0.15, apy: 0.12, tvl: 1000000 };

      const hash1 = calculateSourceHash(sourceData1);
      const hash2 = calculateSourceHash(sourceData2);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different data', () => {
      const sourceData1 = { apy: 0.12, tvl: 1000000 };
      const sourceData2 = { apy: 0.15, tvl: 2000000 };

      const hash1 = calculateSourceHash(sourceData1);
      const hash2 = calculateSourceHash(sourceData2);

      expect(hash1).not.toBe(hash2);
    });

    it('should include sourceSnapshotHash when saving decision with source data', async () => {
      prisma.allocationProvenance.findUnique.mockResolvedValue(null);
      const mockResult = {
        ...mockProvenance,
        sourceSnapshotHash: 'abc123def456',
        timestamp: new Date(mockProvenance.timestamp),
      };
      prisma.allocationProvenance.create.mockResolvedValue(mockResult);

      const provWithSource = {
        ...mockProvenance,
        sourceSnapshotHash: calculateSourceHash({ apy: 0.12, tvl: 1000000 }),
      };

      const result = await provenanceService.saveDecision(provWithSource);

      expect(result.sourceSnapshotHash).toBeDefined();
      expect(prisma.allocationProvenance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceSnapshotHash: expect.any(String),
          }),
        })
      );
    });

    it('should auto-generate sourceSnapshotHash from trigger inputs if not provided', async () => {
      prisma.allocationProvenance.findUnique.mockResolvedValue(null);
      prisma.allocationProvenance.create.mockImplementation(({ data }: any) => ({
        ...data,
        timestamp: new Date(data.timestamp),
        sourceSnapshotHash: data.sourceSnapshotHash || 'generated_hash',
      }));

      const provWithoutHash = { ...mockProvenance };
      const result = await provenanceService.saveDecision(provWithoutHash);

      expect(prisma.allocationProvenance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceSnapshotHash: expect.any(String),
          }),
        })
      );
    });

    it('should handle missing source data gracefully', () => {
      const emptyData = {};
      const hash = calculateSourceHash(emptyData);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});