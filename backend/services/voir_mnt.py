import rasterio
import matplotlib.pyplot as plt

# 1. Remplace par le nom de ton fichier téléchargé
fichier_tif = "mnt_final.tif" 

print(f"📂 Ouverture du fichier {fichier_tif}...")

# 2. Ouverture avec Rasterio
with rasterio.open(fichier_tif) as src:
    # On lit la première "bande" (la matrice des altitudes)
    matrice_altitude = src.read(1)
    
    # On récupère les stats pour info
    alt_min = matrice_altitude.min()
    alt_max = matrice_altitude.max()
    print(f"🏔️ Altitude la plus basse : {alt_min} m")
    print(f"⛰️ Altitude la plus haute : {alt_max} m")
    print(f"📏 Taille de la matrice : {matrice_altitude.shape} pixels")

    # 3. Affichage visuel
    plt.figure(figsize=(10, 8))
    
    # cmap='terrain' met du vert en bas, du marron au milieu et du blanc en haut
    img = plt.imshow(matrice_altitude, cmap='terrain') 
    
    # Ajoute une barre d'échelle sur le côté
    plt.colorbar(img, label="Altitude (mètres)")
    
    plt.title(f"Modèle Numérique de Terrain (MNT)\nMin: {alt_min}m | Max: {alt_max}m")
    plt.xlabel("Pixels (X)")
    plt.ylabel("Pixels (Y)")
    
    # Affiche la fenêtre
    plt.show()