param(
  [int]$Port = 3000,
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

Add-Type -AssemblyName System.Web

$listener = [System.Net.HttpListener]::new()
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "Serving $Root at $prefix"
Write-Host "Press Ctrl+C to stop."

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    try {
      $relativePath = [System.Web.HttpUtility]::UrlDecode($request.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($relativePath)) {
        $relativePath = "index.html"
      }

      $fullPath = [System.IO.Path]::GetFullPath((Join-Path $Root $relativePath))
      $rootPath = [System.IO.Path]::GetFullPath($Root)

      if (-not $fullPath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        $response.StatusCode = 403
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("Forbidden")
      } elseif (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        $response.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not found")
      } else {
        $ext = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
        $contentType = switch ($ext) {
          ".css" { "text/css; charset=utf-8" }
          ".js" { "application/javascript; charset=utf-8" }
          ".html" { "text/html; charset=utf-8" }
          ".json" { "application/json; charset=utf-8" }
          default { "application/octet-stream" }
        }

        $bytes = [System.IO.File]::ReadAllBytes($fullPath)
        $response.StatusCode = 200
        $response.ContentType = $contentType
      }

      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
      $response.StatusCode = 500
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($_.Exception.Message)
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } finally {
      $response.OutputStream.Close()
    }
  }
}
finally {
  $listener.Stop()
  $listener.Close()
}
