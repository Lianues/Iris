import * as fs from 'fs';
import * as path from 'path';
import type { NoteService, NoteState, NoteUpdateMetadata } from './types';

const NOTE_FILE_NAME = 'note.md';

export class NoteManager implements NoteService {
  private updatedAt?: number;
  private updatedBy?: NoteState['updatedBy'];

  constructor(private dataDir: string) {}

  getNoteFilePath(): string {
    return path.join(this.dataDir, NOTE_FILE_NAME);
  }

  getNote(): string {
    try {
      return fs.readFileSync(this.getNoteFilePath(), 'utf-8');
    } catch {
      return '';
    }
  }

  getState(): NoteState {
    return {
      content: this.getNote(),
      noteFilePath: this.getNoteFilePath(),
      updatedAt: this.updatedAt,
      updatedBy: this.updatedBy,
    };
  }

  setNote(content: string, metadata?: NoteUpdateMetadata): NoteState {
    this.writeNoteFile(content);
    this.updatedAt = Date.now();
    this.updatedBy = metadata?.updatedBy;
    return this.getState();
  }

  clearNote(metadata?: NoteUpdateMetadata): NoteState {
    return this.setNote('', metadata);
  }

  private writeNoteFile(content: string): void {
    const filePath = this.getNoteFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}
