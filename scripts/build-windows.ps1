$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Run-Step {
    param(
        [string]$Name,
        [scriptblock]$Command
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Command
}

function Find-Python {
    $commands = @(
        @("py", "-3"),
        @("python", ""),
        @("python3", "")
    )

    foreach ($candidate in $commands) {
        $exe = $candidate[0]
        $arg = $candidate[1]
        try {
            if ($arg) {
                & $exe $arg --version *> $null
            } else {
                & $exe --version *> $null
            }
            return $candidate
        } catch {
            continue
        }
    }

    throw "Python 3 was not found. Install Python 3.10+ and enable 'Add python.exe to PATH'."
}

$Python = Find-Python
$PythonExe = $Python[0]
$PythonArg = $Python[1]

function Invoke-Python {
    param([string[]]$Args)

    if ($PythonArg) {
        & $PythonExe $PythonArg @Args
    } else {
        & $PythonExe @Args
    }
}

Run-Step "Check Node.js and npm" {
    node --version
    npm --version
}

Run-Step "Install npm dependencies" {
    npm install
}

Run-Step "Build web assets" {
    npm run build:web
}

Run-Step "Install PyInstaller if missing" {
    try {
        Invoke-Python @("-m", "PyInstaller", "--version")
    } catch {
        Invoke-Python @("-m", "pip", "install", "--upgrade", "pyinstaller")
    }
}

Run-Step "Build Python backend exe" {
    if (Test-Path "build\backend") {
        Remove-Item "build\backend" -Recurse -Force
    }
    if (Test-Path "dist\backend") {
        Remove-Item "dist\backend" -Recurse -Force
    }

    Invoke-Python @(
        "-m", "PyInstaller",
        "--name", "backend",
        "--onedir",
        "--noconsole",
        "--clean",
        "--add-data", "character_runtime;character_runtime",
        "--add-data", "characters;characters",
        "--add-data", "dist-web;dist-web",
        "--add-data", ".env.example;.",
        "web_server.py"
    )
}

Run-Step "Build Windows installer" {
    npx electron-builder --win nsis
}

Write-Host ""
Write-Host "Windows installer is in: $Root\release" -ForegroundColor Green
