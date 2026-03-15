#!/usr/bin/env python3
"""
PIX Recoleccion - Project Converter
====================================
Scans a Hacienda folder structure and generates a consolidated
proyecto_hacienda.json file ready to import into the PIX Recoleccion app.

Expected folder structure:
  base_path/
    RESUMEN_LOTES_MUESTREO_26-27.csv   (optional - lote area info)
    2-2A1/
      PRO/
        puntos_muestreo.kml
        zonas_manejo_*.geojson          (EPSG:32720 UTM zone 20S)
    A-A1/
      PRO/
        puntos_muestreo.kml
        zonas_manejo_*.geojson

Usage:
    python tools/convert_project.py "C:\\path\\to\\Hacienda-Del-Senor\\Lotes para muestreo hacienda Del Senor"
"""

import os
import sys
import json
import csv
import re
import math
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path


# ============================================================
# UTM to WGS84 conversion (EPSG:32720 = UTM Zone 20S)
# Pure-Python implementation -- no external dependencies needed.
# If pyproj is available, it will be used for better accuracy.
# ============================================================

try:
    from pyproj import Transformer
    _transformer = Transformer.from_crs("EPSG:32720", "EPSG:4326", always_xy=True)

    def utm_to_wgs84(easting, northing):
        """Convert EPSG:32720 (UTM 20S) coordinates to WGS84 (lon, lat)."""
        lon, lat = _transformer.transform(easting, northing)
        return lon, lat

    print("[INFO] Usando pyproj para conversion UTM -> WGS84")

except ImportError:
    # Fallback: manual UTM -> WGS84 conversion
    def utm_to_wgs84(easting, northing):
        """
        Convert UTM Zone 20S (EPSG:32720) to WGS84 lat/lon.
        Uses the Karney/Krueger series expansion (accurate to ~1mm).
        """
        # UTM Zone 20S parameters
        zone = 20
        is_southern = True

        # WGS84 ellipsoid
        a = 6378137.0            # semi-major axis
        f = 1 / 298.257223563   # flattening
        b = a * (1 - f)
        e = math.sqrt(2 * f - f * f)
        e2 = e * e
        e_prime2 = e2 / (1 - e2)

        k0 = 0.9996
        x = easting - 500000.0  # remove false easting
        y = northing
        if is_southern:
            y = y - 10000000.0  # remove false northing for southern hemisphere

        lon0 = math.radians((zone - 1) * 6 - 180 + 3)  # central meridian

        M = y / k0
        mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256))

        e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))

        phi1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu)
                + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
                + (151 * e1 ** 3 / 96) * math.sin(6 * mu)
                + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))

        sin_phi1 = math.sin(phi1)
        cos_phi1 = math.cos(phi1)
        tan_phi1 = math.tan(phi1)

        N1 = a / math.sqrt(1 - e2 * sin_phi1 ** 2)
        T1 = tan_phi1 ** 2
        C1 = e_prime2 * cos_phi1 ** 2
        R1 = a * (1 - e2) / (1 - e2 * sin_phi1 ** 2) ** 1.5
        D = x / (N1 * k0)

        lat = phi1 - (N1 * tan_phi1 / R1) * (
            D ** 2 / 2
            - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * e_prime2) * D ** 4 / 24
            + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2
               - 252 * e_prime2 - 3 * C1 ** 2) * D ** 6 / 720
        )

        lon = lon0 + (
            D
            - (1 + 2 * T1 + C1) * D ** 3 / 6
            + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2
               + 8 * e_prime2 + 24 * T1 ** 2) * D ** 5 / 120
        ) / cos_phi1

        return math.degrees(lon), math.degrees(lat)

    print("[INFO] pyproj no disponible, usando conversion UTM manual")


# ============================================================
# KML parsing
# ============================================================

