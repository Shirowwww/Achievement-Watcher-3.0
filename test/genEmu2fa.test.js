'use strict';

// Exercise the interactive wrapper without contacting Steam: the command shim emits a Steam Guard
// prompt without a newline (like WebAuth), waits on stdin, then produces a minimal generated config.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gen = require(path.join(__dirname, '..', 'app', 'parser', 'genEmuConfig.js'));

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-genemu-2fa-'));
  let result = null;
  try {
    const shim = path.join(temp, 'generate_emu_config.cmd');
    fs.writeFileSync(
      shim,
      '@echo off\r\n' +
        'set /p CODE=Enter Steam Guard code: 1>&2\r\n' +
        'if not "%CODE%"=="246810" exit /b 9\r\n' +
        'mkdir "%~dp0_OUTPUT\\480\\steam_settings"\r\n' +
        'echo %*>"%~dp0_OUTPUT\\480\\steam_settings\\args.txt"\r\n' +
        'echo ok>"%~dp0_OUTPUT\\480\\steam_settings\\achievements.json"\r\n'
    );
    const prompts = [];
    result = await gen.generate({
      tool: { exe: shim, tag: 'test' },
      appid: '480',
      login: { username: 'throwaway', password: 'secret' },
      onPrompt: async (question) => {
        prompts.push(question);
        return '246810';
      },
      timeout: 10000,
    });
    assert.strictEqual(prompts.length, 1, 'Steam Guard prompt must be forwarded exactly once');
    assert.match(prompts[0], /Steam Guard code/i);
    assert.match(result.steamSettings, /_OUTPUT[\\/]480[\\/]steam_settings$/, 'current GSE _OUTPUT layout must be detected');
    const args = fs.readFileSync(path.join(result.steamSettings, 'args.txt'), 'utf8');
    assert.match(args, /-tok/, 'login must persist its refresh token');
    assert.match(args, /-name\b/, 'modern profile should request named output');
    assert.match(args, /-clean\b/, 'modern profile should clean generated output');
    assert.match(args, /-cve\b/, 'modern profile should include modern config coverage');
    assert.match(args, /-reldir\b/, 'modern profile should use relative directories');
    assert.match(args, /-token\b/, 'modern profile should generate token-compatible config');

    const src = path.join(temp, 'rich', 'steam_settings');
    const dest = path.join(temp, 'game', 'steam_settings');
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(
      path.join(src, 'achievements.json'),
      JSON.stringify([{ name: 'ACH_ONE', progress: { value: { operation: 'statvalue', operand1: 'real_stat_hash' } } }])
    );
    fs.writeFileSync(path.join(src, 'stats.json'), JSON.stringify([{ name: 'real_stat_hash', type: 'int', default: '0' }]));
    fs.writeFileSync(path.join(dest, 'achievements.json'), JSON.stringify([{ name: 'ACH_ONE', displayName: 'Simple' }]));
    fs.writeFileSync(path.join(dest, 'stats.json'), JSON.stringify([{ name: 'stat_1', type: 'int', default: '0' }]));
    const merged = gen.mergeIntoGame(src, dest);
    assert.ok(merged.includes('achievements.json'), 'rich generated achievements schema should replace AW simple schema');
    assert.ok(merged.includes('stats.json'), 'generated stats should replace placeholder stat_1 mapping');
    const mergedAchievement = JSON.parse(fs.readFileSync(path.join(dest, 'achievements.json'), 'utf8'))[0];
    assert.strictEqual(mergedAchievement.progress.value.operand1, 'real_stat_hash');
    console.log('PASS: generate_emu_config forwards 2FA and enables refresh-token persistence');
  } finally {
    if (result && result.workDir) fs.rmSync(result.workDir, { recursive: true, force: true });
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
