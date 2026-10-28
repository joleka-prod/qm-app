# Abgleich 3E Look -> JOLEKA 360° (nur lesend gegenüber 3E).
# Liest die Kunden (kunden.sql) und danach die Projekte als Bauvorhaben (projekte.sql) und schickt sie an die Edge Function sync-3e.
#
#   .\sync-3e.ps1 -Probe                    Probelauf: ändert nichts, schreibt die Vorschau nach vorschau.csv bzw. vorschau-bauvorhaben.csv
#   .\sync-3e.ps1                           Abgleich (für die geplante Aufgabe)
#   .\sync-3e.ps1 -Nur Bauvorhaben -Probe   nur einen Teil (Kunden oder Bauvorhaben)
#
# Einstellungen stehen in einstellungen.json im selben Ordner (Vorlage: einstellungen.beispiel.json).
param([switch]$Probe, [ValidateSet('', 'Kunden', 'Bauvorhaben')][string]$Nur = '')

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

# Liest eine Abfrage aus 3E und schickt das Ergebnis in Paketen an die App
function Sync($label, $queryFile, $key, $fields, $previewFile) {
  $query = Get-Content (Join-Path $dir $queryFile) -Raw -Encoding UTF8

  # --- 3E lesen ---
  $conn = New-Object System.Data.SqlClient.SqlConnection $cfg.Datenbank
  $conn.Open()
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = $query
  $cmd.CommandTimeout = 120
  $table = New-Object System.Data.DataTable
  $table.Load($cmd.ExecuteReader())
  $conn.Close()

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
  Log "$($table.Rows.Count) $label aus 3E gelesen"

  # --- an die App schicken (in Paketen) ---
  $url = $cfg.SupabaseUrl.TrimEnd('/') + '/functions/v1/sync-3e'
  $headers = @{ 'x-sync-key' = $cfg.SyncSchluessel }
  $sum = [ordered]@{ neu = 0; verknuepft = 0; aktualisiert = 0; unveraendert = 0; uebersprungen = 0; ohne_kunde = 0 }
  $preview = @()
  $errors = @()
  $size = 500
  for ($i = 0; $i -lt @($rows).Count; $i += $size) {
    $part = @($rows)[$i..([Math]::Min($i + $size, @($rows).Count) - 1)]
    $json = @{ $key = $part; dry_run = [bool]$Probe } | ConvertTo-Json -Depth 4 -Compress
    $res = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -ContentType 'application/json; charset=utf-8' `
      -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 300
    foreach ($k in @($sum.Keys)) { $sum[$k] += [int]$res.$k }
    $preview += $res.vorschau
    $errors += $res.fehler
  }

  $mode = if ($Probe) { 'Probelauf (nichts geändert)' } else { 'Abgleich' }
  $extra = if ($key -eq 'projects') { ", ohne Kunde in der App $($sum.ohne_kunde)" } else { '' }
  Log "$mode $label`: neu $($sum.neu), verknüpft $($sum.verknuepft), aktualisiert $($sum.aktualisiert), unverändert $($sum.unveraendert), übersprungen $($sum.uebersprungen)$extra"
  foreach ($e in $errors) { Log "  Fehler: $($e | ConvertTo-Json -Compress -Depth 4)" }
  if ($Probe) {
    $csv = Join-Path $dir $previewFile
    $preview | Export-Csv -Path $csv -NoTypeInformation -Delimiter ';' -Encoding UTF8
    Log "Vorschau gespeichert: $csv"
  }
}

$failed = $false
try {
  $cfg = Get-Content (Join-Path $dir 'einstellungen.json') -Raw -Encoding UTF8 | ConvertFrom-Json
}
catch {
  Log "FEHLER: $($_.Exception.Message)"
  exit 1
}

# Kunden zuerst, damit neue Bauvorhaben ihren Kunden schon vorfinden
if ($Nur -ne 'Bauvorhaben') {
  try {
    Sync 'Kunden' $cfg.KundenAbfrage 'customers' @('ext_id', 'customer_number', 'name', 'name2', 'street', 'house_no', 'zip', 'city', 'country', 'phone', 'mobile', 'email', 'website', 'origin', 'active', 'customer_group') 'vorschau.csv'
  }
  catch {
    Log "FEHLER Kunden: $($_.Exception.Message)"
    $failed = $true
  }
}

# Bauvorhaben: Abfrage aus den Einstellungen (ProjektAbfrage), sonst projekte.sql, wenn vorhanden
$projectQuery = if ($cfg.ProjektAbfrage) { $cfg.ProjektAbfrage } else { 'projekte.sql' }
if ($Nur -ne 'Kunden' -and (Test-Path (Join-Path $dir $projectQuery))) {
  try {
    Sync 'Bauvorhaben' $projectQuery 'projects' @('ext_id', 'project_number', 'name', 'customer_ext_id', 'status') 'vorschau-bauvorhaben.csv'
  }
  catch {
    Log "FEHLER Bauvorhaben: $($_.Exception.Message)"
    $failed = $true
  }
}

if ($failed) { exit 1 }