def parse_kml(kml_path):
    """
    Parse a KML file and extract Placemarks with name and coordinates.
    Returns a list of dicts: { name, lon, lat }
    """
    tree = ET.parse(kml_path)
    root = tree.getroot()

    # Handle KML namespace
    ns = ''
    if root.tag.startswith('{'):
        ns = root.tag.split('}')[0] + '}'

    placemarks = []
    for pm in root.iter(f'{ns}Placemark'):
        name_el = pm.find(f'{ns}name')
        name = name_el.text.strip() if name_el is not None and name_el.text else ''

        # Try Point coordinates
        point = pm.find(f'.//{ns}Point/{ns}coordinates')
        if point is not None and point.text:
            coords_text = point.text.strip()
            parts = coords_text.split(',')
            if len(parts) >= 2:
                lon = float(parts[0].strip())
                lat = float(parts[1].strip())
                placemarks.append({'name': name, 'lon': lon, 'lat': lat})

    return placemarks


# ============================================================
# GeoJSON parsing with coordinate conversion
# ============================================================

def convert_coords_recursive(coords):
    """
    Recursively convert coordinate arrays from UTM (EPSG:32720)
    to WGS84 (lon, lat). Handles nested arrays for Polygon/MultiPolygon.
    """
    if not coords:
        return coords

    # Check if this is a coordinate pair [easting, northing, ...]
    if isinstance(coords[0], (int, float)):
        easting, northing = coords[0], coords[1]
        lon, lat = utm_to_wgs84(easting, northing)
        result = [round(lon, 8), round(lat, 8)]
        if len(coords) > 2:
            result.append(coords[2])  # preserve altitude if present
        return result

    # Otherwise it's a nested array - recurse
    return [convert_coords_recursive(c) for c in coords]


