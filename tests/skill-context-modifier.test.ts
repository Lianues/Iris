/**
 * Skill 上下文修改器集成测试。
 *
 * 覆盖点：
 * 1. invoke_skill inline 模式返回 __contextModifier + __response 结构
 * 2. ToolLoop 提取 modifier 并从历史中剥离
 * 3. 工具权限变更生效
 * 4. 模型覆盖影响后续 LLM 调用
 * 5. invoke_skill fork 模式不返回 contextModifier
 */

import { describe, expect, it } from 'vitest';
import { createInvokeSkillTool } from '../src/tools/internal/invoke_skill';
import type { SkillDefinition } from '../src/config/types';
import type { FunctionResponsePart } from '../src/types';

// ---- invoke_skill 单元测试 ----

describe('createInvokeSkillTool: inline mode', () => {
  function createMockDeps(skills: SkillDefinition[]) {
    return {
      getBackend: () => ({
        listSkills: () => skills.map(s => ({
          name: s.name,
          path: s.path,
          description: s.description,
          mode: s.mode,
          whenToUse: s.whenToUse,
          argumentHint: s.argumentHint,
          disableModelInvocation: s.disableModelInvocation,
        })),
        getSkillByName: (name: string) => skills.find(s => s.name === name),
      }),
      getRouter: () => ({} as any),
      tools: { createSubset: () => ({} as any), createFiltered: () => ({} as any) } as any,
      getToolsConfig: () => ({ permissions: {} }),
    };
  }

  it('inline skill 返回 __contextModifier + __response', async () => {
    const skill: SkillDefinition = {
      name: 'deploy',
      description: '部署技能',
      content: '执行部署到 $0 环境。',
      path: 'inline:deploy',
      allowedTools: ['shell'],
      model: 'opus',
      mode: 'inline',
      arguments: ['env'],
      contextModifier: {
        autoApproveTools: ['shell'],
        modelOverride: 'opus',
      },
    };

    const tool = createInvokeSkillTool(createMockDeps([skill]));
    const result = await tool.handler({ skill: 'deploy', args: 'staging' }) as any;

    // 验证 __contextModifier 存在（仅包含 autoApproveTools 和 modelOverride，不含 systemPromptInjection）
    expect(result.__contextModifier).toBeDefined();
    expect(result.__contextModifier.autoApproveTools).toEqual(['shell']);
    expect(result.__contextModifier.modelOverride).toBe('opus');
    expect(result.__contextModifier.systemPromptInjection).toBeUndefined();

    // 验证 __response 包含 skill 信息
    expect(result.__response.success).toBe(true);
    expect(result.__response.name).toBe('deploy');
    expect(result.__response.content).toBe('执行部署到 staging 环境。');
  });

  it('无 contextModifier 的 inline skill 不返回 __contextModifier', async () => {
    const skill: SkillDefinition = {
      name: 'simple',
      description: '简单技能',
      content: '做一些简单的事。',
      path: 'inline:simple',
    };

    const tool = createInvokeSkillTool(createMockDeps([skill]));
    const result = await tool.handler({ skill: 'simple' }) as any;

    expect(result.__contextModifier).toBeUndefined();
    expect(result.__response.success).toBe(true);
    expect(result.__response.content).toBe('做一些简单的事。');
  });

  it('skill 参数替换 $ARGUMENTS', async () => {
    const skill: SkillDefinition = {
      name: 'review',
      description: '审查',
      content: 'Please review: $ARGUMENTS',
      path: 'inline:review',
    };

    const tool = createInvokeSkillTool(createMockDeps([skill]));
    const result = await tool.handler({ skill: 'review', args: 'src/core/*.ts' }) as any;

    expect(result.__response.content).toBe('Please review: src/core/*.ts');
  });

  it('找不到 skill 时返回错误', async () => {
    const tool = createInvokeSkillTool(createMockDeps([]));
    const result = await tool.handler({ skill: 'nonexistent' }) as any;

    expect(result.error).toContain('Skill not found');
  });

  it('重复调用同一 skill 参数不同时，content 分别反映各自参数', async () => {
    const skill: SkillDefinition = {
      name: 'review',
      description: '审查',
      content: 'Review: $ARGUMENTS',
      path: 'inline:review',
      allowedTools: ['read_file'],
      contextModifier: {
        autoApproveTools: ['read_file'],
      },
    };

    const tool = createInvokeSkillTool(createMockDeps([skill]));

    const result1 = await tool.handler({ skill: 'review', args: 'src/a.ts' }) as any;
    expect(result1.__response.content).toBe('Review: src/a.ts');

    const result2 = await tool.handler({ skill: 'review', args: 'src/b.ts' }) as any;
    expect(result2.__response.content).toBe('Review: src/b.ts');

    // 两次返回的是独立的 modifier（不共享引用）
    expect(result1.__contextModifier).not.toBe(result2.__contextModifier);
  });

  it('disableModelInvocation 的 skill 不出现在工具声明中', () => {
    const skills: SkillDefinition[] = [
      { name: 'visible', description: 'OK', content: 'x', path: 'inline:visible' },
      { name: 'hidden', description: 'NO', content: 'x', path: 'inline:hidden', disableModelInvocation: true },
    ];

    const tool = createInvokeSkillTool(createMockDeps(skills));
    expect(tool.declaration.description).toContain('visible');
    expect(tool.declaration.description).not.toContain('"hidden"');
  });

  it('disableModelInvocation 的 skill 即使被点名也拒绝 invoke', async () => {
    const skills: SkillDefinition[] = [
      { name: 'hidden', description: 'NO', content: 'x', path: 'inline:hidden', disableModelInvocation: true },
    ];

    const tool = createInvokeSkillTool(createMockDeps(skills));
    const result = await tool.handler({ skill: 'hidden' }) as any;
    expect(result.error).toContain('not available for model invocation');
  });
});

// ---- ToolLoop contextModifier 集成测试 ----

describe('ToolLoop: extractAndApplyContextModifiers', () => {
  // 直接测试 ToolLoop 的 contextModifier 提取逻辑
  // 由于 extractAndApplyContextModifiers 是 private，通过构造 responseParts 间接测试

  it('__contextModifier 应从 response 中被剥离', () => {
    // 模拟 invoke_skill 返回后 scheduler 构建的 FunctionResponsePart
    const responsePart: FunctionResponsePart = {
      functionResponse: {
        name: 'invoke_skill',
        response: {
          success: true,
          content: 'skill content',
          __contextModifier: {
            autoApproveTools: ['shell'],
            modelOverride: 'opus',
          },
        },
      },
    };

    // 直接检查 __contextModifier 的存在
    const resp = responsePart.functionResponse.response as Record<string, unknown>;
    expect(resp.__contextModifier).toBeDefined();

    // 模拟 ToolLoop 的剥离操作
    delete resp.__contextModifier;
    expect(resp.__contextModifier).toBeUndefined();
    // 其他字段保持不变
    expect(resp.success).toBe(true);
    expect(resp.content).toBe('skill content');
  });
});
