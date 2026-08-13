"use strict";

// Sign when the local certificate exists; otherwise build unsigned.

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { publisherMatches } = require("../util/updateSignature.js");

const signingDir = path.join(__dirname, "signing");
const pfx = path.join(signingDir, "Shirow.pfx");
const passwordFile = path.join(signingDir, ".password");

const env = { ...process.env };
const windowsPowerShellModules = path.join(
    process.env.SystemRoot || process.env.WINDIR || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "Modules"
);

function verifySignedUpdateArtifacts() {
    const appDir = path.join(__dirname, "..");
    const version = require(path.join(appDir, "package.json")).version;
    const distDir = path.join(appDir, "dist");
    const installer = path.join(distDir, `Achievement.Watcher.Setup.${version}.exe`);
    const updateConfig = path.join(distDir, "win-unpacked", "resources", "app-update.yml");
    const latest = path.join(distDir, "latest.yml");
    const missing = [installer, updateConfig, latest].filter((file) => !fs.existsSync(file));
    if (missing.length) throw new Error(`Missing signed update artifact(s): ${missing.join(", ")}`);

    const signature = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-InputFormat", "None", "-Command", `Get-AuthenticodeSignature -LiteralPath '${installer.replace(/'/g, "''")}' | ConvertTo-Json -Compress`],
        {
            encoding: "utf8",
            windowsHide: true,
            env: { ...process.env, PSModulePath: windowsPowerShellModules },
        }
    );
    if (signature.status !== 0) throw new Error(`Could not inspect installer signature: ${signature.stderr || signature.error || "unknown error"}`);
    const subject = JSON.parse(signature.stdout).SignerCertificate?.Subject || "";
    if (!publisherMatches(subject, ["Shirow"])) throw new Error(`Installer signer must be CN=Shirow, received: ${subject || "none"}`);

    const appUpdate = fs.readFileSync(updateConfig, "utf8");
    if (!/publisherName:\s*(?:\r?\n\s*-\s*Shirow\b|Shirow\b)/.test(appUpdate)) {
        throw new Error("app-update.yml does not declare Shirow as the update publisher");
    }

    const manifest = yaml.load(fs.readFileSync(latest, "utf8"));
    const artifact = (manifest.files || []).find((file) => file.url === path.basename(installer));
    const sha512 = crypto.createHash("sha512").update(fs.readFileSync(installer)).digest("base64");
    if (!artifact || artifact.sha512 !== sha512 || manifest.sha512 !== sha512) {
        throw new Error("latest.yml SHA-512 does not match the signed installer");
    }
    console.log("[build] Signed installer, update publisher and SHA-512 manifest verified.");
}

if (fs.existsSync(pfx)) {
    env.CSC_LINK = pfx;
    if (fs.existsSync(passwordFile)) {
        env.CSC_KEY_PASSWORD = fs.readFileSync(passwordFile, "utf8").trim();
    }
    console.log(`[build] Local certificate found, this build will be signed: ${pfx}`);
}
else {
    console.log("[build] No local signing certificate found (build/signing/Shirow.pfx) - building unsigned.");
    console.log("[build] To sign, run: powershell -ExecutionPolicy Bypass -File build/signing/create-self-signed-cert.ps1");
}

const result = spawnSync(
    process.execPath,
    [require.resolve("electron-builder/cli"), "--config", "electron-builder.yml", "--publish", "never"],
    {
        cwd: path.join(__dirname, ".."),
        env,
        stdio: "inherit",
    }
);

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}
if (result.status !== 0) process.exit(result.status == null ? 1 : result.status);

try {
    if (fs.existsSync(pfx)) verifySignedUpdateArtifacts();
} catch (error) {
    console.error(`[build] ${error.message}`);
    process.exit(1);
}
process.exit(0);
