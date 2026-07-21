import { describe, it, expect } from "vitest";
import { Keypair, TransactionBuilder, Account, Operation, Networks, Asset } from "@stellar/stellar-sdk";
import {
  VaultClient,
  PreparedTransaction,
  SignedTransaction,
  SubmittedTransaction,
  ServerKeypairSigner,
  CustomSigner,
  FreighterSigner,
  SpecMismatchError,
  ContractExecutionError,
  decodeVaultError,
  parseContractError,
  YIELD_VAULT_SPEC_HASH,
  ApiClient,
} from "../src";

describe("Soroban SDK Bindings & Lifecycle", () => {
  const dummyContractId = "CCW67TSB3SSSBDGRGBXMORAX6P4CBGQLGLKXMFFBVD7OH5VO5BTV6U2M";
  const dummyPassphrase = Networks.TESTNET;
  const dummyRpcUrl = "https://soroban-testnet.stellar.org";

  const sourceKeypair = Keypair.random();
  const sourceAccount = new Account(sourceKeypair.publicKey(), "100");

  function createUnsignedXdr(): string {
    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: dummyPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: "10",
        })
      )
      .setTimeout(30)
      .build();
    return tx.toXDR();
  }

  describe("Spec Hash Pinning & Verification", () => {
    it("exports YIELD_VAULT_SPEC_HASH as a 64-character sha256 string", () => {
      expect(YIELD_VAULT_SPEC_HASH).toMatch(/^[a-f0-9]{64}$/);
    });

    it("accepts matching specHash in VaultClient initialization", () => {
      const client = new VaultClient({
        contractId: dummyContractId,
        networkPassphrase: dummyPassphrase,
        rpcUrl: dummyRpcUrl,
        specHash: YIELD_VAULT_SPEC_HASH,
      });
      expect(client.specHash).toBe(YIELD_VAULT_SPEC_HASH);
    });

    it("throws SpecMismatchError when specHash does not match", () => {
      expect(() => {
        new VaultClient({
          contractId: dummyContractId,
          networkPassphrase: dummyPassphrase,
          rpcUrl: dummyRpcUrl,
          specHash: "1111111111111111111111111111111111111111111111111111111111111111",
        });
      }).toThrow(SpecMismatchError);
    });
  });

  describe("Signer Adapters", () => {
    it("ServerKeypairSigner signs unsigned XDR envelope", async () => {
      const signer = new ServerKeypairSigner(sourceKeypair);
      expect(await signer.getPublicKey()).toBe(sourceKeypair.publicKey());

      const unsignedXdr = createUnsignedXdr();
      const signedXdr = await signer.signTransaction(unsignedXdr, {
        networkPassphrase: dummyPassphrase,
      });

      expect(signedXdr).not.toBe(unsignedXdr);
      const parsed = TransactionBuilder.fromXDR(signedXdr, dummyPassphrase);
      expect(parsed.signatures.length).toBe(1);
    });

    it("CustomSigner delegates signing to custom callback", async () => {
      const mockSignFn = async (xdr: string, passphrase: string) => {
        const tx = TransactionBuilder.fromXDR(xdr, passphrase);
        tx.sign(sourceKeypair);
        return tx.toXDR();
      };

      const customSigner = new CustomSigner(sourceKeypair.publicKey(), mockSignFn);
      expect(await customSigner.getPublicKey()).toBe(sourceKeypair.publicKey());

      const unsignedXdr = createUnsignedXdr();
      const signedXdr = await customSigner.signTransaction(unsignedXdr, {
        networkPassphrase: dummyPassphrase,
      });

      expect(signedXdr).not.toBe(unsignedXdr);
    });
  });

  describe("Transaction Lifecycle Transitions", () => {
    it("PreparedTransaction transition to SignedTransaction", async () => {
      const unsignedXdr = createUnsignedXdr();
      const preparedMeta = {
        simulationResult: 100n,
        footprint: "dummy_footprint",
        authEntries: [],
        minResourceFee: "1000",
        transactionData: "",
        latestLedger: 1000,
        validUntilLedger: 1100,
        contractId: dummyContractId,
        networkPassphrase: dummyPassphrase,
        method: "deposit",
        argsHash: "{}",
        specHash: YIELD_VAULT_SPEC_HASH,
      };

      const prepared = PreparedTransaction.fromXDR<bigint>(unsignedXdr, preparedMeta);
      expect(prepared.state).toBe("SIMULATED");
      expect(prepared.meta.simulationResult).toBe(100n);

      const signer = new ServerKeypairSigner(sourceKeypair);
      const signed = await prepared.sign(signer);

      expect(signed.state).toBe("SIGNED");
      expect(signed.signedXdr).not.toBe(unsignedXdr);
    });
  });

  describe("Typed Error Handling & Decoding", () => {
    it("decodes contract VaultError code 3 into descriptive message", () => {
      const decoded = decodeVaultError(3);
      expect(decoded.name).toBe("ZeroAmount");
      expect(decoded.message).toContain("strictly greater than zero");
    });

    it("parses contract error string into ContractExecutionError", () => {
      const err = new Error("Error(Contract, #4)");
      const parsed = parseContractError(err);
      expect(parsed).toBeInstanceOf(ContractExecutionError);
      if (parsed instanceof ContractExecutionError) {
        expect(parsed.errorCode).toBe(4);
        expect(parsed.errorName).toBe("InsufficientShares");
      }
    });
  });

  describe("ApiClient Route Drift Prevention", () => {
    it("provides registered endpoints matching OpenAPI schema", () => {
      const api = new ApiClient({ baseUrl: "http://localhost:3001" });
      const endpoints = api.getRegisteredEndpoints();
      expect(endpoints.length).toBeGreaterThan(0);
      expect(endpoints.some((e) => e.pathPattern === "/api/yields")).toBe(true);
    });
  });
});
