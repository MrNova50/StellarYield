import React from 'react';
import './PortfolioReconcile.css';

export interface ReconcileRow {
  asset: string;
  expected: string | number;
  observed: string | number | null;
  delta: string | number | null;
  severity: 'ok' | 'warning' | 'critical';
}

export type DepositReceiptStatus = 'pending' | 'confirmed' | 'mismatched';

export interface DepositReceiptRow {
  txHash: string;
  assetId: string;
  amount: number;
  status: DepositReceiptStatus;
  sharesAssigned?: number;
  mismatchReason?: string;
}

type Props = {
  rows: ReconcileRow[];
  receipts?: DepositReceiptRow[];
};

const RECEIPT_STATUS_LABELS: Record<DepositReceiptStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  mismatched: 'Mismatch',
};

const RECEIPT_STATUS_CLASSES: Record<DepositReceiptStatus, string> = {
  pending: 'sev-warning',
  confirmed: 'sev-ok',
  mismatched: 'sev-critical',
};

export const PortfolioReconcile: React.FC<Props> = ({ rows, receipts }) => {
  return (
    <div className="portfolio-reconcile">
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Expected</th>
            <th>Observed</th>
            <th>Delta</th>
            <th>Severity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.asset} className={`sev-${r.severity}`}>
              <td>{r.asset}</td>
              <td>{r.expected}</td>
              <td>{r.observed === null ? '—' : r.observed}</td>
              <td>{r.delta === null ? '—' : r.delta}</td>
              <td>{r.severity}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {receipts && receipts.length > 0 && (
        <>
          <h3 className="receipt-section-title">Deposit Receipts</h3>
          <table className="receipt-table">
            <thead>
              <tr>
                <th>Tx Hash</th>
                <th>Asset</th>
                <th>Amount</th>
                <th>Shares</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr
                  key={r.txHash}
                  className={RECEIPT_STATUS_CLASSES[r.status]}
                  data-testid={`receipt-${r.txHash}`}
                >
                  <td title={r.txHash}>{r.txHash.slice(0, 8)}...</td>
                  <td>{r.assetId}</td>
                  <td>{r.amount}</td>
                  <td>{r.sharesAssigned ?? '—'}</td>
                  <td>{RECEIPT_STATUS_LABELS[r.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};

export default PortfolioReconcile;
