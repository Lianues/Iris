/**
 * SillyTavern 提示词引擎插件
 *
 * 使用 fast-tavern 将酒馆格式的预设、角色卡、世界书、正则脚本
 * 组装为完整的提示词，通过 onBeforeLLMCall 钩子注入 Iris。
 */

import {
  definePlugin,
  createPluginLogger,
  type PluginContext,
} from 'irises-extension-sdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPrompt } from 'fast-tavern';
import type {
  PresetInfo,
  CharacterCard,
  WorldBook,
  RegexScriptData,
} from 'fast-tavern';

import { ensureDataDirs, loadPreset, loadCharacter, loadWorldbooks, loadRegexScripts } from './loader';
import { irisContentsToHistory, assembledToLLMRequest, formatTaggedForLog } from './assembler';
import { defaultConfigTemplate } from './config-template';
import type { SillyTavernConfig } from './types';

export default definePlugin({
  name: 'sillytavern',
  version: '0.1.0',
  description: 'SillyTavern 提示词引擎 — 使用酒馆格式的预设、角色卡、世界书、正则组装提示词',

  activate(ctx: PluginContext) {
    const log = createPluginLogger('sillytavern');

    // ── 1. 配置 ──

    ctx.ensureConfigFile('sillytavern.yaml', defaultConfigTemplate);

    // 无论是否启用都创建数据目录结构，方便用户放入文件
    const dataDir = ctx.getDataDir();
    ensureDataDirs(dataDir);

    const rawConfig = ctx.readConfigSection('sillytavern') as Record<string, unknown> | undefined;
    const config: SillyTavernConfig = {
      enabled: false,
      preset: '',
      character: '',
      worldbooks: [],
      regex: [],
      macros: { user: 'User' },
      debug: true,
      ...((rawConfig as any)?.sillytavern ?? rawConfig ?? {}),
    };

    if (!config.enabled) {
      log.info('SillyTavern 插件已禁用（enabled: false）');
      return;
    }

    if (!config.preset) {
      log.warn('未配置预设文件（preset），插件不会生效');
      return;
    }

    // ── 2. 加载资源 ──
    log.info(`数据目录: ${dataDir}`);

    let preset: PresetInfo;
    let character: CharacterCard | undefined;
    let worldbooks: WorldBook[];
    let regexScripts: RegexScriptData[];

    try {
      preset = loadPreset(dataDir, config.preset);
      log.info(`预设已加载: ${config.preset} (${preset.prompts.length} prompts)`);
    } catch (e: any) {
      log.error(`加载预设失败: ${e.message}`);
      return;
    }

    try {
      if (config.character) {
        character = loadCharacter(dataDir, config.character);
        log.info(`角色卡已加载: ${character.name}`);
      }
    } catch (e: any) {
      log.error(`加载角色卡失败: ${e.message}`);
      return;
    }

    try {
      worldbooks = loadWorldbooks(dataDir, config.worldbooks);
      if (worldbooks.length > 0) {
        log.info(`世界书已加载: ${worldbooks.length} 个文件`);
      }
    } catch (e: any) {
      log.error(`加载世界书失败: ${e.message}`);
      return;
    }

    try {
      regexScripts = loadRegexScripts(dataDir, config.regex);
      if (regexScripts.length > 0) {
        log.info(`正则脚本已加载: ${regexScripts.length} 条`);
      }
    } catch (e: any) {
      log.error(`加载正则脚本失败: ${e.message}`);
      return;
    }

    // ── 4. 注册钩子 ──

    ctx.addHook({
      name: 'sillytavern:build-prompt',

      onBeforeLLMCall({ request, round }) {
        // 仅在第一轮接管（后续轮次包含 tool call/response，不能重组装）
        if (round > 1) return undefined;

        try {
          // 4a. 从 request.contents 提取聊天历史
          const history = irisContentsToHistory(request.contents);

          // 4a-2. 提取最后一条 user 消息文本，供 {{lastUserMessage}} 宏使用
          //       （ST 预设常用正则删掉 history 末尾用户消息，再用此宏单独展示）
          let lastUserMessage = '';
          for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'user') {
              lastUserMessage = (history[i].parts || []).map((p: any) => p.text ?? '').join('');
              break;
            }
          }

          // 4b. 调用 fast-tavern 组装
          const result = buildPrompt({
            preset,
            character,
            globals: {
              worldBooks: worldbooks,
              regexScripts,
            },
            history,
            view: 'model',
            macros: {
              ...config.macros,
              lastUserMessage,
            },
            outputFormat: 'gemini',
            systemRolePolicy: 'keep',
          });

          // 4c. 调试输出
          if (config.debug) {
            const debugText = formatTaggedForLog(result);
            log.info(debugText);

            // 同时写入文件，避免被 TUI 覆盖
            try {
              const debugFile = path.join(dataDir, 'last-prompt-debug.txt');
              fs.writeFileSync(debugFile, debugText, 'utf-8');
              log.info(`调试输出已写入: ${debugFile}`);
            } catch {}
          }

          // 4d. 转为 Iris LLMRequest 格式
          const assembled = result.stages.output.afterPostRegex as any[];
          const newRequest = assembledToLLMRequest(assembled, request);

          return { request: newRequest };
        } catch (e: any) {
          log.error(`提示词组装失败: ${e.message}`);
          // 组装失败时不修改原始请求，回退到 Iris 默认行为
          return undefined;
        }
      },
    });

    log.info('SillyTavern 提示词引擎已启用');
  },
});