def parse_zonas_geojson(geojson_path):
    """
    Parse a zonas_manejo GeoJSON file, converting coordinates from
    EPSG:32720 (UTM Zone 20S) to WGS84.
    Returns a GeoJSON FeatureCollection with WGS84 coordinates.
    """
    with open(geojson_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    features = data.get('features', [])
    converted_features = []

    for feat in features:
        geom = feat.get('geometry', {})
        if geom and 'coordinates' in geom:
            new_geom = {
                'type': geom['type'],
                'coordinates': convert_coords_recursive(geom['coordinates'])
            }
            converted_features.append({
                'type': 'Feature',
                'properties': feat.get('properties', {}),
                'geometry': new_geom
            })
        else:
            converted_features.append(feat)

    return {
        'type': 'FeatureCollection',
        'features': converted_features
    }


# ============================================================
# Point name parsing
# ============================================================

def parse_point_info(name):
    """
    Parse point name to extract zone number and type.
    Examples:
      '22A1-Z1-P1' -> zona=1, tipo='principal'
      '22A1-Z1-S1' -> zona=1, tipo='submuestra'
      'Z3-P2'      -> zona=3, tipo='principal'
    """
    zona = None
    tipo = 'principal'

    # Extract zone: look for Z followed by digits
    zona_match = re.search(r'Z(\d+)', name, re.IGNORECASE)
    if zona_match:
        zona = int(zona_match.group(1))

    # Extract type: P = principal, S = submuestra
    if re.search(r'-S\d+', name, re.IGNORECASE) or re.search(r'S\d+$', name, re.IGNORECASE):
        tipo = 'submuestra'
    elif re.search(r'-P\d+', name, re.IGNORECASE) or re.search(r'P\d+$', name, re.IGNORECASE):
        tipo = 'principal'

    return zona, tipo


def extract_lote_name(folder_name):
    """
    Extract the short lote name from the folder name.
    E.g. '2-2A1' -> '2A1', 'A-A1' -> 'A1'
    If there's a dash, take the part after the first dash.
    """
    if '-' in folder_name:
        parts = folder_name.split('-', 1)
        return parts[1]
    return folder_name


# ============================================================
# CSV parsing for area info
# ============================================================

def load_area_csv(csv_path):
    """
    Load RESUMEN_LOTES_MUESTREO CSV to get area_ha per lote.
    Returns a dict mapping lote folder name -> area_ha.
    Tries common column names for matching.
    """
    area_map = {}
    if not os.path.exists(csv_path):
        return area_map

    try:
        # Try different encodings
        for encoding in ['utf-8', 'latin-1', 'cp1252']:
            try:
                with open(csv_path, 'r', encoding=encoding) as f:
                    # Detect delimiter
                    sample = f.read(2048)
                    f.seek(0)
                    delimiter = ','
                    if sample.count(';') > sample.count(','):
                        delimiter = ';'

                    reader = csv.DictReader(f, delimiter=delimiter)
                    headers = [h.strip().lower() for h in (reader.fieldnames or [])]

                    # Find lote column
                    lote_col = None
                    for h in reader.fieldnames or []:
                        hl = h.strip().lower()
                        if hl in ('lote', 'nombre', 'name', 'id', 'campo', 'field'):
                            lote_col = h
                            break
                    if not lote_col and reader.fieldnames:
                        lote_col = reader.fieldnames[0]

                    # Find area column
                    area_col = None
                    for h in reader.fieldnames or []:
                        hl = h.strip().lower()
                        if 'area' in hl or 'ha' in hl or 'superficie' in hl:
                            area_col = h
                            break

                    if lote_col and area_col:
                        for row in reader:
                            lote_name = (row.get(lote_col) or '').strip()
                            area_str = (row.get(area_col) or '').strip().replace(',', '.')
                            if lote_name and area_str:
                                try:
                                    area_map[lote_name] = float(area_str)
                                except ValueError:
                                    pass
                        print(f"[INFO] CSV cargado: {len(area_map)} lotes con area")
                    else:
                        print(f"[WARN] CSV encontrado pero no se pudieron identificar columnas lote/area")
                        print(f"       Columnas: {reader.fieldnames}")

                break  # encoding worked
            except UnicodeDecodeError:
                continue
    except Exception as e:
        print(f"[WARN] Error leyendo CSV: {e}")

    return area_map


# ============================================================
# Main conversion
# ============================================================

def find_matching_area(lote_folder, lote_name, area_map):
    """Try to find area for a lote using various name matching strategies."""
    # Direct match on folder name
    if lote_folder in area_map:
        return area_map[lote_folder]
    # Match on short name
    if lote_name in area_map:
        return area_map[lote_name]
    # Case-insensitive match
    for key, val in area_map.items():
        if key.lower() == lote_folder.lower() or key.lower() == lote_name.lower():
            return val
    # Partial match
    for key, val in area_map.items():
        if lote_name.lower() in key.lower() or key.lower() in lote_name.lower():
            return val
    return None


def convert_project(base_path):
    """
    Main conversion function.
    Scans base_path for lote subfolders, parses KML/GeoJSON files,
    and generates a consolidated proyecto_hacienda.json.
    """
    base_path = Path(base_path)
    if not base_path.exists():
        print(f"[ERROR] Ruta no existe: {base_path}")
        sys.exit(1)

    print(f"[INFO] Escaneando: {base_path}")
    print(f"{'='*60}")

    # Derive project name from path
    project_name = base_path.parent.name.replace('-', ' ').replace('_', ' ')
    client_name = project_name.replace('Hacienda ', '').replace('hacienda ', '')

    # Load area CSV if present
    area_map = {}
    for csv_name in os.listdir(base_path):
        if csv_name.lower().startswith('resumen') and csv_name.lower().endswith('.csv'):
            csv_path = base_path / csv_name
            print(f"[INFO] Encontrado CSV de areas: {csv_name}")
            area_map = load_area_csv(str(csv_path))
            break

    # Scan subfolders for lotes
    lotes = []
    total_points = 0
    skipped = 0

    subdirs = sorted([
        d for d in base_path.iterdir()
        if d.is_dir() and not d.name.startswith('.')
    ])

    print(f"[INFO] Encontrados {len(subdirs)} subdirectorios")
    print()

    for lote_dir in subdirs:
        lote_folder = lote_dir.name
        lote_name = extract_lote_name(lote_folder)
        pro_dir = lote_dir / 'PRO'

        # Check if PRO directory exists
        if not pro_dir.exists():
            # Try lowercase
            pro_dir_alt = lote_dir / 'pro'
            if pro_dir_alt.exists():
                pro_dir = pro_dir_alt
            else:
                print(f"  [{lote_folder}] Sin carpeta PRO - omitido")
                skipped += 1
                continue

        # Look for KML
        kml_path = pro_dir / 'puntos_muestreo.kml'
        if not kml_path.exists():
            # Try other KML files
            kml_files = list(pro_dir.glob('*.kml'))
            if kml_files:
                kml_path = kml_files[0]
            else:
                print(f"  [{lote_folder}] Sin archivo KML - omitido")
                skipped += 1
                continue

        # Parse KML points
        try:
            raw_points = parse_kml(str(kml_path))
        except Exception as e:
            print(f"  [{lote_folder}] Error KML: {e}")
            skipped += 1
            continue

        # Look for GeoJSON zonas files
        zonas_fc = {'type': 'FeatureCollection', 'features': []}
        geojson_files = sorted(pro_dir.glob('zonas_manejo_*.geojson'))
        if not geojson_files:
            # Try broader pattern
            geojson_files = sorted(pro_dir.glob('*.geojson'))

        for gjf in geojson_files:
            try:
                converted = parse_zonas_geojson(str(gjf))
                zonas_fc['features'].extend(converted.get('features', []))
            except Exception as e:
                print(f"  [{lote_folder}] Error GeoJSON {gjf.name}: {e}")

        # Build point entries
        puntos = []
        for pt in raw_points:
            zona, tipo = parse_point_info(pt['name'])
            puntos.append({
                'id': pt['name'],
                'lat': round(pt['lat'], 6),
                'lng': round(pt['lon'], 6),
                'zona': zona,
                'tipo': tipo,
                'status': 'pendiente'
            })

        # Get area
        area = find_matching_area(lote_folder, lote_name, area_map)

        lote_entry = {
            'id': lote_folder,
            'name': lote_name,
            'area_ha': area,
            'zonas': zonas_fc,
            'puntos': puntos
        }

        lotes.append(lote_entry)
        total_points += len(puntos)

        # Progress
        zonas_count = len(zonas_fc['features'])
        area_str = f"{area:.1f} ha" if area else "sin area"
        print(f"  [{lote_folder}] {len(puntos)} puntos, {zonas_count} zonas, {area_str}")

    # Build output
    output = {
        'project': {
            'name': project_name,
            'client': client_name,
            'date': str(date.today()),
            'totalLotes': len(lotes),
            'totalPoints': total_points
        },
        'lotes': lotes
    }

    # Write output file
    output_path = base_path / 'proyecto_hacienda.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # Summary
    print()
    print(f"{'='*60}")
    print(f"RESUMEN")
    print(f"{'='*60}")
    print(f"  Proyecto:      {project_name}")
    print(f"  Cliente:        {client_name}")
    print(f"  Lotes:          {len(lotes)}")
    print(f"  Puntos totales: {total_points}")
    print(f"  Omitidos:       {skipped}")
    print(f"  Zonas totales:  {sum(len(l['zonas']['features']) for l in lotes)}")
    print(f"  Archivo:        {output_path}")
    print(f"{'='*60}")
    print(f"[OK] Archivo generado exitosamente!")

    return output


# ============================================================
# Entry point
# ============================================================

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Uso: python tools/convert_project.py <ruta_carpeta_hacienda>")
        print()
        print("Ejemplo:")
        print('  python tools/convert_project.py "C:\\Users\\Usuario\\Desktop\\PIXADVISOR\\01-CLIENTES-PROYECTOS\\Hacienda-Del-Senor\\Lotes para muestreo hacienda Del Senor"')
        sys.exit(1)

    base_path = sys.argv[1]
    convert_project(base_path)
