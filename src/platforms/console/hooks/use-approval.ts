import { useCallback, useEffect, useState } from 'react';
import type { ToolInvocation } from '../../../types';
import type { ApprovalChoice, ApprovalDiffView, ApprovalDiffWrapMode } from '../app-types';

export function useApproval(pendingApprovals: ToolInvocation[], pendingApplies: ToolInvocation[]) {
  const [approvalChoice, setApprovalChoice] = useState<ApprovalChoice>('approve');
  const [diffView, setDiffView] = useState<ApprovalDiffView>('unified');
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [wrapMode, setWrapMode] = useState<ApprovalDiffWrapMode>('word');
  const [previewIndex, setPreviewIndex] = useState(0);

  useEffect(() => {
    setApprovalChoice('approve');
  }, [pendingApprovals[0]?.id]);

  useEffect(() => {
    setApprovalChoice('approve');
    setDiffView('unified');
    setShowLineNumbers(true);
    setWrapMode('word');
    setPreviewIndex(0);
  }, [pendingApplies[0]?.id]);

  const resetChoice = useCallback(() => {
    setApprovalChoice('approve');
  }, []);

  const toggleChoice = useCallback(() => {
    setApprovalChoice((prev) => prev === 'approve' ? 'reject' : 'approve');
  }, []);

  const toggleDiffView = useCallback(() => {
    setDiffView((prev) => prev === 'unified' ? 'split' : 'unified');
  }, []);

  const toggleLineNumbers = useCallback(() => {
    setShowLineNumbers((prev) => !prev);
  }, []);

  const toggleWrapMode = useCallback(() => {
    setWrapMode((prev) => prev === 'none' ? 'word' : 'none');
  }, []);

  return {
    approvalChoice,
    diffView,
    showLineNumbers,
    wrapMode,
    previewIndex,
    setPreviewIndex,
    resetChoice,
    toggleChoice,
    toggleDiffView,
    toggleLineNumbers,
    toggleWrapMode,
  };
}
