# =====================================================================
#  refresh.ps1 — Met à jour casse-noisette.aynn.fr depuis ta Google My Map
#  Lance-le après avoir modifié la carte (ajout/suppression de panneaux) :
#      pwsh C:\Users\El Daron\collage-itineraires\refresh.ps1
# =====================================================================
$ErrorActionPreference = "Stop"
$mid  = "1RQF8jQgwfrAmCjlpRn4N_zUY-3LiDzc"
$dir  = "C:\Users\El Daron\collage-itineraires"
$key  = "$env:USERPROFILE\.ssh\id_ed25519"
$host_= "root@192.168.1.122"
$inventoryLayer = "Panneaux d'affichage libre"   # calque exclu des boutons

Write-Host "1/4  Téléchargement du KML..." -ForegroundColor Cyan
Invoke-WebRequest -Uri "https://www.google.com/maps/d/kml?mid=$mid&forcekml=1" `
  -OutFile "$dir\source.kml" -UseBasicParsing

Write-Host "2/4  Extraction des itinéraires..." -ForegroundColor Cyan
[xml]$kml = Get-Content "$dir\source.kml" -Raw
$ns = New-Object System.Xml.XmlNamespaceManager($kml.NameTable)
$ns.AddNamespace("k","http://www.opengis.net/kml/2.2")
$all = @()
foreach($f in $kml.SelectNodes("//k:Folder",$ns)){
  $fname = ($f.SelectSingleNode("k:name",$ns)).InnerText.Trim()
  $pts = @()
  foreach($pm in $f.SelectNodes("k:Placemark[k:Point]",$ns)){
    $nm = $pm.SelectSingleNode("k:name",$ns)
    $nameTxt = if($nm){ $nm.InnerText.Trim() } else { "" }
    $p = ($pm.SelectSingleNode("k:Point/k:coordinates",$ns)).InnerText.Trim().Split(",")
    $pts += [pscustomobject]@{ name=$nameTxt; latlng="$($p[1].Trim()),$($p[0].Trim())" }
  }
  $all += [pscustomobject]@{ itineraire=$fname; nbPoints=$pts.Count; points=$pts }
}
$all | ConvertTo-Json -Depth 6 | Out-File "$dir\data.json" -Encoding utf8

$itins = $all | Where-Object { $_.itineraire -ne $inventoryLayer } | ForEach-Object {
  [pscustomobject]@{ itineraire=$_.itineraire
    points=@($_.points | ForEach-Object { [pscustomobject]@{ name=$_.name; latlng=$_.latlng } }) }
}
$json = $itins | ConvertTo-Json -Depth 6 -Compress
Write-Host ("     {0} itinéraires, {1} panneaux" -f $itins.Count, ($itins.points.Count | Measure-Object -Sum).Sum)

Write-Host "3/4  Injection dans index.html..." -ForegroundColor Cyan
$html = Get-Content "$dir\index.html" -Raw
$html = $html -replace '(?s)const ITINERAIRES = .*?;', "const ITINERAIRES = $json;"
$html | Out-File "$dir\index.html" -Encoding utf8 -NoNewline

Write-Host "4/4  Envoi sur le homelab..." -ForegroundColor Cyan
scp -i $key "$dir\index.html" "${host_}:/opt/casse-noisette/site/index.html"
scp -i $key "$dir\data.json"  "${host_}:/opt/casse-noisette/data.json"
scp -i $key "$dir\source.kml" "${host_}:/opt/casse-noisette/source.kml"

Write-Host "`nOK -> https://casse-noisette.aynn.fr" -ForegroundColor Green
