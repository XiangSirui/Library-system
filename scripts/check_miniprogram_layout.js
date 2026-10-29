'use strict';
// An isolated browser approximation of WeChat's WebView renderer.
// Uses the real WXML tree and compiled WXSS, never the user's browser profile.
// This is NOT a replacement for WeChat native component/device verification.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { createRequire } = require('node:module');
const { chromium } = require('playwright');
const { wxmlToJs, wxssToJs } = require('miniprogram-compiler');
const root = path.resolve(__dirname, '..'), mini = path.join(root, 'miniprogram');
const output = path.join(root, '.qa', 'layout');
const fixtures = require('../tests/layout-fixtures');
const widths = [320, 375, 414, 700, 768, 1024, 1440];
const escape = value => String(value == null ? '' : value).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
const nativeBase = `
html,body{margin:0;padding:0}
wx-page,wx-view,wx-scroll-view,wx-form,wx-picker,wx-checkbox-group{display:block}
wx-text,wx-label{display:inline}
wx-button:not([size="mini"]){width:184px}
wx-button{display:block;position:relative;text-align:center;box-sizing:border-box;overflow:hidden;cursor:pointer}
wx-input{display:flex;align-items:center}
wx-input input{width:100%;min-width:0;box-sizing:border-box;padding:0;border:0;background:transparent;font:inherit;color:inherit;outline:0}
wx-textarea{display:block}
wx-textarea textarea{display:block;width:100%;height:100%;box-sizing:border-box;padding:0;border:0;background:transparent;font:inherit;resize:none;color:inherit}
wx-checkbox{display:inline-block;width:24px;height:24px;vertical-align:middle}
wx-checkbox input{width:22px;height:22px;margin:0;accent-color:#315e46}
wx-switch{display:inline-block;width:52px;height:32px;background:#dce4d0;border-radius:18px}
wx-image{display:inline-block;width:320px;height:240px;overflow:hidden;position:relative;vertical-align:middle}
wx-image img{width:100%;height:100%;object-fit:cover;display:block}
wx-image[data-mode="widthFix"]{height:auto}
wx-image[data-mode="widthFix"] img{height:auto}
wx-scroll-view[scroll-y]{overflow-y:auto}
.preview-tab{height:54px;position:fixed;bottom:0;left:0;right:0;display:flex;align-items:center;justify-content:space-around;background:#fffefa;border-top:1px solid #e2e5d9;color:#727b70;font-size:13px;z-index:50}
body.has-tabs{padding-bottom:54px}
`;
function renderNode(node) {
  if (typeof node === 'string' || typeof node === 'number') return escape(node);
  if (!node) return '';
  const children = (node.children || []).map(renderNode).join('');
  if (!node.tag || node.tag === 'virtual') return children;
  const a = node.attr || {};
  const attributes = Object.entries(a).filter(([key]) => ['id','class','scroll-y'].includes(key) || key.startsWith('data-'))
    .map(([key,value]) => ' ' + key + '="' + escape(value) + '"').join('') + (a.disabled ? ' disabled' : '') + (a.scrollY ? ' scroll-y' : '');
  let body = children;
  if (node.tag === 'wx-input') body = '<input value="' + escape(a.value) + '" placeholder="' + escape(a.placeholder) + '"' + (a.password ? ' type="password"' : '') + ' />';
  if (node.tag === 'wx-textarea') body = '<textarea placeholder="' + escape(a.placeholder) + '">' + escape(a.value) + '</textarea>';
  if (node.tag === 'wx-checkbox') body = '<input type="checkbox"' + (a.checked ? ' checked' : '') + '/>';
  if (node.tag === 'wx-image') body = '<img src="' + escape(a.src) + '"/>';
  return '<' + node.tag + attributes + (a.mode ? ' data-mode="' + escape(a.mode) + '"' : '') + '>' + body + '</' + node.tag + '>';
}
function buildDocuments() {
  const cssText = {}, runtime = { window: { screen: { width:375,height:812 }, __styleSheetManager2__: {addItem(){},setCss(key,css){cssText[key]=css;}} }, navigator:{userAgent:'layout QA'},console };
  const templates = vm.runInNewContext('(function(global){' + wxmlToJs(mini) + '})({})',runtime);
  const style = vm.runInNewContext('(function(global){' + wxssToJs(mini) + '})({})',runtime);
  style('app.wxss')('');
  const globalStyle = Object.entries(cssText).filter(([key]) => key.includes('app.wxss')).map(([,css])=>css).join('\n');
  const documents = {};
  for (const [name, fixture] of Object.entries(fixtures)) {
    const file = path.join(mini,'pages',fixture.page,'index.js');
    let definition;
    vm.runInNewContext(fs.readFileSync(file,'utf8'),{Page(value){definition=value},require:createRequire(file)});
    const tree = templates('pages/' + fixture.page + '/index.wxml')({...definition.data,...fixture.data});
    style('pages/' + fixture.page + '/index.wxss')('');
    const localStyle = Object.entries(cssText).filter(([key])=>key.includes('pages/' + fixture.page + '/index.wxss')).map(([,css])=>css).join('\n');
    const tab = ['garden','books','room','mine'].includes(fixture.page);
    documents[name] = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Layout QA: '+name+'</title><style>' + nativeBase + globalStyle + localStyle + '</style></head><body class="' + (tab?'has-tabs':'')+'">' + renderNode(tree) + (tab?'<nav class="preview-tab"><span>花园</span><span>借书</span><span>活动室</span><span>我的</span></nav>':'') + '</body></html>';
  }
  return documents;
}
async function main() {
  fs.mkdirSync(output,{recursive:true});
  const documents = buildDocuments();
  const server = http.createServer((req,res) => {
    const url = new URL(req.url,'http://127.0.0.1');
    if(url.pathname.startsWith('/preview/')){
      const name=url.pathname.slice(9);
      if(!documents[name]) {res.writeHead(404).end();return}
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end(documents[name]);return;
    }
    if(url.pathname.startsWith('/static/images/')){
      const base=path.join(root,'static','images'), file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
      if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return}
      fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return}res.setHeader('Content-Type',file.endsWith('.png')?'image/png':'image/jpeg');res.end(data)});return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  const report=[];
  try {
    browser=await chromium.launch({headless:true,...(process.env.LAYOUT_BROWSER_PATH?{executablePath:process.env.LAYOUT_BROWSER_PATH}:process.platform==='win32'?{channel:'msedge'}:{})});
    const context=await browser.newContext({viewport:{width:375,height:900},deviceScaleFactor:1});
    const page=await context.newPage();
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='127.0.0.1')return route.continue();
      return route.abort();
    });
    for(const [name]of Object.entries(documents)){
      for(const width of widths){
        await page.setViewportSize({width,height:900});
        await page.goto('http://127.0.0.1:'+server.address().port+'/preview/'+name,{waitUntil:'load'});
        await page.evaluate(() => Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode().catch(() => {}))]));
        const metrics=await page.evaluate(()=>{
          const nodes=[...document.querySelectorAll('wx-view,wx-button,wx-text,wx-label,wx-picker,wx-input,wx-textarea,wx-image')];
          const visible=nodes.filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0});
          const outside=visible.filter(el=>{const r=el.getBoundingClientRect();return r.left<-.5||r.right>innerWidth+.5});
          const clipped=visible.filter(el=>{
            const style=getComputedStyle(el);
            return el.scrollWidth>el.clientWidth+2 && el.clientWidth>0 && style.display!=='inline' && el.tagName!=='WX-INPUT';
          });
          const badControls=visible.filter(el=>el.tagName==='WX-BUTTON'&&(el.getBoundingClientRect().width<36||el.getBoundingClientRect().height<36));
          const desc=el=>({tag:el.tagName,class:el.className,text:el.textContent.trim().slice(0,80),client:el.clientWidth,scroll:el.scrollWidth});
          const brokenImages=[...document.images].filter(el=>!el.complete||el.naturalWidth===0).map(el=>el.src);
          const grid=document.querySelector('.book-grid');
          return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,outside:outside.map(desc),clipped:clipped.map(desc),badControls:badControls.map(desc),brokenImages,bookColumns:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').length:null};
        });
        const failures=metrics.documentWidth>width+1||metrics.outside.length||metrics.clipped.length||metrics.badControls.length||metrics.brokenImages.length;
        const record={fixture:name,width,pass:!failures,...metrics};
        report.push(record);
        const capture=(width===375||width===1440);
        if(capture||failures) {
          await page.screenshot({path:path.join(output,name+'-'+width+'.png'),fullPage:true});
          if(capture) await page.screenshot({path:path.join(output,name+'-'+width+'-viewport.png')});
        }
        if(name==='admin-material') {
          const fixedClose=await page.evaluate(()=>{
            const body=document.querySelector('.material-card'), close=document.querySelector('.material-header wx-button');
            const before=close.getBoundingClientRect().top;
            body.scrollTop=body.scrollHeight;
            const after=close.getBoundingClientRect().top;
            return Math.abs(before-after)<1 && after>=0 && after<innerHeight && body.scrollHeight>body.clientHeight && body.scrollTop>0;
          });
          record.modalCloseRemainsVisible=fixedClose;
          if(!fixedClose)record.pass=false;
        }
      }
      console.log('Checked '+name+' at '+widths.length+' widths');
    }
    await context.close();
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({note:'Isolated browser approximation of compiled WXML/WXSS, not native WeChat verification.',widths,report},null,2));
  const failed=report.filter(item=>!item.pass);
  console.log('Layout checks: '+report.length+'; passed: '+(report.length-failed.length)+'; failed: '+failed.length);
  for(const item of failed)console.log(JSON.stringify({fixture:item.fixture,width:item.width,outside:item.outside.slice(0,4),clipped:item.clipped.slice(0,5),badControls:item.badControls,brokenImages:item.brokenImages}));
  console.log('Screenshots and measurements: .qa/layout/');
  if(failed.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1});
