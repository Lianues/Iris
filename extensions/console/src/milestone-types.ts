export type MilestoneStatusLike = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';

export interface MilestoneItemLike {
  id: string;
  title: string;
  description?: string;
  activeForm?: string;
  status: MilestoneStatusLike;
  owner?: string;
  blockedBy?: string[];
  blocks?: string[];
  metadata?: Record<string, unknown>;
  version: number;
  createdAt: number;
  updatedAt: number;
  updatedBy?: string;
}

export interface MilestoneSnapshotLike {
  sessionId: string;
  items: MilestoneItemLike[];
  stats: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    blocked: number;
    cancelled: number;
    open: number;
  };
  updatedAt: number;
  sourceAgent?: string;
  routeAgent?: string;
}
