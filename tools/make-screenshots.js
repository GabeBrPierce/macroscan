const path=require('path'), fs=require('fs');
const puppeteer=require(path.join('D:','source','repos','vibe-code','News','node_modules','puppeteer'));
const OUT=path.join(__dirname,'..','store-assets','screenshots');
const URL='http://localhost:8790/index.html';

const seed = () => {
  function key(off){var d=new Date();d.setDate(d.getDate()-off);var m=String(d.getMonth()+1).padStart(2,'0');var day=String(d.getDate()).padStart(2,'0');return d.getFullYear()+'-'+m+'-'+day;}
  function E(name,per,grams,brand){return {id:Math.random().toString(36).slice(2),ts:Date.now(),name:name,brand:brand||'',per100:per,grams:grams,source:'off',servG:grams};}
  var diary={};
  diary[key(0)]=[
    E('Greek Yogurt',{kcal:59,protein:10,carb:4,fat:0.4},200,'Fage'),
    E('Banana',{kcal:89,protein:1.1,carb:23,fat:0.3},120,''),
    E('Grilled Chicken',{kcal:165,protein:31,carb:0,fat:3.6},200,''),
    E('Brown Rice',{kcal:123,protein:2.7,carb:26,fat:1},250,''),
    E('Almonds',{kcal:579,protein:21,carb:22,fat:50},30,'')
  ];
  var kc=[1780,2140,1660,1910,1840,2050,1590,1970,1720,1880,1630,2020,1900];
  for(var i=1;i<=13;i++){ if(i===4||i===9){continue;} var n=kc[i-1]/2; diary[key(i)]=[E('Lunch',{kcal:n,protein:30,carb:40,fat:12},100),E('Dinner',{kcal:n,protein:35,carb:45,fat:15},100)]; }
  var weights=[]; var w=[86.2,85.9,86.0,85.5,85.2,85.3,84.8,84.6,84.7,84.1,83.9];
  for(var j=0;j<w.length;j++){ weights.push({id:'w'+j,date:key(24-j*2),kg:w[j],ts:Date.now()-(w.length-j)*8.64e7}); }
  var now=new Date(),h=now.getHours();
  var recentFoods=[
    {id:'o_1',name:'Grilled Chicken Breast',brand:'',per100:{kcal:165,protein:31,carb:0,fat:3.6},source:'off'},
    {id:'o_2',name:'Banana',brand:'',per100:{kcal:89,protein:1.1,carb:23,fat:0.3},source:'off'},
    {id:'u_3',name:'Oatmeal, Rolled Oats',brand:'',per100:{kcal:379,protein:13,carb:67,fat:7},source:'usda'}
  ];
  var customFoods=[
    {id:'c_1',name:'Morning Protein Shake',brand:'',per100:{kcal:120,protein:24,carb:3,fat:1.5},source:'custom',serving:{label:'350 g',grams:350}}
  ];
  var data={settings:{calorieLimit:2000,proteinG:140,carbG:210,fatG:65,weightUnit:'lb',weightGoalKg:79.8,startOnQuickAdd:false,dayStartHour:Math.max(0,h-6),dayEndHour:Math.min(24,h+3),seeded:true},diary:diary,weights:weights,customFoods:customFoods,recentFoods:recentFoods};
  localStorage.setItem('macroscan.data',JSON.stringify(data));
};

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
  const p=await b.newPage();
  await p.setRequestInterception(true);
  p.on('request',r=>{ const u=r.url(); if(u.indexOf('kaiads')!==-1||u.indexOf('kaiads.com')!==-1){ r.abort(); } else r.continue(); });
  await p.setViewport({width:240,height:320,deviceScaleFactor:1});
  await p.goto(URL,{waitUntil:'load'});
  await p.waitForFunction("window.MS && MS.app");
  await p.evaluate(seed);
  await p.reload({waitUntil:'load'});
  await p.waitForFunction("window.MS && MS.app && document.querySelector('.cal-card')");
  const clip={x:0,y:0,width:240,height:320};
  const shot=async(name)=>{ await new Promise(r=>setTimeout(r,250)); await p.screenshot({path:path.join(OUT,name),clip}); console.log('wrote',name); };

  // 1 Today dashboard
  await p.evaluate("MS.app.setTab('today'); document.getElementById('screen').scrollTop=0;");
  await shot('01-today.png');
  // 2 Consistency + chart
  await p.evaluate("document.getElementById('screen').scrollTop=520;");
  await shot('02-consistency.png');
  // 3 Weight projection
  await p.evaluate("MS.app.setTab('weight'); document.getElementById('screen').scrollTop=0;");
  await shot('03-weight.png');
  // 4 Add / search
  await p.evaluate("MS.app.setTab('add'); document.getElementById('screen').scrollTop=0;");
  await shot('04-add.png');
  // 5 Quick add (prefilled)
  await p.evaluate(`MS.app.setTab('add'); var q=document.querySelector('[data-act=\\"quick\\"]'); q._onEnter();`);
  await p.evaluate(`(function(){var s=function(id,v){var e=document.getElementById(id); if(e){e.value=v;}}; s('qName','Chipotle bowl'); s('qKcal','720'); s('qProt','45'); s('qCarb','60'); s('qFat','28');})();`);
  await shot('05-quickadd.png');

  await b.close();
})().catch(e=>{console.error('ERR',e.message,e.stack);process.exit(1);});
