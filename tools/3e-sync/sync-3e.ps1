# Abgleich 3E Look -> JOLEKA 360° (nur lesend gegenüber 3E).
# Liest die Kunden (kunden.sql), danach die Projekte als Bauvorhaben (projekte.sql), die Aufträge (auftraege.sql)
# und die Angebote (angebote.sql), dazu die alte Auftragsverwaltung 2011–2021 (alte-auftraege.sql, alte-angebote.sql)
# und schickt sie an die Edge Function sync-3e.
#
#   .\sync-3e.ps1 -Probe                    Probelauf: ändert nichts, schreibt die Vorschau nach vorschau.csv, vorschau-bauvorhaben.csv, vorschau-auftraege.csv, vorschau-angebote.csv
#   .\sync-3e.ps1                           Abgleich (für die geplante Aufgabe)
#   .\sync-3e.ps1 -Nur Bauvorhaben -Probe   nur einen Teil (Kunden, Bauvorhaben, Auftraege, Angebote, AlteAuftraege oder AlteAngebote)
#
# Einstellungen stehen in einstellungen.json im selben Ordner (Vorlage: einstellungen.beispiel.json).
param([switch]$Probe, [ValidateSet('', 'Kunden', 'Bauvorhaben', 'Auftraege', 'Angebote', 'AlteAuftraege', 'AlteAngebote')][string]$Nur = '')

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
  $sum = [ordered]@{ neu = 0; verknuepft = 0; aktualisiert = 0; unveraendert = 0; uebersprungen = 0; ohne_kunde = 0; ohne_bauvorhaben = 0; bauvorhaben_neu = 0 }
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
  $extra = if ($key -eq 'projects') { ", ohne Kunde in der App $($sum.ohne_kunde)" }
    elseif ($key -eq 'orders' -or $key -eq 'offers') { ", ohne Kunde in der App $($sum.ohne_kunde), ohne Bauvorhaben in der App $($sum.ohne_bauvorhaben), neue Bauvorhaben $($sum.bauvorhaben_neu)" }
    else { '' }
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
if ($Nur -eq '' -or $Nur -eq 'Kunden') {
  try {
    Sync 'Kunden' $cfg.KundenAbfrage 'customers' @('ext_id', 'customer_number', 'name', 'name2', 'street', 'house_no', 'zip', 'city', 'country', 'phone', 'mobile', 'email', 'website', 'origin', 'active', 'customer_group') 'vorschau.csv'
  }
  catch {
    Log "FEHLER Kunden: $($_.Exception.Message)"
    $failed = $true
  }
}

# Bauvorhaben vor den Aufträgen, damit neue Aufträge ihr Bauvorhaben schon vorfinden.
# Bauvorhaben: Abfrage aus den Einstellungen (ProjektAbfrage), sonst projekte.sql, wenn vorhanden
$projectQuery = if ($cfg.ProjektAbfrage) { $cfg.ProjektAbfrage } else { 'projekte.sql' }
if (($Nur -eq '' -or $Nur -eq 'Bauvorhaben') -and (Test-Path (Join-Path $dir $projectQuery))) {
  try {
    Sync 'Bauvorhaben' $projectQuery 'projects' @('ext_id', 'project_number', 'name', 'customer_ext_id', 'status') 'vorschau-bauvorhaben.csv'
  }
  catch {
    Log "FEHLER Bauvorhaben: $($_.Exception.Message)"
    $failed = $true
  }
}

# Aufträge: Abfrage aus den Einstellungen (AuftragAbfrage), sonst auftraege.sql, wenn vorhanden.
$orderQuery = if ($cfg.AuftragAbfrage) { $cfg.AuftragAbfrage } else { 'auftraege.sql' }
if (($Nur -eq '' -or $Nur -eq 'Auftraege') -and (Test-Path (Join-Path $dir $orderQuery))) {
  try {
    Sync 'Aufträge' $orderQuery 'orders' @('ext_id', 'number', 'extension', 'kind', 'title', 'doc_date', 'delivery_date', 'status', 'amount_net', 'notes', 'customer_ext_id', 'project_ext_id', 'vertreter1', 'aufmesser') 'vorschau-auftraege.csv'
  }
  catch {
    Log "FEHLER Aufträge: $($_.Exception.Message)"
    $failed = $true
  }
}

# Angebote: Abfrage aus den Einstellungen (AngebotAbfrage), sonst angebote.sql, wenn vorhanden.
$offerQuery = if ($cfg.AngebotAbfrage) { $cfg.AngebotAbfrage } else { 'angebote.sql' }
if (($Nur -eq '' -or $Nur -eq 'Angebote') -and (Test-Path (Join-Path $dir $offerQuery))) {
  try {
    Sync 'Angebote' $offerQuery 'offers' @('ext_id', 'number', 'extension', 'kind', 'title', 'doc_date', 'delivery_date', 'status', 'amount_net', 'notes', 'customer_ext_id', 'project_ext_id', 'vertreter1', 'aufmesser') 'vorschau-angebote.csv'
  }
  catch {
    Log "FEHLER Angebote: $($_.Exception.Message)"
    $failed = $true
  }
}

# Alte Auftragsverwaltung (2011 bis ca. 2021, JOLEKA_LIVE_BWG): nur wenn die Dateien im Ordner liegen
$docFields = @('ext_id', 'number', 'extension', 'kind', 'title', 'doc_date', 'delivery_date', 'status', 'amount_net', 'notes', 'customer_ext_id', 'project_ext_id')
foreach ($old in @(@('AlteAuftraege', 'alte Aufträge', 'alte-auftraege.sql', 'orders', 'vorschau-alte-auftraege.csv'),
                   @('AlteAngebote', 'alte Angebote', 'alte-angebote.sql', 'offers', 'vorschau-alte-angebote.csv'))) {
  if (($Nur -eq '' -or $Nur -eq $old[0]) -and (Test-Path (Join-Path $dir $old[2]))) {
    try {
      Sync $old[1] $old[2] $old[3] ($docFields + @('site_key', 'site_name', 'site_street', 'site_zip', 'site_city', 'site_country')) $old[4]
    }
    catch {
      Log "FEHLER $($old[1]): $($_.Exception.Message)"
      $failed = $true
    }
  }
}

if ($failed) { exit 1 }
