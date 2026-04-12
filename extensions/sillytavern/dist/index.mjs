// src/index.ts
import {
  definePlugin,
  createPluginLogger
} from "irises-extension-sdk";
import * as fs2 from "node:fs";
import * as path2 from "node:path";
import { buildPrompt } from "fast-tavern";

// src/loader.ts
import * as fs from "node:fs";
import * as path from "node:path";
import {
  convertPresetFromSillyTavern,
  convertCharacterFromSillyTavern,
  convertWorldBookFromSillyTavern,
  convertRegexesFromSillyTavern
} from "fast-tavern";
function ensureDataDirs(dataDir) {
  for (const sub of ["presets", "characters", "worldbooks", "regex"]) {
    const dir = path.join(dataDir, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
function readJSON(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}
function loadPreset(dataDir, filename) {
  const filePath = path.join(dataDir, "presets", filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`预设文件不存在: ${filePath}`);
  }
  const raw = readJSON(filePath);
  return convertPresetFromSillyTavern(raw);
}
function loadCharacter(dataDir, filename) {
  const filePath = path.join(dataDir, "characters", filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`角色卡文件不存在: ${filePath}`);
  }
  const raw = readJSON(filePath);
  return convertCharacterFromSillyTavern(raw);
}
function loadWorldbooks(dataDir, filenames) {
  const books = [];
  for (const filename of filenames) {
    const filePath = path.join(dataDir, "worldbooks", filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`世界书文件不存在: ${filePath}`);
    }
    const raw = readJSON(filePath);
    books.push(convertWorldBookFromSillyTavern(raw));
  }
  return books;
}
function loadRegexScripts(dataDir, filenames) {
  const allScripts = [];
  for (const filename of filenames) {
    const filePath = path.join(dataDir, "regex", filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`正则脚本文件不存在: ${filePath}`);
    }
    const raw = readJSON(filePath);
    const arr = Array.isArray(raw) ? raw : raw.regex_scripts ?? [raw];
    allScripts.push(...convertRegexesFromSillyTavern(arr));
  }
  return allScripts;
}

// src/assembler.ts
function irisContentsToHistory(contents) {
  const result = [];
  for (const content of contents) {
    const textParts = [];
    for (const part of content.parts) {
      if ("text" in part && part.text && !("functionCall" in part) && !("functionResponse" in part)) {
        if (part.thought)
          continue;
        textParts.push({ text: part.text });
      }
    }
    if (textParts.length === 0)
      continue;
    result.push({
      role: content.role,
      parts: textParts
    });
  }
  return result;
}
function assembledToLLMRequest(assembled, originalRequest) {
  const systemParts = [];
  const contents = [];
  for (const msg of assembled) {
    const parts = msg.parts;
    if (!parts || parts.length === 0)
      continue;
    if (msg.role === "system") {
      for (const p of parts) {
        if (p.text)
          systemParts.push({ text: p.text });
      }
    } else {
      const irisParts = parts.filter((p) => p.text).map((p) => ({ text: p.text }));
      if (irisParts.length > 0) {
        contents.push({
          role: msg.role,
          parts: irisParts
        });
      }
    }
  }
  return {
    contents,
    systemInstruction: systemParts.length > 0 ? { parts: systemParts } : undefined,
    tools: originalRequest.tools,
    generationConfig: originalRequest.generationConfig
  };
}
function formatTaggedForLog(result) {
  const tagged = result.stages.tagged.afterPostRegex;
  const lines = ["=== SillyTavern Assembled Prompt ==="];
  for (const item of tagged) {
    const roleTag = `[${item.role}]`;
    const label = item.tag;
    const preview = item.text.length > 200 ? item.text.slice(0, 200) + "..." : item.text;
    lines.push(`${roleTag} ${label}: ${preview}`);
  }
  lines.push(`=== Total items: ${tagged.length} ===`);
  return lines.join(`
`);
}

// src/config-template.ts
var defaultConfigTemplate = `# ─────────────────────────────────────────────
# SillyTavern 提示词引擎配置
# ─────────────────────────────────────────────
#
# 数据目录位于 ~/.iris/extension-data/sillytavern/
# 请将酒馆导出的 JSON 文件放入对应子目录：
#   presets/       预设文件
#   characters/    角色卡文件
#   worldbooks/    世界书文件
#   regex/         正则脚本文件

sillytavern:
  # 是否启用（启用后将接管 Iris 默认的提示词组装）
  enabled: false

  # 当前激活的预设文件名（presets/ 目录下）
  preset: ""

  # 当前激活的角色卡文件名（characters/ 目录下，留空则不使用）
  character: ""

  # 全局世界书文件名列表（worldbooks/ 目录下）
  worldbooks: []

  # 全局正则脚本文件名列表（regex/ 目录下）
  regex: []

  # 宏变量（对应酒馆的 {{user}}、{{char}} 等）
  # char 会从角色卡自动提取，一般只需设置 user
  macros:
    user: "User"

  # 调试模式：将组装后的提示词结构输出到日志
  debug: true
`;

