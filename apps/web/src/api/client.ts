/**
 * API client — thin fetch wrapper with base URL and error handling.
 *
 * All API calls go through this module so the base URL and
 * error handling logic live in exactly one place.
 */

const API_BASE = '/api';

interface ApiResponse<T> {
  status: 'ok' | 'error';
  data?: T;
  error?: string;
  errors?: Array<{ field: string; message: string }>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errors?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Development JWT tokens (1-year expiry, signed with the dev JWT_SECRET).
 * In production these would come from a login flow / identity provider.
 */
const DEV_TOKENS: Record<string, string> = {
  operator: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZXYtb3BlcmF0b3IiLCJyb2xlIjoib3BlcmF0b3IiLCJleHAiOjE4MjIwNTA3NzR9.FSPuFcvQx895gBgZ4-DZkNzw4-tgypS5ZtX5VIBk0E0',
  admin: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZXYtYWRtaW4iLCJyb2xlIjoiYWRtaW4iLCJleHAiOjE4MjIwNTA3ODl9.QvHGPDvS1anlkZLohsSqJ9g2cj7jd3My3BS2fMlGQ5U',
  insurance_approver: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZXYtYXBwcm92ZXIiLCJyb2xlIjoiaW5zdXJhbmNlX2FwcHJvdmVyIiwiZXhwIjoxODIyMDUwNzg5fQ.d8q72AGrW867FsHYmPLkF8hoC_vicAAmgwhnYXZ34HA',
};

/** Currently active role for the dev session. */
let activeRole = 'operator';

/** Switch the active role (for UI role switching). */
export function setActiveRole(role: string): void {
  activeRole = role;
}

export function getActiveRole(): string {
  return activeRole;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const token = DEV_TOKENS[activeRole] ?? DEV_TOKENS['operator'];

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });

  const body = (await res.json()) as ApiResponse<T>;

  if (!res.ok || body.status === 'error') {
    throw new ApiError(
      body.error ?? 'Request failed',
      res.status,
      body.errors,
    );
  }

  return body.data as T;
}

// ── Parcel API ──────────────────────────────────────────

export interface SubmitParcelResponse {
  parcelId: string;
  correlationId: string;
}

export interface ParcelData {
  _id: string;
  weight: number;
  value: number;
  destinationCountry: string;
  recipient: {
    name: string;
    address: {
      street: string;
      houseNumber: string;
      postalCode: string;
      city: string;
    };
  };
  custom: Record<string, unknown>;
  status: string;
  batchId: string | null;
  correlationId: string;
  retryCount: number;
  createdAt: string;
}

export interface OutcomeData {
  _id: string;
  parcelId: string;
  department: string | null;
  matchedRuleId: string | null;
  matchedRuleVersion: number | null;
  status: string;
  reason: string;
}

export interface ParcelDetailResponse {
  parcel: ParcelData;
  outcome?: OutcomeData;
}

export interface PaginatedParcelsResponse {
  parcels: ParcelData[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BatchUploadResponse {
  batchId: string;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  rejectedDetails?: Array<{ rowIndex: number; reason: string }>;
}

export interface BatchStatusResponse {
  batchId: string;
  counts: Record<string, number>;
}

export async function submitParcel(parcel: {
  weight: number;
  value: number;
  destinationCountry: string;
  recipient: {
    name: string;
    address: {
      street: string;
      houseNumber: string;
      postalCode: string;
      city: string;
    };
  };
  custom?: Record<string, unknown>;
}): Promise<SubmitParcelResponse> {
  return request<SubmitParcelResponse>('/parcels', {
    method: 'POST',
    body: JSON.stringify(parcel),
  });
}

export async function getParcel(parcelId: string): Promise<ParcelDetailResponse> {
  return request<ParcelDetailResponse>(`/parcels/${parcelId}`);
}

export async function getParcels(params: {
  page?: number;
  limit?: number;
  status?: string;
  batchId?: string;
}): Promise<PaginatedParcelsResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.status) query.set('status', params.status);
  if (params.batchId) query.set('batchId', params.batchId);
  return request<PaginatedParcelsResponse>(`/parcels?${query.toString()}`);
}

export async function uploadBatch(file: File): Promise<BatchUploadResponse> {
  const form = new FormData();
  form.append('file', file);

  const url = `${API_BASE}/parcels/batch`;
  const token = DEV_TOKENS[activeRole] ?? DEV_TOKENS['operator'];
  const res = await fetch(url, {
    method: 'POST',
    body: form,
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const body = (await res.json()) as ApiResponse<BatchUploadResponse>;

  if (!res.ok || body.status === 'error') {
    throw new ApiError(body.error ?? 'Upload failed', res.status);
  }
  return body.data as BatchUploadResponse;
}

export async function getBatchStatus(batchId: string): Promise<BatchStatusResponse> {
  return request<BatchStatusResponse>(`/parcels/batch/${batchId}/status`);
}

export async function approveParcel(parcelId: string): Promise<void> {
  await request(`/parcels/${parcelId}/approve`, {
    method: 'POST',
    body: '{}',
  });
}

export async function rejectParcel(parcelId: string): Promise<void> {
  await request(`/parcels/${parcelId}/reject`, {
    method: 'POST',
    body: '{}',
  });
}

// ── Rules API ───────────────────────────────────────────

export interface RuleData {
  _id: string;
  name: string;
  version: number;
  active: boolean;
  priority: number;
  type: string;
  conditions: {
    all?: Array<{ field: string; operator: string; value: unknown }>;
    any?: Array<{ field: string; operator: string; value: unknown }>;
  };
  action: {
    route_to?: string;
    require_approval?: string;
    block_until_approved?: boolean;
  };
  createdAt: string;
  createdBy: string;
}

export async function getRules(): Promise<RuleData[]> {
  const result = await request<{ rules: RuleData[] }>('/rules');
  return result.rules;
}

export interface CreateRulePayload {
  name: string;
  priority: number;
  type: 'condition_rule' | 'precondition_rule';
  conditions: {
    all?: Array<{ field: string; operator: string; value: unknown }>;
    any?: Array<{ field: string; operator: string; value: unknown }>;
  };
  action: {
    route_to?: string;
    require_approval?: string;
    block_until_approved?: boolean;
  };
  createdBy: string;
}

export async function createRule(rule: CreateRulePayload): Promise<RuleData> {
  const result = await request<{ rule: RuleData }>('/rules', {
    method: 'POST',
    body: JSON.stringify(rule),
  });
  return result.rule;
}
