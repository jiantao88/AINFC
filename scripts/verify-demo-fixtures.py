from pathlib import Path
import json,xml.etree.ElementTree as ET,struct,zlib,binascii
from sanitize_demo_gpx import sanitize, NS, CREATOR
root=Path(__file__).resolve().parents[1];d=root/'docs/demo-fixtures'
def png(path):
 data=path.read_bytes(); assert data[:8]==b'\x89PNG\r\n\x1a\n'
 pos=8;compressed=[];size=None
 while pos<len(data):
  length=struct.unpack('>I',data[pos:pos+4])[0];kind=data[pos+4:pos+8];chunk=data[pos+8:pos+8+length];crc=struct.unpack('>I',data[pos+8+length:pos+12+length])[0]
  assert binascii.crc32(kind+chunk)&0xffffffff==crc
  if kind==b'IHDR':size=struct.unpack('>II',chunk[:8])
  if kind==b'IDAT':compressed.append(chunk)
  pos+=12+length
 assert zlib.decompress(b''.join(compressed))
 return size
for i in range(1,4):assert png(d/f'scores/0{i}.png')==(900,1200)
assert png(d/'errors/oversized-27mb.png')==(3072,3072)
assert (d/'errors/oversized-27mb.png').stat().st_size>20*1024*1024
reference=ET.parse(d/'routes/xiangzhi-reference-demo.gpx').getroot()
original=ET.parse(root/'docs/gpx-samples/beijing-xiangzhi-wgs84.gpx').getroot()
FORBIDDEN = ('time', 'BeginTime', 'EndTime', 'TimeUsed', 'speed', 'Distance',
             'CreaterName', 'OriginCreaterName', 'PosStartName', 'PosEndName',
             'extensions', 'author')

def check_clean(tree, keep_elevation):
    allowed = {'gpx': {'version', 'creator'}, 'metadata': set(),
               'bounds': {'minlat', 'maxlat', 'minlon', 'maxlon'},
               'trk': set(), 'trkseg': set(), 'trkpt': {'lat', 'lon'}}
    children = {'gpx': {'metadata', 'trk'}, 'metadata': {'bounds'},
                'bounds': set(), 'trk': {'trkseg'}, 'trkseg': {'trkpt'},
                'trkpt': {'ele'} if keep_elevation else set(), 'ele': set()}
    if keep_elevation: allowed['ele'] = set()
    assert tree.attrib == {'version': '1.1', 'creator': CREATOR}
    for node in tree.iter():
        tag = node.tag.split('}')[-1]
        assert node.tag.startswith('{'+NS+'}') and tag in allowed, tag
        assert set(node.attrib) == allowed[tag], (tag, 'unexpected attributes')
        assert all(c.tag.split('}')[-1] in children[tag] for c in node), tag
        assert not (node.tail or '').strip()
        if tag == 'ele': float(node.text)
        else: assert not (node.text or '').strip(), (tag, 'unexpected text')
    # Whole serialized file check also catches forbidden names hidden in attributes/text.
    serialized = ET.tostring(tree, encoding='unicode').casefold()
    for field in FORBIDDEN: assert field.casefold() not in serialized, field
    assert len(tree.findall('./{*}metadata')) <= 1
    for metadata in tree.findall('./{*}metadata'):
        assert len(metadata) == 1 and metadata[0].tag == '{'+NS+'}bounds'

def coords(tree):
    return [[[(p.attrib['lat'],p.attrib['lon']) for p in seg.findall('./{*}trkpt')]
             for seg in trk.findall('./{*}trkseg')] for trk in tree.findall('./{*}trk')]

no_time=ET.parse(d/'errors/no-timestamps.gpx').getroot()
check_clean(reference, False)
check_clean(no_time, True)
assert len(reference.findall('.//{*}trkpt')) == 489
assert coords(reference) == coords(original) == coords(no_time)
assert [float(p.text) for p in no_time.findall('.//{*}ele')] == [float(p.text) for p in original.findall('.//{*}ele')]
assert original.findall('.//{*}time') and original.findall('.//{*}ele')
# No source metadata values (including usernames and location names) may survive.
source_values = [n.text.strip() for n in original.iter()
                 if n.tag.split('}')[-1] in FORBIDDEN[1:10] and n.text and n.text.strip()]
for tree in (reference, no_time):
    remaining = [(n.text or '').strip() for n in tree.iter()]
    remaining += [v for n in tree.iter() for v in n.attrib.values()]
    assert not set(source_values).intersection(remaining)
# Regression: inject metadata, namespaced extensions, attributes and point speed.
poisoned = ET.fromstring(ET.tostring(original))
meta = ET.SubElement(poisoned, '{'+NS+'}metadata')
for field in FORBIDDEN:
    ET.SubElement(meta, '{urn:fixture-test}'+field).text = 'PRIVATE-SENTINEL'
point=poisoned.find('.//{*}trkpt')
point.set('speed','PRIVATE-SENTINEL')
ET.SubElement(point, '{urn:fixture-test}speed').text='PRIVATE-SENTINEL'
for keep in (False, True):
    cleaned = sanitize(poisoned, keep_elevation=keep)
    check_clean(cleaned, keep)
    assert 'PRIVATE-SENTINEL' not in ET.tostring(cleaned, encoding='unicode')
    assert coords(cleaned) == coords(original)
# Verify the checker really rejects each prohibited field in the generated output.
for field in FORBIDDEN:
    contaminated = ET.fromstring(ET.tostring(reference))
    ET.SubElement(contaminated, '{urn:fixture-test}'+field).text='PRIVATE-SENTINEL'
    try: check_clean(contaminated, False)
    except AssertionError: pass
    else: raise AssertionError('Validator missed forbidden field: '+field)
assert not ET.parse(d/'errors/no-track-points.gpx').getroot().findall('.//{*}trkpt')
try:ET.parse(d/'errors/broken-xml.gpx');raise AssertionError('broken XML unexpectedly parsed')
except ET.ParseError:pass
assert ET.parse(d/'errors/disguised-not-gpx.gpx').getroot().tag!='gpx'
players=json.loads((d/'players.json').read_text());assert [p['status'] for p in players]==['unclaimed','claimed_empty','saved']
config=json.loads((d/'event.json').read_text());assert (d/config['heroImage']).exists()
assert 'data-test-result="PASS"' in Path('/tmp/ainfc-fixture-console-test.html').read_text()
print('PASS: 3 Chrome PNGs, valid oversized PNG, preserved GPX coordinates, strict GPX whitelist and forbidden-field regressions, error fixtures, initial states, Chrome state transitions/reset.')
