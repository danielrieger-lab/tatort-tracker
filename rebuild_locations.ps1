$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\danie\TatortTracker'

function Clean-WikiText([string]$value) {
  if ($null -eq $value) { return '' }
  $text = [string]$value
  $text = [regex]::Replace($text, '<ref[^>]*>.*?</ref>', '', [System.Text.RegularExpressions.RegexOptions]::Singleline -bor [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  $text = [regex]::Replace($text, '<ref[^/>]*/>', '', [System.Text.RegularExpressions.RegexOptions]::Singleline -bor [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  $text = [regex]::Replace($text, '\[\[([^\]|]+)\|([^\]]+)\]\]', '$2')
  $text = [regex]::Replace($text, '\[\[([^\]]+)\]\]', '$1')
  $text = [regex]::Replace($text, '\{\{DatumZelle\|([^}]+)\}\}', '$1')
  $text = [regex]::Replace($text, '\{\{Anker\|[^}]+\}\}', '')
  $text = [regex]::Replace($text, '\{\{[^{}]*\}\}', '')
  $text = [regex]::Replace($text, '<[^>]+>', '')
  $text = $text -replace '&nbsp;', ' '
  $text = [regex]::Replace($text, '\s+', ' ').Trim()
  return $text.Trim(' ', ',', ';')
}

function Normalize-Ermittler([string]$value) {
  $text = Clean-WikiText $value
  $text = [regex]::Replace($text, '\s*\([^)]*\)', '')
  $text = [regex]::Replace($text, '\s+', ' ').Trim(' ', ',', ';')
  return $text
}

function Extract-WikiLinks([string]$value) {
  $links = New-Object System.Collections.Generic.List[string]
  foreach ($m in [regex]::Matches([string]$value, '\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]')) {
    $link = Clean-WikiText $m.Groups[1].Value
    if (-not [string]::IsNullOrWhiteSpace($link)) {
      $links.Add($link)
    }
  }
  return $links | Select-Object -Unique
}

function Get-WikiRaw([string]$title) {
  $encoded = [System.Uri]::EscapeDataString($title)
  $url = "https://de.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&format=json&formatversion=2&origin=*&titles=$encoded"
  $resp = Invoke-RestMethod -Uri $url -Method Get
  $page = $resp.query.pages[0]
  if ($null -eq $page -or $null -eq $page.revisions -or $page.revisions.Count -eq 0) { return '' }
  return [string]$page.revisions[0].content
}

function Parse-EpisodeRows([string]$raw) {
  $rows = New-Object System.Collections.Generic.List[object]
  $lines = $raw -split "`r?`n"
  $inTable = $false
  $cells = New-Object System.Collections.Generic.List[string]
  $currentCellIndex = -1

  $pushRow = {
    if ($cells.Count -lt 5) { return }
    $noRaw = Clean-WikiText $cells[0]
    if ($noRaw -notmatch '^\d+$') { return }
    $titleRaw = [string]$cells[1]
    $titleRaw = [regex]::Replace($titleRaw, '<br\s*/?>(.|\n|\r)*$', '', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $title = Clean-WikiText $titleRaw
    if ([string]::IsNullOrWhiteSpace($title)) { return }
    $ermRaw = [string]$cells[4]
    $rows.Add([pscustomobject]@{
      no = [int]$noRaw
      title = $title
      sender = (Clean-WikiText $cells[2])
      date = (Clean-WikiText $cells[3])
      ermittler = (Normalize-Ermittler $ermRaw)
      ermittlerLinks = @(Extract-WikiLinks $ermRaw)
      titleLinks = @(Extract-WikiLinks $cells[1])
    })
  }

  foreach ($line in $lines) {
    if ($line -match '^\{\|') {
      $inTable = $true
      $cells.Clear()
      $currentCellIndex = -1
      continue
    }
    if (-not $inTable) { continue }

    if ($line -match '^\|-') {
      & $pushRow
      $cells.Clear()
      $currentCellIndex = -1
      continue
    }

    if ($line -match '^\|\}') {
      & $pushRow
      $inTable = $false
      $cells.Clear()
      $currentCellIndex = -1
      continue
    }

    if ($line -match '^!') { continue }

    $cellMatch = [regex]::Match($line, '^\|\s*(.*)$')
    if ($cellMatch.Success) {
      $chunks = $cellMatch.Groups[1].Value -split '\|\|'
      foreach ($chunk in $chunks) { $cells.Add($chunk.Trim()) }
      $currentCellIndex = $cells.Count - 1
      continue
    }

    if ($currentCellIndex -ge 0 -and -not [string]::IsNullOrWhiteSpace($line)) {
      $cells[$currentCellIndex] = "$($cells[$currentCellIndex]) $($line.Trim())"
    }
  }

  return $rows
}

function Extract-LocationFromWiki([string]$raw) {
  $patterns = @(
    '(?im)^\|\s*Ort\s*=\s*([^\n|}]+)',
    '(?im)^\|\s*Orte\s*=\s*([^\n|}]+)',
    '(?im)^\|\s*Dienstort\s*=\s*([^\n|}]+)',
    '(?im)^\|\s*Dienstorte\s*=\s*([^\n|}]+)',
    '(?im)^\|\s*Wohnort\s*=\s*([^\n|}]+)',
    '(?im)^\|\s*Wirkungsort\s*=\s*([^\n|}]+)',
    '(?im)^\|\s*Einsatzort\s*=\s*([^\n|}]+)',
    '(?im)^\|\s*Region\s*=\s*([^\n|}]+)',
    '(?im)^\|\s*Standort\s*=\s*([^\n|}]+)'
  )

  foreach ($pattern in $patterns) {
    $match = [regex]::Match($raw, $pattern)
    if ($match.Success) {
      $value = Clean-WikiText $match.Groups[1].Value
      $value = [regex]::Replace($value, '\s*\([^)]*\)', '')
      $value = [regex]::Replace($value, '\s+', ' ').Trim()
      if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
    }
  }

  $text = Clean-WikiText $raw
  $introPatterns = @(
    'ermittelt\s+in\s+([^.,;]+?)(?:\s+und\s+|\.|,|;|\)|$)',
    'Dienstort\s+([^.,;]+?)(?:\.|,|;|\)|$)',
    'Region\s+([^.,;]+?)(?:\.|,|;|\)|$)',
    'sitzt\s+in\s+([^.,;]+?)(?:\.|,|;|\)|$)'
  )

  foreach ($pattern in $introPatterns) {
    $match = [regex]::Match($text, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($match.Success) {
      $value = Clean-WikiText $match.Groups[1].Value
      $value = [regex]::Replace($value, '\s*\([^)]*\)', '')
      $value = [regex]::Replace($value, '\s+', ' ').Trim()
      if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
    }
  }

  return ''
}

$listRaw = Get-WikiRaw 'Liste_der_Tatort-Folgen'
if ([string]::IsNullOrWhiteSpace($listRaw)) { throw 'Liste der Tatort-Folgen konnte nicht geladen werden.' }
$rows = Parse-EpisodeRows $listRaw
if ($rows.Count -eq 0) { throw 'Keine Episoden aus der Liste geparst.' }

$episodesPath = 'data/tatort-episodes.json'
$episodes = Get-Content -Raw $episodesPath | ConvertFrom-Json

$byNo = @{}
foreach ($row in $rows) {
  $byNo[[int]$row.no] = $row
}

$linkToLocation = @{}
$uniqueLinks = $rows | ForEach-Object { @($_.ermittlerLinks) + @($_.titleLinks) } | Where-Object { $_ } | Select-Object -Unique

foreach ($link in $uniqueLinks) {
  try {
    $raw = Get-WikiRaw $link
    $loc = ''
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
      $loc = Extract-LocationFromWiki $raw
    }
    $linkToLocation[$link] = $loc
  } catch {
    $linkToLocation[$link] = ''
  }
}

foreach ($episode in $episodes) {
  $episode.ermittler = ''
  $episode.location = ''
  $row = $byNo[[int]$episode.no]
  if ($null -ne $row) {
    $episode.ermittler = [string]$row.ermittler
    $resolved = ''
    foreach ($link in @($row.ermittlerLinks) + @($row.titleLinks)) {
      if ($linkToLocation.ContainsKey($link) -and -not [string]::IsNullOrWhiteSpace($linkToLocation[$link])) {
        $resolved = $linkToLocation[$link]
        break
      }
    }
    $episode.location = $resolved
  }
}

$locationByErmittler = @{}
foreach ($episode in $episodes) {
  $ermKey = Normalize-Ermittler $episode.ermittler
  if (-not [string]::IsNullOrWhiteSpace($ermKey) -and -not [string]::IsNullOrWhiteSpace($episode.location) -and -not $locationByErmittler.ContainsKey($ermKey)) {
    $locationByErmittler[$ermKey] = $episode.location
  }
}

foreach ($episode in $episodes) {
  if (-not [string]::IsNullOrWhiteSpace($episode.location)) { continue }
  $ermKey = Normalize-Ermittler $episode.ermittler
  if ($locationByErmittler.ContainsKey($ermKey)) {
    $episode.location = $locationByErmittler[$ermKey]
  }
}

$episodes | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $episodesPath
"Rows parsed: $($rows.Count)"
"Unique Ermittler links: $($uniqueLinks.Count)"
"Episodes updated: $($episodes.Count)"
"Filled locations: $(($episodes | Where-Object { -not [string]::IsNullOrWhiteSpace($_.location) }).Count)"
