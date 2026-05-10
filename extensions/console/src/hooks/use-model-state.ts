import { useCallback, useState } from 'react';
import type { SwitchModelResult } from '../app-types';

interface UseModelStateOptions {
  modelId: string;
  modelName: string;
  contextWindow?: number;
  modelProvider?: string;
  thinkingControlEnabled?: boolean;
}

export interface UseModelStateReturn {
  currentModelId: string;
  currentModelName: string;
  currentContextWindow?: number;
  currentModelProvider?: string;
  currentThinkingControlEnabled?: boolean;
  updateModel: (result: SwitchModelResult) => void;
}

export function useModelState({ modelId, modelName, contextWindow, modelProvider, thinkingControlEnabled }: UseModelStateOptions): UseModelStateReturn {
  const [currentModelId, setCurrentModelId] = useState(modelId);
  const [currentModelName, setCurrentModelName] = useState(modelName);
  const [currentContextWindow, setCurrentContextWindow] = useState(contextWindow);
  const [currentModelProvider, setCurrentModelProvider] = useState(modelProvider);
  const [currentThinkingControlEnabled, setCurrentThinkingControlEnabled] = useState(thinkingControlEnabled);

  const updateModel = useCallback((result: SwitchModelResult) => {
    if (result.modelId) setCurrentModelId(result.modelId);
    if (result.modelName) setCurrentModelName(result.modelName);
    if ('contextWindow' in result) setCurrentContextWindow(result.contextWindow);
    if (result.modelProvider) setCurrentModelProvider(result.modelProvider);
    if ('thinkingControlEnabled' in result) setCurrentThinkingControlEnabled(result.thinkingControlEnabled);
  }, []);

  return {
    currentModelId,
    currentModelName,
    currentContextWindow,
    currentModelProvider,
    currentThinkingControlEnabled,
    updateModel,
  };
}
