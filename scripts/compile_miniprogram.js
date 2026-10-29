'use strict';
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { wxmlToJs, wxssToJs } = require('miniprogram-compiler');
const root = path.resolve(__dirname, '../miniprogram');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
function main() {
  const generatedWxml = wxmlToJs(root);
  const generatedWxss = wxssToJs(root);
  const styles = {};
  const runtime = {
    window: { screen: { width: 375, height: 812 }, __styleSheetManager2__: { addItem() {}, setCss(key, css) { styles[key] = css; } } },
    navigator: { userAgent: 'MiniProgram compiler check' }, console
  };
  const templates = vm.runInNewContext('(function(global){' + generatedWxml + '})({})', runtime);
  const stylesheet = vm.runInNewContext('(function(global){' + generatedWxss + '})({})', runtime);
  for (const route of app.pages) {
    let definition;
    const script = path.join(root, route + '.js');
    vm.runInNewContext(fs.readFileSync(script, 'utf8'), { Page(value) { definition = value; }, require: createRequire(script) });
    const render = templates(route + '.wxml');
    if (typeof render !== 'function') throw new Error('Missing compiled template: ' + route);
    const tree = render(definition.data || {});
    if (!tree || tree.tag !== 'wx-page') throw new Error('Invalid rendered template: ' + route);
    const css = stylesheet(route + '.wxss');
    if (typeof css !== 'function') throw new Error('Missing compiled stylesheet: ' + route);
    css('');
  }
  if (typeof stylesheet('app.wxss') !== 'function') throw new Error('Global stylesheet missing');
  stylesheet('app.wxss')('');
  console.log('Official WXML/WXSS compilation and initial render OK: ' + app.pages.length + ' pages, ' + Object.keys(styles).length + ' stylesheets.');
  console.log('Real device preview still requires WeChat Developer Tools.');
}
try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
