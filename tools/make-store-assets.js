const fs=require('fs'),path=require('path');
const puppeteer=require(path.join('D:','source','repos','vibe-code','News','node_modules','puppeteer'));
const OUT=path.join(__dirname,'..','store-assets');
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
  const p=await b.newPage();
  // banner 1280x640
  const banner=fs.readFileSync(path.join(__dirname,'banner-source.svg'),'utf8');
  await p.setViewport({width:1280,height:640,deviceScaleFactor:1});
  await p.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0">'+banner+'</body>',{waitUntil:'load'});
  await (await p.$('svg')).screenshot({path:path.join(OUT,'macroscan-banner-1280x640.png')});
  console.log('wrote store-assets/macroscan-banner-1280x640.png');
  // standalone store icon 256 (transparent) + on-white 256
  const logo=fs.readFileSync(path.join(__dirname,'icon-source.svg'),'utf8');
  await p.setViewport({width:256,height:256,deviceScaleFactor:1});
  await p.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent">'+logo+'</body>',{waitUntil:'load'});
  await (await p.$('svg')).screenshot({path:path.join(OUT,'macroscan-icon-256.png'),omitBackground:true});
  console.log('wrote store-assets/macroscan-icon-256.png');
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
