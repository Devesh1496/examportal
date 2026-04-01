// components/UI/index.jsx — Reusable UI components
import React from 'react';
import './UI.css';

export function Spinner({ size = 20, color }) {
  return (
    <span className="ui-spinner" style={{ width: size, height: size, borderTopColor: color || 'var(--accent)' }} />
  );
}

export function Tag({ children, variant = 'muted', icon }) {
  return (
    <span className={`ui-tag ui-tag-${variant}`}>
      {icon && <span className="tag-icon">{icon}</span>}
      {children}
    </span>
  );
}

export function ProgressBar({ value = 0, color, height = 4, animated = false }) {
  return (
    <div className="ui-progress" style={{ height }}>
      <div
        className={`ui-progress-fill${animated ? ' animated' : ''}`}
        style={{ width: `${Math.min(100, value)}%`, background: color || 'var(--accent)' }}
      />
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = 480 }) {
  if (!open) return null;
  return (
    <div className="ui-modal-overlay" onClick={onClose}>
      <div className="ui-modal" style={{ maxWidth: width }} onClick={e => e.stopPropagation()}>
        {title && (
          <div className="ui-modal-header">
            <h3>{title}</h3>
            <button className="ui-modal-close" onClick={onClose}>✕</button>
          </div>
        )}
        <div className="ui-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon = '📭', title, subtitle, action }) {
  return (
    <div className="ui-empty">
      <span className="ui-empty-icon">{icon}</span>
      <div className="ui-empty-title">{title}</div>
      {subtitle && <div className="ui-empty-sub">{subtitle}</div>}
      {action}
    </div>
  );
}

export function StatusBadge({ status }) {
  const MAP = {
    ready:      { label: 'Ready',      variant: 'green' },
    processing: { label: 'Processing', variant: 'amber' },
    pending:    { label: 'Pending',    variant: 'muted' },
    failed:     { label: 'Failed',     variant: 'red'   },
  };
  const s = MAP[status] || { label: status, variant: 'muted' };
  return <Tag variant={s.variant}>{status === 'processing' && <span className="dot-pulse"/>}{s.label}</Tag>;
}

export function Input({ label, value, onChange, placeholder, type = 'text', ...rest }) {
  return (
    <div className="ui-input-wrap">
      {label && <label className="ui-label">{label}</label>}
      <input
        className="ui-input"
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        {...rest}
      />
    </div>
  );
}

export function StatCard({ label, value, sub, accent }) {
  return (
    <div className="ui-stat-card" style={accent ? { borderColor: accent + '55', background: accent + '10' } : {}}>
      <div className="ui-stat-val" style={accent ? { color: accent } : {}}>{value}</div>
      <div className="ui-stat-label">{label}</div>
      {sub && <div className="ui-stat-sub">{sub}</div>}
    </div>
  );
}
