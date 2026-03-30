import { useCallback, useState } from 'react';
import type { SwitchModelResult } from '../app-types';

interface UseModelStateOptions {
  modelId: string;
  modelName: string;
  contextWindow?: number;
}

export interface UseModelStateReturn {
  currentModelId: string;
  currentModelName: string;
  currentContextWindow?: number;
  updateModel: (result: SwitchModelResult) => void;
}

export function useModelState({ modelId, modelName, contextWindow }: UseModelStateOptions): UseModelStateReturn {
  const [currentModelId, setCurrentModelId] = useState(modelId);
  const [currentModelName, setCurrentModelName] = useState(modelName);
  const [currentContextWindow, setCurrentContextWindow] = useState(contextWindow);

  const updateModel = useCallback((result: SwitchModelResult) => {
    if (result.modelId) setCurrentModelId(result.modelId);
    if (result.modelName) setCurrentModelName(result.modelName);
    if ('contextWindow' in result) setCurrentContextWindow(result.contextWindow);
  }, []);

  return {
    currentModelId,
    currentModelName,
    currentContextWindow,
    updateModel,
  };
}
