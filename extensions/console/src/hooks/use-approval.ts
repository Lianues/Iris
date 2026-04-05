import { useCallback, useEffect, useState } from 'react';
import type { ToolInvocation } from '@irises/extension-sdk';
import type { ApprovalChoice, ApprovalDiffView, ApprovalDiffWrapMode } from '../app-types';

export type ApprovalPage = 'basic' | 'policy';

export function useApproval(pendingApprovals: ToolInvocation[], pendingApplies: ToolInvocation[]) {
  const [approvalChoice, setApprovalChoice] = useState<ApprovalChoice>('approve');
  const [approvalPage, setApprovalPage] = useState<ApprovalPage>('basic');
  const [diffView, setDiffView] = useState<ApprovalDiffView>('unified');
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [wrapMode, setWrapMode] = useState<ApprovalDiffWrapMode>('word');
  const [previewIndex, setPreviewIndex] = useState(0);

  useEffect(() => {
    setApprovalChoice('approve');
    setApprovalPage('basic');
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
    setApprovalPage('basic');
  }, []);

  const toggleApprovalPage = useCallback(() => {
    setApprovalPage((prev) => prev === 'basic' ? 'policy' : 'basic');
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
    approvalPage,
    diffView,
    showLineNumbers,
    wrapMode,
    previewIndex,
    setPreviewIndex,
    resetChoice,
    toggleChoice,
    toggleApprovalPage,
    toggleDiffView,
    toggleLineNumbers,
    toggleWrapMode,
  };
}
