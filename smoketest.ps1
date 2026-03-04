# smoketest.ps1

$secret = $env:SHOPIFY_API_SECRET
$shop   = "profit-engine-test.myshopify.com"
$topic  = "shop/redact"

$body  = '{"test":true}'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

# ✅ Correct HMACSHA256 usage in PowerShell
$hmacsha = [System.Security.Cryptography.HMACSHA256]::new()
$hmacsha.Key = [System.Text.Encoding]::UTF8.GetBytes($secret)
$hash = $hmacsha.ComputeHash($bytes)
$hmac = [Convert]::ToBase64String($hash)

# Optional: make output obvious
Write-Host "HMAC: $hmac"
Write-Host "Topic: $topic"
Write-Host "Shop: $shop"

Invoke-WebRequest `
  -Method POST `
  -Uri "https://real-profit-backend.onrender.com/api/shopify/webhooks"
  -Headers @{
      "Content-Type"="application/json"
      "X-Shopify-Topic"=$topic
      "X-Shopify-Shop-Domain"=$shop
      "X-Shopify-Hmac-Sha256"=$hmac
      "X-Shopify-Event-Id"="evt_smoke_delete_test_2"
  } `
  -Body $body