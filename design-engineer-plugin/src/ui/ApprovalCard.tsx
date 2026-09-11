import React from 'react';

export interface ApprovalCardProps {
  title: string;
  description: string;
  approveLabel?: string;
  onApprove: () => void;
  onCancel: () => void;
}

export default function ApprovalCard({
  title,
  description,
  approveLabel = 'Approve',
  onApprove,
  onCancel,
}: ApprovalCardProps) {
  return (
    <div className="card approval-card">
      <div className="card-title">{title}</div>
      <div className="card-desc">{description}</div>
      <div className="card-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={onApprove}>
          {approveLabel}
        </button>
      </div>
    </div>
  );
}
