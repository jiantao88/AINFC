"""Rebuild minimal GPX; never copy free-form source metadata or extensions."""
import xml.etree.ElementTree as ET

NS = 'http://www.topografix.com/GPX/1/1'
CREATOR = 'AINFC internal demo reference; NOT event course'
ET.register_namespace('', NS)

def sanitize(source, *, keep_elevation=False):
    clean = ET.Element(f'{{{NS}}}gpx', version='1.1', creator=CREATOR)
    points = source.findall('.//{*}trk/{*}trkseg/{*}trkpt')
    if points:
        # Derive bounds from retained points rather than copying source metadata.
        lat = [float(p.attrib['lat']) for p in points]
        lon = [float(p.attrib['lon']) for p in points]
        meta = ET.SubElement(clean, f'{{{NS}}}metadata')
        ET.SubElement(meta, f'{{{NS}}}bounds', {
            'minlat': str(min(lat)), 'maxlat': str(max(lat)),
            'minlon': str(min(lon)), 'maxlon': str(max(lon)),
        })
    for track in source.findall('./{*}trk'):
        target_track = ET.SubElement(clean, f'{{{NS}}}trk')
        for segment in track.findall('./{*}trkseg'):
            target_segment = ET.SubElement(target_track, f'{{{NS}}}trkseg')
            for point in segment.findall('./{*}trkpt'):
                target = ET.SubElement(target_segment, f'{{{NS}}}trkpt',
                                       {k: point.attrib[k] for k in ('lat', 'lon')})
                if keep_elevation:
                    elevation = point.find(f'{{{NS}}}ele')
                    if elevation is not None and elevation.text is not None:
                        # Numeric content only; drop all source attributes and tails.
                        ET.SubElement(target, f'{{{NS}}}ele').text = str(float(elevation.text))
    return clean

if __name__ == '__main__':
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    source = ET.parse(root/'docs/gpx-samples/beijing-xiangzhi-wgs84.gpx').getroot()
    for path, keep in [('routes/xiangzhi-reference-demo.gpx', False),
                       ('errors/no-timestamps.gpx', True)]:
        ET.ElementTree(sanitize(source, keep_elevation=keep)).write(
            root/'docs/demo-fixtures'/path, encoding='utf-8', xml_declaration=True)
