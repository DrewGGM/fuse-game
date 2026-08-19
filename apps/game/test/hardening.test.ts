/**
 * Guards for the security posture of the shipped client and Android shell.
 *
 * These assert on files rather than behaviour, which is unusual for a test
 * suite, and deliberate: each one encodes a decision that is easy to undo by
 * accident. Regenerating the Capacitor project rewrites the manifest and the
 * file-provider paths; a convenient template literal reintroduces innerHTML; a
 * new CDN dependency quietly needs the CSP relaxed. A failing test here is a
 * prompt to make that trade-off on purpose.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/**
 * Strips comments before matching.
 *
 * Every one of these rules is documented in a comment right where it applies,
 * and those comments name the dangerous pattern in order to explain it. Scanning
 * raw text therefore flags the explanation as the violation — so the scan has to
 * look at code only.
 */
const codeOf = (rel: string): string =>
  read(rel)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const CLIENT_SOURCES = [
  '../src/main.ts',
  '../src/board-view.ts',
  '../src/tutorial.ts',
  '../src/storage.ts',
  '../src/share.ts',
  '../src/commerce.ts',
  '../src/format.ts',
];

describe('client: no markup injection sinks', () => {
  it.each(CLIENT_SOURCES)('%s never assigns HTML from a string', (file) => {
    const code = codeOf(file);
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
      expect(code.includes(sink), `${file} uses ${sink}`).toBe(false);
    }
  });

  it.each(CLIENT_SOURCES)('%s never evaluates a string as code', (file) => {
    const code = codeOf(file);
    expect(/\beval\s*\(/.test(code), `${file} calls eval`).toBe(false);
    expect(/new\s+Function\s*\(/.test(code), `${file} builds a Function`).toBe(false);
    // setTimeout('code') is an eval in disguise.
    expect(/setTimeout\s*\(\s*['"`]/.test(code)).toBe(false);
  });
});

describe('client: content security policy', () => {
  const html = read('../index.html');
  const csp = /content="([^"]*default-src[^"]*)"/s.exec(html)?.[1]?.replace(/\s+/g, ' ') ?? '';

  it('ships a policy at all', () => {
    expect(html).toContain('Content-Security-Policy');
    expect(csp).toBeTruthy();
  });

  it('denies by default and forbids remote or inline script', () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
    expect(csp).not.toMatch(/script-src[^;]*\*/);
  });

  it('blocks plugins and base-tag hijacking', () => {
    // frame-ancestors is deliberately absent: browsers ignore it in a <meta>
    // tag, so asserting on it here would only prove the string exists.
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it('keeps every directive on one line so none swallows the next', () => {
    // Wrapping the policy across indented lines made the browser read the
    // continuation as extra sources for the previous directive, which silently
    // disabled object-src. Caught in a real browser, not by a string match.
    const raw = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/s.exec(html)?.[1] ?? '';
    expect(raw).toBeTruthy();
    expect(raw.includes(String.fromCharCode(10)), 'policy must be one line').toBe(false);
    for (const directive of raw.split(';')) {
      const sources = directive.trim().split(/\s+/).slice(1);
      if (sources.includes("'none'")) {
        expect(sources, `${directive.trim()} — 'none' must stand alone`).toHaveLength(1);
      }
    }
  });

  it('does not allow the page to call arbitrary hosts', () => {
    const connect = /connect-src ([^;]*)/.exec(csp)?.[1] ?? '';
    expect(connect).toBeTruthy();
    expect(connect).not.toContain('*');
    expect(connect.trim()).toMatch(/^'self'/);
  });
});

describe('android: manifest', () => {
  const manifest = read('../android/app/src/main/AndroidManifest.xml');

  it('does not let the save file be pulled off the device by backup', () => {
    // The default is true; with it on, `adb backup` extracts the save from an
    // unrooted phone.
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:fullBackupContent="false"');
    expect(manifest).toContain('android:dataExtractionRules=');
  });

  it('exports only the launcher activity', () => {
    const exported = [...manifest.matchAll(/android:exported="true"/g)];
    expect(exported).toHaveLength(1);
    expect(manifest).toMatch(/android:name="\.MainActivity"[\s\S]*?android:exported="true"/);
  });

  it('keeps the file provider unexported', () => {
    expect(manifest).toMatch(/FileProvider[\s\S]*?android:exported="false"/);
  });

  it('requests no permission beyond internet', () => {
    const permissions = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map(
      (m) => m[1]
    );
    expect(permissions).toEqual(['android.permission.INTERNET']);
  });

  it('never opts back into cleartext traffic', () => {
    expect(manifest).not.toContain('usesCleartextTraffic="true"');
  });
});

describe('android: shared file scope', () => {
  it('does not expose whole storage roots through the file provider', () => {
    const paths = codeOf('../android/app/src/main/res/xml/file_paths.xml');
    // path="." is the whole root: any app given a URI can walk it.
    expect(paths).not.toMatch(/path="\."/);
    expect(paths).not.toContain('<external-path');
  });

  it('leaves no wildcard origin in the cordova compatibility config', () => {
    const cordova = codeOf('../android/app/src/main/res/xml/config.xml');
    expect(cordova).not.toContain('origin="*"');
  });
});

describe('android: webview configuration', () => {
  const config = JSON.parse(read('../capacitor.config.json'));

  it('serves over an https scheme, not http', () => {
    expect(config.server?.androidScheme).toBe('https');
  });

  it('refuses mixed content', () => {
    expect(config.android?.allowMixedContent).toBe(false);
  });

  it('does not point the webview at a remote origin', () => {
    // A server.url turns the app into a shell around someone else's page — the
    // exact shape Google Play's minimum-functionality policy targets.
    expect(config.server?.url).toBeUndefined();
    expect(config.server?.cleartext).not.toBe(true);
  });
});

describe('supply chain', () => {
  it('ships no build tooling as a runtime dependency', () => {
    const pkg = JSON.parse(read('../package.json'));
    const deps = Object.keys(pkg.dependencies ?? {});
    // @capacitor/cli pulls xcode and uuid, both with advisories, and never runs
    // on a device.
    for (const tool of ['@capacitor/cli', 'wrangler', 'vite', 'esbuild', 'typescript']) {
      expect(deps, `${tool} must not be a production dependency`).not.toContain(tool);
    }
  });

  it('keeps the client free of network-fetching dependencies', () => {
    const pkg = JSON.parse(read('../package.json'));
    const deps = Object.keys(pkg.dependencies ?? {});
    // Every asset is bundled; nothing should be reaching out at runtime.
    expect(deps.sort()).toEqual([
      '@capacitor/android',
      '@capacitor/core',
      '@fontsource/chakra-petch',
      '@fuse/gen',
      '@fuse/sim',
    ]);
  });
});

describe('secrets', () => {
  it.each([...CLIENT_SOURCES, '../index.html'])('%s carries no embedded credential', (file) => {
    const src = read(file);
    // Real ad-unit and API key shapes, not the word "secret".
    expect(src).not.toMatch(/ca-app-pub-\d{16}/);
    expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{30,}/);
    expect(src).not.toMatch(/sk_live_|pk_live_|ghp_[A-Za-z0-9]{20,}/);
    expect(src).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });
});
