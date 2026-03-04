# smoketest.ps1

$secret = $env:SHOPIFY_API_SECRET
if (-not $secret) { throw "SHOPIFY_API_SECRET is not set in this PowerShell session." }

$shop  = "profit-engine-test.myshopify.com"
$topic = "shop/redact"   # change to: app/uninstalled | shop/redact | customers/redact | customers/data_request

# Choose target
$uri = "https://real-profit-backend.onrender.com/api/shopify/webhooks"
# $uri = "http://localhost:3001/api/shopify/webhooks"

$body  = '{"test":true}'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

$hmacsha = [System.Security.Cryptography.HMACSHA256]::new()
$hmacsha.Key = [System.Text.Encoding]::UTF8.GetBytes($secret)
$hash = $hmacsha.ComputeHash($bytes)
$hmac = [Convert]::ToBase64String($hash)

$eventId = "evt_render_smoke_" + [Guid]::NewGuid().ToString("N")

$headers = @{
  "X-Shopify-Topic"       = $topic
  "X-Shopify-Shop-Domain" = $shop
  "X-Shopify-Hmac-Sha256" = $hmac
  "X-Shopify-Event-Id"    = $eventId
}

Write-Host "URI:   $uri"
Write-Host "Shop:  $shop"
Write-Host "Topic: $topic"
Write-Host "Event: $eventId"
Write-Host "HMAC:  $hmac"

try {
  $resp = Invoke-WebRequest -Method POST -Uri $uri -Headers $headers -ContentType "application/json" -Body $body
  Write-Host "StatusCode: $($resp.StatusCode)"
  Write-Host "OK"
} catch {
  if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
    Write-Host "HTTP Status: $([int]$_.Exception.Response.StatusCode) $($_.Exception.Response.StatusDescription)"
  }
  throw
}