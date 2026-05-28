import type { Content } from '../types';

export const NOTE_SERVICE_ID = 'note';

export type NoteUpdatedBy = 'user' | 'model-approved';

export interface NoteUpdateMetadata {
  updatedBy?: NoteUpdatedBy;
}

export interface NoteState {
  content: string;
  noteFilePath: string;
  updatedAt?: number;
  updatedBy?: NoteUpdatedBy;
}

export interface NoteService {
  getNote(): string;
  setNote(content: string, metadata?: NoteUpdateMetadata): NoteState;
  clearNote(metadata?: NoteUpdateMetadata): NoteState;
  getState(): NoteState;
  getNoteFilePath(): string;
}

export interface NoteUpdateApprovalProgress {
  kind: 'note_update_approval';
  currentNote: string;
  proposedNote: string;
  reason: string;
  mode: 'replace' | 'clear';
  noteFilePath: string;
}

export interface NoteHistoryService {
  reconcileWithHistory?(sessionId: string, history: Content[]): NoteState | null;
}
