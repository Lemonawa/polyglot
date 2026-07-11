// ---- 格式标识 ----
export type WireFormat = 'chat' | 'responses' | 'anthropic';

export function isWireFormat(v: unknown): v is WireFormat {
  return v === 'chat' || v === 'responses' || v === 'anthropic';
}

// ---- 数据模型行类型(与 SQLite 表一一对应) ----
export interface LogicalModel {
  id: number;
  name: string;
  created_at: string; // ISO 8601
}

export interface Provider {
  id: number;
  logical_model_id: number;
  priority: number; // 升序 = 尝试顺序
  upstream_format: WireFormat;
  base_url: string;
  api_key: string;
  upstream_model: string;
  models_dev_id: string | null;
  fallback_status_codes: number[]; // 存储为 JSON TEXT
  enabled: boolean; // 存储为 0/1
}

export interface RequestLog {
  id: number;
  logical_model_id: number;
  hit_provider_id: number | null;
  client_format: WireFormat;
  upstream_format: WireFormat | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  latency_ms: number;
  status: 'success' | 'error';
  error: string | null;
  attempts: number;
  created_at: string; // ISO 8601
}

export type BudgetScope = 'global' | 'logical_model';
export type BudgetPeriod = 'day' | 'month' | 'total';
export type BudgetAction = 'warn' | 'block';

export interface Budget {
  id: number;
  scope: BudgetScope;
  target_id: number | null;
  limit_usd: number;
  period: BudgetPeriod;
  action: BudgetAction;
}

// ---- 计价 ----
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface UnitPrice {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}
