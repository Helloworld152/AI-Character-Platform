param(
    [switch]$SkipNpmInstall
)

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
    param([string[]]$PythonArgs)

    if ($PythonArg) {
        & $PythonExe $PythonArg @PythonArgs
    } else {
        & $PythonExe @PythonArgs
    }
}

Run-Step "Check Node.js and npm" {
    node --version
    npm --version
}

if (-not $SkipNpmInstall) {
    Run-Step "Install npm dependencies" {
        npm install
    }
}

Run-Step "Build web assets" {
    npm run build:web
    if (-not (Test-Path "dist-web\index.html")) {
        throw "dist-web\index.html was not generated."
    }
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

    if (-not (Test-Path "dist\backend\backend.exe")) {
        throw "dist\backend\backend.exe was not generated."
    }
}

Run-Step "Build Windows installer" {
    npx electron-builder --win nsis portable --publish never

    $Version = node -p "require('./package.json').version"
    $Setup = Get-ChildItem "release" -Filter "*Setup*.exe" -File | Select-Object -First 1
    $Portable = Get-ChildItem "release" -Filter "*.exe" -File | Where-Object { $_.Name -notlike "*Setup*" } | Select-Object -First 1

    if (-not $Setup) {
        throw "Windows setup installer was not generated in release\."
    }
    if (-not $Portable) {
        throw "Windows portable package was not generated in release\."
    }

    $SetupTarget = "AI-Character-Platform-Setup-$Version.exe"
    $PortableTarget = "AI-Character-Platform-Portable-$Version.exe"

    if ($Setup.Name -ne $SetupTarget) {
        Rename-Item $Setup.FullName $SetupTarget
        $Setup = Get-Item (Join-Path "release" $SetupTarget)
    }
    if ($Portable.Name -ne $PortableTarget) {
        Rename-Item $Portable.FullName $PortableTarget
        $Portable = Get-Item (Join-Path "release" $PortableTarget)
    }

    $SetupBlockmap = Join-Path "release" "$($Setup.BaseName).exe.blockmap"
    if (Test-Path $SetupBlockmap) {
        Rename-Item $SetupBlockmap "$SetupTarget.blockmap"
    }

    $LatestYml = Join-Path "release" "latest.yml"
    if (Test-Path $LatestYml) {
        $content = Get-Content $LatestYml -Raw
        $content = $content -replace '(?m)^path: .+$', "path: $SetupTarget"
        $content = $content -replace '(?m)^(\s*- url: ).+$', "`$1$SetupTarget"
        Set-Content $LatestYml $content -NoNewline
    }

    Write-Host "Generated setup: $($Setup.FullName)"
    Write-Host "Generated portable: $($Portable.FullName)"
}

Write-Host ""
Write-Host "Windows installer is in: $Root\release" -ForegroundColor Green
