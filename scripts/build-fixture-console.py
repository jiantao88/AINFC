from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]/'docs/demo-fixtures'
players=(root/'players.json').read_text();event=(root/'event.json').read_text()
html='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>赛事测试数据控制台（内部）</title><style>body{font:16px/1.7 -apple-system,"PingFang SC",sans-serif;background:#f4f3ed;color:#243d2d;max-width:1100px;margin:40px auto;padding:0 24px}h1{margin-bottom:8px}.notice{background:#fff0d8;padding:16px;border-radius:12px}button,select,a{font:inherit}button{padding:10px 18px;margin:5px;border:1px solid #bcc8b6;border-radius:8px;cursor:pointer;background:#fff}button.primary{background:#2d5039;color:white}section{background:white;border:1px solid #dadfd4;border-radius:12px;padding:22px;margin:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf1e7;padding:18px;border-radius:10px;font-size:13px}.row{display:flex;gap:15px;flex-wrap:wrap}img{width:160px;border-radius:8px}a{color:#356244}#message{font-weight:600}select{padding:10px;max-width:100%}</style><h1>赛事测试数据控制台</h1><p>虚构赛事 · 内部数据准备工具 · 未接入正式应用或真实 Agent</p><p class="notice">参考 GPX 不是赛事赛道，商用授权未确认，整个包不得对外发布。此处的状态只存于本浏览器，不代表真实用户登录、后台任务或正式保存。</p><section><h2>三名虚构选手</h2><select id="player"></select><p id="message" aria-live="polite"></p><div><button data-state="draft">一键造：草稿</button><button data-state="generating">一键造：生成中</button><button data-state="pending_confirmation">一键造：待确认</button></div><button id="reset">重置全部为初始状态</button><button id="export" class="primary">导出当前选手状态 JSON</button><p>初始：林小野未认领；陈逐风已认领无素材；许听松已保存。快捷造状态会为所选虚构选手补齐模拟认领与素材，不启动网络任务。</p><pre id="state"></pre></section><section><h2>成绩截图</h2><div class="row"><a href="scores/01.png"><img src="scores/01.png" alt="含排名成绩">01 含排名</a><a href="scores/02.png"><img src="scores/02.png" alt="标准成绩">02 标准</a><a href="scores/03.png"><img src="scores/03.png" alt="低对比度成绩">03 低对比度</a></div><p><a href="scores/expected.json">人工核对标准答案</a> · <a href="event.json">赛事配置</a> · <a href="players.json">初始选手数据</a> · <a href="routes/xiangzhi-reference-demo.gpx">内部占位路线</a></p></section><section><h2>异常与边界文件</h2><ul><li><a href="errors/broken-xml.gpx">坏 XML</a></li><li><a href="errors/no-track-points.gpx">无轨迹点</a></li><li><a href="errors/no-timestamps.gpx">无时间戳（有效 GPX，应该降级展示而非拒绝）</a></li><li><a href="errors/not-gpx.txt">非 GPX 文本</a> / <a href="errors/disguised-not-gpx.gpx">伪装成 GPX 的 HTML</a></li><li><a href="errors/oversized-27mb.png">超大有效 PNG（约27 MiB）</a></li></ul><a href="errors/expected.json">预期行为说明</a></section><script>
const INITIAL=__PLAYERS__;
const EVENT=__EVENT__;
const KEY='ainfc:internal-race-fixtures:v1';
const clone=x=>JSON.parse(JSON.stringify(x));
let storageWarning='';
function persist(){try{localStorage.setItem(KEY,JSON.stringify(players))}catch{storageWarning='（本环境无法持久化，可导出 JSON）'}}
let players=clone(INITIAL);
try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(Array.isArray(saved)&&saved.length===3&&INITIAL.every((p,i)=>saved[i]?.id===p.id))players=saved}catch{}
const picker=document.querySelector('#player');
for(const p of INITIAL){const o=document.createElement('option');o.value=p.id;o.textContent=p.name+' / '+p.bib;picker.append(o)}
function render(){const p=players.find(p=>p.id===picker.value);document.querySelector('#state').textContent=JSON.stringify(p,null,2);document.querySelector('#message').textContent='当前状态：'+p.status+storageWarning}
function setState(id,status){
 if(!['draft','generating','pending_confirmation'].includes(status))throw Error('Unsupported state');
 const index=players.findIndex(p=>p.id===id);if(index<0)throw Error('Unknown player');
 const p=clone(INITIAL[index]);p.status=status;p.ownerId='demo-owner-'+(index+1);
 p.materials={photos:['assets/02-山脊奔跑.png'],route:'routes/xiangzhi-reference-demo.gpx',scoreImage:'scores/0'+(index+1)+'.png'};
 p.score={elapsedTime:['01:42:36','02:08:19','01:56:48'][index],groupId:'demo-open',groupName:'体验组（演示）',groupRank:index===0?12:null,source:'fictional-fixture-not-official'};
 p.draft={note:'这是用于测试的虚构比赛经历。',updatedAt:'2026-11-17T00:00:00Z'};
 p.job=status==='generating'?{id:'mock-job-'+id,status:'running',simulated:true,autoComplete:false}:null;
 p.preview=status==='pending_confirmation'?{title:p.name+'的赛事记忆',text:'模拟 Agent 输出，尚未确认。',cover:p.materials.photos[0],score:clone(p.score),isSynthetic:true}:null;
 // Preserve the initially saved version until the user confirms its replacement.
 players[index]=p;persist();render();return clone(p);
}
for(const button of document.querySelectorAll('[data-state]'))button.onclick=()=>setState(picker.value,button.dataset.state);
picker.onchange=render;
function reset(){players=clone(INITIAL);persist();render()}
document.querySelector('#reset').onclick=reset;
document.querySelector('#export').onclick=()=>{const blob=new Blob([JSON.stringify({event:EVENT,players},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='internal-demo-state.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
window.demoFixtures={setState,reset,getState:()=>clone(players)};
render();
if(new URLSearchParams(location.search).has('selftest')){
 const before=clone(players);const check=(ok,msg)=>{if(!ok)throw Error(msg)};
 try{reset();check(players.map(p=>p.status).join(',')==='unclaimed,claimed_empty,saved','initial');
 for(const p of INITIAL)for(const status of ['draft','generating','pending_confirmation']){const result=setState(p.id,status);check(result.status===status&&result.ownerId&&result.materials.photos.length,'transition');check((result.job!==null)===(status==='generating'),'job');check((result.preview!==null)===(status==='pending_confirmation'),'preview');if(p.status==='saved')check(result.savedCard!==null,'saved version preserved')}
 reset();check(JSON.stringify(players)===JSON.stringify(INITIAL),'reset');document.body.dataset.testResult='PASS';}
 catch(e){document.body.dataset.testResult='FAIL';document.body.dataset.testError=String(e)}
 players=before;persist();render();
}
</script></html>'''
(root/'console.html').write_text(html.replace('__PLAYERS__',players).replace('__EVENT__',event))
print(root/'console.html')
