import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('console /extension keyboard regressions', () => {
  it('Enter 只修改扩展开关草稿，S 才调用 onToggleExtension 保存并热重载', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/hooks/use-app-keyboard.ts'),
      'utf8',
    );

    const enterBranch = source.match(/else if \(key\.name === 'return' \|\| key\.name === 'enter'\) \{[\s\S]*?\n      \} else if \(key\.name === 's'\)/)?.[0] ?? '';
    expect(enterBranch).toContain('setExtensionList');
    expect(enterBranch).toContain('S 保存');
    expect(enterBranch).not.toContain('onToggleExtension(');

    const saveBranch = source.match(/else if \(key\.name === 's'\) \{[\s\S]*?\n      \}/)?.[0] ?? '';
    expect(saveBranch).toContain("onToggleExtension(item.name, item.status === 'active')");
    expect(saveBranch).toContain('已保存并热重载');
  });

  it('/extension 列表应按 Plugins 与 Platforms 分组展示，避免混在一起', () => {
    const viewSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/components/ExtensionListView.tsx'),
      'utf8',
    );
    expect(viewSource).toContain("'Plugins'");
    expect(viewSource).toContain("'Platforms'");
  });

  it('/extension 支持 Git 拉取、升级和删除快捷键', () => {
    const viewSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/components/ExtensionListView.tsx'),
      'utf8',
    );
    const keyboardSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/hooks/use-app-keyboard.ts'),
      'utf8',
    );
    const platformSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/index.ts'),
      'utf8',
    );

    expect(viewSource).toContain('G 拉取 Git');
    expect(viewSource).toContain('U 升级');
    expect(viewSource).toContain('D 删除');
    expect(viewSource).toContain('处理中，请稍候');
    expect(keyboardSource).toContain('usePaste');
    expect(keyboardSource).toContain('extensionBusy');
    expect(keyboardSource).toContain('blockIfDirty');
    expect(keyboardSource).toContain("key.ctrl && key.name === 'v'");
    expect(keyboardSource).toContain('readClipboardText');
    expect(keyboardSource).toContain('onInstallGitExtension(target, extensionInstallScope)');
    expect(keyboardSource).toContain('onDeleteExtension(item.name)');
    expect(keyboardSource).toContain('onPreviewUpdateExtension(item.name)');
    expect(keyboardSource).toContain('onUpdateExtension(item.name)');
    expect(keyboardSource).toContain('危险操作：再次按 D 将永久删除');
    expect(keyboardSource).toContain('升级预览');
    expect(keyboardSource).toContain('当前有未保存的启用/禁用修改');
    expect(platformSource).toContain('handleInstallGitExtension');
    expect(platformSource).toContain('handleDeleteExtension');
    expect(platformSource).toContain('handlePreviewUpdateExtension');
    expect(platformSource).toContain('handleUpdateExtension');
  });

  it('/lover 不应是静态命令，应随 virtual-lover 扩展开关动态出现/隐藏', () => {
    const commandsSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/input-commands.ts'),
      'utf8',
    );
    const appSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/App.tsx'),
      'utf8',
    );
    const dispatchSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/hooks/use-command-dispatch.ts'),
      'utf8',
    );

    expect(commandsSource).not.toContain("name: '/lover'");
    expect(appSource).toContain("id === 'virtual-lover'");
    expect(appSource).toContain("name: '/lover'");
    expect(dispatchSource).toContain('canOpenLoverSettings');
  });

  it('动态命令应基于已保存状态过滤，保存后刷新插件 settings tabs', () => {
    const appSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/App.tsx'),
      'utf8',
    );
    const keyboardSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/hooks/use-app-keyboard.ts'),
      'utf8',
    );
    expect(appSource).toContain('item.originalStatus ?? item.status');
    expect(appSource).toContain('refreshPluginSettingsTabs');
    expect(keyboardSource).toContain('onRefreshPluginSettingsTabs');
  });

  it('/extension 应展示并可切换 workspace 可选扩展，而不是要求用户手改 system.yaml', () => {
    const platformSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/index.ts'),
      'utf8',
    );
    const keyboardSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/hooks/use-app-keyboard.ts'),
      'utf8',
    );

    expect(platformSource).toContain('ext.discoverAll?.() ?? packages');
    expect(platformSource).toContain('updateWorkspaceExtensionDiscoveryConfig');
    expect(platformSource).toContain('ext.setWorkspaceDiscovery?.(workspaceUpdate.workspace)');
    expect(keyboardSource).toContain("onToggleExtension(item.name, item.status === 'active')");
  });
});
