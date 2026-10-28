# Kundenabgleich 3E Look -> JOLEKA 360° (nur lesend gegenüber 3E).
# Liest die Kunden mit der Abfrage aus kunden.sql und schickt sie an die Edge Function sync-3e.
#
#   .\sync-3e.ps1 -Probe   Probelauf: ändert nichts, schreibt die Vorschau nach vorschau.csv
#   .\sync-3e.ps1          Abgleich (für die geplante Aufgabe)
#
# Einstellungen stehen in einstellungen.json im selben Ordner (Vorlage: einstellungen.beispiel.json).
param([switch]$Probe)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $dir 'sync-3e.log'

function Log($text) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $text"
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding UTF8
}

function Text($v) {
  if ($v -is [DBNull] -or $null -eq $v) { return '' }
  return ([string]$v).Trim()
}

try {
  $cfg = Get-Content (Join-Path $dir 'einstellungen.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $query = Get-Content (Join-Path $dir $cfg.KundenAbfrage) -Raw -Encoding UTF8

  # --- 3E lesen ---
  $conn = New-Object System.Data.SqlClient.SqlConnection $cfg.Datenbank
  $conn.Open()
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = $query
  $cmd.CommandTimeout = 120
  $table = New-Object System.Data.DataTable
  $table.Load($cmd.ExecuteReader())
  $conn.Close()

  $fields = 'ext_id', 'customer_number', 'name', 'name2', 'street', 'house_no', 'zip', 'city', 'country', 'phone', 'mobile', 'email', 'website', 'origin', 'active', 'customer_group'
  $rows = foreach ($r in $table.Rows) {
    $o = [ordered]@{}
    foreach ($f in $fields) {
      if ($table.Columns.Contains($f)) { $o[$f] = Text $r[$f] }
    }
    # "Musterstraße 12a" in Straße und Hausnummer trennen, wenn 3E beides in einem Feld hat
    if ($o.Contains('street') -and -not $o['house_no'] -and $o['street'] -match '^(.*\D)\s+(\d+\s*[a-zA-Z]?(\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$') {
      $o['street'] = $Matches[1].Trim()
      $o['house_no'] = $Matches[2].Trim()
    }
    [pscustomobject]$o
  }
  Log "$($table.Rows.Count) Kunden aus 3E gelesen"

  # --- an die App schicken (in Paketen) ---
  $url = $cfg.SupabaseUrl.TrimEnd('/') + '/functions/v1/sync-3e'
  $headers = @{ 'x-sync-key' = $cfg.SyncSchluessel }
  $sum = @{ neu = 0; verknuepft = 0; aktualisiert = 0; unveraendert = 0; uebersprungen = 0 }
  $preview = @()
  $errors = @()
  $size = 500
  for ($i = 0; $i -lt @($rows).Count; $i += $size) {
    $part = @($rows)[$i..([Math]::Min($i + $size, @($rows).Count) - 1)]
    $json = @{ customers = $part; dry_run = [bool]$Probe } | ConvertTo-Json -Depth 4 -Compress
    $res = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -ContentType 'application/json; charset=utf-8' `
      -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 300
    foreach ($k in @($sum.Keys)) { $sum[$k] += [int]$res.$k }
    $preview += $res.vorschau
    $errors += $res.fehler
  }

  $mode = if ($Probe) { 'Probelauf (nichts geändert)' } else { 'Abgleich' }
  Log "$mode`: neu $($sum.neu), verknüpft $($sum.verknuepft), aktualisiert $($sum.aktualisiert), unverändert $($sum.unveraendert), übersprungen $($sum.uebersprungen)"
  foreach ($e in $errors) { Log "  Fehler: $($e | ConvertTo-Json -Compress -Depth 4)" }
  if ($Probe) {
    $csv = Join-Path $dir 'vorschau.csv'
    $preview | Export-Csv -Path $csv -NoTypeInformation -Delimiter ';' -Encoding UTF8
    Log "Vorschau gespeichert: $csv"
  }
}
catch {
  Log "FEHLER: $($_.Exception.Message)"
  exit 1
}
