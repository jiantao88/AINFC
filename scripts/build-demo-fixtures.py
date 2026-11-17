"""Build internal-only fictional race fixtures. PNG screenshots rendered separately with Chrome."""
from pathlib import Path
import json, shutil, xml.etree.ElementTree as ET, zlib, struct, binascii, random
from sanitize_demo_gpx import sanitize
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/demo-fixtures'
for name in ['scores','routes','errors','assets']: (OUT/name).mkdir(parents=True,exist_ok=True)
def write_json(name,value): (OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
hero=ROOT/'docs/demo-assets/xiangzhi/02-山脊奔跑.png'
shutil.copy2(hero,OUT/'assets/02-山脊奔跑.png')
config={'schemaVersion':1,'id':'internal-race-demo-001','name':'西山越野记忆体验赛（虚构演示）','date':'2026-11-15','timezone':'Asia/Shanghai','isPlaceholder':True,'distribution':'internal-only-do-not-publish','groups':[{'id':'demo-open','name':'体验组（演示）'}],'heroImage':'assets/02-山脊奔跑.png','referenceRoute':{'file':'routes/xiangzhi-reference-demo.gpx','kind':'external-placeholder-not-event-course','isOfficialCourse':False,'commercialPermission':'unconfirmed','notice':'香植线仅用于演示，不是本赛事赛道；商用授权未确认，不得对外发布。'},'testLimits':{'imageMaxBytes':20971520,'note':'20 MiB 为测试阈值，不代表已确认产品限制'},'replacementChecklist':['赛事名称和日期','组别','授权主视觉','正式赛道与授权','选手及成绩数据']}
write_json('event.json',config)
people=[('demo-001','林小野','DEMO 021','01:42:36','unclaimed'),('demo-002','陈逐风','DEMO 022','02:08:19','claimed_empty'),('demo-003','许听松','DEMO 023','01:56:48','saved')]
players=[]; answers=[]
for i,(pid,name,bib,duration,status) in enumerate(people,1):
 rank=12 if i==1 else None
 score={'elapsedTime':duration,'groupId':'demo-open','groupName':'体验组（演示）','groupRank':rank,'source':'fictional-fixture-not-official'}
 result={'title':name+'的赛后记忆','text':'这是一份用于检查卡片布局与保存状态的虚构回忆，不代表实际参赛经历。','cover':'assets/02-山脊奔跑.png','score':score,'routeKind':'external-placeholder-not-event-course','isSynthetic':True}
 players.append({'id':pid,'name':name,'bib':bib,'eventId':config['id'],'isFictional':True,'status':status,'ownerId':None if i==1 else 'demo-owner-'+str(i),'materials':{'photos':['assets/02-山脊奔跑.png'] if i==3 else [],'route':'routes/xiangzhi-reference-demo.gpx' if i==3 else None,'scoreImage':f'scores/0{i}.png' if i==3 else None},'score':score if i==3 else None,'draft':None,'job':None,'preview':None,'savedCard':result if i==3 else None})
 answers.append({'playerId':pid,'file':f'scores/0{i}.png','name':name,'bib':bib,'group':'体验组（演示）','elapsedTime':duration,'groupRank':rank,'lowContrast':i==3,'expected':'低对比度：允许识别失败或低置信度，人工更正后须与本答案一致' if i==3 else '识别字段与本答案一致；未出现排名时保持空值'})
 muted='#c9c9c6' if i==3 else '#183d2f'
 html=f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>虚构成绩 {i}</title><style>*{{box-sizing:border-box}}body{{margin:0;width:900px;height:1200px;background:#eeeee8;font-family:"PingFang SC",sans-serif;padding:55px;color:#173c2e}}article{{background:#fffdf6;border:1px solid #d8dfd4;border-radius:24px;padding:55px;height:1090px}}small{{letter-spacing:3px}}h1{{font-size:35px;margin:30px 0 10px}}h2{{font-size:23px;font-weight:400}}.fields{{color:{muted};background:{'#e3e3df' if i==3 else '#f1f4eb'};padding:35px;border-radius:16px;margin-top:45px}}.row{{margin:24px 0;font-size:25px}}b{{display:block;font-size:36px;margin-top:6px}}.time{{font-size:70px;font-variant-numeric:tabular-nums}}footer{{margin-top:50px;border-top:1px solid #d8dfd4;padding-top:25px;font-size:20px;color:#8e583a}}</style><article><small>INTERNAL DEMO / TEST FIXTURE 0{i}</small><h1>西山越野记忆体验赛</h1><h2>模拟成绩单 · 非真实赛事</h2><p>演示日期 2026-11-15</p><div class="fields"><div class="row">选手 / 号码<b>{name} · {bib}</b></div><div class="row">参赛组别<b>体验组（演示）</b></div><div class="row">完赛用时<b class="time">{duration}</b></div>{'<div class="row">组别排名<b>第 12 名</b></div>' if rank else ''}</div><footer>虚构数据 · 仅限内部测试 · 不可作为成绩证明<br>{'低对比度样本：用于验证人工核对与更正' if i==3 else '用于成绩识别、字段核对与卡片生成测试'}</footer></article></html>'''
 (OUT/f'scores/0{i}.html').write_text(html)
write_json('players.json',players);write_json('scores/expected.json',answers)
source=ET.parse(ROOT/'docs/gpx-samples/beijing-xiangzhi-wgs84.gpx').getroot()
root=sanitize(source)
ET.ElementTree(root).write(OUT/'routes/xiangzhi-reference-demo.gpx',encoding='utf-8',xml_declaration=True)
(OUT/'routes/SOURCE.md').write_text('''# 参考路线使用边界

来源：https://chinatrails.app/trail/beijing/xiangzhi/
原文件：https://chinatrails.app/trail-assets/beijing/xiangzhi/xiangzhi_wgs84.gpx
本地原件：docs/gpx-samples/beijing-xiangzhi-wgs84.gpx
处理：按白名单重建两个派生 GPX。仅保留轨迹分段与 lat/lon 坐标，metadata 仅含根据坐标重算的 bounds；全部 extensions、原作者、轨迹名称、起终点名称、链接与其他源属性/文本均不复制，creator 替换为固定演示标识。
参考路线不保留海拔；errors/no-timestamps.gpx 仅额外保留数值海拔，用于单独测试缺少时间。
两个文件都不含 time、BeginTime、EndTime、TimeUsed、speed、Distance、CreaterName、OriginCreaterName、PosStartName、PosEndName；距离若需要应按坐标计算，不使用原始汇总值。
原始 GPX 未修改，仍含原始信息，不属于已清理的演示数据，禁止随测试包分发。保留的真实坐标仍能推断实际起终点，本处理不是地理匿名化。
仅用于轨迹解析与路线展示演示，不能冒充任何赛事赛道，不能据此计算选手真实用时、配速或爬升。
商用授权未确认，不得对外发布、放入生产 public 目录或对外演示分发包。该限制适用于包含此文件的整个内部测试包。
''')
(OUT/'errors/broken-xml.gpx').write_text('<gpx><trk><trkseg><trkpt lat="40" lon="116"></gpx>')
(OUT/'errors/no-track-points.gpx').write_text('<?xml version="1.0"?><gpx version="1.1" creator="demo" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg/></trk></gpx>')
# No timestamps is a VALID GPX; preserve elevations to isolate the missing-time case.
no_time=sanitize(source, keep_elevation=True)
ET.ElementTree(no_time).write(OUT/'errors/no-timestamps.gpx',encoding='utf-8',xml_declaration=True)
(OUT/'errors/not-gpx.txt').write_text('This is plain text, not a GPX file. Internal test only.\n')
(OUT/'errors/disguised-not-gpx.gpx').write_text('<html><body>Not GPX despite extension</body></html>')
# Valid RGB PNG over the suggested 20 MiB limit, not invalid bytes renamed .png.
png=OUT/'errors/oversized-27mb.png'
if not png.exists():
 rng=random.Random(20261117);w=h=3072
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',binascii.crc32(kind+data)&0xffffffff)
 compressor=zlib.compressobj(1);parts=[]
 for _ in range(h):parts.append(compressor.compress(b'\x00'+rng.randbytes(w*3)))
 parts.append(compressor.flush())
 png.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',b''.join(parts))+chunk(b'IEND',b''))
write_json('errors/expected.json',[
 {'file':'broken-xml.gpx','expected':'拒绝：XML 解析失败'},
 {'file':'no-track-points.gpx','expected':'拒绝：无可用轨迹点'},
 {'file':'no-timestamps.gpx','expected':'接受路线展示；缺少时间，不计算时长或配速；不能误判为坏文件'},
 {'file':'not-gpx.txt','expected':'拒绝：文件类型不支持'},
 {'file':'disguised-not-gpx.gpx','expected':'拒绝：XML 根元素不是 gpx'},
 {'file':'oversized-27mb.png','bytes':png.stat().st_size,'expected':'测试阈值20 MiB时拒绝；显示大小提示且保留其他素材'}])
print('Generated',OUT)
