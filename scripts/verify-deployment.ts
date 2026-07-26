#!/usr/bin/env ts-node
/**
 * Deployment configuration verifier.
 *
 * Validates that all required environment variables are set for a production
 * deployment. Checks:
 *   - VITE_* frontend variables (read from .env or environment)
 *   - Backend service variables (RPC, database, keeper secrets)
 *   - Node.js version against engines field in root package.json
 *   - Vercel build config (if vercel.json is present)
 *
 * Variable values are never printed; only names and redacted status appear
 * in the report. Secrets are identified by name pattern and shown as [REDACTED].
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more required vars missing or config invalid
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import semver from 'semver';
import { validateContractAddresses, DEPLOYMENT_CONTRACT_ROLES } from './validateContractAddresses';

const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Variable definitions
// ---------------------------------------------------------------------------

interface VarSpec {
  name: string;
  required: boolean;
  secret: boolean;
  description: string;
}

const FRONTEND_VARS: VarSpec[] = [
  { name: 'VITE_SOROBAN_RPC_URL',     required: true,  secret: false, description: 'Soroban RPC endpoint for the frontend' },
  { name: 'VITE_CONTRACT_ID',          required: true,  secret: false, description: 'Deployed vault contract ID' },
  { name: 'VITE_NETWORK_PASSPHRASE',   required: true,  secret: false, description: 'Stellar network passphrase' },
  { name: 'VITE_NETWORK',              required: true,  secret: false, description: 'Target network (testnet|mainnet)' },
  { name: 'VITE_WALLET_CONNECT_ID',    required: false, secret: true,  description: 'WalletConnect project ID' },
  { name: 'VITE_SENTRY_DSN',           required: false, secret: true,  description: 'Sentry DSN for frontend error reporting' },
];

const BACKEND_VARS: VarSpec[] = [
  { name: 'DATABASE_URL',              required: true,  secret: true,  description: 'PostgreSQL connection string' },
  { name: 'REDIS_URL',                 required: true,  secret: true,  description: 'Redis connection string for BullMQ' },
  { name: 'VAULT_CONTRACT_ID',         required: true,  secret: false, description: 'Vault contract ID for keeper operations' },
  { name: 'KEEPER_SECRET_KEY',         required: true,  secret: true,  description: 'Ed25519 secret key for keeper signer' },
  { name: 'STELLAR_NETWORK',           required: true,  secret: false, description: 'Stellar network identifier' },
  { name: 'SOROBAN_RPC_URL',           required: true,  secret: false, description: 'Soroban RPC URL for keeper' },
  { name: 'STABLECOIN_MANAGER_CONTRACT_ID', required: true, secret: false, description: 'Stablecoin manager contract ID' },
  { name: 'KEEPER_HEALTH_PORT',        required: false, secret: false, description: 'Port for the keeper health server (default 3002)' },
  { name: 'SENTRY_DSN',               required: false, secret: true,  description: 'Sentry DSN for backend error reporting' },
  { name: 'LOG_LEVEL',                 required: false, secret: false, description: 'Pino log level (default: info)' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = ['secret', 'key', 'password', 'token', 'dsn', 'url', 'credential'];

function isSecret(spec: VarSpec): boolean {
  if (spec.secret) return true;
  const lower = spec.name.toLowerCase();
  return SECRET_PATTERNS.some((p) => lower.includes(p));
}

function redactedValue(spec: VarSpec, value: string): string {
  if (isSecret(spec)) return '[REDACTED]';
  return value;
}

interface CheckResult {
  name: string;
  status: 'ok' | 'missing' | 'empty';
  required: boolean;
  displayValue: string;
  description: string;
}

function checkVar(spec: VarSpec): CheckResult {
  const value = process.env[spec.name];
  if (!value) {
    return {
      name: spec.name,
      status: spec.required ? 'missing' : 'empty',
      required: spec.required,
      displayValue: '',
      description: spec.description,
    };
  }
  return {
    name: spec.name,
    status: 'ok',
    required: spec.required,
    displayValue: redactedValue(spec, value),
    description: spec.description,
  };
}

// ---------------------------------------------------------------------------
// Node version check
// ---------------------------------------------------------------------------

interface NodeCheckResult {
  ok: boolean;
  current: string;
  required: string | null;
  message: string;
}

function checkNodeVersion(): NodeCheckResult {
  const current = process.version;
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { ok: true, current, required: null, message: 'No root package.json found; skipping version check' };
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const required: string | undefined = pkg.engines?.node;
  if (!required) {
    return { ok: true, current, required: null, message: 'No engines.node constraint in package.json' };
  }
  const satisfied = semver.satisfies(current, required);
  return {
    ok: satisfied,
    current,
    required,
    message: satisfied
      ? `Node ${current} satisfies ${required}`
      : `Node ${current} does NOT satisfy required range ${required}`,
  };
}

// ---------------------------------------------------------------------------
// Vercel config check
// ---------------------------------------------------------------------------

interface VercelCheckResult {
  ok: boolean;
  found: boolean;
  issues: string[];
}

function checkVercelConfig(): VercelCheckResult {
  const vercelPath = path.join(REPO_ROOT, 'vercel.json');
  if (!fs.existsSync(vercelPath)) {
    return { ok: true, found: false, issues: [] };
  }
  const config = JSON.parse(fs.readFileSync(vercelPath, 'utf-8'));
  const issues: string[] = [];

  if (config.buildCommand === undefined && config.builds === undefined) {
    issues.push('vercel.json has no buildCommand or builds field');
  }
  if (config.outputDirectory === undefined && config.builds === undefined) {
    issues.push('vercel.json has no outputDirectory field');
  }
  if (config.framework !== undefined && config.framework !== 'vite' && config.framework !== 'nextjs') {
    issues.push(`vercel.json framework "${config.framework}" may not match project type`);
  }

  return { ok: issues.length === 0, found: true, issues };
}

// ---------------------------------------------------------------------------
// Load .env file (non-override: process.env takes precedence)
// ---------------------------------------------------------------------------

function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printSection(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(title);
  console.log('─'.repeat(60));
}

function printResult(r: CheckResult): void {
  const icon = r.status === 'ok' ? '✓' : r.required ? '✗' : '·';
  const label = r.status === 'ok'
    ? `${r.displayValue}`
    : r.required
    ? 'MISSING (required)'
    : 'not set (optional)';
  console.log(`  ${icon} ${r.name.padEnd(40)} ${label}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const ENV_FILE = process.argv.find((a) => a.startsWith('--env='))?.split('=')[1]
  ?? path.join(REPO_ROOT, '.env');

loadDotEnv(ENV_FILE);

printSection('Frontend Variables (VITE_*)');
const frontendResults = FRONTEND_VARS.map(checkVar);
frontendResults.forEach(printResult);

printSection('Backend Variables');
const backendResults = BACKEND_VARS.map(checkVar);
backendResults.forEach(printResult);

printSection('Node.js Version');
const nodeCheck = checkNodeVersion();
console.log(`  ${nodeCheck.ok ? '✓' : '✗'} ${nodeCheck.message}`);

printSection('Contract Address Sanity Checks');
const contractAddressIssues = validateContractAddresses(process.env, DEPLOYMENT_CONTRACT_ROLES);
if (contractAddressIssues.length === 0) {
  console.log('  ✓ All configured contract addresses are well-formed and unique per role');
} else {
  contractAddressIssues.forEach((issue) => console.log(`  ✗ [${issue.code}] ${issue.message}`));
}

printSection('Vercel Config');
const vercelCheck = checkVercelConfig();
if (!vercelCheck.found) {
  console.log('  · vercel.json not found (skipped)');
} else if (vercelCheck.ok) {
  console.log('  ✓ vercel.json looks valid');
} else {
  vercelCheck.issues.forEach((issue) => console.log(`  ✗ ${issue}`));
}

// ---------------------------------------------------------------------------
// Summary and exit code
// ---------------------------------------------------------------------------

const allResults = [...frontendResults, ...backendResults];
const missingRequired = allResults.filter((r) => r.status === 'missing' && r.required);
const nodeOk = nodeCheck.ok;
const vercelOk = vercelCheck.ok;
const contractAddressesOk = contractAddressIssues.length === 0;

console.log('\n' + '═'.repeat(60));
if (missingRequired.length === 0 && nodeOk && vercelOk && contractAddressesOk) {
  console.log('DEPLOYMENT CHECK: ALL PASSED');
  process.exit(0);
} else {
  console.log('DEPLOYMENT CHECK: FAILED');
  if (missingRequired.length > 0) {
    console.log(`  Missing required vars: ${missingRequired.map((r) => r.name).join(', ')}`);
  }
  if (!nodeOk) console.log(`  Node version issue: ${nodeCheck.message}`);
  if (!vercelOk) console.log(`  Vercel config issues: ${vercelCheck.issues.join('; ')}`);
  if (!contractAddressesOk) {
    console.log(`  Contract address issues: ${contractAddressIssues.map((i) => i.message).join('; ')}`);
  }
  process.exit(1);
}
