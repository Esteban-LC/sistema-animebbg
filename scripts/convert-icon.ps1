
try {
    Add-Type -AssemblyName System.Drawing
} catch {
    Write-Host "System.Drawing not found, trying generic load"
}

$source = "public\app.ico"
$dest192 = "public\icon-192x192.png"
$dest512 = "public\icon-512x512.png"

try {
    Write-Host "Loading $source..."
    $img = [System.Drawing.Image]::FromFile($source)
    
    Write-Host "Saving to $dest192..."
    $img.Save($dest192, [System.Drawing.Imaging.ImageFormat]::Png)
    
    Write-Host "Saving to $dest512..."
    $img.Save($dest512, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $img.Dispose()
    Write-Host "Done!"
} catch {
    Write-Error "Conversion failed: $_"
    exit 1
}
