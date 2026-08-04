"use strict";

// Build wrapper: signs automatically with the local self-signed certificate
// when app/build/signing/Shirow.pfx exists, otherwise builds unsigned.
// The certificate is never committed; create it with:
//   powershell -ExecutionPolicy Bypass -File build/signing/create-self-signed-cert.ps1

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const signingDir = path.join(__dirname, "signing");
const pfx = path.join(signingDir, "Shirow.pfx");
const passwordFile = path.join(signingDir, ".password");

const env = { ...process.env };

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
    "npx",
    ["electron-builder", "--config", "electron-builder.yml", "--publish", "never"],
    {
        cwd: path.join(__dirname, ".."),
        env,
        stdio: "inherit",
        shell: true,
    }
);

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}
process.exit(result.status == null ? 1 : result.status);