// src/index.ts
var src_default = definePlugin({
  name: "sillytavern",
  version: "0.1.0",
  description: "SillyTavern 提示词引擎 — 使用酒馆格式的预设、角色卡、世界书、正则组装提示词",
  activate(ctx) {
    const log = createPluginLogger("sillytavern");
    const diagLog = (msg) => {
      const dataDir2 = ctx.getDataDir();
      const logFile = path2.join(dataDir2, "activate.log");
      fs2.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}
`, "utf-8");
    };
    ctx.ensureConfigFile("sillytavern.yaml", defaultConfigTemplate);
    const dataDir = ctx.getDataDir();
    ensureDataDirs(dataDir);
    const rawConfig = ctx.readConfigSection("sillytavern");
    diagLog(`rawConfig keys: ${rawConfig ? Object.keys(rawConfig).join(", ") : "undefined"}`);
    const config = {
      enabled: false,
      preset: "",
      character: "",
      worldbooks: [],
      regex: [],
      macros: { user: "User" },
      debug: true,
      ...rawConfig?.sillytavern ?? rawConfig ?? {}
    };
    diagLog(`config: enabled=${config.enabled}, preset=${config.preset}, debug=${config.debug}`);
    if (!config.enabled) {
      log.info("SillyTavern 插件已禁用（enabled: false）");
      return;
    }
    if (!config.preset) {
      log.warn("未配置预设文件（preset），插件不会生效");
      return;
    }
    diagLog("开始加载资源...");
    log.info(`数据目录: ${dataDir}`);
    let preset;
    let character;
    let worldbooks;
    let regexScripts;
    try {
      preset = loadPreset(dataDir, config.preset);
      log.info(`预设已加载: ${config.preset} (${preset.prompts.length} prompts)`);
    } catch (e) {
      log.error(`加载预设失败: ${e.message}`);
      return;
    }
    try {
      if (config.character) {
        character = loadCharacter(dataDir, config.character);
        log.info(`角色卡已加载: ${character.name}`);
      }
    } catch (e) {
      log.error(`加载角色卡失败: ${e.message}`);
      return;
    }
    try {
      worldbooks = loadWorldbooks(dataDir, config.worldbooks);
      if (worldbooks.length > 0) {
        log.info(`世界书已加载: ${worldbooks.length} 个文件`);
      }
    } catch (e) {
      log.error(`加载世界书失败: ${e.message}`);
      return;
    }
    try {
      regexScripts = loadRegexScripts(dataDir, config.regex);
      if (regexScripts.length > 0) {
        log.info(`正则脚本已加载: ${regexScripts.length} 条`);
      }
    } catch (e) {
      log.error(`加载正则脚本失败: ${e.message}`);
      return;
    }
    ctx.addHook({
      name: "sillytavern:build-prompt",
      onBeforeLLMCall({ request, round }) {
        if (round > 1)
          return;
        try {
          const history = irisContentsToHistory(request.contents);
          const result = buildPrompt({
            preset,
            character,
            globals: {
              worldBooks: worldbooks,
              regexScripts
            },
            history,
            view: "model",
            macros: config.macros,
            outputFormat: "gemini",
            systemRolePolicy: "keep"
          });
          if (config.debug) {
            const debugText = formatTaggedForLog(result);
            log.info(debugText);
            try {
              const debugFile = path2.join(dataDir, "last-prompt-debug.txt");
              fs2.writeFileSync(debugFile, debugText, "utf-8");
              log.info(`调试输出已写入: ${debugFile}`);
            } catch {}
          }
          const assembled = result.stages.output.afterPostRegex;
          const newRequest = assembledToLLMRequest(assembled, request);
          return { request: newRequest };
        } catch (e) {
          log.error(`提示词组装失败: ${e.message}`);
          return;
        }
      }
    });
    diagLog("钩子已注册，插件启用完成");
    log.info("SillyTavern 提示词引擎已启用");
  }
});
export {
  src_default as default
};
