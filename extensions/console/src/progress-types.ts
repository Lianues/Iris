export type ProgressStatusLike = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';

export interface ProgressItemLike {
  title: string;
  description?: string;
  activeForm?: string;
  status: ProgressStatusLike;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ProgressSnapshotLike {
  sessionId: string;
  items: ProgressItemLike[];
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
}
