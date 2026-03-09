/**
 * 底部输入栏
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface InputBarProps {
  disabled: boolean;
  onSubmit: (text: string) => void;
}

export function InputBar({ disabled, onSubmit }: InputBarProps) {
  const [value, setValue] = useState('');

  const handleSubmit = (text: string) => {
    if (disabled) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue('');
  };

  return (
    <Box flexDirection="row" width="100%">
      <Text color={disabled ? 'gray' : 'cyan'} bold>{"\u276F"} </Text>
      <Box flexGrow={1}>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder=""
        />
      </Box>
    </Box>
  );
}
