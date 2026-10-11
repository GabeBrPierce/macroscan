const fs=require('fs'),path=require('path');
const puppeteer=require(path.join('D:','source','repos','vibe-code','News','node_modules','puppeteer'));
const OUT=path.join(__dirname,'..','store-assets');
(async()=>{
  const svg=fs.readFileSync(path.join(__dirname,'banner-240-source.svg'),'utf8');
  const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
  const p=await b.newPage();
  await p.setViewport({width:240,height:130,deviceScaleFactor:1});
  await p.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0">'+svg+'</body>',{waitUntil:'load'});
  await (await p.$('svg')).screenshot({path:path.join(OUT,'macroscan-banner-240x130.png')});
  await b.close();
  console.log('wrote store-assets/macroscan-banner-240x130.png');
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
