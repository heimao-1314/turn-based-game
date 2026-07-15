param(
  [int]$Port = 8021,
  [string]$Root = $PSScriptRoot,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

function Get-MimeType {
  param([string]$Path)
  $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
  switch ($ext) {
    ".html" { "text/html; charset=utf-8" }
    ".htm"  { "text/html; charset=utf-8" }
    ".js"   { "application/javascript; charset=utf-8" }
    ".css"  { "text/css; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".png"  { "image/png" }
    ".jpg"  { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".gif"  { "image/gif" }
    ".svg"  { "image/svg+xml" }
    ".ico"  { "image/x-icon" }
    ".txt"  { "text/plain; charset=utf-8" }
    ".md"   { "text/plain; charset=utf-8" }
    default { "application/octet-stream" }
  }
}

function Find-FreePort {
  param([int]$StartPort)
  for ($candidate = $StartPort; $candidate -lt ($StartPort + 100); $candidate += 1) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $iar = $client.BeginConnect("127.0.0.1", $candidate, $null, $null)
      if (-not $iar.AsyncWaitHandle.WaitOne(120, $false)) {
        return $candidate
      }
      $client.EndConnect($iar)
    } catch {
      return $candidate
    } finally {
      $client.Close()
    }
  }
  throw "No free port found."
}

$Root = $Root.Trim().Trim('"')
$Root = [System.IO.Path]::GetFullPath($Root)
$Port = Find-FreePort -StartPort $Port
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
$listener.Start()

$url = "http://127.0.0.1:$Port/index.html"
Write-Host "Map tool started: $url"
Write-Host "Root: $Root"
Write-Host "Close this window to stop the server."
if (-not $NoBrowser) {
  Start-Process $url
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $stream.ReadTimeout = 2000
      $stream.WriteTimeout = 5000
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
      try {
        $requestLine = $reader.ReadLine()
      } catch [System.IO.IOException] {
        continue
      }
      if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }

      while ($true) {
        try {
          $line = $reader.ReadLine()
        } catch [System.IO.IOException] {
          break
        }
        if ([string]::IsNullOrEmpty($line)) { break }
      }

      $parts = $requestLine.Split(" ")
      $method = if ($parts.Length -gt 0) { $parts[0] } else { "GET" }
      $rawPath = if ($parts.Length -gt 1) { $parts[1] } else { "/" }
      $pathOnly = $rawPath.Split("?")[0]
      $decodedPath = [System.Uri]::UnescapeDataString($pathOnly).Replace("/", [System.IO.Path]::DirectorySeparatorChar)
      if ($decodedPath -eq [System.IO.Path]::DirectorySeparatorChar) {
        $decodedPath = [System.IO.Path]::DirectorySeparatorChar + "index.html"
      }

      $relativePath = $decodedPath.TrimStart([System.IO.Path]::DirectorySeparatorChar)
      $filePath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Root, $relativePath))
      $rootPrefix = $Root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

      if (-not $filePath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")
        $header = "HTTP/1.1 403 Forbidden`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
        $stream.Write([System.Text.Encoding]::ASCII.GetBytes($header), 0, $header.Length)
        if ($method -ne "HEAD") { $stream.Write($body, 0, $body.Length) }
        continue
      }

      if (-not [System.IO.File]::Exists($filePath)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
        $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
        $stream.Write([System.Text.Encoding]::ASCII.GetBytes($header), 0, $header.Length)
        if ($method -ne "HEAD") { $stream.Write($body, 0, $body.Length) }
        continue
      }

      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $mime = Get-MimeType -Path $filePath
      $header = "HTTP/1.1 200 OK`r`nContent-Type: $mime`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
      $stream.Write([System.Text.Encoding]::ASCII.GetBytes($header), 0, $header.Length)
      if ($method -ne "HEAD") { $stream.Write($bytes, 0, $bytes.Length) }
    } catch [System.IO.IOException] {
      continue
    } catch {
      Write-Host "Request failed: $($_.Exception.Message)"
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
