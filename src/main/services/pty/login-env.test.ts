import { describe, expect, it } from 'vitest'
import { BUILT_IN_ADAPTERS } from '../cli/adapters'
import { loginEnvPatterns, PROVIDER_LOGIN_ENV } from '../cli/adapters/login-env'
import { applySavedLoginEnv, isLoginVar, parseEnvDump, parseRegQuery, type SavedEnv } from './login-env'

const saved = (entries: Record<string, string>, platform: NodeJS.Platform = 'win32'): SavedEnv =>
  new Map(Object.entries(entries).map(([name, value]) => [platform === 'win32' ? name.toUpperCase() : name, { name, value }]))

const patterns = loginEnvPatterns(BUILT_IN_ADAPTERS)

describe('CLI logins come from the saved environment (ADR 0063)', () => {
  it('knows the shared provider variables and each CLI’s own', () => {
    expect(isLoginVar('ANTHROPIC_AUTH_TOKEN', patterns)).toBe(true)
    expect(isLoginVar('OPENAI_BASE_URL', patterns)).toBe(true)
    expect(isLoginVar('CLAUDE_CONFIG_DIR', patterns)).toBe(true)
    expect(isLoginVar('CODEX_HOME', patterns)).toBe(true)
    expect(isLoginVar('GH_TOKEN', patterns)).toBe(true)
    expect(isLoginVar('PATH', patterns)).toBe(false)
    expect(isLoginVar('ANTHROPIC', patterns)).toBe(false)
    expect(new Set(patterns).size).toBe(patterns.length)
    expect(patterns).toEqual(expect.arrayContaining([...PROVIDER_LOGIN_ENV]))
  })

  it('drops an inherited token, endpoint and model the user no longer has', () => {
    const env = { PATH: 'C:\\bin', ANTHROPIC_AUTH_TOKEN: 'old', ANTHROPIC_BASE_URL: 'https://proxy.example', ANTHROPIC_MODEL: 'some-model', HOME: 'C:\\Users\\me' }
    expect(applySavedLoginEnv(env, saved({ Path: 'C:\\bin' }), patterns)).toEqual({ PATH: 'C:\\bin', HOME: 'C:\\Users\\me' })
  })

  it('uses the saved value over an inherited one, and adds saved ones that were missing', () => {
    const env = { OPENAI_API_KEY: 'stale', TERM: 'xterm' }
    const out = applySavedLoginEnv(env, saved({ OPENAI_API_KEY: 'fresh', GEMINI_API_KEY: 'g', Unrelated: 'x' }), patterns)
    expect(out).toEqual({ OPENAI_API_KEY: 'fresh', GEMINI_API_KEY: 'g', TERM: 'xterm' })
  })

  it('matches names regardless of case on Windows', () => {
    const out = applySavedLoginEnv({ anthropic_api_key: 'old' }, saved({ Anthropic_Api_Key: 'new' }), patterns, 'win32')
    expect(out).toEqual({ ANTHROPIC_API_KEY: 'new' })
  })

  it('keeps names as written elsewhere', () => {
    const out = applySavedLoginEnv({ ANTHROPIC_API_KEY: 'old' }, saved({ ANTHROPIC_API_KEY: 'new' }, 'linux'), patterns, 'linux')
    expect(out).toEqual({ ANTHROPIC_API_KEY: 'new' })
  })

  it('reads reg query output: user over machine, expanded values, empty values', () => {
    const machine = 'HKEY_LOCAL_MACHINE\\SYSTEM\\...\\Environment\r\n    OPENAI_API_KEY    REG_SZ    machine-key\r\n    ComSpec    REG_EXPAND_SZ    %SystemRoot%\\system32\\cmd.exe\r\n'
    const user = 'HKEY_CURRENT_USER\\Environment\r\n    OPENAI_API_KEY    REG_SZ    user-key\r\n    CODEX_HOME    REG_EXPAND_SZ    %USERPROFILE%\\.codex\r\n    EMPTY_ONE    REG_SZ\r\n'
    const env = parseRegQuery([machine, user], { USERPROFILE: 'C:\\Users\\me', SystemRoot: 'C:\\Windows' })
    expect(env.get('OPENAI_API_KEY')?.value).toBe('user-key')
    expect(env.get('CODEX_HOME')?.value).toBe('C:\\Users\\me\\.codex')
    expect(env.get('COMSPEC')?.value).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(env.get('EMPTY_ONE')?.value).toBe('')
  })

  it('reads a login shell’s env between its markers, ignoring what rc files print', () => {
    const out = 'welcome!\n__HIVEORY_ENV__HOME=/home/me\nANTHROPIC_API_KEY=a=b\n__HIVEORY_ENV__bye'
    const env = parseEnvDump(out, 'linux')
    expect(env?.get('ANTHROPIC_API_KEY')?.value).toBe('a=b')
    expect(env?.get('HOME')?.value).toBe('/home/me')
    expect(parseEnvDump('no markers', 'linux')).toBeNull()
  })
})
