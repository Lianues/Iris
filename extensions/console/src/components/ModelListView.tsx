/** @jsxImportSource @opentui/react */

import React from 'react';
import type { IrisModelInfoLike as LLMModelInfo } from '@irises/extension-sdk';
import { C } from '../theme';

interface ModelListViewProps {
  models: LLMModelInfo[];
  selectedIndex: number;
}

export function ModelListView({ models, selectedIndex }: ModelListViewProps) {
  return (
    <box flexDirection="column" width="100%" height="100%">
      <box padding={1}>
        <text fg={C.primary}>切换模型</text>
        <text fg={C.dim}>  ↑↓ 选择  Enter 切换  Esc 返回</text>
      </box>
      <scrollbox flexGrow={1}>
        {models.map((info, index) => {
          const isSelected = index === selectedIndex;
          const currentMarker = info.current ? '•' : ' ';
          return (
            <box key={info.modelName} paddingLeft={1}>
              <text>
                <span fg={isSelected ? C.accent : C.dim}>{isSelected ? '❯ ' : '  '}</span>
                <span fg={info.current ? C.accent : C.dim}>{currentMarker} </span>
                {isSelected
                  ? <strong><span fg={C.text}>{info.modelName}</span></strong>
                  : <span fg={C.textSec}>{info.modelName}</span>}
                <span fg={C.dim}>  {info.modelId}  {info.provider}</span>
              </text>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}
